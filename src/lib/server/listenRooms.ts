import "server-only";
import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { COUNTED } from "../dashboard";
import {
  AWAY_MS,
  changeQueue,
  INVITE_MS,
  INVITES_PER_DAY,
  isRx,
  isSongId,
  LISTEN_GRAY,
  LISTEN_PAUSED,
  NO_ROOM,
  NO_SONG,
  QUEUE_MAX,
  ROOM_FULL,
  ROOM_GONE,
  ROOM_IDLE_MS,
  ROOM_KEEP_MS,
  ROOM_LIFE_MS,
  ROOM_SHUT,
  roomAt,
  RX_EVERY_MS,
  RX_PER_SONG,
  type InviteSent,
  type ListenFriend,
  type ListenRoom,
  type QueueChange,
  type RoomEnd,
  type RoomInvited,
  type RoomMember,
  type RoomSchedule,
} from "../listen";
import { displayName } from "../profile";
import { siteDay, siteDayStart } from "../siteDay";
import type { InboxItem } from "../world/types";
import { blockedWith } from "./blocks";
import { db } from "./db";
import { lockPlayer, type Exec } from "./guides";
import { HttpError } from "./http";
import { listenOpen, refuseIfFull, roomOfPlayer } from "./listen";
import { nudge, onToldListen, tellListen } from "./live";
import { allow } from "./rateLimit";
import { listenInvites, listenMembers, listenNow, listenRooms, users, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { firstSong, songList, songOf } from "./songs";
import { countStat } from "./stats";
import { cardsOf, friendIdsOf, friendKey, profileOf } from "./world";

/**
 * 一起听: rooms where a host and the 触须之交 they invite hear the same song at the same second. The server keeps only
 * each room's songs and when its song started (src/lib/listen.ts RoomSchedule); every phone works out where it should
 * be from that (roomAt), and the host alone changes it (changeQueue). Invitations go to 消息 → 触须之交 and pop up on
 * a page that is open; whoever goes in is known in the room by a number of its own (handle), never by an id. What a
 * room does goes to the phones in it at once, with what happened in it (live.ts tellListen): its songs (never anything
 * of who), that who is in it changed (each phone asks again, as each sees the others its own way), the 短评 of the last
 * second, and that it ended. 短评 are never written down. A room ends when its host ends or leaves it, goes off for more
 * than AWAY_MS, opens another or goes in at another; when its songs have been over ROOM_IDLE_MS, nobody is left, or it
 * has gone on ROOM_LIFE_MS; and every room ends when 听歌 is paused in the 管理台 or the site goes gray. ROOM_KEEP_MS
 * after, the room, who was in it and the invitations to it are deleted.
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

const scheduleOf = (r: Room): RoomSchedule => ({ queue: r.queue, idx: r.idx, startedAt: r.startedAt?.getTime() ?? null, version: r.version });

/** How long each song lasts, by the list every process holds (one no longer in it lasts nothing, so a room passes over it) */
async function secondsOf() {
  const list = await songList();
  return (id: string) => list.byId.get(id)?.seconds ?? Number.NaN;
}

// ---- who is in a room, for what is told to it ----

type Hearer = { userId: string; handle: number; hiddenFrom: number[] };
type Held = { at: number; rows: Hearer[] };
type Batch = { items: { h: number; r: number }[]; timer: ReturnType<typeof setTimeout> };
const g = globalThis as unknown as { listenRoomMembers?: Map<string, Held>; listenRx?: Map<string, Batch>; listenToldHeard?: boolean };
const hearersHeld: Map<string, Held> = (g.listenRoomMembers ??= new Map());
const batches: Map<string, Batch> = (g.listenRx ??= new Map());

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
  const members: RoomMember[] = shown.map(({ m, u }) => ({
    h: m.handle,
    card: cards.get(u.id)!,
    friend: friends.has(u.id),
    host: u.id === room.hostId,
    state: !m.leftAt ? "in" : m.kicked && host ? "kicked" : "left",
  }));
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
  const hostRow = rows.find((r) => r.u.id === room.hostId);
  return {
    id: room.id,
    ...scheduleOf(room),
    max: listenSettings().roomMax,
    you: me.handle,
    host,
    hostName: hostRow ? displayName(profileOf(hostRow.u)) : "",
    members,
    invited,
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
  // what they heard there stops counting soon: their phones fade it out, and say so
  await tx.update(listenNow).set({ roomId: null, until: soonest(now) }).where(eq(listenNow.roomId, roomId));
  return gone.map((r) => r.userId);
}

/** Listening to a room's song stops counting END_GRACE_MS after one is out of it, at most */
const soonest = (now: number) => sql`least(${listenNow.until}, ${new Date(now + END_GRACE_MS).toISOString()}::timestamptz)`;

function tellEnd(roomId: string, ids: string[], why: RoomEnd) {
  forget(roomId);
  batches.delete(roomId);
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
 * is), and invitations to the 触须之交 given (invite: their Friend ids). Out of the room they were in first.
 */
export async function openRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  // no song named (a 触须之交's card, before the list was looked at): 新歌's first
  const song = body.song == null ? await firstSong() : await songOf(body.song);
  if (!song) throw refuse(404, T.server.listen.noSong, NO_SONG);
  await mayListen(user.id, now);
  const { roomId, left } = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    const left = await leaveIn(tx, user.id, now);
    const [room] = await tx.insert(listenRooms).values({ hostId: user.id, createdAt: new Date(now), queue: [song.id] }).returning({ id: listenRooms.id });
    await tx.insert(listenMembers).values({ roomId: room.id, userId: user.id, handle: 1, via: "host", joinedAt: new Date(now) });
    return { roomId: room.id, left };
  });
  await told(left);
  countStat(COUNTED.listenRoom, 1, now);
  const sent = body.invite === undefined ? [] : await inviteIn(user, roomId, body.invite, now);
  return { room: await roomView(roomId, user.id, now), sent, now };
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
 * Each 触须之交 given gets an invitation, unless TA may not listen (LISTEN, blocking), is in the room already, has one
 * to it still good, or was invited INVITES_PER_DAY times today by this host (a site day, none of the day's touches)
 */
async function inviteIn(user: UserRow, roomId: string, given: unknown, now: number): Promise<InviteSent[]> {
  if (!Array.isArray(given)) throw refuse(400, T.server.common.badRequest);
  const keys = [...new Set(given.map(String))].slice(0, INVITE_AT_ONCE);
  if (!keys.length) return [];
  const byKey = new Map([...(await friendIdsOf(user.id))].map((id) => [friendKey(user.id, id), id]));
  const ids = keys.map((k) => byKey.get(k)).filter((id): id is string => Boolean(id));
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const blocked = await blockedWith(user.id);
  const dayStart = new Date(siteDayStart(siteDay(now)));
  const results: InviteSent[] = [];
  const nudged: string[] = [];
  await db.transaction(async (tx) => {
    // one host's invitations one at a time, so two taps cannot both find room for a fourth today
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
        continue;
      }
      const [{ n }] = await tx
        .select({ n: count() })
        .from(listenInvites)
        .where(and(eq(listenInvites.fromUserId, user.id), eq(listenInvites.toUserId, to), gte(listenInvites.createdAt, dayStart)));
      if (n >= INVITES_PER_DAY) {
        results.push({ id: key, ok: false, why: fmt(T.server.listen.invitedEnough, { n: INVITES_PER_DAY }) });
        continue;
      }
      await tx.insert(listenInvites).values({ roomId, fromUserId: user.id, toUserId: to, createdAt: new Date(now) });
      results.push({ id: key, ok: true });
      nudged.push(to);
    }
  });
  if (nudged.length) {
    countStat(COUNTED.listenInvite, nudged.length, now);
    nudge(nudged);
    // the host's own list of who is invited
    tellListen([user.id], { t: "members", room: roomId });
  }
  return results;
}

/**
 * In at an invitation (invite: its id, from 消息 or the card on the map): only the one invited, while it is good and the
 * room goes on, not full, never to one asked to leave it, nor with anyone in it either has blocked. Out of the room
 * they were in first.
 */
export async function joinRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseNow(now);
  const id = typeof body.invite === "string" && UUID.test(body.invite) ? body.invite.toLowerCase() : null;
  const [invite] = id
    ? await db
        .select()
        .from(listenInvites)
        .where(and(eq(listenInvites.id, id), eq(listenInvites.toUserId, user.id)))
    : [];
  if (!invite) throw refuse(404, T.server.listen.inviteGone, ROOM_GONE);
  if (invite.createdAt.getTime() <= now - INVITE_MS) throw refuse(410, T.server.listen.inviteGone, ROOM_GONE);
  const blocked = await blockedWith(user.id);
  const already = await roomOfPlayer(db, user.id);
  if (already?.room.id !== invite.roomId) await mayListen(user.id, now);
  const { left } = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    // the room's row first, so two coming in at once are counted one after the other
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, invite.roomId)).for("update");
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
      await tx.insert(listenMembers).values({ roomId: room.id, userId: user.id, handle, via: "invite", joinedAt: new Date(now) });
    }
    await tx
      .update(listenInvites)
      .set({ answer: "joined", answeredAt: new Date(now), seenAt: sql`coalesce(${listenInvites.seenAt}, now())` })
      .where(eq(listenInvites.id, invite.id));
    return { left };
  });
  await told(left);
  if (already?.room.id !== invite.roomId) {
    countStat(COUNTED.listenJoin, 1, now);
    await tellMembers(invite.roomId);
  }
  const room = await roomView(invite.roomId, user.id, now);
  if (!room) throw refuse(410, T.server.listen.roomGone, ROOM_GONE);
  return { room, now };
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

/** The host's 结束 */
export async function endByHost(user: Pick<UserRow, "id">, now = Date.now()) {
  const mine = await roomOfPlayer(db, user.id);
  if (!mine) return { now };
  if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
  await endRoom(mine.room.id, "host", now);
  return { now };
}

// ---- the songs ----

/** What the host does to the room's songs (src/lib/listen.ts changeQueue): start, next, restart, or add a song */
export async function changeSongs(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const change: QueueChange | null =
    body.start === true ? "start" : body.next === true ? "next" : body.restart === true ? "restart" : isSongId(body.add) ? { add: body.add } : null;
  if (!change) throw refuse(400, T.server.common.badRequest);
  refuseNow(now);
  if (typeof change === "object" && !(await songOf(change.add))) throw refuse(404, T.server.listen.noSong, NO_SONG);
  const seconds = await secondsOf();
  const result = await db.transaction(async (tx) => {
    const mine = await roomOfPlayer(tx, user.id);
    if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
    if (mine.room.hostId !== user.id) throw refuse(403, T.server.listen.notHost);
    const [room] = await tx.select().from(listenRooms).where(eq(listenRooms.id, mine.room.id)).for("update");
    const next = changeQueue(scheduleOf(room), change, seconds, now);
    if (next === "noNext") throw refuse(409, T.server.listen.noNext);
    if (next === "full") throw refuse(409, fmt(T.server.listen.queueFull, { n: QUEUE_MAX }));
    if (next === "same") return { room, next: null };
    await tx
      .update(listenRooms)
      .set({ queue: next.queue, idx: next.idx, startedAt: next.startedAt === null ? null : new Date(next.startedAt), version: next.version })
      .where(eq(listenRooms.id, room.id));
    return { room, next };
  });
  if (result.next) {
    const how = typeof change === "object" ? "add" : change;
    const rows = await hearersOf(result.room.id);
    tellListen(
      rows.map((r) => r.userId),
      { t: "state", room: result.room.id, how, ...result.next },
    );
  }
  return { room: await roomView(result.room.id, user.id, now), now };
}

// ---- 短评 ----

/**
 * A 短评 in the room you are in, by its number (src/lib/listen.ts isRx): one every RX_EVERY_MS and RX_PER_SONG to a
 * song, counted in memory alone, and never written down. Those of a second go out together (RX_BATCH_MS), to everyone
 * in the room but those it is hidden from. sent: false when it was one too many (the page greys its buttons).
 */
export async function reactInRoom(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (!isRx(body.r)) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOfPlayer(db, user.id);
  if (!mine) throw refuse(409, T.server.listen.noRoom, NO_ROOM);
  const at = roomAt(scheduleOf(mine.room), await secondsOf(), now);
  const song = at.phase === "playing" ? `${mine.room.queue[at.i]}@${at.start}` : "between";
  if (!allow(`listen:rx:${user.id}`, 1, RX_EVERY_MS)) return { sent: false, now };
  if (!allow(`listen:rx:${mine.room.id}:${song}:${user.id}`, RX_PER_SONG, ROOM_LIFE_MS)) return { sent: false, full: true, now };
  addRx(mine.room.id, mine.me.handle, body.r);
  countStat(COUNTED.listenRx, 1, now);
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
 * over (ROOM_IDLE_MS after their last song), empty, older than ROOM_LIFE_MS, or all of them while 听歌 is paused or the
 * site is gray; and rooms over for ROOM_KEEP_MS go, with who was in them and the invitations to them. Says how many
 * ended.
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
  for (const room of open) {
    const at = roomAt(scheduleOf(room), seconds, now);
    const over =
      why ??
      (!counts.get(room.id) ||
      room.createdAt.getTime() <= now - ROOM_LIFE_MS ||
      (at.phase === "done" && at.end <= now - ROOM_IDLE_MS)
        ? "idle"
        : null);
    if (!over) continue;
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
    const at = roomAt(scheduleOf(room), seconds, now);
    const song = room.queue[at.phase === "playing" ? at.i : at.phase === "done" ? room.queue.length - 1 : room.idx] ?? room.queue[0];
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

/** Your 触须之交 who may listen, to invite: how many times more today, and whether TA is in your room already */
export async function listenFriends(user: Pick<UserRow, "id">, now = Date.now()): Promise<{ friends: ListenFriend[]; now: number }> {
  const ids = [...(await friendIdsOf(user.id))];
  if (!ids.length) return { friends: [], now };
  const blocked = await blockedWith(user.id);
  const people = (await db.select().from(users).where(inArray(users.id, ids))).filter((u) => !blocked.has(u.id) && listenOpen(u));
  const dayStart = new Date(siteDayStart(siteDay(now)));
  const used = new Map(
    (
      await db
        .select({ to: listenInvites.toUserId, n: count() })
        .from(listenInvites)
        .where(and(eq(listenInvites.fromUserId, user.id), gte(listenInvites.createdAt, dayStart)))
        .groupBy(listenInvites.toUserId)
    ).map((r) => [r.to, r.n]),
  );
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
        left: Math.max(0, INVITES_PER_DAY - (used.get(u.id) ?? 0)),
        inRoom: inRoomNow.has(u.id),
      }),
    )
    .sort((a, b) => a.card.displayName.localeCompare(b.card.displayName, "zh"));
  return { friends, now };
}
