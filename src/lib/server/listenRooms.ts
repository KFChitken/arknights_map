import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { COUNTED } from "../dashboard";
import { LISTEN_TEMPLATE } from "../declarations";
import {
  ALONE_EARLY_MS,
  ALONE_MS,
  AWAY_MS,
  changeQueue,
  INVITE_MS,
  isQueueRemove,
  isRx,
  isSeek,
  isSongId,
  LISTEN_ASK,
  LISTEN_GRAY,
  LISTEN_PAUSED,
  needsTopUp,
  NO_ROOM,
  NO_SONG,
  NOT_LISTENING,
  QUEUE_MAX,
  QUIET_AFTER_LATER_MS,
  RANDOM_ADD,
  RECENT_AVOID,
  REQUESTS_EACH,
  ROOM_FULL,
  ROOM_GONE,
  ROOM_IDLE_MS,
  ROOM_KEEP_MS,
  ROOM_LIFE_MS,
  ROOM_SHUT,
  roomAt,
  RX_EVERY_MS,
  RX_PER_SONG,
  RX_ROOM_FROM,
  songsAhead,
  type FriendListening,
  type InviteSent,
  type ListenCall,
  type ListenFriend,
  type ListenRoom,
  type QueueChange,
  type QueueEdit,
  type QueueRemove,
  type RoomEnd,
  type RoomInvited,
  type RoomMember,
  type RoomRequest,
  type RoomSchedule,
} from "../listen";
import { displayName } from "../profile";
import { siteDay } from "../siteDay";
import { WorldError, type InboxItem, type TouchResult } from "../world/types";
import { blockedWith } from "./blocks";
import { canSeeDeclaration } from "./declarationInbox";
import { db } from "./db";
import { lockPlayer, type Exec } from "./guides";
import { HttpError } from "./http";
import { listenOpen, refuseIfFull, roomOfPlayer } from "./listen";
import { nudge, onToldListen, tellListen } from "./live";
import { allow } from "./rateLimit";
import { friendNotes, listenInvites, listenMembers, listenNow, listenRequests, listenRooms, roaches, users, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { countSaid, firstSong, songList, songOf } from "./songs";
import { countStat } from "./stats";
import { cardsOf, declare, friendIdsOf, friendKey, profileOf, touch } from "./world";

/**
 * 一起听: rooms where a host and the 触须之交 they invite hear the same song at the same second. The server keeps only
 * each room's songs and when its song started (src/lib/listen.ts RoomSchedule); every phone works out where it should
 * be from that (roomAt), and the host alone changes it (changeQueue). Invitations go to 消息 → 触须之交 and pop up on
 * a page that is open; the host may also call those nearby once a room (宣言一起听, a declaration), who go in at it
 * without asking, and may ask anyone to leave. Whoever goes in is known in the room by a number of its own (handle),
 * never by an id, and by it is touched (碰), blocked or reported there (拉黑, 举报: src/lib/server/safety.ts). What a
 * room does goes to the phones in it at once, with what happened in it (live.ts tellListen): its songs (never anything
 * of who), that who is in it changed (each phone asks again, as each sees the others its own way), the 短评 of the last
 * second, and that it ended. 短评 are never written down. Its songs never run out: one playing the last of them is given
 * another at the end, at random (toppedUp, as the host changes them and every minute). A room ends when its host ends
 * or leaves it, goes off for more than AWAY_MS, opens another or goes in at another; when its host has been alone in it
 * ALONE_MS (alone_since: nobody came, or all who did left), its songs have been over ROOM_IDLE_MS (none could be added
 * in time), nobody is left, or it has gone on ROOM_LIFE_MS; and every room ends when 听歌 is paused in the 管理台 or the
 * site goes gray. Whoever was in a room that ended (but by the 管理台 or 全站变灰) goes on with its song alone, on their
 * own page (src/components/app/listening.ts). ROOM_KEEP_MS
 * after, the room, who was in it and the invitations to it are deleted. Your 触须之交 see what you listen to while you
 * let them (show_listening: friendsListening), and may ask you to invite them (想一起听: askToListen, answerAsk).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 短评 that came to this process in this long go out together, one message to the room */
const RX_BATCH_MS = 1_000;
/** Who is in a room, as this process last read it, for what it tells the room: at most this old */
const MEMBERS_MS = 5_000;
/** One whose room ended is counted as listening this much longer at most, while their phone fades the song out */
const END_GRACE_MS = 30_000;
/** An invitation to as many at once at most */
const INVITE_AT_ONCE = 30;

type Room = typeof listenRooms.$inferSelect;

const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);

/** Nothing new while the site is gray (全站变灰) or 听歌 is paused in the 管理台 */
function refuseNow(now: number) {
  if (grayUntil(now)) throw refuse(403, T.server.listen.gray, LISTEN_GRAY);
  if (listenSettings().paused) throw refuse(503, T.server.listen.paused, LISTEN_PAUSED);
}

/** A room's number for its host (newRoom) */
const HOST_H = 1;

const scheduleOf = (r: Room): RoomSchedule => ({
  queue: r.queue,
  idx: r.idx,
  startedAt: r.startedAt?.getTime() ?? null,
  version: r.version,
  // songs put in before who put each in was kept (a room open as 点歌 came in) count as the host's
  by: r.queue.map((_, i) => r.queueBy[i] ?? HOST_H),
});

/** A 点歌's id as sent: a whole number from 1 */
const requestId = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : null);

/** A room's songs as they are written: who put each in with them */
const written = (s: RoomSchedule) => ({
  queue: s.queue,
  queueBy: s.queue.map((_, i) => s.by?.[i] ?? 0),
  idx: s.idx,
  startedAt: s.startedAt === null ? null : new Date(s.startedAt),
  version: s.version,
});

/** How long each song lasts, by the list every process holds (one no longer in it lasts nothing, so a room passes over it) */
async function secondsOf() {
  const list = await songList();
  return (id: string) => list.byId.get(id)?.seconds ?? Number.NaN;
}

/** The song a room is at now: the one playing (or next, between two), the first before it starts, the last once all are over */
function songNow(room: Room, seconds: (id: string) => number, now: number): string {
  const at = roomAt(scheduleOf(room), seconds, now);
  return room.queue[at.phase === "playing" ? at.i : at.phase === "done" ? room.queue.length - 1 : room.idx] ?? room.queue[0];
}

/** A room's number for someone in it, as a request gives it */
const handleOf = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 32_767 ? (v as number) : null);

// ---- who is in a room, for what is told to it ----

type Hearer = { userId: string; handle: number; hiddenFrom: number[] };
type Held = { at: number; rows: Hearer[] };
type Batch = { items: { h: number; r: number }[]; timer: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as {
  listenRoomMembers?: Map<string, Held>;
  listenRx?: Map<string, Batch>;
  listenToldHeard?: boolean;
  listenRoomLately?: Map<string, string[]>;
};
const hearersHeld: Map<string, Held> = (g.listenRoomMembers ??= new Map());
const batches: Map<string, Batch> = (g.listenRx ??= new Map());
/** The songs each room played lately, as this process saw them (its songs drop those played as they change), the latest last */
const lately: Map<string, string[]> = (g.listenRoomLately ??= new Map());

async function hearersOf(roomId: string, now = Date.now()): Promise<Hearer[]> {
  const held = hearersHeld.get(roomId);
  if (held && now - held.at < MEMBERS_MS) return held.rows;
  const rows = await db
    .select({ userId: listenMembers.userId, handle: listenMembers.handle, hiddenFrom: listenMembers.hiddenFrom })
    .from(listenMembers)
    .where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt)));
  hearersHeld.set(roomId, { at: now, rows });
  if (hearersHeld.size > 5_000) hearersHeld.delete(hearersHeld.keys().next().value as string);
  return rows;
}

/** Who is in it changed: here at once, and on the other processes as they hear of it */
const forget = (roomId: string) => hearersHeld.delete(roomId);
if (!g.listenToldHeard) {
  g.listenToldHeard = true;
  onToldListen((d) => {
    const t = d as { t?: unknown; room?: unknown };
    if ((t.t === "members" || t.t === "end") && typeof t.room === "string") forget(t.room);
  });
}

/** Tell everyone in the room that who is in it changed: each asks again */
async function tellMembers(roomId: string, also: string[] = []) {
  forget(roomId);
  const rows = await hearersOf(roomId);
  tellListen([...rows.map((r) => r.userId), ...also], { t: "members", room: roomId });
}

// ---- what a room looks like to someone in it ----

/** The room as viewerId sees it, or null when they are not in it (or it is over) */
export async function roomView(roomId: string, viewerId: string, now = Date.now()): Promise<ListenRoom | null> {
  const [room] = await db.select().from(listenRooms).where(eq(listenRooms.id, roomId));
  if (!room || room.endedAt) return null;
  const rows = await db
    .select({ m: listenMembers, u: users })
    .from(listenMembers)
    .innerJoin(users, eq(users.id, listenMembers.userId))
    .where(eq(listenMembers.roomId, roomId));
  const me = rows.find((r) => r.u.id === viewerId)?.m;
  if (!me || me.leftAt) return null;
  const friends = await friendIdsOf(viewerId);
  const host = room.hostId === viewerId;
  const shown = rows
    // those hidden from you by blocking are not there at all, for you
    .filter((r) => r.u.id === viewerId || !r.m.hiddenFrom.includes(me.handle))
    .sort((a, b) => Number(Boolean(a.m.leftAt)) - Number(Boolean(b.m.leftAt)) || a.m.handle - b.m.handle);
  const cards = await cardsOf(
    shown.map((r) => r.u),
    viewerId,
  );
  const members: RoomMember[] = shown.map(({ m, u }) => {
    const p = profileOf(u);
    return {
      h: m.handle,
      card: cards.get(u.id)!,
      open: !p.anonymous && p.name.trim() !== "",
      friend: friends.has(u.id),
      host: u.id === room.hostId,
      state: !m.leftAt ? "in" : m.kicked && host ? "kicked" : "left",
    };
  });
  const invited: RoomInvited[] = [];
  if (host) {
    const asked = await db
      .select({ i: listenInvites, u: users })
      .from(listenInvites)
      .innerJoin(users, eq(users.id, listenInvites.toUserId))
      .where(eq(listenInvites.roomId, roomId))
      .orderBy(desc(listenInvites.createdAt));
    const came = new Set(rows.map((r) => r.u.id));
    // the latest invitation to each who has not come
    const latest = new Map<string, (typeof asked)[number]>();
    for (const a of asked) if (!came.has(a.u.id) && !latest.has(a.u.id)) latest.set(a.u.id, a);
    const theirCards = await cardsOf(
      [...latest.values()].map((a) => a.u),
      viewerId,
    );
    for (const { i, u } of latest.values()) {
      const waiting = !i.answer && i.createdAt.getTime() > now - INVITE_MS;
      invited.push({ card: theirCards.get(u.id)!, state: waiting ? "waiting" : "missed" });
    }
  }
  // 点歌 waiting: all of them to the host, their own to anyone else
  const requests: RoomRequest[] = await db
    .select({ id: listenRequests.id, h: listenRequests.handle, song: listenRequests.song })
    .from(listenRequests)
    .where(host ? eq(listenRequests.roomId, roomId) : and(eq(listenRequests.roomId, roomId), eq(listenRequests.handle, me.handle)))
    .orderBy(asc(listenRequests.createdAt), asc(listenRequests.id));
  const hostRow = rows.find((r) => r.u.id === room.hostId);
  // only while nobody else is in it: a count left from two going at once is not shown (sweepRooms puts it right)
  const alone = host && room.aloneSince && rows.filter((r) => !r.m.leftAt).length === 1 ? room.aloneSince.getTime() : null;
  return {
    id: room.id,
    ...scheduleOf(room),
    max: listenSettings().roomMax,
    you: me.handle,
    host,
    hostName: hostRow ? displayName(profileOf(hostRow.u)) : "",
    declared: Boolean(room.declaredAt),
    aloneSince: alone,
    members,
    invited,
    requests,
    now,
  };
}

/** The room you are in now, as you see it (null: none), and the server's clock */
export async function myRoom(user: Pick<UserRow, "id">, now = Date.now()) {
  const mine = await roomOfPlayer(db, user.id);
  return { room: mine ? await roomView(mine.room.id, user.id, now) : null, now };
}

// ---- in and out ----

/** What leaving the room you are in made of it, told once the change is written */
type Left = { roomId: string; ended: string[] | null } | null;

/** Out of the room you are in, if any: the host's ends with them (why), anyone else's goes on without them */
async function leaveIn(tx: Exec, userId: string, now: number, why: RoomEnd = "host"): Promise<Left> {
  const mine = await roomOfPlayer(tx, userId);
  if (!mine) return null;
  if (mine.room.hostId === userId) return { roomId: mine.room.id, ended: await endIn(tx, mine.room.id, why, now) };
  await tx
    .update(listenMembers)
    .set({ leftAt: new Date(now), awayAt: null })
    .where(and(eq(listenMembers.roomId, mine.room.id), eq(listenMembers.userId, userId)));
  await dropRequests(tx, mine.room.id, mine.me.handle);
  await aloneFrom(tx, mine.room.id, now);
  await tx
    .update(listenNow)
    .set({ roomId: null, until: soonest(now) })
    .where(and(eq(listenNow.userId, userId), eq(listenNow.roomId, mine.room.id)));
  return { roomId: mine.room.id, ended: null };
}

async function told(left: Left, why: RoomEnd = "host") {
  if (!left) return;
  if (left.ended) return tellEnd(left.roomId, left.ended, why);
  await tellMembers(left.roomId);
}

/** The room over, everyone in it out; says who was in it (null: it was over already) */
async function endIn(tx: Exec, roomId: string, why: RoomEnd, now: number): Promise<string[] | null> {
  const [ended] = await tx
    .update(listenRooms)
    .set({ endedAt: new Date(now), endReason: why })
    .where(and(eq(listenRooms.id, roomId), isNull(listenRooms.endedAt)))
    .returning({ id: listenRooms.id });
  if (!ended) return null;
  const gone = await tx
    .update(listenMembers)
    .set({ leftAt: new Date(now) })
    .where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt)))
    .returning({ userId: listenMembers.userId });
  await dropRequests(tx, roomId);
  // what they heard there stops counting soon: their phones fade it out, and say so
  await tx.update(listenNow).set({ roomId: null, until: soonest(now) }).where(eq(listenNow.roomId, roomId));
  return gone.map((r) => r.userId);
}

/** The 点歌 waiting in a room: those of the number h there (out of it), or all of them (it ended) */
async function dropRequests(tx: Exec, roomId: string, h?: number) {
  await tx.delete(listenRequests).where(h === undefined ? eq(listenRequests.roomId, roomId) : and(eq(listenRequests.roomId, roomId), eq(listenRequests.handle, h)));
}

/**
 * Someone out of a room (left, asked to leave, parted by a block): its host alone in it from now on, when nobody else is
 * in (those invited are nobody yet), so it ends ALONE_MS after unless anyone comes. true: they are
 */
async function aloneFrom(tx: Exec, roomId: string, now: number): Promise<boolean> {
  const set = await tx
    .update(listenRooms)
    .set({ aloneSince: new Date(now) })
    .where(
      and(
        eq(listenRooms.id, roomId),
        isNull(listenRooms.endedAt),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(listenMembers)
            .where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt), ne(listenMembers.userId, listenRooms.hostId))),
        ),
      ),
    )
    .returning({ id: listenRooms.id });
  return set.length > 0;
}

/** The host called someone while alone in their room (an invitation, 宣言一起听): ALONE_MS from now, for TA to answer */
async function aloneAgain(roomId: string, now: number) {
  await db
    .update(listenRooms)
    .set({ aloneSince: new Date(now) })
    .where(and(eq(listenRooms.id, roomId), isNotNull(listenRooms.aloneSince), isNull(listenRooms.endedAt)));
}

/**
 * The room its host has been alone in ALONE_MS ends (alone), as they go on alone: by the sweep, or by the host's own
 * page as it counts down (early: so much sooner at most, as clocks go). Read again under the room's lock, after anyone
 * coming in at once (joinRoom): not with anyone else in it (a count left from two going at once, put right). true: ended
 */
async function endAlone(roomId: string, now: number, early = 0): Promise<boolean> {
  const ids = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, roomId)).for("update");
    if (!room || room.endedAt || !room.aloneSince || room.aloneSince.getTime() > now - ALONE_MS + early) return null;
    const [{ n }] = await tx
      .select({ n: count() })
      .from(listenMembers)
      .where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt)));
    if (n <= 1) return endIn(tx, roomId, "alone", now);
    await tx.update(listenRooms).set({ aloneSince: null }).where(eq(listenRooms.id, roomId));
    return null;
  });
  if (ids) tellEnd(roomId, ids, "alone");
  return Boolean(ids);
}

/** Listening to a room's song stops counting END_GRACE_MS after one is out of it, at most */
const soonest = (now: number) => sql`least(${listenNow.until}, ${new Date(now + END_GRACE_MS).toISOString()}::timestamptz)`;

function tellEnd(roomId: string, ids: string[], why: RoomEnd) {
  forget(roomId);
  batches.delete(roomId);
  lately.delete(roomId);
  tellListen(ids, { t: "end", room: roomId, why });
}

/** End a room (the host's 结束, the sweep, the 管理台's pause, 全站变灰) and tell everyone in it */
export async function endRoom(roomId: string, why: RoomEnd, now = Date.now()) {
  const ids = await db.transaction((tx) => endIn(tx, roomId, why, now));
  if (ids) tellEnd(roomId, ids, why);
}

/** Every room ends at once: 听歌 paused in the 管理台 (admin), or the site gone gray */
export async function endAllRooms(why: RoomEnd, now = Date.now()) {
  const open = await db.select({ id: listenRooms.id }).from(listenRooms).where(isNull(listenRooms.endedAt));
  for (const r of open) await endRoom(r.id, why, now);
  return open.length;
}

/** The cap on players at once applies to a room's first song too: one not listening yet is turned away when it is full */
async function mayListen(userId: string, now: number) {
  await refuseIfFull(userId, now);
}

/**
 * A new room, the player its host, with the song given first (the one they play, or 新歌's first; 新歌's first when none
 * is), and invitations to the 触须之交 given (invite: their Friend ids). Out of the room they were in first. at: seconds
 * into that song, which plays at once from there (a song playing alone goes on as the room's); else it waits for 开始.
 */
export async function openRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const { id: roomId } = await newRoom(user, body.song, now, body.at);
  countStat(COUNTED.listenRoom, 1, now);
  const sent = body.invite === undefined ? [] : await inviteIn(user, roomId, body.invite, now);
  return { room: await roomView(roomId, user.id, now), sent, now };
}

/**
 * A room of the player's own, with the song given first (新歌's first when none is), out of the one they were in first;
 * at: seconds into it, playing from there at once (and so given one more after it, as 待播 never runs out)
 */
async function newRoom(user: UserRow, given: unknown, now: number, at?: unknown) {
  // no song named (a 触须之交's card, before the list was looked at): 新歌's first
  const song = given == null ? await firstSong() : await songOf(given);
  if (!song) throw refuse(404, T.server.listen.noSong, NO_SONG);
  await mayListen(user.id, now);
  const startedAt = typeof at === "number" && Number.isFinite(at) && at >= 0 && at < song.seconds ? now - Math.floor(at * 1000) : null;
  // the host's first song, theirs (HOST_H: the number the host has in the room)
  const first: RoomSchedule = { queue: [song.id], idx: 0, startedAt, version: 0, by: [HOST_H] };
  const songs = startedAt === null ? first : (toppedUp(first, "", [...(await songList()).byId.keys()], await secondsOf(), now) ?? first);
  const { id, left } = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    const left = await leaveIn(tx, user.id, now);
    const [room] = await tx
      .insert(listenRooms)
      .values({
        hostId: user.id,
        createdAt: new Date(now),
        queue: songs.queue,
        queueBy: songs.by,
        startedAt: startedAt === null ? null : new Date(startedAt),
        // alone in it until anyone comes
        aloneSince: new Date(now),
      })
      .returning({ id: listenRooms.id });
    await tx.insert(listenMembers).values({ roomId: room.id, userId: user.id, handle: 1, via: "host", joinedAt: new Date(now) });
    return { id: room.id, left };
  });
  await told(left);
  return { id, song };
}

/** Invitations from the host of the room they are in to the 触须之交 given (friends: their Friend ids) */
export async function inviteFriends(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const mine = await roomOfPlayer(db, user.id);
  if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
  if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
  const sent = await inviteIn(user, mine.room.id, body.friends, now);
  return { room: await roomView(mine.room.id, user.id, now), sent, now };
}

/**
 * Each 触须之交 given gets an invitation, unless TA may not listen (LISTEN, blocking), is in the room already, or has
 * one to it still good; as many as the host likes, none of the day's touches. One TA said 下次吧 to lately (from this
 * host, to 一起听) goes quietly (QUIET_AFTER_LATER_MS): seen at once and never pushed to TA, the host told the same.
 * asked: the answer to TA's own 想一起听, never quiet. A host alone in the room who invites anyone (or again) has
 * ALONE_MS from now for TA to come.
 */
async function inviteIn(user: UserRow, roomId: string, given: unknown, now: number, asked = false): Promise<InviteSent[]> {
  if (!Array.isArray(given)) throw refuse(400, T.server.common.badRequest);
  const keys = [...new Set(given.map(String))].slice(0, INVITE_AT_ONCE);
  if (!keys.length) return [];
  const byKey = new Map([...(await friendIdsOf(user.id))].map((id) => [friendKey(user.id, id), id]));
  const ids = keys.map((k) => byKey.get(k)).filter((id): id is string => Boolean(id));
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const blocked = await blockedWith(user.id);
  const results: InviteSent[] = [];
  const made: string[] = [];
  const nudged: string[] = [];
  // invited now, or still: anyone called to come
  let called = false;
  await db.transaction(async (tx) => {
    // one host's invitations one at a time, so two taps cannot both send TA one to the room
    await lockPlayer(tx, user.id);
    const inNow = new Set(
      (
        await tx
          .select({ id: listenMembers.userId })
          .from(listenMembers)
          .where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt)))
      ).map((r) => r.id),
    );
    for (const key of keys) {
      const to = byKey.get(key);
      const u = people.find((p) => p.id === to);
      if (!to || !u) {
        results.push({ id: key, ok: false, why: T.server.common.notFriends });
        continue;
      }
      if (blocked.has(to) || !listenOpen(u)) {
        results.push({ id: key, ok: false, why: T.server.listen.cantInvite });
        continue;
      }
      if (inNow.has(to)) {
        results.push({ id: key, ok: true });
        continue;
      }
      const [still] = await tx
        .select({ id: listenInvites.id })
        .from(listenInvites)
        .where(
          and(
            eq(listenInvites.roomId, roomId),
            eq(listenInvites.toUserId, to),
            isNull(listenInvites.answer),
            gt(listenInvites.createdAt, new Date(now - INVITE_MS)),
          ),
        )
        .limit(1);
      if (still) {
        results.push({ id: key, ok: true });
        called = true;
        continue;
      }
      // TA said 下次吧 to one of this host's lately: this one goes quietly
      const [later] = asked
        ? []
        : await tx
            .select({ id: listenInvites.id })
            .from(listenInvites)
            .where(
              and(
                eq(listenInvites.fromUserId, user.id),
                eq(listenInvites.toUserId, to),
                eq(listenInvites.answer, "later"),
                gt(listenInvites.answeredAt, new Date(now - QUIET_AFTER_LATER_MS)),
              ),
            )
            .limit(1);
      await tx.insert(listenInvites).values({ roomId, fromUserId: user.id, toUserId: to, createdAt: new Date(now), asked, seenAt: later ? new Date(now) : null });
      results.push({ id: key, ok: true });
      called = true;
      made.push(to);
      if (!later) nudged.push(to);
    }
  });
  if (called) await aloneAgain(roomId, now);
  if (made.length) {
    countStat(COUNTED.listenInvite, made.length, now);
    if (nudged.length) nudge(nudged);
    // the host's own list of who is invited
    tellListen([user.id], { t: "members", room: roomId });
  }
  return results;
}

/**
 * In at an invitation (invite: its id) or at a 宣言一起听 (declaration: its id), from 消息 or the card on the map, the
 * host asked for neither: only by one it was sent to (one invited; one who sees the declaration in 消息 now,
 * src/lib/server/declarationInbox.ts), while it is good and the room goes on, not full, never to one asked to leave
 * it, nor with anyone in it either has blocked. Out of the room they were in first.
 */
export async function joinRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const called = await calledTo(user.id, body, now);
  const roomId = called.roomId;
  const blocked = await blockedWith(user.id);
  const already = await roomOfPlayer(db, user.id);
  if (already?.room.id !== roomId) await mayListen(user.id, now);
  const { left } = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    // the room's row first, so two coming in at once are counted one after the other
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, roomId)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.listen.roomGone, ROOM_GONE);
    const rows = await tx.select().from(listenMembers).where(eq(listenMembers.roomId, room.id));
    const mine = rows.find((m) => m.userId === user.id);
    if (mine && !mine.leftAt) return { left: null };
    if (mine?.kicked) throw refuse(403, T.server.listen.roomShut, ROOM_SHUT);
    const inNow = rows.filter((m) => !m.leftAt);
    if (inNow.some((m) => blocked.has(m.userId))) throw refuse(403, T.server.listen.roomShut, ROOM_SHUT);
    if (inNow.length >= listenSettings().roomMax) throw refuse(409, T.server.listen.roomFull, ROOM_FULL);
    const left = await leaveIn(tx, user.id, now);
    if (mine) {
      await tx
        .update(listenMembers)
        .set({ leftAt: null, awayAt: null, joinedAt: new Date(now) })
        .where(and(eq(listenMembers.roomId, room.id), eq(listenMembers.userId, user.id)));
    } else {
      const handle = rows.reduce((h, m) => Math.max(h, m.handle), 0) + 1;
      await tx
        .insert(listenMembers)
        .values({ roomId: room.id, userId: user.id, handle, via: called.invite ? "invite" : "declaration", joinedAt: new Date(now) });
    }
    if (called.invite) {
      await tx
        .update(listenInvites)
        .set({ answer: "joined", answeredAt: new Date(now), seenAt: sql`coalesce(${listenInvites.seenAt}, now())` })
        .where(eq(listenInvites.id, called.invite));
    }
    // the host is alone no more
    if (room.aloneSince) await tx.update(listenRooms).set({ aloneSince: null }).where(eq(listenRooms.id, room.id));
    return { left };
  });
  await told(left);
  if (already?.room.id !== roomId) {
    countStat(called.invite ? COUNTED.listenJoin : COUNTED.listenJoinDecl, 1, now);
    await tellMembers(roomId);
  }
  const room = await roomView(roomId, user.id, now);
  if (!room) throw refuse(410, T.server.listen.roomGone, ROOM_GONE);
  return { room, now };
}

/** The room an invitation to the player (invite) or a 宣言一起听 they see (declaration) lets them in at */
async function calledTo(userId: string, body: Record<string, unknown>, now: number): Promise<{ roomId: string; invite: string | null }> {
  const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
  if (body.declaration !== undefined) {
    const id = uuid(body.declaration);
    const d = id ? await canSeeDeclaration(userId, id, now) : null;
    if (!d || d.template !== LISTEN_TEMPLATE) throw refuse(404, T.server.listen.declarationGone, ROOM_GONE);
    // its room is gone a day after it ended
    if (!d.roomId) throw refuse(410, T.server.listen.roomGone, ROOM_GONE);
    return { roomId: d.roomId, invite: null };
  }
  const id = uuid(body.invite);
  const [invite] = id
    ? await db
        .select()
        .from(listenInvites)
        .where(and(eq(listenInvites.id, id), eq(listenInvites.toUserId, userId)))
    : [];
  if (!invite) throw refuse(404, T.server.listen.inviteGone, ROOM_GONE);
  if (invite.createdAt.getTime() <= now - INVITE_MS) throw refuse(410, T.server.listen.inviteGone, ROOM_GONE);
  return { roomId: invite.roomId, invite: invite.id };
}

/** 下次吧: the host sees TA as not come, as an invitation that ran out; never as said no */
export async function laterInvite(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const id = typeof body.invite === "string" && UUID.test(body.invite) ? body.invite.toLowerCase() : null;
  if (!id) throw refuse(400, T.server.common.badRequest);
  const [done] = await db
    .update(listenInvites)
    .set({ answer: "later", answeredAt: new Date(now), seenAt: sql`coalesce(${listenInvites.seenAt}, now())` })
    .where(and(eq(listenInvites.id, id), eq(listenInvites.toUserId, user.id), isNull(listenInvites.answer)))
    .returning({ from: listenInvites.fromUserId, room: listenInvites.roomId });
  if (done) tellListen([done.from], { t: "members", room: done.room });
  return { now };
}

/** Out of the room you are in: the host's ends */
export async function leaveRoom(user: Pick<UserRow, "id">, now = Date.now()) {
  const left = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    return leaveIn(tx, user.id, now);
  });
  await told(left);
  return { now };
}

/**
 * The host's 结束. alone: their page counted down ALONE_MS alone in the room, and ends it as the sweep would (alone),
 * only when that is so by the server's clock (ALONE_EARLY_MS early at most); else nothing. ended: it ended now
 */
export async function endByHost(user: Pick<UserRow, "id">, body: Record<string, unknown> = {}, now = Date.now()) {
  const mine = await roomOfPlayer(db, user.id);
  if (!mine) return { ended: false, now };
  if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
  if (body.alone === true) return { ended: await endAlone(mine.room.id, now, ALONE_EARLY_MS), now };
  await endRoom(mine.room.id, "host", now);
  return { ended: true, now };
}

/**
 * 发宣言招附近的人: the host calls those nearby to their room, once a room, by a declaration of its own sentence,
 * 我在听《…》 with the song it is at (src/lib/server/world.ts declare, template listen: from the roaches given, their
 * main one when none are; within today's twenty, a minute apart; to those near enough who may listen, never to those
 * blocked). Not in a room, one of their own first, with the song given (or 新歌's first), as openRoom opens one; a
 * declaration refused then ends it, and is not counted as sent.
 */
export async function declareRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const from = Array.isArray(body.from) ? body.from.map(String) : undefined;
  const mine = await roomOfPlayer(db, user.id);
  if (mine && mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
  if (mine?.room.declaredAt) throw refuse(409, T.server.listen.declaredAlready);
  const list = await songList();
  const called = mine ? list.byId.get(songNow(mine.room, (id) => list.byId.get(id)?.seconds ?? Number.NaN, now)) : null;
  if (mine && !called) throw refuse(404, T.server.listen.noSong, NO_SONG);
  const opened = mine ? null : await newRoom(user, body.song, now);
  const roomId = mine?.room.id ?? opened!.id;
  const song = (called ?? opened!.song).name;
  // once a room, however many taps come at once
  const [claimed] = await db
    .update(listenRooms)
    .set({ declaredAt: new Date(now) })
    .where(and(eq(listenRooms.id, roomId), eq(listenRooms.hostId, user.id), isNull(listenRooms.declaredAt), isNull(listenRooms.endedAt)))
    .returning({ id: listenRooms.id });
  const undo = async () => {
    if (opened) await endRoom(roomId, "host", now);
    else if (claimed) await db.update(listenRooms).set({ declaredAt: null }).where(eq(listenRooms.id, roomId));
  };
  if (!claimed) {
    await undo();
    throw refuse(409, T.server.listen.declaredAlready);
  }
  let sent: Awaited<ReturnType<typeof declare>>;
  try {
    sent = await declare(user.id, { template: LISTEN_TEMPLATE, song, room: roomId }, from, false, true);
  } catch (e) {
    await undo();
    throw e;
  }
  if (opened) countStat(COUNTED.listenRoom, 1, now);
  // alone in it: ALONE_MS from now, for those called to come
  else await aloneAgain(roomId, now);
  // the host's own page shows it sent
  tellListen([user.id], { t: "members", room: roomId });
  return { ...sent, room: await roomView(roomId, user.id, now), now };
}

/**
 * 请出去: the host asks someone in their room to leave it (h: their number there), for good: TA can never come in to
 * it again, and is told so alone (you, kicked); everyone else sees TA as 走了, the host as 请出去了
 */
export async function kickMember(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const h = handleOf(body.h);
  if (h === null) throw refuse(400, T.server.common.badRequest);
  const out = await db.transaction(async (tx) => {
    const mine = await roomOfPlayer(tx, user.id);
    if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
    if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
    // after any coming in at once, as they count it (joinRoom)
    await tx.select({ id: listenRooms.id }).from(listenRooms).where(eq(listenRooms.id, mine.room.id)).for("update");
    const [them] = await tx
      .select()
      .from(listenMembers)
      .where(and(eq(listenMembers.roomId, mine.room.id), eq(listenMembers.handle, h)));
    if (!them || them.userId === user.id) throw refuse(400, T.server.common.badRequest);
    if (them.leftAt || them.hiddenFrom.includes(mine.me.handle)) throw refuse(409, T.server.listen.notInRoom);
    await tx
      .update(listenMembers)
      .set({ kicked: true, leftAt: new Date(now), awayAt: null })
      .where(and(eq(listenMembers.roomId, mine.room.id), eq(listenMembers.userId, them.userId)));
    await dropRequests(tx, mine.room.id, them.handle);
    await aloneFrom(tx, mine.room.id, now);
    await tx
      .update(listenNow)
      .set({ roomId: null, until: soonest(now) })
      .where(and(eq(listenNow.userId, them.userId), eq(listenNow.roomId, mine.room.id)));
    return { roomId: mine.room.id, them: them.userId };
  });
  tellListen([out.them], { t: "you", room: out.roomId, why: "kicked" });
  await tellMembers(out.roomId);
  return { room: await roomView(out.roomId, user.id, now), now };
}

// ---- the songs ----

/**
 * What the host does to the room's songs (src/lib/listen.ts changeQueue): start, next, restart, add a song (the host's,
 * by), add RANDOM_ADD at random from all of them (随机加: none already in its songs; told as an add), go to a second of
 * the one playing (seek: everyone with it), or take a song out of 待播 (remove). The last song playing after it is
 * given one more in the same change (toppedUp: one version more in all, told once as the host's); ⏭ on the last song
 * goes to the one it is given.
 */
export async function changeSongs(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const change: QueueChange | QueueRemove | null =
    body.start === true
      ? "start"
      : body.next === true
        ? "next"
        : body.restart === true
          ? "restart"
          : body.random === true
            ? "random"
            : isSongId(body.add)
              ? { add: body.add }
              : isSeek(body.seek)
                ? { seek: body.seek }
                : isQueueRemove(body)
                  ? { remove: body.remove as number, song: body.song as string }
                  : null;
  if (!change) throw refuse(400, T.server.common.badRequest);
  refuseNow(now);
  if (typeof change === "object" && "add" in change && !(await songOf(change.add))) throw refuse(404, T.server.listen.noSong, NO_SONG);
  const seconds = await secondsOf();
  const all = [...(await songList()).byId.keys()];
  const result = await db.transaction(async (tx) => {
    const mine = await roomOfPlayer(tx, user.id);
    if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
    if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, mine.room.id)).for("update");
    sawPlayed(room, seconds, now);
    const was = scheduleOf(room);
    // ⏭ on the last song: to the one 待播 gives it
    const from = change === "next" && roomAt(was, seconds, now).phase === "playing" ? (toppedUp(was, room.id, all, seconds, now) ?? was) : was;
    const edit: QueueEdit = change === "random" ? { adds: pickAtRandom(all, new Set(room.queue), RANDOM_ADD) } : change;
    // the host's own song is theirs; 随机加's are nobody's
    const changed = changeQueue(from, edit, seconds, now, change === "random" ? 0 : mine.me.handle);
    if (changed === "noNext") throw refuse(409, T.server.listen.noNext);
    if (changed === "full") throw refuse(409, fmt(T.server.listen.queueFull, { n: QUEUE_MAX }));
    if (changed === "same") return { room, next: null };
    const next = toppedUp(changed, room.id, all, seconds, now) ?? changed;
    await tx.update(listenRooms).set(written(next)).where(eq(listenRooms.id, room.id));
    return { room, next };
  });
  if (result.next) {
    const how = typeof change === "object" ? ("seek" in change ? "seek" : "remove" in change ? "remove" : "add") : change === "random" ? "add" : change;
    const rows = await hearersOf(result.room.id);
    tellListen(
      rows.map((r) => r.userId),
      { t: "state", room: result.room.id, how, ...result.next },
    );
  }
  return { room: await roomView(result.room.id, user.id, now), now };
}

// ---- 点歌 ----

/**
 * 点歌: someone in the room (not its host, who adds what they like) asks its host for a song: REQUESTS_EACH waiting
 * each at most; not one in 待播 (from the one playing on) or asked for by anyone already, nor while 待播 is full
 * (QUEUE_MAX). The host is told (asks); TA waits for the answer (answerRequest), or takes it back (withdrawRequest).
 */
export async function requestSong(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const song = isSongId(body.song) ? await songOf(body.song) : null;
  if (!song) throw refuse(404, T.server.listen.noSong, NO_SONG);
  const seconds = await secondsOf();
  const asked = await db.transaction(async (tx) => {
    const mine = await roomOfPlayer(tx, user.id);
    if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
    if (mine.room.hostId === user.id) throw refuse(409, T.server.listen.hostAdds);
    // one change at a time in a room: its songs and what is asked for, as they are
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, mine.room.id)).for("update");
    const waiting = await tx.select().from(listenRequests).where(eq(listenRequests.roomId, room.id));
    if (waiting.filter((w) => w.handle === mine.me.handle).length >= REQUESTS_EACH) throw refuse(409, fmt(T.server.listen.askedMax, { n: REQUESTS_EACH }));
    const ahead = songsAhead(scheduleOf(room), seconds, now).ids;
    if (ahead.includes(song.id)) throw refuse(409, T.server.listen.askedIn);
    if (waiting.some((w) => w.song === song.id)) throw refuse(409, T.server.listen.askedAlready);
    if (ahead.length >= QUEUE_MAX) throw refuse(409, fmt(T.server.listen.askedFull, { n: QUEUE_MAX }));
    await tx.insert(listenRequests).values({ roomId: room.id, handle: mine.me.handle, song: song.id, createdAt: new Date(now) });
    return { roomId: room.id, hostId: room.hostId };
  });
  tellListen([asked.hostId], { t: "asks", room: asked.roomId });
  return { room: await roomView(asked.roomId, user.id, now), now };
}

/** 撤回: one who asked for a song (id) takes it back while the host has not answered; the host is told */
export async function withdrawRequest(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const id = requestId(body.id);
  if (id === null) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOfPlayer(db, user.id);
  if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
  const [gone] = await db
    .delete(listenRequests)
    .where(and(eq(listenRequests.id, id), eq(listenRequests.roomId, mine.room.id), eq(listenRequests.handle, mine.me.handle)))
    .returning({ id: listenRequests.id });
  if (!gone) throw refuse(409, T.server.listen.noRequest);
  tellListen([mine.room.hostId], { t: "asks", room: mine.room.id });
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * The host answers a song asked for (id): yes lets it into 待播 at its end, as the one who asked for it put it in (by),
 * told to everyone as the songs change (not again when it is in 待播 already); no leaves it out. Either way it is asked
 * for no longer, and the one who asked is told, alone.
 */
export async function answerRequest(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const id = requestId(body.id);
  if (id === null || typeof body.yes !== "boolean") throw refuse(400, T.server.common.badRequest);
  const yes = body.yes;
  if (yes) refuseNow(now);
  const seconds = await secondsOf();
  const all = [...(await songList()).byId.keys()];
  const out = await db.transaction(async (tx) => {
    const mine = await roomOfPlayer(tx, user.id);
    if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
    if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, mine.room.id)).for("update");
    const [asked] = await tx
      .delete(listenRequests)
      .where(and(eq(listenRequests.id, id), eq(listenRequests.roomId, room.id)))
      .returning({ h: listenRequests.handle, song: listenRequests.song });
    if (!asked) throw refuse(409, T.server.listen.noRequest);
    const [them] = await tx
      .select({ userId: listenMembers.userId })
      .from(listenMembers)
      .where(and(eq(listenMembers.roomId, room.id), eq(listenMembers.handle, asked.h), isNull(listenMembers.leftAt)));
    let next: RoomSchedule | null = null;
    if (yes) {
      if (!(await songOf(asked.song))) throw refuse(404, T.server.listen.noSong, NO_SONG);
      sawPlayed(room, seconds, now);
      const was = scheduleOf(room);
      if (!songsAhead(was, seconds, now).ids.includes(asked.song)) {
        const changed = changeQueue(was, { add: asked.song }, seconds, now, asked.h);
        if (changed === "full") throw refuse(409, fmt(T.server.listen.queueFull, { n: QUEUE_MAX }));
        if (typeof changed === "object") {
          next = toppedUp(changed, room.id, all, seconds, now) ?? changed;
          await tx.update(listenRooms).set(written(next)).where(eq(listenRooms.id, room.id));
        }
      }
    }
    return { roomId: room.id, song: asked.song, them: them?.userId ?? null, next };
  });
  if (out.next) {
    const rows = await hearersOf(out.roomId);
    tellListen(
      rows.map((r) => r.userId),
      { t: "state", room: out.roomId, how: "add", ...out.next },
    );
  }
  if (out.them) tellListen([out.them], { t: "answered", room: out.roomId, song: out.song, yes });
  return { room: await roomView(out.roomId, user.id, now), now };
}

/** n of these songs at random, none of those left out, each once */
function pickAtRandom(ids: readonly string[], not: ReadonlySet<string>, n: number): string[] {
  const pool = ids.filter((id) => !not.has(id));
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const i = randomInt(pool.length);
    out.push(pool[i]);
    pool[i] = pool[pool.length - 1];
    pool.pop();
  }
  return out;
}

/**
 * 待播 never runs out: a room playing the last of its songs, or with all of them over (needsTopUp), given one more at
 * the end, as a change of its own (changeQueue: one added after all were over starts at once). From all of them at
 * random: none of its songs from the one playing on, nor those it played lately (lately); none such left, any but the
 * one playing. Its version as it was; null: none needed, or none to give.
 */
function toppedUp(s: RoomSchedule, roomId: string, all: readonly string[], seconds: (id: string) => number, now: number): RoomSchedule | null {
  if (!needsTopUp(s, seconds, now)) return null;
  const at = roomAt(s, seconds, now);
  const i = at.phase === "playing" ? at.i : s.queue.length - 1;
  const pick =
    pickAtRandom(all, new Set([...s.queue.slice(i), ...(lately.get(roomId) ?? [])]), 1)[0] ?? pickAtRandom(all, new Set([s.queue[i]]), 1)[0];
  if (!pick) return null;
  const more = changeQueue(s, { adds: [pick] }, seconds, now);
  return typeof more === "string" ? null : { ...more, version: s.version };
}

/** What a room played up to the song it is at now, kept by this process (the last RECENT_AVOID) so toppedUp passes over it */
function sawPlayed(room: Room, seconds: (id: string) => number, now: number) {
  const at = roomAt(scheduleOf(room), seconds, now);
  if (at.phase === "ready") return;
  const played = room.queue.slice(Math.max(0, room.idx), (at.phase === "playing" ? at.i : room.queue.length - 1) + 1);
  const was = lately.get(room.id) ?? [];
  lately.delete(room.id);
  lately.set(room.id, [...was.filter((id) => !played.includes(id)), ...played].slice(-RECENT_AVOID));
  if (lately.size > 5_000) lately.delete(lately.keys().next().value as string);
}

/** The sweep's: a room in need of a song (needsTopUp) given one, a version more, told as one added */
async function topUp(roomId: string, all: readonly string[], seconds: (id: string) => number, now: number) {
  const next = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, roomId)).for("update");
    if (!room || room.endedAt) return null;
    const more = toppedUp(scheduleOf(room), room.id, all, seconds, now);
    if (!more) return null;
    const next = { ...more, version: room.version + 1 };
    await tx.update(listenRooms).set(written(next)).where(eq(listenRooms.id, room.id));
    return next;
  });
  if (!next) return;
  const rows = await hearersOf(roomId);
  tellListen(
    rows.map((r) => r.userId),
    { t: "state", room: roomId, how: "add", ...next },
  );
}

// ---- someone in the room: 碰, 拉黑, 举报 ----

/** Who has the number h in the room the player is in now, as they see it: never themselves, nor one hidden from them */
async function memberAt(userId: string, h: number) {
  const mine = await roomOfPlayer(db, userId);
  if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
  const [them] = await db
    .select()
    .from(listenMembers)
    .where(and(eq(listenMembers.roomId, mine.room.id), eq(listenMembers.handle, h)));
  if (!them || them.userId === userId) throw refuse(400, T.server.common.badRequest);
  if (them.hiddenFrom.includes(mine.me.handle)) throw refuse(409, T.server.listen.notInRoom);
  return { roomId: mine.room.id, them };
}

/**
 * 偷偷碰 or 大胆碰 someone in the room you are in (h: their number there): their main roach, touched as on the map
 * (src/lib/server/world.ts touch: the day's touches, a few a day on one player, a sneaky one may be followed by a bold
 * one, between a blocked pair it looks sent and never arrives). Made 触须之交 by it, the two of them see it at once.
 */
export async function touchMember(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()): Promise<TouchResult & { now: number }> {
  const h = handleOf(body.h);
  if (h === null || typeof body.bold !== "boolean") throw refuse(400, T.server.common.badRequest);
  const { roomId, them } = await memberAt(user.id, h);
  const [main] = await db
    .select({ publicId: roaches.publicId })
    .from(roaches)
    .where(and(eq(roaches.userId, them.userId), eq(roaches.slot, 0)))
    .limit(1);
  if (!main) throw new WorldError(T.server.listen.noRoachToTouch);
  const res = await touch(user.id, main.publicId, body.bold);
  if (res.newFriend) tellListen([user.id, them.userId], { t: "members", room: roomId });
  return { ...res, now };
}

/**
 * Who has the number h in a room (lr:<room>:<h>), for 拉黑 and 举报 there (src/lib/server/safety.ts): only by someone in
 * it now, of anyone who has been in it but themselves and those hidden from them. known: they saw who it was there
 * (an open card, or a 触须之交 of theirs).
 */
export async function roomSender(userId: string, roomId: string, h: number): Promise<{ other: string; known: boolean } | null> {
  if (!UUID.test(roomId) || handleOf(h) === null) return null;
  const rows = await db
    .select({ m: listenMembers, u: users, ended: listenRooms.endedAt })
    .from(listenMembers)
    .innerJoin(users, eq(users.id, listenMembers.userId))
    .innerJoin(listenRooms, eq(listenRooms.id, listenMembers.roomId))
    .where(and(eq(listenMembers.roomId, roomId), or(eq(listenMembers.userId, userId), eq(listenMembers.handle, h))));
  const me = rows.find((r) => r.u.id === userId);
  const them = rows.find((r) => r.m.handle === h && r.u.id !== userId);
  if (!me || me.m.leftAt || me.ended || !them || them.m.hiddenFrom.includes(me.m.handle)) return null;
  const p = profileOf(them.u);
  const known = (!p.anonymous && p.name.trim() !== "") || (await friendIdsOf(userId)).has(them.u.id);
  return { other: them.u.id, known };
}

/**
 * One blocked the other (拉黑, or 举报, which blocks too): in a room they are both in now, they part, nobody told why.
 * Blocking its host takes you out of it, as though you left; its host blocking you takes you out, as though it ended
 * (end, why host); and two others in it vanish from each other's list there, and hear none of each other's 短评
 * (hidden_from), which nobody else sees. Never in one room again (joinRoom).
 */
export async function separateBlocked(blockerId: string, blockedId: string, now = Date.now()) {
  const both = await db
    .select({ m: listenMembers, hostId: listenRooms.hostId })
    .from(listenMembers)
    .innerJoin(listenRooms, eq(listenRooms.id, listenMembers.roomId))
    .where(and(inArray(listenMembers.userId, [blockerId, blockedId]), isNull(listenMembers.leftAt), isNull(listenRooms.endedAt)));
  const a = both.find((r) => r.m.userId === blockerId);
  const b = both.find((r) => r.m.userId === blockedId);
  if (!a || !b || a.m.roomId !== b.m.roomId) return;
  const roomId = a.m.roomId;
  if (a.hostId === blockedId) {
    const left = await db.transaction(async (tx) => {
      await lockPlayer(tx, blockerId);
      return leaveIn(tx, blockerId, now);
    });
    await told(left);
    if (left) tellListen([blockerId], { t: "you", room: roomId, why: "left" });
    return;
  }
  if (a.hostId === blockerId) {
    const gone = await db
      .update(listenMembers)
      .set({ leftAt: new Date(now), awayAt: null })
      .where(and(eq(listenMembers.roomId, roomId), eq(listenMembers.userId, blockedId), isNull(listenMembers.leftAt)))
      .returning({ id: listenMembers.userId });
    if (!gone.length) return;
    await dropRequests(db, roomId, b.m.handle);
    await aloneFrom(db, roomId, now);
    await db
      .update(listenNow)
      .set({ roomId: null, until: soonest(now) })
      .where(and(eq(listenNow.userId, blockedId), eq(listenNow.roomId, roomId)));
    tellListen([blockedId], { t: "end", room: roomId, why: "host" });
    await tellMembers(roomId);
    return;
  }
  const hide = (userId: string, from: number) =>
    db
      .update(listenMembers)
      .set({ hiddenFrom: sql`array_append(${listenMembers.hiddenFrom}, ${from}::smallint)` })
      .where(and(eq(listenMembers.roomId, roomId), eq(listenMembers.userId, userId), sql`not (${from}::smallint = any(${listenMembers.hiddenFrom}))`));
  await hide(blockerId, b.m.handle);
  await hide(blockedId, a.m.handle);
  // the two of them see it at once; to every process the room's members are to be read again
  forget(roomId);
  tellListen([blockerId, blockedId], { t: "members", room: roomId });
}

// ---- 短评 ----

/**
 * A 短评 in the room you are in, by its number (src/lib/listen.ts isRx): one every RX_EVERY_MS and RX_PER_SONG to a
 * song, counted in memory alone, and never written down. Those of a second go out together (RX_BATCH_MS), to everyone
 * in the room but those it is hidden from. sent: false when it was one too many (the page greys its buttons). Out of a
 * room, one said listening alone (reactAlone).
 */
export async function reactInRoom(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (!isRx(body.r)) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOfPlayer(db, user.id);
  if (!mine) return reactAlone(user, body.r, now);
  const at = roomAt(scheduleOf(mine.room), await secondsOf(), now);
  const song = at.phase === "playing" ? `${mine.room.queue[at.i]}@${at.start}` : "between";
  if (!allow(`listen:rx:${user.id}`, 1, RX_EVERY_MS)) return { sent: false, now };
  if (!allow(`listen:rx:${mine.room.id}:${song}:${user.id}`, RX_PER_SONG, ROOM_LIFE_MS)) return { sent: false, full: true, now };
  addRx(mine.room.id, mine.me.handle, body.r);
  countStat(COUNTED.listenRx, 1, now);
  return { sent: true, now };
}

/**
 * A 短评 said listening alone, to the song playing: rows one and two only (the third is a room's), as often as in a
 * room, and to nobody. Only how many times each is said to each song is kept (songs.ts countSaid: 大家都在说), never
 * who said it. A song's RX_PER_SONG are counted over as long as it lasts.
 */
async function reactAlone(user: Pick<UserRow, "id">, r: number, now: number) {
  if (r >= RX_ROOM_FROM) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
  const [playing] = await db
    .select({ song: listenNow.song })
    .from(listenNow)
    .where(and(eq(listenNow.userId, user.id), gt(listenNow.until, new Date(now))));
  const song = playing && (await songOf(playing.song));
  if (!song) throw refuse(409, T.server.listen.notListening, NOT_LISTENING);
  if (!allow(`listen:rx:${user.id}`, 1, RX_EVERY_MS)) return { sent: false, now };
  if (!allow(`listen:rx:alone:${song.id}:${user.id}`, RX_PER_SONG, Math.max(60_000, song.seconds * 1000))) return { sent: false, full: true, now };
  countSaid(song.id, r);
  countStat(COUNTED.listenRxAlone, 1, now);
  return { sent: true, now };
}

function addRx(roomId: string, h: number, r: number) {
  let b = batches.get(roomId);
  if (!b) {
    b = { items: [], timer: setTimeout(() => void flushRx(roomId), RX_BATCH_MS) };
    b.timer.unref?.();
    batches.set(roomId, b);
  }
  b.items.push({ h, r });
}

async function flushRx(roomId: string) {
  const b = batches.get(roomId);
  batches.delete(roomId);
  if (!b?.items.length) return;
  try {
    const rows = await hearersOf(roomId);
    const hidden = new Map(rows.filter((r) => r.hiddenFrom.length).map((r) => [r.handle, new Set(r.hiddenFrom)]));
    if (!hidden.size) return tellListen(rows.map((r) => r.userId), { t: "rx", room: roomId, items: b.items });
    // with some hidden from some: each hears what is not hidden from them
    for (const to of rows) {
      const items = b.items.filter((x) => !hidden.get(x.h)?.has(to.handle));
      if (items.length) tellListen([to.userId], { t: "rx", room: roomId, items });
    }
  } catch (e) {
    console.error("listen: telling a room its 短评 failed", e);
  }
}

/** For tests: the 短评 waiting to go out now, gone */
export async function flushRxNow() {
  for (const [roomId, b] of [...batches]) {
    clearTimeout(b.timer);
    await flushRx(roomId);
  }
}

// ---- gone off, back ----

/** Any of their requests says they are back, after their page went (src/lib/server/listen.ts stopSong away) */
export async function cameBack(userId: string) {
  await db
    .update(listenMembers)
    .set({ awayAt: null })
    .where(and(eq(listenMembers.userId, userId), isNull(listenMembers.leftAt), isNotNull(listenMembers.awayAt)));
}

/**
 * The main process, every minute: those gone off longer than AWAY_MS leave (a host's room ends); rooms end that are
 * over (ROOM_IDLE_MS after their last song), empty, older than ROOM_LIFE_MS, their host alone in them ALONE_MS
 * (endAlone), or all of them while 听歌 is paused or the site is gray; a room going on that plays its last song (or
 * whose songs are over) is given one more (topUp); and rooms over for ROOM_KEEP_MS go, with who was in them and the
 * invitations to them. A host alone in a room not counted so (two going at once: each saw the other still in) is from
 * now. Says how many ended.
 */
export async function sweepRooms(now = Date.now()) {
  const away = await db
    .select({ roomId: listenMembers.roomId, userId: listenMembers.userId, hostId: listenRooms.hostId })
    .from(listenMembers)
    .innerJoin(listenRooms, eq(listenRooms.id, listenMembers.roomId))
    .where(and(isNull(listenMembers.leftAt), lt(listenMembers.awayAt, new Date(now - AWAY_MS))));
  let ended = 0;
  for (const a of away) {
    const left = await db.transaction((tx) => leaveIn(tx, a.userId, now));
    if (left?.ended) ended += 1;
    await told(left);
  }
  const why: RoomEnd | null = grayUntil(now) ? "gray" : listenSettings().paused ? "admin" : null;
  const open = await db.select().from(listenRooms).where(isNull(listenRooms.endedAt));
  const counts = new Map(
    (
      await db
        .select({ id: listenMembers.roomId, n: count() })
        .from(listenMembers)
        .where(and(isNull(listenMembers.leftAt), inArray(listenMembers.roomId, open.length ? open.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"])))
        .groupBy(listenMembers.roomId)
    ).map((r) => [r.id, r.n]),
  );
  const seconds = await secondsOf();
  let all: string[] | null = null;
  for (const room of open) {
    const at = roomAt(scheduleOf(room), seconds, now);
    const n = counts.get(room.id) ?? 0;
    const over = why ?? (!n || room.createdAt.getTime() <= now - ROOM_LIFE_MS || (at.phase === "done" && at.end <= now - ROOM_IDLE_MS) ? "idle" : null);
    if (!over && n === 1 && room.aloneSince && room.aloneSince.getTime() <= now - ALONE_MS && (await endAlone(room.id, now))) {
      ended += 1;
      continue;
    }
    // the host's page shows it from now
    if (!over && n === 1 && !room.aloneSince && (await aloneFrom(db, room.id, now))) tellListen([room.hostId], { t: "members", room: room.id });
    if (!over) {
      sawPlayed(room, seconds, now);
      if (needsTopUp(scheduleOf(room), seconds, now)) await topUp(room.id, (all ??= [...(await songList()).byId.keys()]), seconds, now);
      continue;
    }
    await endRoom(room.id, over, now);
    ended += 1;
  }
  await db.delete(listenRooms).where(lt(listenRooms.endedAt, new Date(now - ROOM_KEEP_MS)));
  return ended;
}

// ---- invitations in 消息, and whom you may invite ----

/**
 * The invitations to you in 消息 → 触须之交: still good to go in at (open; later: you said 下次吧, and may still), in
 * (you are in the room), or over (the room ended, or the invitation ran out)
 */
export async function listenInbox(userId: string, blocked: Set<string>, now = Date.now()): Promise<InboxItem[]> {
  const rows = (
    await db
      .select({ i: listenInvites, room: listenRooms, from: users })
      .from(listenInvites)
      .innerJoin(listenRooms, eq(listenRooms.id, listenInvites.roomId))
      .innerJoin(users, eq(users.id, listenInvites.fromUserId))
      .where(eq(listenInvites.toUserId, userId))
      .orderBy(desc(listenInvites.createdAt))
      .limit(20)
  ).filter((r) => !blocked.has(r.from.id));
  if (!rows.length) return [];
  const cards = await cardsOf(
    rows.map((r) => r.from),
    userId,
  );
  const roomIds = [...new Set(rows.map((r) => r.room.id))];
  const members = await db
    .select({ roomId: listenMembers.roomId, userId: listenMembers.userId })
    .from(listenMembers)
    .where(and(inArray(listenMembers.roomId, roomIds), isNull(listenMembers.leftAt)));
  const seconds = await secondsOf();
  const names = (await songList()).byId;
  return rows.map(({ i, room, from }): InboxItem => {
    const inIt = members.filter((m) => m.roomId === room.id);
    const song = songNow(room, seconds, now);
    const state = room.endedAt
      ? "over"
      : inIt.some((m) => m.userId === userId)
        ? "in"
        : i.createdAt.getTime() <= now - INVITE_MS
          ? "over"
          : i.answer === "later"
            ? "later"
            : "open";
    return {
      kind: "listenInvite",
      id: `li:${i.id}`,
      at: i.createdAt.getTime(),
      seen: Boolean(i.seenAt),
      from: cards.get(from.id)!,
      friendId: friendKey(userId, from.id),
      song: names.get(song)?.name ?? "",
      state,
      n: state === "open" || state === "later" ? inIt.length : 0,
      until: i.createdAt.getTime() + INVITE_MS,
      replied: true,
    };
  });
}

/**
 * The rooms of the 宣言一起听 a player got (by room id; one deleted, a day after it ended, is not there) as they are
 * now to them: open to go in at, full, they are in it, closed to them (asked to leave it), or over (src/lib/listen.ts
 * ListenCall); read for all of them at once
 */
export async function listenCalls(userId: string, roomIds: string[]): Promise<Map<string, ListenCall>> {
  const ids = [...new Set(roomIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, ListenCall>();
  if (!ids.length) return out;
  const max = listenSettings().roomMax;
  const rooms = await db.select({ id: listenRooms.id, endedAt: listenRooms.endedAt }).from(listenRooms).where(inArray(listenRooms.id, ids));
  const members = await db
    .select({ roomId: listenMembers.roomId, userId: listenMembers.userId, leftAt: listenMembers.leftAt, kicked: listenMembers.kicked })
    .from(listenMembers)
    .where(inArray(listenMembers.roomId, ids));
  for (const r of rooms) {
    const inIt = members.filter((m) => m.roomId === r.id);
    const mine = inIt.find((m) => m.userId === userId);
    const n = inIt.filter((m) => !m.leftAt).length;
    const state: ListenCall["state"] = r.endedAt
      ? "over"
      : mine && !mine.leftAt
        ? "in"
        : mine?.kicked
          ? "shut"
          : n >= max
            ? "full"
            : "open";
    out.set(r.id, { state, n: state === "over" ? 0 : n, max });
  }
  return out;
}

/** Seen in 消息 (li:<id>) */
export async function seeListenInvites(userId: string, itemIds: string[]) {
  const ids = itemIds
    .filter((i) => typeof i === "string" && i.startsWith("li:"))
    .map((i) => i.slice(3))
    .filter((i) => UUID.test(i));
  if (!ids.length) return;
  await db
    .update(listenInvites)
    .set({ seenAt: new Date() })
    .where(and(inArray(listenInvites.id, ids), eq(listenInvites.toUserId, userId), isNull(listenInvites.seenAt)));
}

/**
 * Your 触须之交 who may listen, to invite, and whether TA is in your room already; by name, and those of one name (as
 * all who are anonymous are) by id, so they keep their places
 */
export async function listenFriends(user: Pick<UserRow, "id">, now = Date.now()): Promise<{ friends: ListenFriend[]; now: number }> {
  const ids = [...(await friendIdsOf(user.id))];
  if (!ids.length) return { friends: [], now };
  const blocked = await blockedWith(user.id);
  const people = (await db.select().from(users).where(inArray(users.id, ids))).filter((u) => !blocked.has(u.id) && listenOpen(u));
  const mine = await roomOfPlayer(db, user.id);
  const inRoomNow = new Set(
    mine
      ? (
          await db
            .select({ id: listenMembers.userId })
            .from(listenMembers)
            .where(and(eq(listenMembers.roomId, mine.room.id), isNull(listenMembers.leftAt)))
        ).map((r) => r.id)
      : [],
  );
  const cards = await cardsOf(people, user.id);
  const friends = people
    .map(
      (u): ListenFriend => ({
        id: friendKey(user.id, u.id),
        card: cards.get(u.id)!,
        inRoom: inRoomNow.has(u.id),
      }),
    )
    .sort((a, b) => a.card.displayName.localeCompare(b.card.displayName, "zh") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { friends, now };
}

// ---- 在听, and 想一起听 ----

/**
 * What each of these 触须之交 of the player's listens to now (Friend.listening), by user id: only while TA lets 触须之交
 * see it (show_listening), TA's listen_now is good, and both of you may listen (not while the site is gray or 听歌 is
 * paused); asked: the player said 想一起听 to TA today. Read for all of them at once.
 */
export async function friendsListening(viewer: Pick<UserRow, "id" | "email">, others: UserRow[], now = Date.now()) {
  const out = new Map<string, FriendListening>();
  if (!listenOpen(viewer) || grayUntil(now) || listenSettings().paused) return out;
  const ids = others.filter((u) => u.showListening && listenOpen(u)).map((u) => u.id);
  if (!ids.length) return out;
  const rows = await db
    .select({ userId: listenNow.userId, song: listenNow.song })
    .from(listenNow)
    .where(and(inArray(listenNow.userId, ids), gt(listenNow.until, new Date(now))));
  if (!rows.length) return out;
  const asked = new Set(
    (
      await db
        .select({ to: friendNotes.toUserId })
        .from(friendNotes)
        .where(
          and(
            eq(friendNotes.fromUserId, viewer.id),
            eq(friendNotes.kind, LISTEN_ASK),
            eq(friendNotes.period, siteDay(now)),
            inArray(
              friendNotes.toUserId,
              rows.map((r) => r.userId),
            ),
          ),
        )
    ).map((r) => r.to),
  );
  const names = (await songList()).byId;
  for (const r of rows) {
    const name = names.get(r.song)?.name;
    // a song no longer in the list: nothing to say of it
    if (name) out.set(r.userId, { song: r.song, name, asked: asked.has(r.userId) });
  }
  return out;
}

/**
 * 想一起听: the player asks a 触须之交 who is listening now, as they see it (friendsListening), to invite them; a note
 * in TA's 消息 → 触须之交 with what TA listens to, once a site day to each (not one of the day's invitations). Not to one
 * in the same room already.
 */
export async function askToListen(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const key = String(body.friend ?? "");
  const other = [...(await friendIdsOf(user.id))].find((id) => friendKey(user.id, id) === key);
  if (!other) throw refuse(404, T.server.common.notFriends);
  const [them] = await db.select().from(users).where(eq(users.id, other));
  const playing = them && (await friendsListening(user, [them], now)).get(them.id);
  if (!playing) throw refuse(409, T.server.listen.theyStopped, NOT_LISTENING);
  const [mine, theirs] = await Promise.all([roomOfPlayer(db, user.id), roomOfPlayer(db, other)]);
  if (mine && mine.room.id === theirs?.room.id) throw refuse(409, T.server.listen.togetherAlready);
  if (playing.asked) throw refuse(409, T.server.listen.askedToday);
  const [asked] = await db
    .insert(friendNotes)
    .values({ fromUserId: user.id, toUserId: other, kind: LISTEN_ASK, period: siteDay(now), song: playing.song, createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ id: friendNotes.id });
  if (!asked) throw refuse(409, T.server.listen.askedToday);
  countStat(COUNTED.listenAsk, 1, now);
  nudge([other]);
  return { now };
}

/**
 * 一起听 at a 想一起听 to the player (item: c:<its note>), the site day it came: the room they host, or a new one of
 * theirs with what they listen to now (else the song it asked about, else 新歌's first), and an invitation in it to the
 * one who asked, as any other but never quiet (QUIET_AFTER_LATER_MS). Not while in someone else's room. Again once
 * done: the room as it is.
 */
export async function answerAsk(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const id = String(body.item ?? "").replace(/^c:/, "");
  if (!UUID.test(id)) throw refuse(400, T.server.common.badRequest);
  const [note] = await db
    .select()
    .from(friendNotes)
    .where(and(eq(friendNotes.id, id), eq(friendNotes.toUserId, user.id), eq(friendNotes.kind, LISTEN_ASK)));
  if (!note) throw refuse(404, T.server.common.noSuchNote);
  const mine = await roomOfPlayer(db, user.id);
  if (note.answer) return { room: mine ? await roomView(mine.room.id, user.id, now) : null, sent: [] as InviteSent[], now };
  if (note.period !== siteDay(now)) throw refuse(410, T.server.listen.askOver);
  if (!(await friendIdsOf(user.id)).has(note.fromUserId)) throw refuse(404, T.server.common.notFriends);
  if (mine && mine.room.hostId !== user.id) throw refuse(409, T.server.listen.leaveFirst);
  let roomId = mine?.room.id;
  if (!roomId) {
    const [playing] = await db
      .select({ song: listenNow.song })
      .from(listenNow)
      .where(and(eq(listenNow.userId, user.id), gt(listenNow.until, new Date(now))));
    const song = (playing && (await songOf(playing.song))) || (note.song && (await songOf(note.song))) || null;
    roomId = (await newRoom(user, song?.id ?? null, now)).id;
    countStat(COUNTED.listenRoom, 1, now);
  }
  const sent = await inviteIn(user, roomId, [friendKey(user.id, note.fromUserId)], now, true);
  await db
    .update(friendNotes)
    .set({ answer: "invited", answeredAt: new Date(now), seenAt: sql`coalesce(${friendNotes.seenAt}, now())` })
    .where(and(eq(friendNotes.id, id), isNull(friendNotes.answer)));
  return { room: await roomView(roomId, user.id, now), sent, now };
}
