import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, gte, isNotNull, isNull, lte, max, sql } from "drizzle-orm";
import { answerKind, deviceHour, paintingStart, SI, SI_LINES, siRoach, stampAt } from "../si";
import { homeSpot, homesReach } from "../siHomes";
import { ROOMS, roomOf, STAY_MS, toLngLat } from "../siInn";
import { ROACH_AVATARS, type RoachAvatar } from "../types";
import { WorldError, type SiInk, type SiItem, type SiMe, type SiState, type SiTouch, type TouchResult } from "../world/types";
import { award } from "./badges";
import { db } from "./db";
import { isProd } from "./env";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, lockPlayer, type Exec, type GuideRow, type GuideTable } from "./guides";
import { siInks, siTickets, siTouches, users } from "./schema";
import { fastForwardSi, siGlobals, siNow, siShift } from "./siClock";
import { forgetInkSnapshot } from "./siInk";

/**
 * 祀掌柜 on the server (src/lib/si.ts): her answers to each player's touches and the stamp she
 * puts in their 集章本 with the first of each day, the portrait she gives a new 触须之交, and
 * 缘缘庄 (src/lib/siInn.ts): the ink roach she draws of each player the first time they touch
 * her, its places in her queue (si_tickets, given out in order under one lock, each knowing when
 * it gets its room the moment it is given), and the minute job that tells them as they check in
 * and out. Nothing here nudges anyone: the page asks again when it wants to know.
 */

// her table starts with the columns every guide's has (schema.ts)
const her = guideTouches(SI, siTouches as unknown as GuideTable);

type SiRow = GuideRow & {
  line: number | null;
  stamp: number | null;
  stamps: number | null;
  room: number | null;
  waited: number | null;
};

const LINES: SiItem["line"][] = ["touch", "away", "longaway", "night", "friend", "checkin", "again", "checkout"];
const DAY_MS = 86_400_000;
/** One portrait in this many is her own, by mistake */
export const WRONG_ONE_IN = 10;

// ---- her clock (siClock.ts), and 下次一定拿错 beside it ----

const g = siGlobals;
export { fastForwardSi, siNow, siShift };
/** 下次一定拿错 (development only) */
export function wrongNext() {
  if (!isProd) g.__siWrongNext = true;
}

// ---- her lines ----

function toItem(r: SiRow, replied: boolean): SiItem {
  return {
    kind: "si",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    line: LINES.find((l) => l === r.kind) ?? "touch",
    bold: r.bold,
    variant: r.line,
    stamp: r.stamp,
    stamps: r.stamps,
    room: r.room,
    waited: r.waited,
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

// ---- 缘缘庄: the counts (src/lib/siInn.ts) ----

/** How many had their room by t: the highest ticket whose check-in is not after it (both only grow, together) */
export async function checkedInBy(exec: Exec, t: number) {
  const [row] = await exec
    .select({ n: siTickets.n })
    .from(siTickets)
    .where(lte(siTickets.checkinAt, new Date(t)))
    .orderBy(desc(siTickets.checkinAt), desc(siTickets.n))
    .limit(1);
  return row?.n ?? 0;
}

/** Where an ink roach is at `now`, by its latest ticket */
function inkState(ink: { no: number; look: string }, ticket: { n: number; checkinAt: Date }, checkedIn: number, now: number): SiInk {
  const look = (ROACH_AVATARS as readonly string[]).includes(ink.look) ? (ink.look as RoachAvatar) : "hood";
  const h = homeSpot(ink.no);
  const at = { inkNo: ink.no, look, home: toLngLat(h.x, h.y) };
  const inAt = ticket.checkinAt.getTime();
  if (inAt > now) return { state: "queue", ...at, n: ticket.n, place: Math.max(1, ticket.n - checkedIn), checkinAt: inAt };
  if (inAt + STAY_MS > now) return { state: "stay", ...at, n: ticket.n, room: roomOf(ticket.n), checkoutAt: inAt + STAY_MS };
  return { state: "out", ...at };
}

/** Their ink roach and its latest ticket, if she drew one */
async function inkOf(exec: Exec, userId: string) {
  const [row] = await exec
    .select({ no: siInks.no, look: siInks.look, n: siTickets.n, checkinAt: siTickets.checkinAt })
    .from(siInks)
    .innerJoin(siTickets, eq(siTickets.n, siInks.ticket))
    .where(eq(siInks.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * A place in the queue for an ink roach, under the inn's lock: the next number, and when it gets its
 * room. Everyone stays exactly STAY_MS and nobody leaves early or gives up a place, so ticket n gets the
 * room ticket n − ROOMS leaves (the same room number), the moment it leaves, or now if that is earlier:
 * known for good as it is given, and the queue moves up one by one without anything to run each day.
 * Never before the ticket ahead of it, whatever the clocks of different processes say.
 */
async function giveTicket(tx: Exec, inkNo: number, again: boolean, now: number) {
  const [{ last }] = await tx.select({ last: max(siTickets.n) }).from(siTickets);
  const n = (last ?? 0) + 1;
  const before = await tx
    .select({ n: siTickets.n, checkinAt: siTickets.checkinAt })
    .from(siTickets)
    .where(sql`${siTickets.n} in (${n - 1}, ${n - ROOMS})`);
  const prev = before.find((r) => r.n === n - 1)?.checkinAt.getTime() ?? 0;
  const freed = before.find((r) => r.n === n - ROOMS);
  const checkinAt = Math.max(now, prev, freed ? freed.checkinAt.getTime() + STAY_MS : 0);
  return { n, checkinAt, values: { n, inkNo, again, queuedAt: new Date(now), checkinAt: new Date(checkinAt) } };
}

type InnEvent = SiTouch["inn"] & { stayedNow: boolean; queuedNow: boolean; itemId: string | null };

/**
 * 3.4: after every touch of hers, answered or not. No ink roach yet: she draws one in the player's look,
 * and it queues. One whose stay is over (lying outside): it queues again. Queuing or staying: nothing,
 * and no lock taken. A ticket whose room is free at once checks in on the spot, with her line about it
 * written here rather than by the minute job (said_in). The player's row is locked already (lockPlayer),
 * so their double tap waits its turn; the inn's lock keeps numbers from being skipped or given twice.
 */
async function innAfterTouch(tx: Exec, userId: string, look: string, now: number): Promise<{ event: InnEvent; you: SiInk }> {
  const ink = await inkOf(tx, userId);
  if (ink && ink.checkinAt.getTime() + STAY_MS > now) {
    const you = inkState(ink, ink, await checkedInBy(tx, now), now);
    return { event: { drawn: false, event: "none", room: null, place: null, stayedNow: false, queuedNow: false, itemId: null }, you };
  }
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('si-inn'))`);
  // tickets go out in the order the lock is had, so their time is taken now, not before waiting for it
  now = Math.max(now, siNow());
  const drawnLook = (ROACH_AVATARS as readonly string[]).includes(look) ? look : "hood";
  let inkNo = ink?.no;
  if (!inkNo) {
    const [{ last }] = await tx.select({ last: max(siInks.no) }).from(siInks);
    inkNo = (last ?? 0) + 1;
  }
  const again = Boolean(ink);
  const ticket = await giveTicket(tx, inkNo, again, now);
  if (ink) await tx.update(siInks).set({ ticket: ticket.n }).where(eq(siInks.no, inkNo));
  else await tx.insert(siInks).values({ no: inkNo, userId, look: drawnLook, drawnAt: new Date(now), ticket: ticket.n });
  const straightIn = ticket.checkinAt <= now;
  await tx.insert(siTickets).values({ ...ticket.values, saidIn: straightIn });
  const room = roomOf(ticket.n);
  let itemId: string | null = null;
  if (straightIn) {
    // what the minute job would have said, said now
    const [said] = await tx
      .insert(siTouches)
      .values({ userId, direction: her.from, kind: again ? "again" : "checkin", bold: false, room, waited: 0, createdAt: new Date(now) })
      .returning({ id: siTouches.id });
    itemId = her.itemId(said.id);
    await tx
      .update(users)
      .set({ siStayedAt: new Date(now) })
      .where(and(eq(users.id, userId), isNull(users.siStayedAt)));
  }
  const checkedIn = straightIn ? ticket.n : await checkedInBy(tx, now);
  const you = inkState({ no: inkNo, look: ink?.look ?? drawnLook }, { n: ticket.n, checkinAt: new Date(ticket.checkinAt) }, checkedIn, now);
  return {
    event: {
      drawn: !ink,
      event: straightIn ? "in" : again ? "again" : "queued",
      room: straightIn ? room : null,
      place: you.state === "queue" ? you.place : null,
      stayedNow: straightIn,
      queuedNow: !straightIn,
      itemId,
    },
    you,
  };
}

// ---- touching her ----

/**
 * The player touches her, maybe answering one of hers: the first touch of their day she answers at
 * once, the same way they touched her, and stamps their 集章本; the rest of the day not. Their first
 * bold touch makes them 触须之交, answered whenever it comes, and the first time it does she gives them a
 * portrait. Every touch, answered or not, sees to their ink roach at 缘缘庄.
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin?: unknown): Promise<TouchResult> {
  const now = siNow();
  await her.allow(userId, now);
  const day = deviceDay(offsetMin, now);
  let done: {
    id: string | null;
    friend: boolean;
    kind: SiItem["line"];
    variant: number | null;
    stamp: { stamp: number; stamps: number } | null;
    portrait: "right" | "wrong" | null;
    inn: { event: InnEvent; you: SiInk };
  };
  try {
    done = await db.transaction(async (tx) => {
      await lockPlayer(tx, userId);
      const [u] = await tx
        .select({
          friendSince: users.siFriendSince,
          portraitAt: users.siPortraitAt,
          stamps: users.siStamps,
          stampedOn: users.siStampedOn,
          avatar: users.avatar,
        })
        .from(users)
        .where(eq(users.id, userId));
      const [last] = await tx
        .select({ at: siTouches.createdAt })
        .from(siTouches)
        .where(and(eq(siTouches.userId, userId), eq(siTouches.direction, her.to)))
        .orderBy(desc(siTouches.createdAt))
        .limit(1);
      const friend = bold && !u.friendSince;
      let portrait: "right" | "wrong" | null = null;
      if (friend) {
        // a portrait the first time only: after 解除 and back, the one they have stays
        portrait = u.portraitAt ? null : g.__siWrongNext || randomInt(WRONG_ONE_IN) === 0 ? "wrong" : "right";
        if (portrait) g.__siWrongNext = false;
        await tx
          .update(users)
          .set({ siFriendSince: new Date(now), ...(portrait ? { siPortraitAt: new Date(now), siPortrait: portrait } : {}) })
          .where(eq(users.id, userId));
      }
      const kind = answerKind({
        newFriend: friend,
        friend: Boolean(u.friendSince),
        last: last ? last.at.getTime() : null,
        now,
        hour: deviceHour(offsetMin, now),
      });
      const variant = kind === "touch" ? randomInt(SI_LINES.sneaky.length) : null;
      // the day's first touch gets a stamp with her answer, once a day by their device
      const first = (await her.touchesSince(tx, userId, new Date(day.start))) === 0;
      const stamp = first && u.stampedOn !== day.day ? { stamp: stampAt(userId, u.stamps), stamps: u.stamps + 1 } : null;
      const answer = await her.pair(tx, userId, {
        bold,
        replyTo,
        dayStart: new Date(day.start),
        kind,
        at: new Date(now),
        more: { line: variant, ...(stamp ?? {}) },
      });
      if (stamp && answer) await tx.update(users).set({ siStamps: stamp.stamps, siStampedOn: day.day }).where(eq(users.id, userId));
      const inn = await innAfterTouch(tx, userId, u.avatar, now);
      return { id: answer?.id ?? null, friend, kind, variant, stamp: answer ? stamp : null, portrait, inn };
    });
  } catch (e) {
    // two answers to the same one of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError("已经碰过她了。");
    throw e;
  }
  const { event, you } = done.inn;
  if (event.queuedNow) await award(userId, ["siqueue"]);
  if (event.stayedNow) await award(userId, ["siinn"]);
  const inn = { drawn: event.drawn, event: event.event, room: event.room, place: event.place };
  return {
    newFriend: done.friend ? SI.name : null,
    guide: {
      id: SI.id,
      itemId: done.id && her.itemId(done.id),
      bold,
      kind: done.friend ? "friend" : "touch",
      times: null,
      others: null,
      line: done.variant,
    },
    si: { answer: done.id ? done.kind : null, stamp: done.stamp, portrait: done.portrait, inn, innItemId: event.itemId, you },
  };
}

export const touchSi = (userId: string, bold: boolean, offsetMin?: unknown) => touchBack(userId, bold, null, offsetMin);

/** Touch back one of hers, once: it counts as touching her, stamps and all. */
export async function replySi(userId: string, itemId: string, bold: boolean, offsetMin?: unknown) {
  const item = await her.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id, offsetMin);
}

export const ignoreSi = (userId: string, itemId: string) => her.ignore(userId, itemId);

export const seeSi = (userId: string, itemIds: string[]) => her.see(userId, itemIds);

/** Her latest to the player, for the inbox. */
export async function siInbox(userId: string): Promise<SiItem[]> {
  return (await her.latest(userId)).map(({ row, replied }) => toItem(row as SiRow, replied));
}

/** Her place among the 触须之交, fifth, after 明河都尉. */
export const siFriend = (since: Date) => guideFriend(SI, since, [siRoach(true)]);

/** 解除: only that; her portrait, the stamps and the ink roach all stay. A bold touch makes them 触须之交 again. */
export async function unfriendSi(userId: string) {
  await db.update(users).set({ siFriendSince: null }).where(eq(users.id, userId));
}

/** 还给她 or 就不还, only while the portrait she gave is her own by mistake; her line about it. */
export async function answerPortrait(userId: string, choice: unknown) {
  if (choice !== "return" && choice !== "keep") throw new WorldError("选一个吧。");
  const [done] = await db
    .update(users)
    .set({ siPortrait: choice === "return" ? "returned" : "kept" })
    .where(and(eq(users.id, userId), eq(users.siPortrait, "wrong")))
    .returning({ id: users.id });
  if (!done) throw new WorldError("这幅画已经说好了。");
  return { line: choice === "return" ? SI_LINES.portraitReturn : SI_LINES.portraitKeep };
}

const PORTRAITS = ["right", "wrong", "returned", "kept"] as const;

/** What me() says about her. */
export async function siOf(
  u: {
    id: string;
    siFriendSince: Date | null;
    siPortraitAt: Date | null;
    siPortrait: string | null;
    siStamps: number;
    siStampedOn: string | null;
    siStayedAt: Date | null;
  },
  offsetMin?: unknown,
): Promise<SiMe> {
  const now = siNow();
  const ink = await inkOf(db, u.id);
  const inn = ink ? inkState(ink, ink, await checkedInBy(db, now), now) : null;
  const state = PORTRAITS.find((p) => p === u.siPortrait);
  return {
    friend: Boolean(u.siFriendSince),
    portrait: u.siPortraitAt && state ? { at: u.siPortraitAt.getTime(), state } : null,
    stamps: u.siStamps,
    stampedToday: u.siStampedOn === deviceDay(offsetMin, now).day,
    inn,
    // had its room, whether or not the minute job has said so yet
    stayed: Boolean(u.siStayedAt) || (ink !== null && ink.checkinAt.getTime() <= now),
    shift: siShift(),
  };
}

/** Whether their ink roach has had a room (her two declarations, src/lib/declarations.ts) */
export async function hasStayed(userId: string, stayedAt: Date | null) {
  if (stayedAt) return true;
  const ink = await inkOf(db, userId);
  return ink !== null && ink.checkinAt.getTime() <= siNow();
}

// ---- 缘缘庄, every minute ----

const BATCH = 500;

/**
 * 3.5, once a minute in the main process: her lines to the owners of the tickets that got their room
 * (checkin, or again for a returning guest, with how long they queued; their first stay also brings
 * 塔卫二最好的客栈 and si_stayed_at) and of those whose half day is over (checkout), each dated when it
 * happened. A ticket is claimed as it is told (said_in, said_out), so running it twice tells nobody
 * twice, and a run after hours without one catches up at once. Ink roaches nobody owns any more are
 * claimed and passed over.
 */
export async function innMinute(now = siNow()) {
  let told = 0;
  for (;;) {
    const [res] = await db.execute<{ claimed: number; owners: string[] }>(sql`
        with claimed as (
          update si_tickets set said_in = true
          where n in (select n from si_tickets where not said_in and checkin_at <= ${new Date(now).toISOString()}::timestamptz order by n limit ${BATCH} for update skip locked)
          returning n, ink_no, again, queued_at, checkin_at
        ), owned as (
          select c.*, i.user_id from claimed c join si_inks i on i.no = c.ink_no where i.user_id is not null
        ), said as (
          insert into si_touches (user_id, direction, kind, bold, room, waited, created_at)
          select user_id, ${her.from}, case when again then 'again' else 'checkin' end, false, ((n - 1) % ${ROOMS}) + 1,
            greatest(0, floor(extract(epoch from (checkin_at - queued_at)) / 60))::int, checkin_at
          from owned
        ), stayed as (
          update users set si_stayed_at = owned.checkin_at from owned where users.id = owned.user_id and users.si_stayed_at is null
        )
        select (select count(*) from claimed)::int as claimed, coalesce((select array_agg(distinct user_id::text) from owned), '{}') as owners`);
    for (const id of res.owners) await award(id, ["siinn"]);
    told += res.owners.length;
    if (res.claimed < BATCH) break;
  }
  for (;;) {
    const [res] = await db.execute<{ claimed: number; owned: number }>(sql`
        with claimed as (
          update si_tickets set said_out = true
          where n in (
            select n from si_tickets where not said_out and checkin_at <= ${new Date(now - STAY_MS).toISOString()}::timestamptz order by n limit ${BATCH} for update skip locked
          )
          returning n, ink_no, checkin_at
        ), owned as (
          select c.*, i.user_id from claimed c join si_inks i on i.no = c.ink_no where i.user_id is not null
        ), said as (
          insert into si_touches (user_id, direction, kind, bold, room, created_at)
          select user_id, ${her.from}, 'checkout', false, ((n - 1) % ${ROOMS}) + 1, checkin_at + ${`${STAY_MS / 1000} seconds`}::interval
          from owned
        )
        select (select count(*) from claimed)::int as claimed, (select count(*) from owned)::int as owned`);
    told += res.owned;
    if (res.claimed < BATCH) break;
  }
  return told;
}

// ---- 缘缘庄 as everyone sees it ----

let shared: { at: number; state: SiState } | null = null;
/** How long one process keeps the counts before asking again */
const STATE_KEPT_MS = 15_000;

/**
 * The few numbers every page draws 缘缘庄 from (3.6, src/lib/siInn.ts), and today's visitors for her
 * painting: one small read for everyone a quarter of a minute, whoever asks.
 */
export async function siState(): Promise<SiState> {
  const real = Date.now();
  if (shared && real - shared.at < STATE_KEPT_MS && !siShift()) return shared.state;
  const now = siNow();
  const [[{ drawn }], [{ tickets }]] = await Promise.all([
    db.select({ drawn: max(siInks.no) }).from(siInks),
    db.select({ tickets: max(siTickets.n) }).from(siTickets),
  ]);
  const [checkedIn, checkedOut, inDayAgo, [queuedDayAgo], today] = await Promise.all([
    checkedInBy(db, now),
    checkedInBy(db, now - STAY_MS),
    checkedInBy(db, now - DAY_MS),
    db
      .select({ n: siTickets.n })
      .from(siTickets)
      .where(lte(siTickets.queuedAt, new Date(now - DAY_MS)))
      .orderBy(desc(siTickets.queuedAt), desc(siTickets.n))
      .limit(1),
    todaysVisitors(now),
  ]);
  const state: SiState = {
    drawn: drawn ?? 0,
    tickets: tickets ?? 0,
    checkedIn,
    checkedOut,
    queueDayAgo: Math.max(0, (queuedDayAgo?.n ?? 0) - inDayAgo),
    today,
    homesReach: Math.round(homesReach(drawn ?? 0)),
    at: now,
    shift: siShift(),
  };
  shared = { at: real, state };
  return state;
}

/** Tests: the counts asked afresh */
export function forgetSiState() {
  shared = null;
}

// ---- 今天的画 ----

let paintingCount: { at: number; day: number; n: number } | null = null;
const PAINTING_KEPT_MS = 60_000;

/** Players who touched her today (Beijing, from 04:00), counted once a minute at most; nobody is kept by name */
export async function todaysVisitors(now = siNow()) {
  const start = paintingStart(now);
  if (!isProd && g.__siToday != null) return g.__siToday;
  if (paintingCount && paintingCount.day === start && Date.now() - paintingCount.at < PAINTING_KEPT_MS) return paintingCount.n;
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${siTouches.userId})::int` })
    .from(siTouches)
    .where(and(eq(siTouches.direction, her.to), gte(siTouches.createdAt, new Date(start))));
  paintingCount = { at: Date.now(), day: start, n: row?.n ?? 0 };
  return paintingCount.n;
}

/** 假装今天来了 n 人 (development only): the painting counts n until set back with null, which counts afresh */
export function pretendVisitors(n: number | null) {
  if (isProd) return;
  g.__siToday = n;
  paintingCount = null;
  shared = null;
}

// ---- development only ----

/** 清掉我和祀的记录: her columns and lines of theirs gone; their ink roach stays in the painting, nobody's now */
export async function forgetSi(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ siFriendSince: null, siPortraitAt: null, siPortrait: null, siStamps: 0, siStampedOn: null, siStayedAt: null })
      .where(eq(users.id, userId));
    await tx.delete(siTouches).where(eq(siTouches.userId, userId));
    await tx.update(siInks).set({ userId: null }).where(eq(siInks.userId, userId));
  });
}

/** 清掉缘缘庄: every ink roach and ticket gone, to start again (emptied whole: row by row, 100,000 take minutes) */
export async function clearInn() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`truncate ${siTickets}, ${siInks}`);
    await tx.update(users).set({ siStayedAt: null }).where(isNotNull(users.siStayedAt));
  });
  forgetInkSnapshot();
  shared = null;
}

/**
 * 假装已经有 n 人碰过她: ink roaches of nobody, in random looks, each queuing now, until n are drawn in
 * all; in batches, so 100,000 take a few seconds.
 */
export async function pretendCrowd(total: number) {
  const now = siNow();
  const CHUNK = 5000;
  for (;;) {
    const added = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('si-inn'))`);
      const [{ last }] = await tx.select({ last: max(siInks.no) }).from(siInks);
      const from = (last ?? 0) + 1;
      const k = Math.min(CHUNK, total - from + 1);
      if (k <= 0) return 0;
      // the numbers and check-ins worked out as giveTicket would, one after another
      const [{ n0 }] = await tx.select({ n0: max(siTickets.n) }).from(siTickets);
      const firstN = (n0 ?? 0) + 1;
      const lookback = await tx
        .select({ n: siTickets.n, checkinAt: siTickets.checkinAt })
        .from(siTickets)
        .where(gte(siTickets.n, Math.max(1, firstN - ROOMS)));
      const checkin = new Map(lookback.map((r) => [r.n, r.checkinAt.getTime()]));
      const inks = [];
      const tickets = [];
      for (let i = 0; i < k; i++) {
        const n = firstN + i;
        const freed = checkin.get(n - ROOMS);
        const at = Math.max(now, checkin.get(n - 1) ?? 0, freed !== undefined ? freed + STAY_MS : 0);
        checkin.set(n, at);
        inks.push({ no: from + i, userId: null, look: ROACH_AVATARS[randomInt(ROACH_AVATARS.length)], drawnAt: new Date(now), ticket: n });
        tickets.push({ n, inkNo: from + i, again: false, queuedAt: new Date(now), checkinAt: new Date(at) });
      }
      await tx.insert(siInks).values(inks);
      await tx.insert(siTickets).values(tickets);
      return k;
    });
    if (!added) break;
  }
  await innMinute();
  shared = null;
}
