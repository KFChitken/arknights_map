import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gte, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { MINGHE, mingheDay, mingheRoach, queueSpots, RIDE_STOPS, stationOf, stopOf } from "../minghe";
import type { LngLat } from "../types";
import { WorldError, type MingheItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { isProd } from "./env";
import { guideFriend, guideTouches, isUniqueViolation, type Exec, type GuideRow, type GuideTable } from "./guides";
import { roachesChanged } from "./roachFeed";
import { mingheTouches, roaches, touches, users } from "./schema";

/**
 * 明河都尉 on the server (src/lib/minghe.ts): his answers to each player's touches,
 * and the clones riding with him, which the 04:00 batch moves to his next station
 * every day and sees home after 7. Getting a clone on and off is a placement like any
 * other, in world.ts (rideMinghe, dismountMinghe); his lines about it are written here.
 */

// his table starts with the columns every guide's has (schema.ts)
const him = guideTouches(MINGHE, mingheTouches as unknown as GuideTable);

type MingheRow = GuideRow & { stop: number | null; times: number | null };
type Line = MingheItem["line"];
const LINES: Line[] = ["touch", "friend", "ride", "dismount", "trip"];

// ---- the day of his journey ----

// 明河快进一天 (development only): days added to his journey, kept across reloads of this module
const g = globalThis as typeof globalThis & { __mingheShift?: number };
/** Days added by 明河快进一天; always 0 on the live site */
export const dayShift = () => (isProd ? 0 : (g.__mingheShift ?? 0));
export function fastForward() {
  if (!isProd) g.__mingheShift = dayShift() + 1;
}
/** Today's day of his journey, as every page works it out too */
export const mingheToday = (now = Date.now()) => mingheDay(now, dayShift());

// ---- his lines ----

function toItem(r: MingheRow, replied: boolean): MingheItem {
  return {
    kind: "minghe",
    id: him.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    line: LINES.find((l) => l === r.kind) ?? "touch",
    bold: r.bold,
    stop: r.stop,
    times: r.times,
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

/** One of his lines about a clone of theirs (getting on or off, or home again), written along with what it is about. */
export async function sayAboutRide(exec: Exec, userId: string, line: "ride" | "dismount" | "trip", stop: number, times: number | null = null) {
  const [row] = await exec
    .insert(mingheTouches)
    .values({ userId, direction: him.from, kind: line, bold: false, stop, times })
    .returning();
  return toItem(row, false);
}

/**
 * The player touches him, maybe answering one of his: he answers at once, the same way
 * they touched him. Their first bold touch makes them 触须之交.
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null): Promise<TouchResult> {
  await him.allow(userId);
  let done: { id: string; friend: boolean };
  try {
    done = await db.transaction(async (tx) => {
      const made = bold
        ? await tx
            .update(users)
            .set({ mingheFriendSince: new Date() })
            .where(and(eq(users.id, userId), isNull(users.mingheFriendSince)))
            .returning({ id: users.id })
        : [];
      const friend = made.length > 0;
      const answer = await him.pair(tx, userId, bold, replyTo, friend ? "friend" : "touch");
      return { id: answer.id, friend };
    });
  } catch (e) {
    // two answers to the same one of his at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError("已经碰过他了。");
    throw e;
  }
  return {
    newFriend: done.friend ? MINGHE.name : null,
    guide: {
      id: MINGHE.id,
      itemId: him.itemId(done.id),
      bold,
      kind: done.friend ? "friend" : "touch",
      times: null,
      others: null,
      line: null,
    },
  };
}

export const touchMinghe = (userId: string, bold: boolean) => touchBack(userId, bold, null);

/** Touch back one of his, once; it counts towards his 20 like any touch. */
export async function replyMinghe(userId: string, itemId: string, bold: boolean) {
  const item = await him.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id);
}

export const ignoreMinghe = (userId: string, itemId: string) => him.ignore(userId, itemId);

export const seeMinghe = (userId: string, itemIds: string[]) => him.see(userId, itemIds);

/** His latest to the player, for the inbox. */
export async function mingheInbox(userId: string): Promise<MingheItem[]> {
  return (await him.latest(userId)).map(({ row, replied }) => toItem(row as MingheRow, replied));
}

/** His place among the 触须之交, after the three guides before him: where he is today. */
export const mingheFriend = (since: Date) => guideFriend(MINGHE, since, [mingheRoach(mingheToday(), true)]);

/** 解除: he rides on; a bold touch makes them 触须之交 again. */
export async function unfriendMinghe(userId: string) {
  await db.update(users).set({ mingheFriendSince: null }).where(eq(users.id, userId));
}

/** What me() says about him: 触须之交 or not, and the clone riding with him. */
export async function mingheOf(u: { id: string; mingheFriendSince: Date | null }) {
  const [r] = await db
    .select({ id: roaches.id, since: roaches.rideSince, start: roaches.rideStartDay, day: roaches.rideDay })
    .from(roaches)
    .where(and(eq(roaches.userId, u.id), isNotNull(roaches.rideSince)))
    .limit(1);
  const stops = r ? Math.min(RIDE_STOPS, Math.max(1, (r.day ?? 0) - (r.start ?? 0) + 1)) : 0;
  return {
    friend: Boolean(u.mingheFriendSince),
    riding: r?.since ? { roachId: r.id, since: r.since.getTime(), stops } : null,
    dayShift: dayShift(),
  };
}

// ---- his riders ----

/** No longer riding: what a clone's ride columns go back to */
export const OFF_HORSE = { rideSince: null, rideStartDay: null, rideDay: null, rideFromLng: null, rideFromLat: null };

/** Where the roaches already standing near a day's station are, but for those listed. */
export async function standingNear(exec: Exec, day: number, except: string[] = []): Promise<LngLat[]> {
  const at = stationOf(day).at;
  const center = sql`ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography`;
  return exec
    .select({ lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(and(sql`ST_DWithin(${roaches.geog}, ${center}, 2000)`, except.length ? notInArray(roaches.id, except) : undefined));
}

/**
 * The 04:00 batch, once a day: every clone riding with him that is not at today's
 * station yet moves there, into his queue in the order they got on, under a new
 * public id, so nobody can follow it from city to city; those that rode RIDE_STOPS
 * stations go home instead (back where they stood, or taken back if they were put
 * down to ride), and he tells their owners how many times they were touched on the
 * way. None of these moves count as the player's own, so no moves rows (the radar
 * and 欢迎回家 never see them). Running it again the same day changes nothing; after
 * days without it, everyone goes straight to today's station.
 */
export async function moveMingheRiders(now = Date.now()) {
  const day = mingheToday(now);
  const riders = await db
    .select()
    .from(roaches)
    .where(and(isNotNull(roaches.rideSince), lt(roaches.rideDay, day)))
    .orderBy(asc(roaches.rideSince));
  if (!riders.length) return { moved: 0, home: 0 };
  const done = riders.filter((r) => day - (r.rideStartDay ?? day) >= RIDE_STOPS);
  const going = riders.filter((r) => !done.includes(r));

  for (const r of done) {
    const [{ n }] = await db
      .select({ n: count() })
      .from(touches)
      .where(
        and(
          eq(touches.toUserId, r.userId),
          eq(touches.toSlot, r.slot),
          eq(touches.withheld, false),
          gte(touches.createdAt, r.rideSince!),
        ),
      );
    await db.transaction(async (tx) => {
      const back = r.rideFromLng !== null && r.rideFromLat !== null;
      const [still] = back
        ? await tx
            .update(roaches)
            .set({ lng: r.rideFromLng!, lat: r.rideFromLat!, publicId: randomUUID(), ...OFF_HORSE })
            .where(and(eq(roaches.id, r.id), lt(roaches.rideDay, day)))
            .returning({ id: roaches.id })
        : await tx
            .delete(roaches)
            .where(and(eq(roaches.id, r.id), lt(roaches.rideDay, day)))
            .returning({ id: roaches.id });
      // gone or got off meanwhile: nothing to say
      if (still) await sayAboutRide(tx, r.userId, "trip", stopOf(r.rideStartDay ?? day), n);
    });
  }

  if (going.length) {
    const ids = going.map((r) => r.id);
    const spots = queueSpots(day, going.length, await standingNear(db, day, ids));
    for (const [i, r] of going.entries()) {
      await db
        .update(roaches)
        .set({ lng: spots[i].lng, lat: spots[i].lat, publicId: randomUUID(), rideDay: day })
        .where(and(eq(roaches.id, r.id), isNotNull(roaches.rideSince), lt(roaches.rideDay, day)));
    }
  }
  roachesChanged();
  return { moved: going.length, home: done.length };
}

/** 清掉我和明河的记录 (local testing only): as if they had never met him; a riding clone just stays where it is. */
export async function forgetMinghe(userId: string) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mingheFriendSince: null }).where(eq(users.id, userId));
    await tx.delete(mingheTouches).where(eq(mingheTouches.userId, userId));
    await tx
      .update(roaches)
      .set(OFF_HORSE)
      .where(and(eq(roaches.userId, userId), isNotNull(roaches.rideSince)));
  });
  roachesChanged();
}
