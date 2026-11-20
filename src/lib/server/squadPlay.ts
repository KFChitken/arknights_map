import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { FISH_ITEMS } from "../fish/items";
import { NOT_IN_ROOM } from "../squad";
import { weekStartOf } from "../hotList";
import { BALL_BACK_MS, fireAdd, fireLit, shakes, THROW_EVERY_MS, throwable, THROWS, THROWS_AT_A_MINUTE, woodAfter, woodNow, type SquadFire } from "../squadFire";
import { blockedBetween } from "./blocks";
import { db } from "./db";
import { HttpError } from "./http";
import { allow, hasRoom } from "./rateLimit";
import { squadFireRooms, squadFireSticks, squadMembers, squadRooms, users, type UserRow } from "./schema";
import { roomOf, tellSquadPlay, throwInRoom } from "./squad";

/**
 * 篝火 and 扔东西 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑤; the rules in src/lib/squadFire.ts). 添一根: a stick from the
 * hand (WOOD_MAX, one growing each WOOD_EVERY_MS) goes on the fire, up one level once enough are on (fireNeed); the
 * room is told, and 火焰周榜 counts it (src/lib/server/fireBoard.ts) while the room's week lasts. 扔: one of
 * THROWS at someone in the room, THROW_EVERY_MS apart and THROWS_AT_A_MINUTE a minute at the same one at most, never
 * at one who turned 别人扔我 off or between two who blocked each other; told to the room with its lines, nothing kept
 * but what stays a while (on the head, asleep, dancing, a ball to send back). A ball comes back with a tap
 * (BALL_BACK_MS), the rally counted; a 源石虫 is shaken off one's head with a tap. A 人机 is thrown at on the page alone.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
const notInRoom = () => refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
const handleOf = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 32_767 ? (v as number) : null);
/** 令的酒's number: what 白开水 wakes one from */
const FAINT = THROWS.find((t) => t.fx === "faint")!.no;
/** What a parcel may hold: 钓鳞's junk that bites somewhere (src/data/fish-items.json), not 通行证 things */
const PARCEL = FISH_ITEMS.filter((i) => i.cat === "junk" && !i.off && !i.kind).map((i) => i.no);

/** The player's room and their own row in it, both locked, the room first (as the round's start and end take them) */
async function lockedMine(tx: Tx, userId: string) {
  const mine = await roomOf(tx, userId);
  if (!mine) throw notInRoom();
  const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, mine.room.id)).for("update");
  const [me] = await tx
    .select()
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.userId, userId), isNull(squadMembers.leftAt)))
    .for("update");
  if (!room || room.endedAt || !me) throw notInRoom();
  return { room, me };
}

/**
 * 添一根: a stick on the fire as it is now (fireAdd), up one level once enough are on; a stick less in hand; the room
 * told. 火焰周榜, in the same transaction, while the room's week lasts (a room opened before this Monday 04:00 counts
 * no more): the stick to the player, and the room's highest that week when this is higher.
 */
export async function addWood(
  user: Pick<UserRow, "id">,
  now = Date.now(),
): Promise<{ now: number; fire: SquadFire; up: boolean; wood: number; woodAt: number }> {
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const woodAt = me.woodAt?.getTime() ?? null;
    if (woodNow(me.wood, woodAt, now) < 1) throw refuse(409, T.server.squad.noWood);
    const at = room.fireAt?.getTime() ?? null;
    const next = fireAdd(room.fireLevel, room.fireProg, at, now);
    // what it burnt since it was last put, counted to this 局 before it is put again
    const burn = room.fireBurn + (at === null ? 0 : fireLit(room.fireLevel, at, now));
    const top = Math.max(room.fireTop, next.level);
    const hand = woodAfter(me.wood, woodAt, now);
    await tx
      .update(squadRooms)
      .set({ fireLevel: next.level, fireProg: next.prog, fireAt: new Date(now), fireBy: me.handle, fireBurn: burn, fireTop: top })
      .where(eq(squadRooms.id, room.id));
    await tx
      .update(squadMembers)
      .set({ wood: hand.wood, woodAt: new Date(hand.at) })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id), isNull(squadMembers.leftAt)));
    const week = weekStartOf(room.createdAt.getTime());
    if (week === weekStartOf(now)) {
      const when = new Date(week);
      await tx
        .insert(squadFireSticks)
        .values({ roomId: room.id, userId: user.id, week: when, sticks: 1, firstAt: new Date(now) })
        .onConflictDoUpdate({ target: [squadFireSticks.roomId, squadFireSticks.userId], set: { sticks: sql`${squadFireSticks.sticks} + 1` } });
      await tx
        .insert(squadFireRooms)
        .values({ roomId: room.id, week: when, peak: next.level, peakAt: new Date(now) })
        .onConflictDoUpdate({
          target: squadFireRooms.roomId,
          set: { peak: next.level, peakAt: new Date(now) },
          setWhere: sql`${squadFireRooms.peak} < ${next.level}`,
        });
    }
    const fire: SquadFire = {
      level: next.level,
      prog: next.prog,
      at: now,
      by: me.handle,
      top,
      last: room.fireLast,
      lastTop: room.fireLastTop,
      bestTop: room.fireBestTop,
    };
    return { roomId: room.id, h: me.handle, fire, up: next.up, hand };
  });
  await tellSquadPlay(done.roomId, { kind: "fire", h: done.h });
  return { now, fire: done.fire, up: done.up, wood: done.hand.wood, woodAt: done.hand.at };
}

/** 扔: item (THROWS, by number) at the one numbered to in the room; what stays on TA is kept a while; the room told */
export async function throwAt(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now(), rand: (n: number) => number = randomInt) {
  // a prize (急件赛's crown) is worn, never thrown
  const item = throwable(body.item);
  const to = handleOf(body.to);
  if (!item || to === null) throw refuse(400, T.server.squad.badThrow);
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  const [them] = await db
    .select({ m: squadMembers, noThrow: users.squadNoThrow })
    .from(squadMembers)
    .innerJoin(users, eq(users.id, squadMembers.userId))
    .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.handle, to), isNull(squadMembers.leftAt)));
  if (!them || them.m.userId === user.id) throw refuse(409, T.server.squad.notThere);
  if (them.noThrow || (await blockedBetween(user.id, them.m.userId))) throw refuse(409, T.server.squad.noThrow);
  const every = `squad:throwEvery:${user.id}`;
  const at = `squad:throwAt:${user.id}:${them.m.userId}`;
  if (!hasRoom(every, 1, THROW_EVERY_MS)) throw refuse(429, T.server.squad.throwWait);
  if (!hasRoom(at, THROWS_AT_A_MINUTE, 60_000)) throw refuse(429, fmt(T.server.squad.throwEnough, { n: THROWS_AT_A_MINUTE }));
  allow(every, 1, THROW_EVERY_MS);
  allow(at, THROWS_AT_A_MINUTE, 60_000);

  const where = and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.handle, to), isNull(squadMembers.leftAt));
  let out: number | undefined;
  if (item.fx === "head") await db.update(squadMembers).set({ head: item.no, headUntil: new Date(now + item.ms) }).where(where);
  if (item.fx === "faint" || item.fx === "dance") await db.update(squadMembers).set({ fx: item.no, fxUntil: new Date(now + item.ms) }).where(where);
  if (item.fx === "ball") {
    await db
      .update(squadMembers)
      .set({ ball: item.no, ballFrom: mine.me.handle, ballN: 1, ballUntil: new Date(now + BALL_BACK_MS) })
      .where(where);
  }
  if (item.fx === "wake") {
    // 泼醒: fainted (the pages clear it as the throw comes), or asleep (醉倒睡觉), up again
    await db.update(squadMembers).set({ fx: null, fxUntil: null }).where(and(where, eq(squadMembers.fx, FAINT)));
    if (them.m.pose === 2) {
      await db.update(squadMembers).set({ pose: 0 }).where(where);
      await tellSquadPlay(mine.room.id, { kind: "pose", h: to, pose: 0 });
    }
  }
  if (item.fx === "parcel") out = PARCEL[rand(PARCEL.length)];
  throwInRoom(mine.room.id, { h: mine.me.handle, to, item: item.no, ...(out === undefined ? {} : { out }), ...(item.fx === "ball" ? { n: 1 } : {}) });
  return { now, ...(out === undefined ? {} : { out }) };
}

/** 打回去: the ball on one's tile sent back to whoever sent it, the rally one more; nothing to send back once it fell */
export async function hitBack(user: Pick<UserRow, "id">, now = Date.now()) {
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    if (me.ball === null || me.ballFrom === null || !me.ballUntil || me.ballUntil.getTime() <= now) throw refuse(409, T.server.squad.noBall);
    const back = and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.ballFrom), isNull(squadMembers.leftAt));
    await tx
      .update(squadMembers)
      .set({ ball: null, ballFrom: null, ballN: 0, ballUntil: null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id), isNull(squadMembers.leftAt)));
    const [sent] = await tx
      .update(squadMembers)
      .set({ ball: me.ball, ballFrom: me.handle, ballN: me.ballN + 1, ballUntil: new Date(now + BALL_BACK_MS) })
      .where(back)
      .returning({ h: squadMembers.handle });
    if (!sent) throw refuse(409, T.server.squad.notThere);
    return { roomId: room.id, thrown: { h: me.handle, to: sent.h, item: me.ball, n: me.ballN + 1, back: true as const } };
  });
  throwInRoom(done.roomId, done.thrown);
  return { now, n: done.thrown.n };
}

/** 甩掉: what crawled onto one's head (源石虫) off it; the room told */
export async function shakeOff(user: Pick<UserRow, "id">, now = Date.now()) {
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    if (me.head === null || !shakes(me.head) || !me.headUntil || me.headUntil.getTime() <= now) throw refuse(409, T.server.squad.nothingOnHead);
    await tx
      .update(squadMembers)
      .set({ head: null, headUntil: null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id), isNull(squadMembers.leftAt)));
    return { roomId: room.id, h: me.handle };
  });
  await tellSquadPlay(done.roomId, { kind: "shake", h: done.h });
  return { now };
}
