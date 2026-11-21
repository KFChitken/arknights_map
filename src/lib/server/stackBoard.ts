import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { STACKTOP } from "../badges";
import { WEEK, weekStartOf } from "../hotList";
import { BOARD_NAMES, BOARD_SHOWN, BOARD_TOP } from "../squadFire";
import { STACK_BOARD_BLOCKS, towerNow, type StackBoard, type StackBoardName, type StackBoardRow, type StackMine } from "../squadMode";
import { db } from "./db";
import { nameList, namesOf, rankRooms, type Ranked } from "./fireBoard";
import { nudge } from "./live";
import { squadRooms, squadStackBlocks, squadStackTowers, squadStackWeeks, userBadges, users, type UserRow } from "./schema";
import { roomOf } from "./squad";

/**
 * 基建周榜 (基建加盖's towers; the numbers in src/lib/squadMode.ts), as 火焰周榜 (fireBoard.ts) with a tower (a room's
 * round) for a room: a week from Monday 04:00 Beijing time to the next, each tower counted in the week its first block
 * stood. Each block that stood keeps its tower's highest that week and when it first got there (squad_stack_towers),
 * and each player's blocks on each tower (squad_stack_blocks). A row is a tower: highest first, the earlier first
 * among those as high; it names the players who put STACK_BOARD_BLOCKS or more on it (real ones, none suspended),
 * BOARD_NAMES at most, those with most first, and is listed once it names BOARD_MIN; each counts once a week, in their
 * highest. The named of the first BOARD_TOP rows win 基建狂魔 for a week as the week is settled (settleStackWeek), by
 * the main process once after the Monday 04:00 that ends it. Pages get no times at all.
 */

type Exec = Pick<typeof db, "select">;
/** A tower's key in a ranking: its room and round */
const keyOf = (roomId: string, round: number) => `${roomId}:${round}`;
const partsOf = (key: string) => {
  const i = key.lastIndexOf(":");
  return { room: key.slice(0, i), round: Number(key.slice(i + 1)) };
};

/** A week's towers with all their counted blocks, ranked as of now (the suspended left out) */
async function rankWeek(exec: Exec, week: number, now: number): Promise<Ranked[]> {
  const when = new Date(week);
  const [towers, blocks] = await Promise.all([
    exec.select().from(squadStackTowers).where(eq(squadStackTowers.week, when)),
    exec
      .select()
      .from(squadStackBlocks)
      .where(and(eq(squadStackBlocks.week, when), gte(squadStackBlocks.blocks, STACK_BOARD_BLOCKS))),
  ]);
  const byTower = new Map<string, { user: string; sticks: number; first: number }[]>();
  for (const b of blocks) {
    const key = keyOf(b.roomId, b.round);
    const list = byTower.get(key) ?? [];
    list.push({ user: b.userId, sticks: b.blocks, first: b.firstAt.getTime() });
    byTower.set(key, list);
  }
  const ids = [...new Set(blocks.map((b) => b.userId))];
  const out = ids.length
    ? await exec
        .select({ id: users.id, until: users.suspendedUntil })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const suspended = new Set(out.filter((u) => u.until && u.until.getTime() > now).map((u) => u.id));
  return rankRooms(
    towers.map((t) => {
      const key = keyOf(t.roomId, t.round);
      return { room: key, peak: t.peak, peakAt: t.peakAt?.getTime() ?? 0, sticks: byTower.get(key) ?? [] };
    }),
    (u) => !suspended.has(u),
    STACK_BOARD_BLOCKS,
  );
}

/** This week's rows with their names, kept a little in each process (the board is the same to all but for 你) */
const KEEP_MS = 30_000;
type Held = { week: number; at: number; rows: (Ranked & { names: Map<string, StackBoardName> })[] };
const g = globalThis as unknown as { stackBoardHeld?: Held | null };

/** For the tests: the week's board worked out afresh */
export function forgetStackBoard() {
  g.stackBoardHeld = null;
}

async function thisWeek(now: number, hidden: string): Promise<Held> {
  const week = weekStartOf(now);
  const held = g.stackBoardHeld;
  if (held && held.week === week && now - held.at < KEEP_MS) return held;
  const ranked = (await rankWeek(db, week, now)).slice(0, BOARD_SHOWN);
  const names = await namesOf(
    ranked.flatMap((r) => r.named.map((n) => n.user)),
    hidden,
  );
  const fresh: Held = { week, at: now, rows: ranked.map((r) => ({ ...r, names })) };
  g.stackBoardHeld = fresh;
  return fresh;
}

/**
 * 基建周榜 for a player (POST /api/squad/stackboard): this week's (till it is settled: left, ms) or last week's as it
 * was settled (got: won 基建狂魔); how many won, or would as it is now; and 你们这座 (StackMine). words: 「一位舟P」
 * and 「你」, in the asker's language.
 */
export async function stackBoard(
  user: Pick<UserRow, "id">,
  which: "this" | "last",
  words: { hidden: string; you: string },
  now = Date.now(),
): Promise<StackBoard> {
  const weekNow = weekStartOf(now);
  if (which === "last") {
    const [saved] = await db.select().from(squadStackWeeks).where(eq(squadStackWeeks.week, new Date(weekNow - WEEK)));
    const board = saved?.board ?? [];
    const names = await namesOf(
      board.flatMap((r) => r.users),
      words.hidden,
    );
    const rows: StackBoardRow[] = board.map((r) => ({
      rank: r.rank,
      peak: r.peak,
      names: nameList(r.users, names, user.id, words.you),
      ...(r.rank <= BOARD_TOP ? { got: true as const } : {}),
      ...(r.users.includes(user.id) ? { mine: true as const } : {}),
    }));
    const holders = board.filter((r) => r.rank <= BOARD_TOP).reduce((n, r) => n + r.users.length, 0);
    const row = rows.find((r) => r.mine);
    return { week: "last", rows, holders, mine: row ? { rank: row.rank, peak: row.peak, names: row.names, say: "old" } : null, now };
  }
  const [held, here] = await Promise.all([thisWeek(now, words.hidden), hereOf(user.id, now)]);
  const named = held.rows.findIndex((r) => r.named.some((n) => n.user === user.id));
  const old = here !== null && here.week !== null && here.week < weekNow;
  // the tower pinned: the one you are named on, else the room's tower now when you put a block on it
  const mineHere = here && here.blocks > 0 ? here : null;
  const pinned = named >= 0 ? held.rows[named].room : mineHere?.key;
  const rows: StackBoardRow[] = held.rows.map((r, i) => ({
    rank: i + 1,
    peak: r.peak,
    names: nameList(
      r.named.map((n) => n.user),
      r.names,
      user.id,
      words.you,
    ),
    ...(r.room === pinned ? { mine: true as const } : {}),
  }));
  const holders = held.rows.slice(0, BOARD_TOP).reduce((n, r) => n + r.named.length, 0);
  const mine = named >= 0 ? sayOf(held, named, user.id, words) : mineHere ? hereSay(held, mineHere, user.id, weekNow, words) : null;
  return { week: "this", rows, holders, left: weekNow + WEEK - now, mine, ...(old ? { old: true as const } : {}), now };
}

/** The tower in the player's room now: its key, week (null: no block stood on it yet), height, and the player's blocks on it */
async function hereOf(userId: string, now: number) {
  const mine = await roomOf(db, userId);
  if (!mine) return null;
  const [room] = await db.select({ stack: squadRooms.stack, createdAt: squadRooms.createdAt }).from(squadRooms).where(eq(squadRooms.id, mine.room.id));
  if (!room) return null;
  const tower = towerNow(room.stack, room.createdAt.getTime(), now);
  const [[own], [row]] = await Promise.all([
    db
      .select({ blocks: squadStackBlocks.blocks })
      .from(squadStackBlocks)
      .where(and(eq(squadStackBlocks.roomId, mine.room.id), eq(squadStackBlocks.round, tower.round), eq(squadStackBlocks.userId, userId))),
    db
      .select({ week: squadStackTowers.week, peak: squadStackTowers.peak })
      .from(squadStackTowers)
      .where(and(eq(squadStackTowers.roomId, mine.room.id), eq(squadStackTowers.round, tower.round))),
  ]);
  return { key: keyOf(mine.room.id, tower.round), week: row ? row.week.getTime() : null, peak: row?.peak ?? 0, blocks: own?.blocks ?? 0 };
}

type Here = NonNullable<Awaited<ReturnType<typeof hereOf>>>;

/** 你们这座 when you are named on row i: in the top, or how far below it */
function sayOf(held: Held, i: number, userId: string, words: { hidden: string; you: string }): StackMine {
  const row = held.rows[i];
  const base = { rank: i + 1, peak: row.peak, names: nameList(row.named.map((n) => n.user), row.names, userId, words.you) };
  if (i < BOARD_TOP) return { ...base, say: "in", n: row.named.length };
  return { ...base, say: "below", d: Math.max(1, held.rows[BOARD_TOP - 1].peak - row.peak + 1) };
}

/** 你们这座 for the room's tower now, you not named anywhere: last week's, short of a name in the top, below it, or not listed */
function hereSay(held: Held, here: Here, userId: string, weekNow: number, words: { hidden: string; you: string }): StackMine {
  if (here.week !== null && here.week < weekNow) return { rank: null, peak: here.peak, names: [], say: "old" };
  const i = held.rows.findIndex((r) => r.room === here.key);
  if (i < 0) return { rank: null, peak: here.peak, names: [], say: "off" };
  const row = held.rows[i];
  const base = { rank: i + 1, peak: row.peak, names: nameList(row.named.map((n) => n.user), row.names, userId, words.you) };
  if (i >= BOARD_TOP) return { ...base, say: "below", d: Math.max(1, held.rows[BOARD_TOP - 1].peak - row.peak + 1) };
  // to be named here: STACK_BOARD_BLOCKS at least, and more than the last named while the row is full
  const full = row.named.length >= BOARD_NAMES;
  const k = Math.max(STACK_BOARD_BLOCKS, full ? row.named[row.named.length - 1].sticks + 1 : 0) - here.blocks;
  return { ...base, say: "short", k: Math.max(1, k) };
}

/**
 * The week before this one settled (the main process, every few minutes; once a week it finds one to do), as
 * 火焰周榜's: its board kept as it is now, 基建狂魔 given to the named of its first BOARD_TOP towers (earned as it
 * ended, the place as the serial, to pop up again; worn a week more by one who already had it), their open pages told;
 * everything from before it cleared. One transaction: a second try finds it done. Who was given it.
 */
export async function settleStackWeek(now = Date.now()) {
  const week = weekStartOf(now) - WEEK;
  const given = await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(squadStackWeeks)
      .values({ week: new Date(week), settledAt: new Date(now), board: [] })
      .onConflictDoNothing()
      .returning({ week: squadStackWeeks.week });
    if (!made) return null;
    const ranked = (await rankWeek(tx, week, now)).slice(0, BOARD_SHOWN);
    const board = ranked.map((r, i) => ({ rank: i + 1, peak: r.peak, ...partsOf(r.room), users: r.named.map((n) => n.user) }));
    await tx.update(squadStackWeeks).set({ board }).where(eq(squadStackWeeks.week, new Date(week)));
    const earnedAt = new Date(week + WEEK);
    const won = board.filter((r) => r.rank <= BOARD_TOP).flatMap((r) => r.users.map((userId) => ({ userId, badge: STACKTOP, earnedAt, serial: r.rank })));
    if (won.length) {
      await tx
        .insert(userBadges)
        .values(won)
        .onConflictDoUpdate({
          target: [userBadges.userId, userBadges.badge],
          set: { earnedAt: sql`excluded.earned_at`, serial: sql`excluded.serial`, seenAt: null },
        });
    }
    await tx.delete(squadStackTowers).where(lt(squadStackTowers.week, new Date(week)));
    await tx.delete(squadStackBlocks).where(lt(squadStackBlocks.week, new Date(week)));
    await tx.delete(squadStackWeeks).where(lt(squadStackWeeks.week, new Date(week)));
    return won.map((w) => w.userId);
  });
  if (given?.length) nudge(given);
  return given;
}
