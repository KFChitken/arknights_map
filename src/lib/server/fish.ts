import "server-only";
import { and, count, desc, eq, gt, inArray, isNull, lt, max, ne, or, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { dexCells, FISH_ITEMS, inDex, itemOf, SIZE_PERFECT, type FishSpot } from "../fish/items";
import { dryAfter, junkAfter, rollCatch } from "../fish/roll";
import {
  ADMIRAL_AFTER,
  biteAfter,
  CASTS_A_DAY,
  FISH_FULL,
  FISH_NO_LINE,
  FISH_NOT_YET,
  onTime,
  SCHOOL_CHANCE,
  SCHOOL_MS,
  SCHOOLS_A_ROUND,
  SHOUT_TIER,
  type FishCatch,
  type FishDex,
  type FishLine,
  type FishShadow,
  type FishShout,
  type FishState,
} from "../fish/rules";
import { siteDay } from "../siteDay";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { fishMode } from "./env";
import { HttpError } from "./http";
import { fishDays, fishDex as dexRows, fishLines, fishRecords, fishShouts, squadMembers, squadRooms, type UserRow } from "./schema";
import { sayFishInRoom, tellSquadPond } from "./squad";
import { squadOpen } from "./squadOpen";

/**
 * 钓鳞: a line in the water at a time for each player (fish_lines), its catch drawn as it goes in (src/lib/fish/roll.ts)
 * and told only once it is pulled in; the day's casts and streaks (fish_days, a site day from 04:00 Beijing time); the
 * dex (fish_dex) and the site's biggest of each (fish_records, no names); purple-or-better catches said on the bank for
 * a while with no name (fish_shouts). The bank (pier) is switched by FISH (env.ts); 卫戍池塘 (pond), a room of
 * 一起卫戍's own, goes with SQUAD: a line there tells the room, purple and better is said to it with the name, its 鳞
 * count for 爆护, and a 鱼群 comes now and then once all its real players fish. The net (auto) comes later.
 */

const DAY = 86_400_000;
/** A purple-or-better catch is said on the bank this long */
const SHOUT_KEEP_MS = 5 * 60_000;
/** How long the count of lines on the bank is kept before it is asked again (each process) */
const BANK_FRESH_MS = 5_000;
/** fish_days kept this many days back */
const DAYS_KEPT = 7;

const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);

/** Whether this player may fish on the bank: everyone signed in (on), the 站长 and the admins (admins), or nobody (off) */
export function fishOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = fishMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/** Whether 钓鳞's requests are this player's at all: the bank's (FISH), or 卫戍池塘's (SQUAD) */
export const fishAny = (user: Pick<UserRow, "id" | "email">) => fishOpen(user) || squadOpen(user);

/** The room of 一起卫戍 the player is in, for 卫戍池塘: its id, the player's number in it, its real players, its 鱼群 */
async function pondOf(userId: string, now: number) {
  const [mine] = await db
    .select({ roomId: squadMembers.roomId, h: squadMembers.handle, schoolUntil: squadRooms.schoolUntil, schools: squadRooms.schools })
    .from(squadMembers)
    .innerJoin(squadRooms, eq(squadRooms.id, squadMembers.roomId))
    .where(and(eq(squadMembers.userId, userId), isNull(squadMembers.leftAt), isNull(squadRooms.endedAt)));
  if (!mine) return null;
  const people = await db
    .select({ userId: squadMembers.userId })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, mine.roomId), isNull(squadMembers.leftAt)));
  const ids = people.map((p) => p.userId);
  const [others] = await db
    .select({ n: count() })
    .from(fishLines)
    .where(and(inArray(fishLines.userId, ids), ne(fishLines.userId, userId), eq(fishLines.spot, "pond")));
  return {
    roomId: mine.roomId,
    h: mine.h,
    real: ids.length,
    othersIn: Number(others?.n ?? 0),
    school: Boolean(mine.schoolUntil && mine.schoolUntil.getTime() > now),
    schools: mine.schools,
  };
}

/**
 * 鱼群: every real player in the room with a line in, two or more, none on now and fewer than SCHOOLS_A_ROUND this 局:
 * a cast brings one SCHOOL_CHANCE of the time, SCHOOL_MS long, and the room is told
 */
async function maybeSchool(pond: NonNullable<Awaited<ReturnType<typeof pondOf>>>, now: number, random: () => number) {
  if (pond.school || pond.schools >= SCHOOLS_A_ROUND || pond.real < 2 || pond.othersIn + 1 < pond.real || random() >= SCHOOL_CHANCE) return;
  const [came] = await db
    .update(squadRooms)
    .set({ schoolUntil: new Date(now + SCHOOL_MS), schools: sql`${squadRooms.schools} + 1` })
    .where(
      and(
        eq(squadRooms.id, pond.roomId),
        lt(squadRooms.schools, SCHOOLS_A_ROUND),
        or(isNull(squadRooms.schoolUntil), lt(squadRooms.schoolUntil, new Date(now))),
      ),
    )
    .returning({ id: squadRooms.id });
  if (came) await tellSquadPond(pond.roomId);
}

/** The player's hour by their own clock, from minutes east of UTC as the page gives them (nothing given: Beijing) */
export function localHour(now: number, tz: unknown): number {
  const off = typeof tz === "number" && Number.isInteger(tz) && tz >= -720 && tz <= 840 ? tz : 480;
  return new Date(now + off * 60_000).getUTCHours();
}

let bankAt = 0;
let bankLines = 0;
/** Lines in the water on the bank, everyone's (counted again every BANK_FRESH_MS) */
async function bankCount(now: number): Promise<number> {
  if (now - bankAt < BANK_FRESH_MS) return bankLines;
  const [row] = await db.select({ n: count() }).from(fishLines).where(eq(fishLines.spot, "pier"));
  bankAt = now;
  bankLines = Number(row?.n ?? 0);
  return bankLines;
}
/** For the tests: count again on the next ask */
export const forgetBank = () => {
  bankAt = 0;
};

const lineOf = (row: typeof fishLines.$inferSelect): FishLine => ({
  spot: row.spot as FishSpot,
  castAt: row.castAt.getTime(),
  biteAt: row.biteAt.getTime(),
  shadow: row.shadow as FishShadow,
});

/** The dex's cells caught: each item shown in it, and each variant */
async function ownedCells(userId: string): Promise<number> {
  const shown = FISH_ITEMS.filter(inDex).map((i) => i.no);
  const [row] = await db
    .select({ n: count() })
    .from(dexRows)
    .where(and(eq(dexRows.userId, userId), inArray(dexRows.item, shown)));
  return Number(row?.n ?? 0);
}

/**
 * How the bank stands for the player: today's casts, the line in the water, the dex caught, the others on the bank,
 * whether they are today's 空军司令, and the purple-or-better catches said there since `after` (a shout's id; none
 * given, none said, only the newest id to go on from)
 */
export async function fishState(user: Pick<UserRow, "id">, after: unknown, now = Date.now()): Promise<FishState & { lastShout: number }> {
  const day = siteDay(now);
  const [[today], [line], owned, bank] = await Promise.all([
    db.select().from(fishDays).where(and(eq(fishDays.userId, user.id), eq(fishDays.day, day))),
    db.select().from(fishLines).where(eq(fishLines.userId, user.id)),
    ownedCells(user.id),
    bankCount(now),
  ]);
  const since = typeof after === "number" && Number.isInteger(after) && after >= 0 ? after : null;
  const recent = await db
    .select({ id: fishShouts.id, no: fishShouts.item, variant: fishShouts.variant, cm: fishShouts.cm, userId: fishShouts.userId })
    .from(fishShouts)
    .where(and(eq(fishShouts.spot, "pier"), gt(fishShouts.at, new Date(now - SHOUT_KEEP_MS)), since === null ? sql`true` : gt(fishShouts.id, since)))
    .orderBy(desc(fishShouts.id))
    .limit(5);
  // the first ask goes on from the newest said, not from what was said before the page opened
  const [newest] = since === null ? await db.select({ id: max(fishShouts.id) }).from(fishShouts) : [];
  const lastShout = Math.max(since ?? 0, Number(newest?.id ?? 0), ...recent.map((r) => r.id));
  const shouts: FishShout[] = since === null ? [] : recent.filter((r) => r.userId !== user.id).map(({ id, no, variant, cm }) => ({ id, no, variant, cm }));
  return {
    now,
    day,
    casts: today?.casts ?? 0,
    line: line ? lineOf(line) : null,
    owned,
    cells: dexCells(),
    // the others: the player's own line on the bank is not one of them
    bank: Math.max(0, bank - (line?.spot === "pier" ? 1 : 0)),
    admiral: today?.admiral ?? false,
    shouts: shouts.reverse(),
    lastShout,
  };
}

/**
 * A cast: one of the day's CASTS_A_DAY (refused once they are gone), and the line in the water, drawn now (what is on
 * the hook, its size and shadow, when it bites), in place of any line the player had in (not given back). Only the
 * bank (pier) in this part. tz: the page's minutes east of UTC, for the hours some things bite in.
 */
export async function castLine(
  user: Pick<UserRow, "id" | "email">,
  body: Record<string, unknown>,
  now = Date.now(),
  random: () => number = Math.random,
): Promise<{ now: number; casts: number; line: FishLine }> {
  if (body.spot !== "pier" && body.spot !== "pond") throw refuse(400, T.server.fish.badSpot);
  const spot: FishSpot = body.spot;
  // the bank is FISH's; 卫戍池塘 is the room's, for one in a room
  const pond = spot === "pond" ? await pondOf(user.id, now) : null;
  if (spot === "pond" && !pond) throw refuse(409, T.server.fish.noPond);
  if (spot === "pier" && !fishOpen(user)) throw refuse(404, T.server.routes.fish.notHere);
  const cast = await castIn(user, spot, pond, body, now, random);
  // 卫戍池塘: the room sees the float by the caster, and a 鱼群 may come
  if (pond) {
    await tellSquadPond(pond.roomId, pond.h);
    await maybeSchool(pond, now, random);
  }
  return cast;
}

/** The cast itself, in one go: the day's count, the draw, the line in */
async function castIn(
  user: Pick<UserRow, "id">,
  spot: FishSpot,
  pond: Awaited<ReturnType<typeof pondOf>>,
  body: Record<string, unknown>,
  now: number,
  random: () => number,
): Promise<{ now: number; casts: number; line: FishLine }> {
  const day = siteDay(now);
  // the others on the bank: the player's own line there is not one of them
  const [[own], bank] = await Promise.all([db.select({ spot: fishLines.spot }).from(fishLines).where(eq(fishLines.userId, user.id)), bankCount(now)]);
  const crowd = Math.max(0, bank - (own?.spot === "pier" ? 1 : 0));
  const needs = [...new Set(FISH_ITEMS.flatMap((i) => (i.when?.after ? [i.when.after[0]] : [])))];
  return db.transaction(async (tx) => {
    // the day's row, a cast more while there are any left (it holds the player's other casts back till this one is in)
    const [today] = await tx
      .insert(fishDays)
      .values({ userId: user.id, day, casts: 1 })
      .onConflictDoUpdate({
        target: [fishDays.userId, fishDays.day],
        set: { casts: sql`${fishDays.casts} + 1` },
        setWhere: lt(fishDays.casts, CASTS_A_DAY),
      })
      .returning({ casts: fishDays.casts, dry: fishDays.dry });
    if (!today) throw refuse(429, fmt(T.server.fish.full, { n: CASTS_A_DAY }), FISH_FULL);
    if (today.casts === 1) await tx.delete(fishDays).where(and(eq(fishDays.userId, user.id), lt(fishDays.day, siteDay(now - DAYS_KEPT * DAY))));
    const caught = new Map<number, number>();
    if (needs.length) {
      const rows = await tx
        .select({ item: dexRows.item, n: sql<number>`sum(${dexRows.n})::int` })
        .from(dexRows)
        .where(and(eq(dexRows.userId, user.id), inArray(dexRows.item, needs)))
        .groupBy(dexRows.item);
      for (const r of rows) caught.set(r.item, r.n);
    }
    const roll = rollCatch({
      spot,
      dry: today.dry,
      hour: localHour(now, body.tz),
      crowd,
      caught: (no) => caught.get(no) ?? 0,
      ...(pond ? { together: pond.othersIn + 1, school: pond.school } : {}),
      random,
    });
    await tx
      .update(fishDays)
      .set({ dry: dryAfter(today.dry, roll.tier) })
      .where(and(eq(fishDays.userId, user.id), eq(fishDays.day, day)));
    const row = { spot, castAt: new Date(now), biteAt: new Date(now + biteAfter(random)), item: roll.no, variant: roll.variant, cm: roll.cm, shadow: roll.shadow };
    await tx
      .insert(fishLines)
      .values({ userId: user.id, ...row })
      .onConflictDoUpdate({ target: fishLines.userId, set: row });
    return { now, casts: today.casts, line: { spot, castAt: now, biteAt: row.biteAt.getTime(), shadow: roll.shadow } };
  });
}

/** The line taken back before (or without) pulling: nothing caught, the cast not given back; 卫戍池塘's room told */
export async function pullBack(user: Pick<UserRow, "id">, now = Date.now()) {
  const [gone] = await db.delete(fishLines).where(eq(fishLines.userId, user.id)).returning({ spot: fishLines.spot });
  if (gone?.spot === "pond") {
    const pond = await pondOf(user.id, now);
    if (pond) await tellSquadPond(pond.roomId, pond.h);
  }
  return { now };
}

/**
 * The pull, once it has bitten: on time or not by the server's clock (onTime), a tenth bigger if it was, then the
 * catch told, kept in the dex (first time, biggest), the site's biggest, the day's junk run (空军司令 at
 * ADMIRAL_AFTER), and said on the bank with no name when purple or better. A line taken by another tab's pull, or none,
 * is refused; one not bitten yet stays in.
 */
export async function reelIn(user: Pick<UserRow, "id">, now = Date.now()): Promise<{ now: number; caught: FishCatch; admiral: boolean }> {
  const day = siteDay(now);
  const pondTold: { roomId: string; h: number; shout: boolean }[] = [];
  const res = await db.transaction(async (tx) => {
    const [line] = await tx
      .delete(fishLines)
      .where(and(eq(fishLines.userId, user.id), lt(fishLines.biteAt, new Date(now + 1))))
      .returning();
    if (!line) {
      const [waiting] = await tx.select({ biteAt: fishLines.biteAt }).from(fishLines).where(eq(fishLines.userId, user.id));
      throw refuse(409, waiting ? T.server.fish.notYet : T.server.fish.noLine, waiting ? FISH_NOT_YET : FISH_NO_LINE);
    }
    const item = itemOf(line.item);
    const timed = onTime(now - line.biteAt.getTime());
    const cm = line.cm === null ? null : timed ? Math.round(line.cm * SIZE_PERFECT) : line.cm;
    const [was] = await tx
      .select({ n: dexRows.n, best: dexRows.best })
      .from(dexRows)
      .where(and(eq(dexRows.userId, user.id), eq(dexRows.item, line.item), eq(dexRows.variant, line.variant)))
      .for("update");
    if (was) {
      await tx
        .update(dexRows)
        .set({ n: sql`${dexRows.n} + 1`, best: cm === null ? dexRows.best : sql`greatest(${dexRows.best}, ${cm})` })
        .where(and(eq(dexRows.userId, user.id), eq(dexRows.item, line.item), eq(dexRows.variant, line.variant)));
    } else {
      await tx
        .insert(dexRows)
        .values({ userId: user.id, item: line.item, variant: line.variant, n: 1, best: cm, firstAt: new Date(now), firstSpot: line.spot })
        .onConflictDoUpdate({
          target: [dexRows.userId, dexRows.item, dexRows.variant],
          set: { n: sql`${dexRows.n} + 1`, best: sql`greatest(${dexRows.best}, excluded.best)` },
        });
    }
    let top: number | null = null;
    if (cm !== null) {
      await tx
        .insert(fishRecords)
        .values({ item: line.item, variant: line.variant, cm, at: new Date(now) })
        .onConflictDoUpdate({ target: [fishRecords.item, fishRecords.variant], set: { cm, at: new Date(now) }, setWhere: lt(fishRecords.cm, cm) });
      const [site] = await tx
        .select({ cm: fishRecords.cm })
        .from(fishRecords)
        .where(and(eq(fishRecords.item, line.item), eq(fishRecords.variant, line.variant)));
      top = site?.cm ?? cm;
    }
    // the day's junk run; ten in a row, 空军司令 for the rest of it
    const [today] = await tx.select({ junk: fishDays.junk, admiral: fishDays.admiral }).from(fishDays).where(and(eq(fishDays.userId, user.id), eq(fishDays.day, day)));
    const junk = junkAfter(today?.junk ?? 0, item ?? { cat: "fish" as const });
    const admiral = Boolean(today?.admiral) || junk >= ADMIRAL_AFTER;
    await tx
      .insert(fishDays)
      .values({ userId: user.id, day, junk, admiral })
      .onConflictDoUpdate({ target: [fishDays.userId, fishDays.day], set: { junk, admiral } });
    const tier = item?.tier ?? 1;
    // 卫戍池塘: the 鳞 of this 局 (爆护), and the room told; purple and up said to it with the name
    if (line.spot === "pond") {
      const [member] = await tx
        .update(squadMembers)
        .set(item?.cat === "fish" ? { fishN: sql`${squadMembers.fishN} + 1` } : { fishN: squadMembers.fishN })
        .where(and(eq(squadMembers.userId, user.id), isNull(squadMembers.leftAt)))
        .returning({ roomId: squadMembers.roomId, h: squadMembers.handle });
      if (member) pondTold.push({ roomId: member.roomId, h: member.h, shout: tier >= SHOUT_TIER });
    }
    if (tier >= SHOUT_TIER && line.spot === "pier") {
      await tx.insert(fishShouts).values({ userId: user.id, spot: line.spot, item: line.item, variant: line.variant, cm, at: new Date(now) });
      await tx.delete(fishShouts).where(lt(fishShouts.at, new Date(now - 12 * SHOUT_KEEP_MS)));
    }
    return {
      now,
      admiral,
      caught: {
        no: line.item,
        variant: line.variant,
        cm,
        tier,
        onTime: timed,
        first: !was,
        record: Boolean(was && cm !== null && (was.best === null || cm > was.best)),
        n: (was?.n ?? 0) + 1,
        top,
      },
    };
  });
  for (const p of pondTold) {
    if (p.shout) sayFishInRoom(p.roomId, { h: p.h, no: res.caught.no, variant: res.caught.variant, cm: res.caught.cm });
    await tellSquadPond(p.roomId, p.h);
  }
  return res;
}

/** The player's dex (each cell caught, how often, the biggest, first when and where) and the site's biggest of each */
export async function fishDexOf(user: Pick<UserRow, "id">): Promise<FishDex> {
  const [mine, records] = await Promise.all([
    db.select().from(dexRows).where(eq(dexRows.userId, user.id)),
    db.select({ no: fishRecords.item, variant: fishRecords.variant, cm: fishRecords.cm }).from(fishRecords),
  ]);
  return {
    mine: mine.map((r) => ({ no: r.item, variant: r.variant, n: r.n, best: r.best, firstAt: r.firstAt.getTime(), firstSpot: r.firstSpot as FishSpot })),
    records,
  };
}
