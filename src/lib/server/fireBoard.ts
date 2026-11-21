import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { FIREWATCH } from "../badges";
import { WEEK, weekStartOf } from "../hotList";
import { displayName } from "../profile";
import {
  BOARD_MIN,
  BOARD_NAMES,
  BOARD_SHOWN,
  BOARD_STICKS,
  BOARD_TOP,
  fireColor,
  type FireBoard,
  type FireBoardName,
  type FireBoardRow,
  type FireMine,
} from "../squadFire";
import { db } from "./db";
import { nudge } from "./live";
import { squadFireRooms, squadFireSticks, squadFireWeeks, userBadges, users, type UserRow } from "./schema";
import { roomOf } from "./squad";
import { profileOf } from "./world";

/**
 * 火焰周榜 (篝火不封顶; the numbers in src/lib/squadFire.ts): a week from Monday 04:00 Beijing time (weekStartOf) to
 * the next, each room counted in the week it was opened. Adding wood (squadPlay.addWood) keeps each room's highest
 * level that week and when it first got there (squad_fire_rooms), and each player's sticks on each room's fire
 * (squad_fire_sticks). A row is a room: highest first, the earlier first among those as high; it names the players
 * who put BOARD_STICKS or more on it (real ones, none suspended), BOARD_NAMES at most, those with most first (the
 * earlier first among equals), and is listed once it names BOARD_MIN; going down the rows, one already named in a
 * higher room is not named again (each counts once a week, in their highest), and a room left with fewer drops off.
 * The named of the first BOARD_TOP rooms win 篝火守夜人 for a week, given as the week is settled: by the main process,
 * once, the first look after the Monday 04:00 that ends it (settleFireWeek), which keeps that board as it was and
 * clears all from before it. Pages get no times at all.
 */

/** A room of a week, as ranked: its highest level, when it got there, and who put how many on (and their first) */
export type BoardRoom = { room: string; peak: number; peakAt: number; sticks: { user: string; sticks: number; first: number }[] };
/** A row as ranked: the room, its highest level, the players named (ids, with their sticks) */
export type Ranked = { room: string; peak: number; named: { user: string; sticks: number }[] };

/**
 * The week's rows, best first (see above); counts: whether a player may be named (real, not suspended); least: what
 * one must have put on a row to be named there (基建周榜's towers rank the same way, with their blocks)
 */
export function rankRooms(rooms: readonly BoardRoom[], counts: (user: string) => boolean, least = BOARD_STICKS): Ranked[] {
  const order = rooms.filter((r) => r.peak > 0).sort((a, b) => b.peak - a.peak || a.peakAt - b.peakAt || (a.room < b.room ? -1 : 1));
  const named = new Set<string>();
  const rows: Ranked[] = [];
  for (const r of order) {
    const these = r.sticks
      .filter((s) => s.sticks >= least && counts(s.user) && !named.has(s.user))
      .sort((a, b) => b.sticks - a.sticks || a.first - b.first)
      .slice(0, BOARD_NAMES);
    if (these.length < BOARD_MIN) continue;
    for (const s of these) named.add(s.user);
    rows.push({ room: r.room, peak: r.peak, named: these.map((s) => ({ user: s.user, sticks: s.sticks })) });
  }
  return rows;
}

type Exec = Pick<typeof db, "select">;

/** A week's rooms with all their counted sticks, ranked as of now (the suspended left out) */
async function rankWeek(exec: Exec, week: number, now: number): Promise<Ranked[]> {
  const when = new Date(week);
  const [rooms, sticks] = await Promise.all([
    exec.select().from(squadFireRooms).where(eq(squadFireRooms.week, when)),
    exec
      .select()
      .from(squadFireSticks)
      .where(and(eq(squadFireSticks.week, when), gte(squadFireSticks.sticks, BOARD_STICKS))),
  ]);
  const byRoom = new Map<string, BoardRoom["sticks"]>();
  for (const s of sticks) {
    const list = byRoom.get(s.roomId) ?? [];
    list.push({ user: s.userId, sticks: s.sticks, first: s.firstAt.getTime() });
    byRoom.set(s.roomId, list);
  }
  const ids = [...new Set(sticks.map((s) => s.userId))];
  const out = ids.length
    ? await exec
        .select({ id: users.id, until: users.suspendedUntil })
        .from(users)
        .where(inArray(users.id, ids))
    : [];
  const suspended = new Set(out.filter((u) => u.until && u.until.getTime() > now).map((u) => u.id));
  return rankRooms(
    rooms.map((r) => ({ room: r.roomId, peak: r.peak, peakAt: r.peakAt?.getTime() ?? 0, sticks: byRoom.get(r.roomId) ?? [] })),
    (u) => !suspended.has(u),
  );
}

/** Names as the board writes them: as in the rooms, with their roach's look; 「一位舟P」 for one who keeps theirs off; the gone left out */
export async function namesOf(ids: readonly string[], hidden: string): Promise<Map<string, FireBoardName>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(users).where(inArray(users.id, [...ids]));
  return new Map(
    rows.map((u: UserRow) => {
      if (u.squadFireHide) return [u.id, { name: hidden }];
      const p = profileOf(u);
      return [u.id, { name: displayName(p), look: { color: p.color, avatar: p.avatar } }];
    }),
  );
}

/** This week's rows with their names, kept a little in each process (the board is the same to all but for 你) */
const KEEP_MS = 30_000;
type Held = { week: number; at: number; rows: (Ranked & { names: Map<string, FireBoardName> })[] };
const g = globalThis as unknown as { fireBoardHeld?: Held | null };

/** For the tests: the week's board worked out afresh */
export function forgetFireBoard() {
  g.fireBoardHeld = null;
}

async function thisWeek(now: number, hidden: string): Promise<Held> {
  const week = weekStartOf(now);
  const held = g.fireBoardHeld;
  if (held && held.week === week && now - held.at < KEEP_MS) return held;
  const ranked = (await rankWeek(db, week, now)).slice(0, BOARD_SHOWN);
  const names = await namesOf(
    ranked.flatMap((r) => r.named.map((n) => n.user)),
    hidden,
  );
  const fresh: Held = { week, at: now, rows: ranked.map((r) => ({ ...r, names })) };
  g.fireBoardHeld = fresh;
  return fresh;
}

export const nameList = (users: readonly string[], names: Map<string, FireBoardName>, viewerId: string, you: string): FireBoardName[] =>
  users.flatMap((u) => {
    const name = names.get(u);
    if (u === viewerId) return [{ name: you, ...(name?.look ? { look: name.look } : {}), you: true as const }];
    return name === undefined ? [] : [name];
  });

/**
 * 火焰周榜 for a player (POST /api/squad/fireboard): this week's (till it is settled: left, ms) or last week's as it
 * was settled (got: won 篝火守夜人); how many won, or would as it is now; and 你们这堆, the room they are in now, with
 * the one thing to say of it (FireMine.say). words: 「一位舟P」 and 「你」, in the asker's language.
 */
export async function fireBoard(
  user: Pick<UserRow, "id">,
  which: "this" | "last",
  words: { hidden: string; you: string },
  now = Date.now(),
): Promise<FireBoard> {
  const weekNow = weekStartOf(now);
  const mine = await roomOf(db, user.id);
  const roomWeek = mine ? weekStartOf(mine.room.createdAt.getTime()) : null;
  if (which === "last") {
    const [saved] = await db.select().from(squadFireWeeks).where(eq(squadFireWeeks.week, new Date(weekNow - WEEK)));
    const board = saved?.board ?? [];
    const names = await namesOf(
      board.flatMap((r) => r.users),
      words.hidden,
    );
    const rows: FireBoardRow[] = board.map((r) => ({
      rank: r.rank,
      peak: r.peak,
      color: fireColor(r.peak).color,
      names: nameList(r.users, names, user.id, words.you),
      ...(r.rank <= BOARD_TOP ? { got: true as const } : {}),
      ...(mine && r.room === mine.room.id ? { mine: true as const } : {}),
    }));
    const holders = board.filter((r) => r.rank <= BOARD_TOP).reduce((n, r) => n + r.users.length, 0);
    const row = rows.find((r) => r.mine);
    return {
      week: "last",
      rows,
      holders,
      mine: row ? { rank: row.rank, peak: row.peak, color: row.color, names: row.names, say: "old" } : null,
      now,
    };
  }
  const held = await thisWeek(now, words.hidden);
  const rows: FireBoardRow[] = held.rows.map((r, i) => ({
    rank: i + 1,
    peak: r.peak,
    color: fireColor(r.peak).color,
    names: nameList(
      r.named.map((n) => n.user),
      r.names,
      user.id,
      words.you,
    ),
    ...(mine && r.room === mine.room.id ? { mine: true as const } : {}),
  }));
  const holders = held.rows.slice(0, BOARD_TOP).reduce((n, r) => n + r.named.length, 0);
  return { week: "this", rows, holders, left: weekNow + WEEK - now, mine: mine ? await mineOf(user.id, mine.room.id, roomWeek!, weekNow, held, words) : null, now };
}

/** 你们这堆: the room the player is in, where it is this week, and the first of these that is so (FireMine.say) */
async function mineOf(viewerId: string, roomId: string, roomWeek: number, weekNow: number, held: Held, words: { hidden: string; you: string }): Promise<FireMine> {
  const [peakRow] = await db.select({ peak: squadFireRooms.peak }).from(squadFireRooms).where(eq(squadFireRooms.roomId, roomId));
  const peak = peakRow?.peak ?? 0;
  const base = { peak, color: fireColor(peak).color };
  if (roomWeek < weekNow) return { ...base, rank: null, names: [], say: "old" };
  const at = held.rows.findIndex((r) => r.room === roomId);
  const row = at < 0 ? null : held.rows[at];
  const names = row
    ? nameList(
        row.named.map((n) => n.user),
        row.names,
        viewerId,
        words.you,
      )
    : [];
  const rank = row ? at + 1 : null;
  const top = rank !== null && rank <= BOARD_TOP;
  if (top && row!.named.some((n) => n.user === viewerId)) return { ...base, rank, names, say: "in", n: row!.named.length };
  // named in another room (each counts once, in the highest they are named in)
  const other = held.rows.findIndex((r) => r.room !== roomId && r.named.some((n) => n.user === viewerId));
  const elsewhere = other < 0 ? null : other + 1;
  if (top && (elsewhere === null || elsewhere > rank!)) {
    const [own] = await db
      .select({ sticks: squadFireSticks.sticks })
      .from(squadFireSticks)
      .where(and(eq(squadFireSticks.roomId, roomId), eq(squadFireSticks.userId, viewerId)));
    // to be named here: BOARD_STICKS at least, and more than the last named while the row is full
    const full = row!.named.length >= BOARD_NAMES;
    const k = Math.max(BOARD_STICKS, full ? row!.named[row!.named.length - 1].sticks + 1 : 0) - (own?.sticks ?? 0);
    if (k > 0) return { ...base, rank, names, say: "short", k };
  }
  if (elsewhere !== null) return { ...base, rank, names, say: "elsewhere", r: elsewhere };
  if (row && !top) {
    const cut = held.rows[BOARD_TOP - 1];
    return { ...base, rank, names, say: "below", d: Math.max(1, cut.peak - row.peak + 1) };
  }
  if (row) return { ...base, rank, names, say: "in", n: row.named.length };
  return { ...base, rank: null, names: [], say: "off" };
}

/**
 * The week before this one settled (the main process, every few minutes; once a week it finds one to do): its board
 * kept as it is now, 篝火守夜人 given to the named of its first BOARD_TOP rooms (earned as it ended, the place as the
 * serial, to pop up again; worn on a week more by one who already had it), their open pages told; and everything from
 * before it cleared. Done in one transaction, so a second try finds it done and does nothing. Who was given it.
 */
export async function settleFireWeek(now = Date.now()) {
  const week = weekStartOf(now) - WEEK;
  const given = await db.transaction(async (tx) => {
    const [made] = await tx
      .insert(squadFireWeeks)
      .values({ week: new Date(week), settledAt: new Date(now), board: [] })
      .onConflictDoNothing()
      .returning({ week: squadFireWeeks.week });
    if (!made) return null;
    const ranked = (await rankWeek(tx, week, now)).slice(0, BOARD_SHOWN);
    const board = ranked.map((r, i) => ({ rank: i + 1, peak: r.peak, room: r.room, users: r.named.map((n) => n.user) }));
    await tx.update(squadFireWeeks).set({ board }).where(eq(squadFireWeeks.week, new Date(week)));
    const earnedAt = new Date(week + WEEK);
    const won = board.filter((r) => r.rank <= BOARD_TOP).flatMap((r) => r.users.map((userId) => ({ userId, badge: FIREWATCH, earnedAt, serial: r.rank })));
    if (won.length) {
      await tx
        .insert(userBadges)
        .values(won)
        .onConflictDoUpdate({
          target: [userBadges.userId, userBadges.badge],
          set: { earnedAt: sql`excluded.earned_at`, serial: sql`excluded.serial`, seenAt: null },
        });
    }
    await tx.delete(squadFireRooms).where(lt(squadFireRooms.week, new Date(week)));
    await tx.delete(squadFireSticks).where(lt(squadFireSticks.week, new Date(week)));
    await tx.delete(squadFireWeeks).where(lt(squadFireWeeks.week, new Date(week)));
    return won.map((w) => w.userId);
  });
  if (given?.length) nudge(given);
  return given;
}
