import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { addDays, beijingDate, beijingMidnight, daysBetween } from "../beijing";
import {
  FRIEND_ACTS_PER_DAY,
  FRIEND_BIRTHDAY_DAYS,
  GAME_ASK_DAYS,
  isAwakeGesture,
  isBatchAct,
  isFriendAnniversary,
  isGesture,
  VISIT_BAN_DAYS,
  type BatchAct,
} from "../friendly";
import { isGame, serverName, type Game } from "../games";
import { displayName } from "../profile";
import { outsideOffLimits } from "../offLimits";
import { INBOX_DAYS } from "../rules";
import { isNearFire, pickSeat } from "../talulah";
import type { LngLat } from "../types";
import { DAY } from "../world/logic";
import type { PublicProfile } from "../profile";
import { WorldError, type FriendBetween, type InboxItem, type OwnRoach, type PlaceTarget, type VisitEvent } from "../world/types";
import { addedInGame, award, placed, quilted } from "./badges";
import { db } from "./db";
import { isUniqueViolation, lockPlayer, type Exec } from "./guides";
import { nudge } from "./live";
import { earn } from "./passes";
import { roachByFeedId, roachesChanged, sleeping } from "./roachFeed";
import { declarations, deliveries, friendNotes, friendships, friendStars, roaches, users, visitBans, visits, type UserRow } from "./schema";
import { countNote, countPlaced } from "./stats";
import { arrivedAt, lockFire, seatByFire } from "./talulah";
import { cardsOf, checkPlacement, friendIdsOf, friendKey, ownRoaches, profileOf, userById, writePlacement } from "./world";

/**
 * What 触须之交 do for each other (src/lib/friendly.ts): 催理智, gestures, 串门 (a clone
 * sitting by the other's roach), adding each other in a game, and their anniversaries. Each
 * is between the two of them only: nothing shows on the shared map or in the shared roach
 * list, and none of it counts against touches. Blocking ends a friendship, and with it all this.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Note = typeof friendNotes.$inferSelect;
type Visit = typeof visits.$inferSelect;

const nameOf = (u: UserRow) => displayName(profileOf(u));

/** One of your 触须之交 by their Friend.id, or a refusal */
async function friendOf(userId: string, friendId: unknown): Promise<UserRow> {
  const key = String(friendId);
  for (const other of await friendIdsOf(userId)) {
    if (friendKey(userId, other) !== key) continue;
    const u = await userById(other);
    if (u) return u;
  }
  throw new WorldError(T.server.common.notFriends);
}

/** An inbox item's note id ("c:<id>" for one sent to you) */
function noteId(itemId: unknown, prefix = "c:") {
  const s = String(itemId);
  const id = s.startsWith(prefix) ? s.slice(prefix.length).toLowerCase() : "";
  if (!UUID.test(id)) throw new WorldError(T.server.common.noSuchNote);
  return id;
}

/** Which sleep of theirs it is: this drink, or this stay away; null while awake */
function sleepOf(u: UserRow, now: number) {
  if (u.drunkUntil && u.drunkUntil.getTime() > now) return `drunk:${u.drunkUntil.toISOString()}`;
  if (u.sleptAwayOn) return `away:${u.sleptAwayOn}`;
  return null;
}

/** Tell them to look again once what was just written can be read */
const nudgeSoon = (ids: string[]) => {
  if (ids.length) setTimeout(() => nudge(ids), 200);
};

// ---- what you do for one 触须之交 a day ----

/** The kinds counted against FRIEND_ACTS_PER_DAY: 催理智 and every gesture, answers included */
const COUNTED = ["sanity", "hug", "highfive", "luck", "blanket", "water"];

/** How many of them you did for TA today (Beijing date) */
async function actsToday(exec: Exec, from: string, to: string, now: number) {
  const [row] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(friendNotes)
    .where(
      and(
        eq(friendNotes.fromUserId, from),
        eq(friendNotes.toUserId, to),
        inArray(friendNotes.kind, COUNTED),
        gte(friendNotes.createdAt, new Date(beijingMidnight(beijingDate(now)))),
      ),
    );
  return Number(row?.n ?? 0);
}

// ---- 催理智 ----

/** 催理智: one a day (Beijing date) for each 触须之交, one of the day's three; it reaches them asleep too, and drunk ones see it once up */
export async function remindSanity(userId: string, friendId: unknown) {
  const other = await friendOf(userId, friendId);
  const now = Date.now();
  const today = beijingDate(now);
  await db.transaction(async (tx) => {
    // one at a time for each player, so two taps cannot both find room for a third
    await lockPlayer(tx, userId);
    const [again] = await tx
      .select({ id: friendNotes.id })
      .from(friendNotes)
      .where(and(eq(friendNotes.fromUserId, userId), eq(friendNotes.toUserId, other.id), eq(friendNotes.kind, "sanity"), eq(friendNotes.period, today)))
      .limit(1);
    if (again) throw new WorldError(T.server.friendly.sanityAskedToday);
    if ((await actsToday(tx, userId, other.id, now)) >= FRIEND_ACTS_PER_DAY) throw new WorldError(fmt(T.server.friendly.actsUsedUp, { max: FRIEND_ACTS_PER_DAY }));
    await tx
      .insert(friendNotes)
      .values({ fromUserId: userId, toUserId: other.id, kind: "sanity", period: today, asleep: sleeping(other, now), createdAt: new Date(now) });
  });
  countNote("sanity");
  await earn(userId, "social");
  nudge([other.id]);
}

/** 「清完了！」 tells the one who reminded you; 「知道啦」 tells nobody */
export async function answerSanity(userId: string, itemId: unknown, answer: unknown) {
  if (answer !== "done" && answer !== "ok") throw new WorldError(T.server.friendly.unknownAnswer);
  const id = noteId(itemId);
  const [note] = await db
    .select()
    .from(friendNotes)
    .where(and(eq(friendNotes.id, id), eq(friendNotes.toUserId, userId), eq(friendNotes.kind, "sanity")))
    .limit(1);
  if (!note) throw new WorldError(T.server.common.noSuchNote);
  if (note.answer) throw new WorldError(T.server.friendly.answered);
  if (answer === "done" && !(await friendIdsOf(userId)).has(note.fromUserId)) throw new WorldError(T.server.common.notFriends);
  const now = new Date();
  const [done] = await db
    .update(friendNotes)
    .set({ answer, answeredAt: now, seenAt: note.seenAt ?? now })
    .where(and(eq(friendNotes.id, id), isNull(friendNotes.answer)))
    .returning({ id: friendNotes.id });
  if (!done) throw new WorldError(T.server.friendly.answered);
  if (answer === "done") nudge([note.fromUserId]);
}

// ---- gestures ----

const AGAIN: Record<"blanket" | "water", string> = {
  get blanket() {
    return T.server.friendly.again.blanket;
  },
  get water() {
    return T.server.friendly.again.water;
  },
};

/**
 * 贴贴, 击掌, 吸欧气 while they are awake, as often as the day's FRIEND_ACTS_PER_DAY allow;
 * 盖被子, 放杯白开水 while they sleep, once a sleep each, within the day's too. Returning one of
 * theirs (replyTo) is one of yours, and each of theirs is returned once.
 */
export async function gesture(userId: string, friendId: unknown, kind: unknown, replyTo?: unknown) {
  if (!isGesture(kind)) throw new WorldError(T.server.friendly.noSuchGesture);
  const other = await friendOf(userId, friendId);
  const now = Date.now();
  const sleep = sleepOf(other, now);
  const awake = isAwakeGesture(kind);
  if (awake && sleep) throw new WorldError(T.server.friendly.asleep);
  if (!awake && !sleep) throw new WorldError(T.server.friendly.awake);
  let answering: string | null = null;
  if (replyTo !== undefined && replyTo !== null && replyTo !== "") {
    const [n] = await db
      .select()
      .from(friendNotes)
      .where(and(eq(friendNotes.id, noteId(replyTo)), eq(friendNotes.toUserId, userId), eq(friendNotes.fromUserId, other.id), eq(friendNotes.kind, kind)))
      .limit(1);
    if (!n || !awake) throw new WorldError(T.server.common.noSuchNote);
    if (n.answer) throw new WorldError(T.server.friendly.answered);
    answering = n.id;
  }
  const made = await db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    const done = await actsToday(tx, userId, other.id, now);
    if (done >= FRIEND_ACTS_PER_DAY) throw new WorldError(fmt(T.server.friendly.actsUsedUp, { max: FRIEND_ACTS_PER_DAY }));
    if (answering) {
      const [open] = await tx
        .update(friendNotes)
        .set({ answer: "back", answeredAt: new Date(now) })
        .where(and(eq(friendNotes.id, answering), isNull(friendNotes.answer)))
        .returning({ id: friendNotes.id });
      if (!open) throw new WorldError(T.server.friendly.answered);
    }
    const rows = await tx
      .insert(friendNotes)
      .values({
        fromUserId: userId,
        toUserId: other.id,
        kind,
        // awake ones may come again the same day: which of the day's it was keeps each its own
        period: awake ? `${beijingDate(now)}#${done + 1}` : sleep!,
        asleep: !awake,
        replyTo: answering,
        createdAt: new Date(now),
      })
      .onConflictDoNothing()
      .returning({ id: friendNotes.id });
    if (!rows.length && answering) throw new WorldError(AGAIN[kind as "blanket" | "water"] ?? T.server.friendly.answered);
    return rows.length > 0;
  });
  if (!made) throw new WorldError(AGAIN[kind as "blanket" | "water"] ?? fmt(T.server.friendly.actsUsedUp, { max: FRIEND_ACTS_PER_DAY }));
  countNote(kind);
  await earn(userId, "social");
  nudge([other.id]);
  // 眠于树影之中: covered with a quilt while asleep, by this 触须之交
  if (kind === "blanket") await quilted(other.id, userId);
}

/** 一键 (src/lib/friendly.ts): one act for many 触须之交 at once, each by the rules for one; says how it went for each */
export async function friendsAct(userId: string, act: unknown, friendIds: unknown): Promise<BatchResult[]> {
  if (!isBatchAct(act)) throw new WorldError(T.server.friendly.noSuchGesture);
  if (!Array.isArray(friendIds) || !friendIds.length) throw new WorldError(T.server.friendly.pickFriends);
  const out: BatchResult[] = [];
  for (const id of [...new Set(friendIds.map(String))].slice(0, MAX_BATCH)) {
    try {
      if (act === "sanity") await remindSanity(userId, id);
      else await gesture(userId, id, act satisfies Exclude<BatchAct, "sanity">);
      out.push({ id, ok: true });
    } catch (e) {
      if (!(e instanceof WorldError)) throw e;
      out.push({ id, ok: false, why: e.message });
    }
  }
  return out;
}

/** How one of a 一键 went: why not, when it did not */
export type BatchResult = { id: string; ok: boolean; why?: string };
/** More 触须之交 than anyone has */
const MAX_BATCH = 300;

// ---- 游戏里也加个好友 ----

const bothWays = (a: string, b: string) =>
  or(and(eq(friendNotes.fromUserId, a), eq(friendNotes.toUserId, b)), and(eq(friendNotes.fromUserId, b), eq(friendNotes.toUserId, a)));

async function latestNote(from: string, to: string, kind: string, game?: Game) {
  const [n] = await db
    .select()
    .from(friendNotes)
    .where(
      and(
        eq(friendNotes.fromUserId, from),
        eq(friendNotes.toUserId, to),
        eq(friendNotes.kind, kind),
        ...(game ? [eq(friendNotes.game, game)] : []),
      ),
    )
    .orderBy(desc(friendNotes.createdAt))
    .limit(1);
  return n ?? null;
}

const againIn = (since: Date, now: number) => {
  const until = since.getTime() + GAME_ASK_DAYS * DAY;
  return until > now ? until : null;
};

/** 我在游戏里申请了: only for a game whose UID they share, on the same server; again after GAME_ASK_DAYS until they say yes */
export async function gameAsk(userId: string, friendId: unknown, game: unknown) {
  if (!isGame(game)) throw new WorldError(T.server.friendly.noSuchGame);
  const other = await friendOf(userId, friendId);
  const me = await userById(userId);
  const theirs = profileOf(other);
  const mine = me ? profileOf(me) : null;
  if (!theirs.games.includes(game) || !theirs.shareUid || !theirs.uid[game]) throw new WorldError(T.server.friendly.uidNotShared);
  if (theirs.uidServer[game] && mine?.uidServer[game] && theirs.uidServer[game] !== mine.uidServer[game]) {
    throw new WorldError(T.server.friendly.differentServers);
  }
  const now = Date.now();
  const [added] = await db
    .select({ id: friendNotes.id })
    .from(friendNotes)
    .where(and(bothWays(userId, other.id), eq(friendNotes.kind, "gameAsk"), eq(friendNotes.game, game), eq(friendNotes.answer, "added")))
    .limit(1);
  if (added) throw new WorldError(T.server.friendly.alreadyGameFriends);
  const last = await latestNote(userId, other.id, "gameAsk", game);
  const until = last && againIn(last.createdAt, now);
  if (until) throw new WorldError(fmt(T.server.friendly.toldWait, { days: Math.ceil((until - now) / DAY) }));
  const [asked] = await db
    .insert(friendNotes)
    .values({ fromUserId: userId, toUserId: other.id, kind: "gameAsk", game, period: `${game}:${beijingDate(now)}`, createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ id: friendNotes.id });
  if (asked) countNote("gameAsk");
  nudge([other.id]);
}

/** 我也加了: both of you see 「游戏里也是好友」 from now on, and they hear so */
export async function gameAdded(userId: string, itemId: unknown) {
  const id = noteId(itemId);
  const [note] = await db
    .select()
    .from(friendNotes)
    .where(and(eq(friendNotes.id, id), eq(friendNotes.toUserId, userId), eq(friendNotes.kind, "gameAsk")))
    .limit(1);
  if (!note) throw new WorldError(T.server.common.noSuchNote);
  if (note.answer) throw new WorldError(T.server.friendly.alreadySaid);
  if (!(await friendIdsOf(userId)).has(note.fromUserId)) throw new WorldError(T.server.common.notFriends);
  const now = new Date();
  await db
    .update(friendNotes)
    .set({ answer: "added", answeredAt: now, seenAt: note.seenAt ?? now })
    .where(and(eq(friendNotes.id, id), isNull(friendNotes.answer)));
  nudge([note.fromUserId]);
  await addedInGame(userId, note.fromUserId);
}

/** 想在游戏里加 TA, for a game whose UID they keep to themselves: nothing is given out, once a week per pair */
export async function gameWant(userId: string, friendId: unknown, game: unknown) {
  if (!isGame(game)) throw new WorldError(T.server.friendly.noSuchGame);
  const other = await friendOf(userId, friendId);
  const theirs = profileOf(other);
  if (theirs.shareUid && theirs.uid[game]) throw new WorldError(T.server.friendly.uidShared);
  const now = Date.now();
  const last = await latestNote(userId, other.id, "gameWant");
  const until = last && againIn(last.createdAt, now);
  if (until) throw new WorldError(fmt(T.server.friendly.toldWait, { days: Math.ceil((until - now) / DAY) }));
  const [wanted] = await db
    .insert(friendNotes)
    .values({ fromUserId: userId, toUserId: other.id, kind: "gameWant", game, period: beijingDate(now), createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ id: friendNotes.id });
  if (wanted) countNote("gameWant");
  nudge([other.id]);
}

// ---- 串门 ----

/** Roaches standing within m metres of a spot, some left out */
async function roachesNear(exec: Exec, at: LngLat, m: number, except: string[]) {
  const rows = await exec
    .select({ id: roaches.id, lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography, ${m})`);
  return rows.filter((r) => !except.includes(r.id));
}

/**
 * Where a guest sits, first thing in the transaction that seats it: on the rings of seats around
 * the host's roach, as by 塔露拉干员's fire; a roach by her fire has its guests on the fire's own
 * rings, as close to it as a seat is free. One seat is picked at a time, by the fire across the site
 * (lockFire, as when sent there from her card), elsewhere for each host roach, so that two never
 * take the same one.
 */
async function seatBy(tx: Exec, host: LngLat & { id: string }, except: string[]): Promise<LngLat> {
  if (isNearFire(host)) {
    await lockFire(tx);
    return seatByFire(tx, except, host);
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`visit-seat:${host.id}`}))`);
  return pickSeat(await roachesNear(tx, host, 150, except), Math.random, { center: host });
}

async function bannedUntil(hostId: string, guestId: string, now: number) {
  const [ban] = await db
    .select()
    .from(visitBans)
    .where(and(eq(visitBans.hostId, hostId), eq(visitBans.guestId, guestId)))
    .limit(1);
  const until = ban ? ban.at.getTime() + VISIT_BAN_DAYS * DAY : 0;
  return until > now ? until : null;
}

/**
 * A visiting clone goes back where it stood (just outside, if that is now where no roach may
 * stand, src/lib/offLimits.ts), or is taken back if it was put down for the visit. No move is counted.
 */
export async function sendBack(tx: Exec, v: Visit) {
  // anyone visiting this clone in turn sees it go
  await roachMoved(tx, v.roachId, v.fromLng === null ? "removed" : "moved");
  if (v.fromLng === null || v.fromLat === null) {
    await tx.delete(roaches).where(eq(roaches.id, v.roachId));
  } else {
    const home = outsideOffLimits({ lng: v.fromLng, lat: v.fromLat });
    await tx
      .update(roaches)
      .set({ lng: home.lng, lat: home.lat, publicId: randomUUID(), placedAt: new Date() })
      .where(eq(roaches.id, v.roachId));
  }
  await tx.delete(visits).where(eq(visits.roachId, v.roachId));
}

/**
 * A roach moved or was taken back (within its transaction): if it was visiting, the visit ends
 * quietly; its guests stay where they sit, and each is told once.
 */
export async function roachMoved(tx: Exec, roachId: string, how: "moved" | "removed") {
  await tx.delete(visits).where(eq(visits.roachId, roachId));
  const now = Date.now();
  const left = await tx
    .update(visits)
    .set({ leftAt: new Date(now) })
    .where(and(eq(visits.hostRoachId, roachId), isNull(visits.leftAt)))
    .returning();
  for (const v of left) {
    await tx
      .insert(friendNotes)
      .values({ fromUserId: v.hostId, toUserId: v.guestId, kind: how === "moved" ? "hostMoved" : "hostRemoved", period: `${v.roachId}:${now}` })
      .onConflictDoNothing();
  }
  nudgeSoon(left.map((v) => v.guestId));
}

/**
 * 做客: a clone of yours sits down by one of a 触须之交's roaches, a new one (a placement) or
 * cloneId moved there (a move). One at a time with each host; the server picks the seat.
 */
export async function visit(userId: string, friendId: unknown, publicId: unknown, cloneId?: unknown) {
  const host = await friendOf(userId, friendId);
  if (!host.welcomeGuests) throw new WorldError(T.server.friendly.noGuests);
  const now = Date.now();
  const banned = await bannedUntil(host.id, userId, now);
  if (banned) throw new WorldError(fmt(T.server.friendly.sentHome, { host: nameOf(host), days: Math.ceil((banned - now) / DAY) }));
  // by the id the feed gave the page, short or whole
  const hostRoach = await roachByFeedId(String(publicId), host.id);
  if (!hostRoach) throw new WorldError(T.server.common.roachGone);
  if (hostRoach.rideSince) throw new WorldError(T.server.friendly.followingMinghe);
  const [already] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.guestId, userId), eq(visits.hostId, host.id)))
    .limit(1);
  if (already) {
    throw new WorldError(already.leftAt ? T.server.friendly.cloneAtOldHome : T.server.friendly.alreadyVisiting);
  }
  if (cloneId !== undefined && cloneId !== null && !UUID.test(String(cloneId))) throw new WorldError(T.server.common.noSuchRoach);
  const target: PlaceTarget = cloneId ? { kind: "move", roachId: String(cloneId) } : { kind: "clone" };
  const placement = await checkPlacement(userId, target);
  if (placement.slot === 0) throw new WorldError(T.server.friendly.mainCannotVisit);
  let seat: LngLat;
  try {
    seat = await db.transaction(async (tx) => {
      const at = await seatBy(tx, hostRoach, placement.existing ? [placement.existing.id] : []);
      await writePlacement(tx, userId, placement, at);
      const [clone] = await tx
        .select({ id: roaches.id })
        .from(roaches)
        .where(and(eq(roaches.userId, userId), eq(roaches.slot, placement.slot)))
        .limit(1);
      await tx.insert(visits).values({
        roachId: clone.id,
        guestId: userId,
        hostId: host.id,
        hostRoachId: hostRoach.id,
        since: new Date(now),
        fromLng: placement.existing?.lng ?? null,
        fromLat: placement.existing?.lat ?? null,
      });
      // the host's first guest ever comes with a word about keeping the main roach away from the door
      const [first] = await tx
        .update(users)
        .set({ visitTipShown: true })
        .where(and(eq(users.id, host.id), eq(users.visitTipShown, false)))
        .returning({ id: users.id });
      await tx.insert(friendNotes).values({
        fromUserId: userId,
        toUserId: host.id,
        kind: "visit",
        period: `${clone.id}:${now}`,
        answer: first ? "tip" : null,
        createdAt: new Date(now),
      });
      return at;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new WorldError(T.server.friendly.alreadyVisiting);
    throw e;
  }
  countNote("visit");
  countPlaced(placement.slot, placement.existing);
  await earn(userId, "social");
  roachesChanged();
  await arrivedAt(userId, seat);
  nudge([host.id]);
  // 使命必达, and 异卵同生 for a clone put out the first time
  await award(userId, ["delivery"]);
  await placed(userId, placement.slot, placement.existing ?? null, seat);
  return { roaches: await ownRoaches(userId), seat };
}

async function guestVisit(userId: string, cloneId: unknown) {
  if (!UUID.test(String(cloneId))) throw new WorldError(T.server.common.noSuchRoach);
  const [v] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.roachId, String(cloneId)), eq(visits.guestId, userId)))
    .limit(1);
  if (!v) throw new WorldError(T.server.friendly.notVisiting);
  return v;
}

/** 回家: your visiting clone goes back */
export async function goHome(userId: string, cloneId: unknown): Promise<OwnRoach[]> {
  const v = await guestVisit(userId, cloneId);
  await db.transaction((tx) => sendBack(tx, v));
  roachesChanged();
  return ownRoaches(userId);
}

/** 跟过去: a clone left behind sits down by its host's roach where it is now (a move) */
export async function followHost(userId: string, cloneId: unknown) {
  const v = await guestVisit(userId, cloneId);
  if (!v.leftAt) throw new WorldError(T.server.friendly.cloneBeside);
  if (!(await friendIdsOf(userId)).has(v.hostId)) throw new WorldError(T.server.common.notFriends);
  const host = await userById(v.hostId);
  if (!host?.welcomeGuests) throw new WorldError(T.server.friendly.noGuests);
  const [hostRoach] = await db.select().from(roaches).where(eq(roaches.id, v.hostRoachId)).limit(1);
  if (!hostRoach) throw new WorldError(T.server.friendly.hostTookBack);
  if (hostRoach.rideSince) throw new WorldError(T.server.friendly.followingMinghe);
  const placement = await checkPlacement(userId, { kind: "move", roachId: v.roachId });
  const seat = await db.transaction(async (tx) => {
    const at = await seatBy(tx, hostRoach, [v.roachId]);
    // moving the clone ends the visit (roachMoved); it goes on by the roach's new spot, as before
    await writePlacement(tx, userId, placement, at);
    await tx.insert(visits).values({ ...v, leftAt: null });
    return at;
  });
  roachesChanged();
  await arrivedAt(userId, seat);
  return { roaches: await ownRoaches(userId), seat };
}

/** 请 TA 回家: their clone goes home, they hear so, and may not visit you for VISIT_BAN_DAYS */
export async function sendHome(userId: string, friendId: unknown) {
  const guest = await friendOf(userId, friendId);
  const [v] = await db
    .select()
    .from(visits)
    .where(and(eq(visits.hostId, userId), eq(visits.guestId, guest.id), isNull(visits.leftAt)))
    .limit(1);
  if (!v) throw new WorldError(T.server.friendly.guestWentHome);
  const now = new Date();
  await db.transaction(async (tx) => {
    await sendBack(tx, v);
    await tx
      .insert(visitBans)
      .values({ hostId: userId, guestId: guest.id, at: now })
      .onConflictDoUpdate({ target: [visitBans.hostId, visitBans.guestId], set: { at: now } });
    await tx
      .insert(friendNotes)
      .values({ fromUserId: userId, toUserId: guest.id, kind: "sentHome", period: `${v.roachId}:${now.getTime()}`, createdAt: now });
  });
  roachesChanged();
  nudge([guest.id]);
}

/** 让触须之交来串门 switched off: every guest sitting by your roaches goes home, and hears why */
export async function closeHouse(userId: string) {
  const vs = await db
    .select()
    .from(visits)
    .where(and(eq(visits.hostId, userId), isNull(visits.leftAt)));
  if (!vs.length) return;
  const now = Date.now();
  await db.transaction(async (tx) => {
    for (const v of vs) {
      await sendBack(tx, v);
      await tx
        .insert(friendNotes)
        .values({ fromUserId: userId, toUserId: v.guestId, kind: "closed", period: `${v.roachId}:${now}`, createdAt: new Date(now) })
        .onConflictDoNothing();
    }
  });
  roachesChanged();
  nudge(vs.map((v) => v.guestId));
}

/** No longer 触须之交 (解除, or a block), within that transaction: visits both ways end, quietly, and the game ones are forgotten */
export async function friendshipEnded(tx: Exec, x: string, y: string) {
  const vs = await tx
    .select()
    .from(visits)
    .where(or(and(eq(visits.guestId, x), eq(visits.hostId, y)), and(eq(visits.guestId, y), eq(visits.hostId, x))));
  for (const v of vs) await sendBack(tx, v);
  await tx.delete(friendNotes).where(and(inArray(friendNotes.kind, ["gameAsk", "gameWant"]), bothWays(x, y)));
  // 特别关注 goes with it: becoming 触须之交 again starts without the star
  await tx
    .delete(friendStars)
    .where(or(and(eq(friendStars.userId, x), eq(friendStars.other, y)), and(eq(friendStars.userId, y), eq(friendStars.other, x))));
}

/** An account going: its guests go home quietly first (its own visiting clones go with its roaches) */
export async function guestsLeave(userId: string) {
  const vs = await db.select().from(visits).where(eq(visits.hostId, userId));
  if (!vs.length) return;
  await db.transaction(async (tx) => {
    for (const v of vs) await sendBack(tx, v);
  });
}

/** Your own roaches, with whose clones visit them and which of yours visit whom */
export async function withVisits(userId: string, own: OwnRoach[]): Promise<OwnRoach[]> {
  if (!own.length) return own;
  const ids = own.map((r) => r.id);
  const asGuest = await db
    .select()
    .from(visits)
    .where(and(eq(visits.guestId, userId), inArray(visits.roachId, ids)));
  const asHost = await db
    .select()
    .from(visits)
    .where(and(eq(visits.hostId, userId), inArray(visits.hostRoachId, ids), isNull(visits.leftAt)));
  if (!asGuest.length && !asHost.length) return own;
  const others = [...new Set([...asGuest.map((v) => v.hostId), ...asHost.map((v) => v.guestId)])];
  const people = new Map((await db.select().from(users).where(inArray(users.id, others))).map((u) => [u.id, u]));
  const hostRoaches = asGuest.map((v) => v.hostRoachId);
  const standing = new Set(
    hostRoaches.length ? (await db.select({ id: roaches.id }).from(roaches).where(inArray(roaches.id, hostRoaches))).map((r) => r.id) : [],
  );
  const who = (id: string) => (people.get(id) ? nameOf(people.get(id)!) : T.lib.profile.anonymous);
  return own.map((r) => {
    const guests = asHost.filter((v) => v.hostRoachId === r.id).map((v) => ({ friendId: friendKey(userId, v.guestId), name: who(v.guestId) }));
    const v = asGuest.find((x) => x.roachId === r.id);
    const left = v?.leftAt ? (standing.has(v.hostRoachId) ? "moved" : "removed") : null;
    return {
      ...r,
      ...(guests.length ? { guests } : {}),
      ...(v ? { visit: { friendId: friendKey(userId, v.hostId), name: who(v.hostId), left } } : {}),
    };
  });
}

// ---- in friends() and the inbox ----

/** Which day of being 触须之交 it is today, by Beijing time: the day they became so is day 1 */
export const friendDayOf = (since: Date, now = Date.now()) => daysBetween(beijingDate(since.getTime()), beijingDate(now)) + 1;

/** Between you and each 触须之交 (others), for their cards: since is when each friendship began */
export async function betweenOf(self: UserRow, others: { user: UserRow; since: Date }[], now = Date.now()) {
  const out = new Map<string, FriendBetween>();
  if (!others.length) return out;
  const userId = self.id;
  const ids = others.map((o) => o.user.id);
  const today = beijingDate(now);
  const dayStart = beijingMidnight(today);
  const recent = new Date(now - 90 * DAY);
  const mine = await db
    .select({ to: friendNotes.toUserId, kind: friendNotes.kind, period: friendNotes.period, game: friendNotes.game, answer: friendNotes.answer, at: friendNotes.createdAt })
    .from(friendNotes)
    .where(and(eq(friendNotes.fromUserId, userId), inArray(friendNotes.toUserId, ids), gt(friendNotes.createdAt, recent)));
  const addedBack = await db
    .select({ from: friendNotes.fromUserId, game: friendNotes.game })
    .from(friendNotes)
    .where(and(eq(friendNotes.toUserId, userId), inArray(friendNotes.fromUserId, ids), eq(friendNotes.kind, "gameAsk"), eq(friendNotes.answer, "added")));
  const mains = await db
    .select({ user: roaches.userId, publicId: roaches.publicId })
    .from(roaches)
    .where(and(inArray(roaches.userId, ids), eq(roaches.slot, 0)));
  const mineVisiting = await db
    .select()
    .from(visits)
    .where(and(eq(visits.guestId, userId), inArray(visits.hostId, ids)));
  const bans = await db
    .select()
    .from(visitBans)
    .where(and(eq(visitBans.guestId, userId), inArray(visitBans.hostId, ids)));
  for (const { user: o, since } of others) {
    const to = mine.filter((n) => n.to === o.id);
    const sleep = sleepOf(o, now);
    const did = (kind: string, period: string | null) => Boolean(period) && to.some((n) => n.kind === kind && n.period === period);
    const latest = (kind: string, game?: Game) =>
      to.filter((n) => n.kind === kind && (!game || n.game === game)).reduce<Date | null>((a, n) => (!a || n.at > a ? n.at : a), null);
    const games: FriendBetween["games"] = {};
    for (const g of profileOf(o).games) {
      const added =
        to.some((n) => n.kind === "gameAsk" && n.game === g && n.answer === "added") || addedBack.some((n) => n.from === o.id && n.game === g);
      const asked = latest("gameAsk", g);
      games[g] = { added, askAgainAt: added || !asked ? null : againIn(asked, now) };
    }
    const wanted = latest("gameWant");
    const ban = bans.find((b) => b.hostId === o.id);
    const banUntil = ban ? ban.at.getTime() + VISIT_BAN_DAYS * DAY : 0;
    const v = mineVisiting.find((x) => x.hostId === o.id);
    const day = friendDayOf(since, now);
    const used = to.filter((n) => COUNTED.includes(n.kind) && n.at.getTime() >= dayStart).length;
    out.set(o.id, {
      mainId: mains.find((m) => m.user === o.id)?.publicId ?? null,
      asleep: sleeping(o, now),
      actsLeft: Math.max(0, FRIEND_ACTS_PER_DAY - used),
      done: {
        sanity: did("sanity", today),
        blanket: did("blanket", sleep),
        water: did("water", sleep),
      },
      welcome: o.welcomeGuests,
      visitAgainAt: banUntil > now ? banUntil : null,
      visiting: v ? { cloneId: v.roachId, left: Boolean(v.leftAt) } : null,
      games,
      wantAgainAt: wanted ? againIn(wanted, now) : null,
      anniversary: isFriendAnniversary(day) ? day : null,
    });
  }
  return out;
}

/** The latest anniversary up to today whose day is still within the inbox's days, or null */
function latestAnniversary(since: Date, now: number) {
  const start = beijingDate(since.getTime());
  const today = beijingDate(now);
  const days = daysBetween(start, today) + 1;
  const candidates = [7, 30, 100, ...Array.from({ length: Math.floor(days / 365) }, (_, i) => 365 * (i + 1))];
  const fits = candidates.filter((d) => d <= days && daysBetween(addDays(start, d - 1), today) < INBOX_DAYS);
  if (!fits.length) return null;
  const day = Math.max(...fits);
  return { day, at: beijingMidnight(addDays(start, day - 1)) };
}

const VISIT_EVENTS: Record<string, VisitEvent> = {
  visit: "came",
  sentHome: "sentHome",
  hostMoved: "hostMoved",
  hostRemoved: "hostRemoved",
  closed: "closed",
};

/**
 * Their messages in your inbox: what 触须之交 did for you (hidden while you are drunk if they
 * did it as you slept), their answers to yours, and your anniversaries with each.
 */
export async function friendlyInbox(self: UserRow, blocked: Set<string>, now = Date.now()): Promise<InboxItem[]> {
  const userId = self.id;
  const since = new Date(now - INBOX_DAYS * DAY);
  const drunk = Boolean(self.drunkUntil && self.drunkUntil.getTime() > now);
  const toMe = (
    await db
      .select()
      .from(friendNotes)
      .where(and(eq(friendNotes.toUserId, userId), gt(friendNotes.createdAt, since)))
  ).filter((n) => !blocked.has(n.fromUserId) && !(drunk && n.asleep && !n.seenAt));
  const answered = (
    await db
      .select()
      .from(friendNotes)
      .where(
        and(
          eq(friendNotes.fromUserId, userId),
          or(and(eq(friendNotes.kind, "sanity"), eq(friendNotes.answer, "done")), and(eq(friendNotes.kind, "gameAsk"), eq(friendNotes.answer, "added"))),
          gt(friendNotes.answeredAt, since),
        ),
      )
  ).filter((n) => !blocked.has(n.toUserId));
  const fs = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.a, userId), eq(friendships.b, userId)));
  const otherOf = (f: { a: string; b: string }) => (f.a === userId ? f.b : f.a);
  const ids = [...new Set([...toMe.map((n) => n.fromUserId), ...answered.map((n) => n.toUserId), ...fs.map(otherOf)])];
  if (!ids.length) return [];
  const cards = await cardsOf(await db.select().from(users).where(inArray(users.id, ids)), self.id);
  // guests still sitting by your roaches, for 去看看
  const guestRoaches = toMe.filter((n) => n.kind === "visit").map((n) => n.period.split(":")[0]);
  const sitting = guestRoaches.length
    ? await db
        .select({ id: visits.roachId, lng: roaches.lng, lat: roaches.lat })
        .from(visits)
        .innerJoin(roaches, eq(roaches.id, visits.roachId))
        .where(and(inArray(visits.roachId, guestRoaches), eq(visits.hostId, userId), isNull(visits.leftAt)))
    : [];
  // your clones still left where their hosts were, for 跟过去 and 回家
  const leftBehind = await db
    .select({ id: visits.roachId })
    .from(visits)
    .where(and(eq(visits.guestId, userId), isNotNull(visits.leftAt)));
  const myGames = profileOf(self);

  const items: InboxItem[] = [];
  const base = (n: Note, id: string, at: Date, seen: boolean, who: string) => ({
    id,
    at: at.getTime(),
    seen,
    from: cards.get(who)!,
    friendId: friendKey(userId, who),
  });
  for (const n of toMe) {
    if (!cards.get(n.fromUserId)) continue;
    const b = base(n, `c:${n.id}`, n.createdAt, Boolean(n.seenAt), n.fromUserId);
    if (n.kind === "sanity") {
      const answer = n.answer === "done" || n.answer === "ok" ? n.answer : null;
      items.push({ kind: "sanity", ...b, asleep: n.asleep, answer, replied: Boolean(answer) });
    } else if (isGesture(n.kind)) {
      items.push({ kind: "gesture", ...b, gesture: n.kind, returned: n.answer === "back", replied: n.answer === "back" });
    } else if (VISIT_EVENTS[n.kind]) {
      const roachId = n.period.split(":")[0];
      const seat = n.kind === "visit" ? sitting.find((s) => s.id === roachId) : undefined;
      const left = n.kind === "hostMoved" || n.kind === "hostRemoved" ? leftBehind.some((l) => l.id === roachId) : false;
      items.push({
        kind: "visit",
        ...b,
        event: VISIT_EVENTS[n.kind],
        tip: n.answer === "tip",
        spot: seat ? { lng: seat.lng, lat: seat.lat } : null,
        cloneId: left ? roachId : null,
        replied: true,
      });
    } else if ((n.kind === "gameAsk" || n.kind === "gameWant") && isGame(n.game)) {
      const ask = n.kind === "gameAsk";
      items.push({
        kind: "game",
        ...b,
        event: ask ? "ask" : "want",
        game: n.game,
        server: ask ? (serverName(n.game, myGames.uidServer[n.game]) ?? "") : "",
        answered: n.answer === "added",
        replied: !ask || n.answer === "added",
      });
    }
  }
  for (const n of answered) {
    if (!cards.get(n.toUserId) || !n.answeredAt) continue;
    const b = base(n, `r:${n.id}`, n.answeredAt, Boolean(n.answerSeenAt), n.toUserId);
    if (n.kind === "sanity") items.push({ kind: "sanityThanks", ...b, replied: true });
    else if (isGame(n.game)) items.push({ kind: "game", ...b, event: "added", game: n.game, server: "", answered: true, replied: true });
  }
  for (const f of fs) {
    const other = otherOf(f);
    const card = cards.get(other);
    const a = card && latestAnniversary(f.createdAt, now);
    if (!a) continue;
    const seenUpTo = f.a === userId ? f.anniversarySeenA : f.anniversarySeenB;
    items.push({
      kind: "anniversary",
      id: `y:${f.a}~${f.b}~${a.day}`,
      at: a.at,
      seen: seenUpTo >= a.day,
      from: card,
      friendId: friendKey(userId, other),
      day: a.day,
      replied: true,
    });
  }
  return items;
}

/** Marks those of the given inbox ids that are these, and yours, as seen */
export async function seeFriendly(userId: string, itemIds: string[]) {
  const now = new Date();
  const ids = (prefix: string) =>
    itemIds
      .filter((i) => typeof i === "string" && i.startsWith(prefix))
      .map((i) => i.slice(prefix.length).toLowerCase())
      .filter((i) => UUID.test(i));
  const c = ids("c:");
  if (c.length) {
    await db
      .update(friendNotes)
      .set({ seenAt: now })
      .where(and(inArray(friendNotes.id, c), eq(friendNotes.toUserId, userId), isNull(friendNotes.seenAt)));
  }
  const r = ids("r:");
  if (r.length) {
    await db
      .update(friendNotes)
      .set({ answerSeenAt: now })
      .where(and(inArray(friendNotes.id, r), eq(friendNotes.fromUserId, userId), isNotNull(friendNotes.answer), isNull(friendNotes.answerSeenAt)));
  }
  for (const y of itemIds.filter((i) => typeof i === "string" && i.startsWith("y:"))) {
    const [a, b, d] = y.slice(2).split("~");
    const day = Number(d);
    if (!UUID.test(a ?? "") || !UUID.test(b ?? "") || !Number.isInteger(day) || day < 1) continue;
    const where = and(eq(friendships.a, a), eq(friendships.b, b));
    if (userId === a) await db.update(friendships).set({ anniversarySeenA: sql`greatest(${friendships.anniversarySeenA}, ${day})` }).where(where);
    if (userId === b) await db.update(friendships).set({ anniversarySeenB: sql`greatest(${friendships.anniversarySeenB}, ${day})` }).where(where);
  }
}

/** Old notes go with the rest of the activity, except that two are also friends in a game; old bans when they end */
export async function pruneFriendly(cutoff: Date, now = Date.now()) {
  await db
    .delete(friendNotes)
    .where(and(lt(friendNotes.createdAt, cutoff), or(sql`${friendNotes.kind} <> 'gameAsk'`, isNull(friendNotes.answer))));
  await db.delete(visitBans).where(lt(visitBans.at, new Date(now - VISIT_BAN_DAYS * DAY)));
}

// ---- 「祝我生日快乐」 to every 触须之交 ----

/**
 * Who a 「祝我生日快乐」 reaches as 触须之交, however far: all of them, unless one already went
 * to them within FRIEND_BIRTHDAY_DAYS (then only those nearby hear it, as anyone's).
 */
export async function birthdayFriends(userId: string, blocked: Set<string>, now = Date.now()) {
  const [lately] = await db
    .select({ id: deliveries.declarationId })
    .from(deliveries)
    .innerJoin(declarations, eq(declarations.id, deliveries.declarationId))
    .where(and(eq(declarations.senderId, userId), eq(deliveries.toFriend, true), gt(declarations.createdAt, new Date(now - FRIEND_BIRTHDAY_DAYS * DAY))))
    .limit(1);
  if (lately) return [];
  return [...(await friendIdsOf(userId))].filter((id) => !blocked.has(id));
}

/**
 * Names for the inbox: the sender of a birthday that came to you as their 触须之交, and those of
 * your 触须之交 who reacted to yours having had it as such. Everyone else stays anonymous.
 */
export async function birthdayNames(userId: string, senders: string[], reactors: { declarationId: string; from: string }[]) {
  const asFriend = reactors.length
    ? await db
        .select({ declarationId: deliveries.declarationId, recipientId: deliveries.recipientId })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.toFriend, true),
            inArray(deliveries.declarationId, [...new Set(reactors.map((r) => r.declarationId))]),
            inArray(deliveries.recipientId, [...new Set(reactors.map((r) => r.from))]),
          ),
        )
    : [];
  const named = new Set(asFriend.map((x) => `${x.declarationId}|${x.recipientId}`));
  const ids = [...new Set([...senders, ...asFriend.map((x) => x.recipientId)])];
  const cards: Map<string, PublicProfile> = ids.length ? await cardsOf(await db.select().from(users).where(inArray(users.id, ids)), userId) : new Map();
  const whoIs = (id: string) => {
    const card = cards.get(id);
    return card ? { from: card, friendId: friendKey(userId, id) } : {};
  };
  return {
    sender: (id: string, toFriend: boolean) => (toFriend ? whoIs(id) : {}),
    reactor: (declarationId: string, from: string) => (named.has(`${declarationId}|${from}`) ? whoIs(from) : {}),
  };
}
