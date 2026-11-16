import "server-only";
import { createHash, randomInt } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { COUNTED } from "../dashboard";
import {
  changeQueue,
  isSeek,
  isSongId,
  LISTEN_GRAY,
  LISTEN_PAUSED,
  NO_SONG,
  QUEUE_MAX,
  RANDOM_ADD,
  roomAt,
  type QueueEdit,
  type RoomSchedule,
} from "../listen";
import { displayName } from "../profile";
import { beijingDate } from "../beijing";
import { siteDay, siteDayStart } from "../siteDay";
import {
  cardNow,
  DEFAULT_SERVER,
  findKey,
  GO_MAX_MS,
  isLevel,
  isPhrase,
  isSquadServer,
  isTag,
  JOINS_PER_HOUR,
  KEEP_MS,
  KEY_CHANGES,
  KEY_EVERY_MS,
  LIFE_MS,
  LIST_MAX,
  NEED_CARD,
  NOT_IN_ROOM,
  OPEN_EVERY_MS,
  OPENS_PER_DAY,
  PREFS_EVERY_MS,
  readCard,
  REQUEST_EVERY_MS,
  REQUESTS_EACH,
  REWAIT_MS,
  ROOM_FULL,
  ROOM_GONE,
  ROOM_PLAYING,
  ROOM_SHUT,
  SAY_EVERY_MS,
  SAY_PER_HOUR,
  SQUAD_CLOSED,
  SQUAD_MAX,
  STATE_EVERY_MS,
  TAGS_MAX,
  WAIT_IDLE_MS,
  type SquadCard,
  type SquadDesk,
  type SquadEnd,
  type SquadList,
  type SquadListRoom,
  type SquadMe,
  type SquadMember,
  type SquadRoom,
  type SquadSeat,
  type SquadSongChange,
  type SquadSongHow,
  type SquadState,
  type SquadTell,
} from "../squad";
import { ROACH_COLORS } from "../types";
import { WorldError, type TouchResult } from "../world/types";
import { blockedWith } from "./blocks";
import { db } from "./db";
import { lockPlayer, type Exec } from "./guides";
import { squadMode } from "./env";
import { HttpError } from "./http";
import { listenOpen } from "./listen";
import { onToldSquad, tellSquad } from "./live";
import { drawnLook } from "./looks";
import { allow } from "./rateLimit";
import { listenNow, roaches, squadMembers, squadRequests, squadRooms, statCounts, users, type UserRow } from "./schema";
import { grayUntil, listenSettings, squadSettings } from "./siteSettings";
import { songList, songOf } from "./songs";
import { squadShown } from "./squadOpen";
import { countStat, unsavedStats } from "./stats";
import { cardsOf, friendIdsOf, touch } from "./world";

/**
 * 一起卫戍 on the server (src/lib/squad.ts), through src/app/api/squad/[op]. A host opens a room with the game's
 * 同盟密钥 and what it is for; others come in at it from the list, four at most, and see the key, each other's names
 * and the card each chose for the room (taken from their 卫戍名片, changed there for the room alone). The host
 * switches it between 等人 (on the list, open) and 开打 (closed, at the bottom of the list), ends it, asks someone to
 * leave for good, and changes the key a few times. Whoever goes in is known in the room by a number of its own
 * (handle), never by an id, and by it is touched (碰), blocked or reported there (sq:<room>:<number>,
 * src/lib/server/safety.ts). What a room does goes to the phones in it at once (live.ts tellSquad, SquadTell): that it
 * changed (each phone asks again), the set lines of the last second, that it ended. The lines are never written down,
 * only how many a day.
 *
 * A room ends when its host ends or leaves it, opens another or goes in at another; when it waited WAIT_IDLE_MS with
 * nobody coming or going (or since 等人 last started the wait over), played GO_MAX_MS since 开打, or was open LIFE_MS,
 * whether or not its host's page is there (they play in the game meanwhile); and every room ends when it is closed for
 * now in the 管理台. KEEP_MS after, it is deleted with who was in it (sweepSquad, on the main process).
 *
 * The list is read from one snapshot each process takes every SNAP_MS of the rooms open and who is in them; each
 * player's is cut from it: their server and 难度, rooms only for 触须之交 shown only to the host's, nothing with anyone
 * they blocked or who blocked them in it, and only the host named (and the viewer's own 触须之交, isNamed).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOUR = 3_600_000;
/** The rooms and who is in them, for the list: read again this often at most, on each process */
const SNAP_MS = 5_000;
/** A player's list asked again within this long, the same as last time */
const LIST_MIN_MS = 5_000;
/** Who is in a room, for what it is told: as this process last read it, at most this old */
const MEMBERS_MS = 5_000;
/** Lines that came to this process in this long go out together, one message to the room */
const SAY_BATCH_MS = 1_000;
/** What each process keeps for so many players or rooms at most, the oldest going first */
// (the limits here count under names of their own: the route's per minute are squad:<op>:<player>)
const HELD_MAX = 5_000;

type Room = typeof squadRooms.$inferSelect;

const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
/** A room's number for someone in it, as a request gives it */
const handleOf = (v: unknown): number | null => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 32_767 ? (v as number) : null);

function refuseClosed() {
  if (squadSettings().closed) throw refuse(503, T.server.squad.closed, SQUAD_CLOSED);
}

const cardOf = (u: Pick<UserRow, "squadCore" | "squadStrategy" | "squadExtras">) => cardNow(u.squadCore, u.squadStrategy, u.squadExtras);
/** A card as a room keeps it, read against this season */
const roomCard = (m: { core: number; strategy: number | null; extras: number[] }): SquadCard => cardNow(m.core, m.strategy, m.extras)!;

/** Kept oldest first: set anew at the end, and the oldest dropped while there are too many */
function hold<K, V>(map: Map<K, V>, key: K, value: V) {
  map.delete(key);
  map.set(key, value);
  for (const k of map.keys()) {
    if (map.size <= HELD_MAX) break;
    map.delete(k);
  }
}

// ---- the room a player is in ----

/** The open room a player is in now, with their row in it */
async function roomOf(exec: Exec, userId: string) {
  const [r] = await exec
    .select({ room: squadRooms, me: squadMembers })
    .from(squadMembers)
    .innerJoin(squadRooms, eq(squadRooms.id, squadMembers.roomId))
    .where(and(eq(squadMembers.userId, userId), isNull(squadMembers.leftAt), isNull(squadRooms.endedAt)));
  return r ?? null;
}

const scheduleOf = (r: Room): RoomSchedule => ({ queue: r.queue, idx: r.idx, startedAt: r.startedAt?.getTime() ?? null, version: r.version });

/** How long each song lasts, by the list every process holds (one no longer in it lasts nothing, so a room passes over it) */
async function secondsOf() {
  const list = await songList();
  return (id: string) => list.byId.get(id)?.seconds ?? Number.NaN;
}

/** Whether this player may hear the host's songs: 听歌 open to them, not paused in the 管理台, the site not gray */
const djFor = (user: Pick<UserRow, "id" | "email">, now: number) => listenOpen(user) && !listenSettings().paused && !grayUntil(now);

/** When a room ends by itself unless something happens (someone in or out, a new key, 等人 again), and why it would */
function endsOf(r: Room): { at: number; why: "idle" | "go" | "life" } {
  const life = r.createdAt.getTime() + LIFE_MS;
  const own: { at: number; why: "idle" | "go" } =
    r.state === "go"
      ? { at: (r.wentAt ?? r.createdAt).getTime() + GO_MAX_MS, why: "go" }
      : { at: Math.max(r.movedAt.getTime(), r.waitedAt.getTime(), r.keyAt.getTime()) + WAIT_IDLE_MS, why: "idle" };
  return own.at <= life ? own : { at: life, why: "life" };
}

// ---- who is in a room, for what is told to it ----

type Hearer = { userId: string; handle: number };
const g = globalThis as unknown as {
  squadHearers?: Map<string, { at: number; rows: Hearer[] }>;
  squadSays?: Map<string, { items: { h: number; p: number }[]; timer: ReturnType<typeof setTimeout> }>;
  squadSnap?: { at: number; rooms: Snap[] | null; loading: Promise<Snap[]> | null };
  squadLists?: Map<string, { at: number; key: string; list: SquadList; etag: string }>;
  squadTold?: boolean;
};
const hearersHeld = (g.squadHearers ??= new Map());
const says = (g.squadSays ??= new Map());

async function hearersOf(roomId: string, now = Date.now()): Promise<Hearer[]> {
  const held = hearersHeld.get(roomId);
  if (held && now - held.at < MEMBERS_MS) return held.rows;
  const rows = await db
    .select({ userId: squadMembers.userId, handle: squadMembers.handle })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
  hold(hearersHeld, roomId, { at: now, rows });
  return rows;
}

/** Who is in it changed: forgotten here at once, and on the other processes as they hear of it */
const forget = (roomId: string) => hearersHeld.delete(roomId);
if (!g.squadTold) {
  g.squadTold = true;
  onToldSquad((d) => {
    const t = d as { t?: unknown; room?: unknown };
    if (typeof t.room === "string") forget(t.room);
  });
}

/** Tell everyone in the room it changed (what: so their page can say so), and also those given */
async function tellRoom(roomId: string, what?: Extract<SquadTell, { t: "room" }>["what"], also: string[] = []) {
  forget(roomId);
  const rows = await hearersOf(roomId);
  const tell: SquadTell = { t: "room", room: roomId, ...(what ? { what } : {}) };
  tellSquad([...rows.map((r) => r.userId), ...also], tell);
}

function tellEnd(roomId: string, ids: string[], why: SquadEnd) {
  forget(roomId);
  says.delete(roomId);
  const tell: SquadTell = { t: "end", room: roomId, why };
  tellSquad(ids, tell);
}

// ---- what a room looks like to someone in it ----

/** The room as viewerId sees it, or null when they are not in it (or it is over) */
export async function roomView(roomId: string, viewerId: string, now = Date.now()): Promise<SquadRoom | null> {
  const [room] = await db.select().from(squadRooms).where(eq(squadRooms.id, roomId));
  if (!room || room.endedAt) return null;
  const rows = await db
    .select({ m: squadMembers, u: users })
    .from(squadMembers)
    .innerJoin(users, eq(users.id, squadMembers.userId))
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
  const me = rows.find((r) => r.u.id === viewerId)?.m;
  if (!me) return null;
  const friends = await friendIdsOf(viewerId);
  const cards = await cardsOf(
    rows.map((r) => r.u),
    viewerId,
  );
  const members: SquadMember[] = rows
    .sort((a, b) => a.m.handle - b.m.handle)
    .map(({ m, u }) => {
      const card = cards.get(u.id)!;
      return {
        h: m.handle,
        name: card.displayName,
        avatar: card.avatar,
        color: card.color,
        host: u.id === room.hostId,
        you: u.id === viewerId,
        friend: friends.has(u.id),
        inGame: m.inGame,
        ...roomCard(m),
      };
    });
  const ends = endsOf(room);
  const host = room.hostId === viewerId;
  const byHandle = new Map(members.map((m) => [m.h, m.name]));
  const asked = await db
    .select({ id: squadRequests.id, handle: squadRequests.handle, song: squadRequests.song })
    .from(squadRequests)
    .where(and(eq(squadRequests.roomId, roomId), host ? undefined : eq(squadRequests.handle, me.handle)))
    .orderBy(asc(squadRequests.createdAt));
  const requests = asked
    .filter((r) => byHandle.has(r.handle))
    .map((r) => (host ? { id: r.id, song: r.song, name: byHandle.get(r.handle)! } : { id: r.id, song: r.song }));
  // to the host alone: how many in it hear one of its songs now (听歌's own row of what each plays, never who)
  let listening: number | null = null;
  if (host) {
    const playing = room.queue.length
      ? await db
          .select({ song: listenNow.song })
          .from(listenNow)
          .where(and(inArray(listenNow.userId, rows.map((r) => r.u.id)), gt(listenNow.until, new Date(now))))
      : [];
    listening = playing.filter((p) => room.queue.includes(p.song)).length;
  }
  return {
    ...scheduleOf(room),
    dj: djFor(rows.find((r) => r.u.id === viewerId)!.u, now),
    requests,
    listening,
    id: room.id,
    server: room.server,
    level: room.level,
    tags: room.tags,
    state: room.state as SquadState,
    friendsOnly: room.friendsOnly,
    key: room.key,
    keyAt: room.keyAt.getTime(),
    keyLeft: Math.max(0, KEY_CHANGES - room.keyChanges),
    you: me.handle,
    host: room.hostId === viewerId,
    members,
    endsAt: ends.at,
    endsWhy: ends.why,
    rewaitAt: room.waitedAt.getTime() + REWAIT_MS,
    now,
  };
}

/** The room you are in now, as you see it (null: none), and the server's clock */
export async function myRoom(user: Pick<UserRow, "id">, now = Date.now()) {
  const mine = await roomOf(db, user.id);
  return { room: mine ? await roomView(mine.room.id, user.id, now) : null, now };
}

/** What me() carries: undefined where its way in does not show to the player */
export async function squadMe(user: UserRow): Promise<SquadMe | undefined> {
  if (!squadShown(user)) return undefined;
  const s = squadSettings();
  return { card: cardOf(user), room: Boolean(await roomOf(db, user.id)), closed: s.closed ? s.note : null };
}

// ---- 卫戍名片 ----

/** The player's 卫戍名片, as given (card), kept for the rooms they open or go in at from now on; null clears it */
export async function saveCard(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (body.card === null) {
    await db.update(users).set({ squadCore: null, squadStrategy: null, squadExtras: [] }).where(eq(users.id, user.id));
    return { card: null, now };
  }
  const card = readCard(body.card);
  if (!card) throw refuse(400, T.server.common.badRequest);
  await db.update(users).set({ squadCore: card.core, squadStrategy: card.strategy, squadExtras: card.extras }).where(eq(users.id, user.id));
  return { card, now };
}

// ---- in and out ----

/** What leaving the room you are in made of it, told once the change is written */
type Left = { roomId: string; ended: string[] | null } | null;

/** Out of the room you are in, if any: the host's ends with them, anyone else's goes on without them */
async function leaveIn(tx: Exec, userId: string, now: number): Promise<Left> {
  const mine = await roomOf(tx, userId);
  if (!mine) return null;
  if (mine.room.hostId === userId) return { roomId: mine.room.id, ended: await endIn(tx, mine.room.id, "host", now) };
  await tx
    .update(squadMembers)
    .set({ leftAt: new Date(now) })
    .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.userId, userId)));
  await tx.update(squadRooms).set({ movedAt: new Date(now) }).where(eq(squadRooms.id, mine.room.id));
  // the songs they asked for go with them
  await tx.delete(squadRequests).where(and(eq(squadRequests.roomId, mine.room.id), eq(squadRequests.handle, mine.me.handle)));
  return { roomId: mine.room.id, ended: null };
}

async function told(left: Left) {
  if (!left) return;
  forgetList();
  if (left.ended) return tellEnd(left.roomId, left.ended, "host");
  await tellRoom(left.roomId);
}

/** The room over, everyone in it out; says who was in it (null: it was over already) */
async function endIn(tx: Exec, roomId: string, why: SquadEnd, now: number): Promise<string[] | null> {
  const [ended] = await tx
    .update(squadRooms)
    .set({ endedAt: new Date(now), endReason: why, state: "ended" })
    .where(and(eq(squadRooms.id, roomId), isNull(squadRooms.endedAt)))
    .returning({ id: squadRooms.id });
  if (!ended) return null;
  const gone = await tx
    .update(squadMembers)
    .set({ leftAt: new Date(now) })
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)))
    .returning({ userId: squadMembers.userId });
  return gone.map((r) => r.userId);
}

/** End a room (the host's 结束, the sweep, the 管理台) and tell everyone in it */
export async function endSquadRoom(roomId: string, why: SquadEnd, now = Date.now()) {
  const ids = await db.transaction((tx) => endIn(tx, roomId, why, now));
  if (!ids) return false;
  forgetList();
  tellEnd(roomId, ids, why);
  return true;
}

/** Every room ends at once: 一起卫戍 closed for now in the 管理台. Says how many there were */
export async function endAllSquadRooms(why: SquadEnd, now = Date.now()) {
  const open = await db.select({ id: squadRooms.id }).from(squadRooms).where(isNull(squadRooms.endedAt));
  for (const r of open) await endSquadRoom(r.id, why, now);
  return open.length;
}

/** The tags a request gives: each one of TAGS, at most TAGS_MAX, none twice */
function readTags(v: unknown): number[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > TAGS_MAX || !v.every(isTag) || new Set(v).size !== v.length) return null;
  return v as number[];
}

/**
 * A new room, the player its host: the 同盟密钥 (key), the server, 难度 (level), how they want to play (tags) and
 * whether only their 触须之交 may come in (friendsOnly). Their 卫戍名片 first. One every OPEN_EVERY_MS and
 * OPENS_PER_DAY a site day at most, counted by the rooms they opened; out of the room they were in first.
 */
export async function openRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseClosed();
  const card = cardOf(user);
  if (!card) throw refuse(409, T.server.squad.needCard, NEED_CARD);
  const key = typeof body.key === "string" ? findKey(body.key) : null;
  if (!key) throw refuse(400, T.server.squad.badKey);
  const tags = readTags(body.tags);
  if (!isSquadServer(body.server) || !isLevel(body.level) || !tags || (body.friendsOnly !== undefined && typeof body.friendsOnly !== "boolean")) {
    throw refuse(400, T.server.common.badRequest);
  }
  const { server, level } = body;
  const friendsOnly = body.friendsOnly === true;
  const { id, left } = await db.transaction(async (tx) => {
    // one player's rooms one at a time, so two taps cannot both find room for one more today
    await lockPlayer(tx, user.id);
    const dayStart = siteDayStart(siteDay(now));
    const recent = await tx
      .select({ at: squadRooms.createdAt })
      .from(squadRooms)
      .where(and(eq(squadRooms.hostId, user.id), gte(squadRooms.createdAt, new Date(Math.min(dayStart, now - OPEN_EVERY_MS)))))
      .orderBy(desc(squadRooms.createdAt));
    if (recent.filter((r) => r.at.getTime() >= dayStart).length >= OPENS_PER_DAY) {
      throw refuse(429, fmt(T.server.squad.openedEnough, { n: OPENS_PER_DAY }));
    }
    const last = recent[0]?.at.getTime();
    if (last !== undefined && last > now - OPEN_EVERY_MS) {
      throw refuse(429, fmt(T.server.squad.openWait, { s: Math.ceil((last + OPEN_EVERY_MS - now) / 1000) }));
    }
    const left = await leaveIn(tx, user.id, now);
    const at = new Date(now);
    const [room] = await tx
      .insert(squadRooms)
      .values({ hostId: user.id, server, level, tags, key, keyAt: at, friendsOnly, createdAt: at, movedAt: at, waitedAt: at })
      .returning({ id: squadRooms.id });
    await tx.insert(squadMembers).values({ roomId: room.id, userId: user.id, handle: 1, joinedAt: at, ...card });
    return { id: room.id, left };
  });
  await told(left);
  forgetList();
  countStat(COUNTED.squadRoom, 1, now);
  return { room: await roomView(id, user.id, now), now };
}

/**
 * In at a room from the list (room: its id), with the 卫戍名片 as this room's card: while it waits for players (等人)
 * and is not full; never one asked to leave it, nor with anyone in it either has blocked; one only for 触须之交, only
 * by a 触须之交 of its host. JOINS_PER_HOUR rooms an hour at most. Out of the room they were in first.
 */
export async function joinRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseClosed();
  const card = cardOf(user);
  if (!card) throw refuse(409, T.server.squad.needCard, NEED_CARD);
  const roomId = uuid(body.room);
  if (!roomId) throw refuse(400, T.server.common.badRequest);
  const already = await roomOf(db, user.id);
  if (already?.room.id === roomId) return { room: await roomView(roomId, user.id, now), now };
  const [{ n }] = await db
    .select({ n: count() })
    .from(squadMembers)
    .where(and(eq(squadMembers.userId, user.id), gt(squadMembers.handle, 1), gt(squadMembers.joinedAt, new Date(now - HOUR))));
  if (n >= JOINS_PER_HOUR) throw refuse(429, fmt(T.server.squad.joinedEnough, { n: JOINS_PER_HOUR }));
  const [blocked, friends] = await Promise.all([blockedWith(user.id), friendIdsOf(user.id)]);
  const { left, handle } = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    // the room's row first, so two coming in at once are counted one after the other
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    if (room.state !== "wait") throw refuse(409, T.server.squad.playing, ROOM_PLAYING);
    const rows = await tx.select().from(squadMembers).where(eq(squadMembers.roomId, room.id));
    const mine = rows.find((m) => m.userId === user.id);
    if (mine?.kicked) throw refuse(403, T.server.squad.shut, ROOM_SHUT);
    const inNow = rows.filter((m) => !m.leftAt);
    if (inNow.some((m) => blocked.has(m.userId))) throw refuse(403, T.server.squad.shut, ROOM_SHUT);
    if (room.friendsOnly && !friends.has(room.hostId)) throw refuse(403, T.server.squad.friendsOnly, ROOM_SHUT);
    if (inNow.length >= SQUAD_MAX) throw refuse(409, T.server.squad.full, ROOM_FULL);
    const left = await leaveIn(tx, user.id, now);
    const at = new Date(now);
    let handle: number;
    if (mine) {
      handle = mine.handle;
      await tx
        .update(squadMembers)
        .set({ leftAt: null, joinedAt: at, inGame: false, ...card })
        .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id)));
    } else {
      handle = rows.reduce((h, m) => Math.max(h, m.handle), 0) + 1;
      await tx.insert(squadMembers).values({ roomId: room.id, userId: user.id, handle, joinedAt: at, ...card });
    }
    await tx.update(squadRooms).set({ movedAt: at }).where(eq(squadRooms.id, room.id));
    return { left, handle };
  });
  await told(left);
  forgetList();
  countStat(COUNTED.squadJoin, 1, now);
  await tellRoom(roomId, { kind: "in", h: handle });
  const room = await roomView(roomId, user.id, now);
  if (!room) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
  return { room, now };
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

/** The room the player is host of, or the refusal */
async function hostedBy(userId: string) {
  const mine = await roomOf(db, userId);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (mine.room.hostId !== userId) throw refuse(403, T.server.squad.notHost);
  return mine;
}

/**
 * The host's row of three (to): 等人 (wait: on the list and open; tapped while waiting, the wait starts over, every
 * REWAIT_MS at most), 开打 (go: closed, at the bottom of the list) or 结束 (end). Between 等人 and 开打 every
 * STATE_EVERY_MS at most.
 */
export async function setState(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const to = body.to;
  if (to !== "wait" && to !== "go" && to !== "end") throw refuse(400, T.server.common.badRequest);
  const mine = await hostedBy(user.id);
  if (to === "end") {
    await endSquadRoom(mine.room.id, "host", now);
    return { room: null, now };
  }
  const changed = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, mine.room.id)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    if (room.state === to) {
      if (to === "go") return false;
      const again = room.waitedAt.getTime() + REWAIT_MS;
      if (again > now) throw refuse(429, fmt(T.server.squad.rewaitLater, { m: Math.ceil((again - now) / 60_000) }));
      await tx.update(squadRooms).set({ waitedAt: new Date(now) }).where(eq(squadRooms.id, room.id));
      return false;
    }
    if (room.stateAt && room.stateAt.getTime() > now - STATE_EVERY_MS) throw refuse(429, T.server.squad.tooFast);
    const at = new Date(now);
    await tx
      .update(squadRooms)
      .set({ state: to, stateAt: at, ...(to === "go" ? { wentAt: at } : { waitedAt: at }) })
      .where(eq(squadRooms.id, room.id));
    return true;
  });
  if (changed) {
    forgetList();
    await tellRoom(mine.room.id, { kind: "state", to });
  }
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * The host pastes a new 同盟密钥 (key), as the game's alliance is made again: every KEY_EVERY_MS at most, and
 * KEY_CHANGES times a room. It counts as something happening (the wait starts over), and the key's age is the new one's.
 */
export async function changeKey(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const key = typeof body.key === "string" ? findKey(body.key) : null;
  if (!key) throw refuse(400, T.server.squad.badKey);
  const mine = await hostedBy(user.id);
  const changed = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, mine.room.id)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    if (room.key === key) return false;
    if (room.keyChanges >= KEY_CHANGES) throw refuse(429, fmt(T.server.squad.keyEnough, { n: KEY_CHANGES }));
    const again = room.keyAt.getTime() + KEY_EVERY_MS;
    if (again > now) throw refuse(429, fmt(T.server.squad.keyWait, { s: Math.ceil((again - now) / 1000) }));
    await tx
      .update(squadRooms)
      .set({ key, keyAt: new Date(now), keyChanges: room.keyChanges + 1 })
      .where(eq(squadRooms.id, room.id));
    return true;
  });
  if (changed) await tellRoom(mine.room.id, { kind: "key" });
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/** Someone in the room the player is in (h: their number there): never themselves */
async function memberAt(userId: string, h: number) {
  const mine = await roomOf(db, userId);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  const [them] = await db
    .select()
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.handle, h), isNull(squadMembers.leftAt)));
  if (!them || them.userId === userId) throw refuse(409, T.server.squad.notThere);
  return { mine, them };
}

/** 请出去: the host asks someone in the room to leave it (h), for good; TA alone is told so */
export async function kickMember(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const h = handleOf(body.h);
  if (h === null) throw refuse(400, T.server.common.badRequest);
  const mine = await hostedBy(user.id);
  const them = await kickIn(mine.room.id, user.id, h, now);
  if (!them) throw refuse(409, T.server.squad.notThere);
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/** Out for good, by its host: the one with the number h in the room (never the host), or null when nobody is */
async function kickIn(roomId: string, hostId: string, h: number, now: number) {
  const gone = await db.transaction(async (tx) => {
    // after any coming in at once, as they count it (joinRoom)
    await tx.select({ id: squadRooms.id }).from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    const [them] = await tx
      .update(squadMembers)
      .set({ kicked: true, leftAt: new Date(now) })
      .where(and(eq(squadMembers.roomId, roomId), eq(squadMembers.handle, h), isNull(squadMembers.leftAt)))
      .returning({ userId: squadMembers.userId });
    if (!them || them.userId === hostId) {
      if (them) throw refuse(400, T.server.common.badRequest);
      return null;
    }
    await tx.update(squadRooms).set({ movedAt: new Date(now) }).where(eq(squadRooms.id, roomId));
    await tx.delete(squadRequests).where(and(eq(squadRequests.roomId, roomId), eq(squadRequests.handle, h)));
    return them.userId;
  });
  if (!gone) return null;
  forgetList();
  const tell: SquadTell = { t: "you", room: roomId, why: "kicked" };
  tellSquad([gone], tell);
  await tellRoom(roomId);
  return gone;
}

/** 我进同盟了 (on), ticked by the player for everyone in the room to see; told to them when it comes on */
export async function setInGame(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (typeof body.on !== "boolean") throw refuse(400, T.server.common.badRequest);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (mine.me.inGame !== body.on) {
    await db
      .update(squadMembers)
      .set({ inGame: body.on })
      .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.userId, user.id)));
    await tellRoom(mine.room.id, body.on ? { kind: "game", h: mine.me.handle } : undefined);
  }
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/** The player's card in this room alone (card), their 卫戍名片 as it was; every PREFS_EVERY_MS at most */
export async function setPrefs(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const card = readCard(body.card);
  if (!card) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (!allow(`squad:prefsEvery:${user.id}`, 1, PREFS_EVERY_MS)) throw refuse(429, T.server.squad.tooFast);
  await db
    .update(squadMembers)
    .set(card)
    .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.userId, user.id)));
  forgetList();
  await tellRoom(mine.room.id);
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * 偷偷碰 or 大胆碰 someone in the room you are in (h: their number there): their main roach, touched as on the map
 * (src/lib/server/world.ts touch: the day's touches, a few a day on one player, a sneaky one may be followed by a bold
 * one, between a blocked pair it looks sent and never arrives). Made 触须之交 by it, the two of them see it at once.
 */
export async function touchMember(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()): Promise<TouchResult & { now: number }> {
  const h = handleOf(body.h);
  if (h === null || typeof body.bold !== "boolean") throw refuse(400, T.server.common.badRequest);
  const { mine, them } = await memberAt(user.id, h);
  const [main] = await db
    .select({ publicId: roaches.publicId })
    .from(roaches)
    .where(and(eq(roaches.userId, them.userId), eq(roaches.slot, 0)))
    .limit(1);
  if (!main) throw new WorldError(T.server.squad.noRoachToTouch);
  const res = await touch(user.id, main.publicId, body.bold);
  if (res.newFriend) {
    const tell: SquadTell = { t: "room", room: mine.room.id };
    tellSquad([user.id, them.userId], tell);
  }
  return { ...res, now };
}

// ---- the host's songs ----

/** Nothing new while the site is gray (全站变灰) or 听歌 is paused in the 管理台 */
function refuseSongsNow(now: number) {
  if (grayUntil(now)) throw refuse(403, T.server.listen.gray, LISTEN_GRAY);
  if (listenSettings().paused) throw refuse(503, T.server.listen.paused, LISTEN_PAUSED);
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

/** 停: nothing plays until the host starts it again, the one playing first then (what has played is dropped) */
function stopQueue(s: RoomSchedule, seconds: (id: string) => number, now: number): RoomSchedule | "same" {
  const at = roomAt(s, seconds, now);
  if (at.phase === "ready") return "same";
  const queue = at.phase === "playing" ? s.queue.slice(at.i) : s.queue.slice(-1);
  return { queue, idx: 0, startedAt: null, version: s.version + 1 };
}

/** A change to a room's songs, written and told to everyone in it; null when it changed nothing */
async function changeSongsIn(roomId: string, change: SquadSongChange, now: number): Promise<RoomSchedule | null> {
  const seconds = await secondsOf();
  const all = change === "random" ? [...(await songList()).byId.keys()] : [];
  const next = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    const s = scheduleOf(room);
    const edit: QueueEdit | "stop" = change === "random" ? { adds: pickAtRandom(all, new Set(room.queue), RANDOM_ADD) } : change;
    const next = edit === "stop" ? stopQueue(s, seconds, now) : changeQueue(s, edit, seconds, now);
    if (next === "noNext") throw refuse(409, T.server.listen.noNext);
    if (next === "full") throw refuse(409, fmt(T.server.listen.queueFull, { n: QUEUE_MAX }));
    if (next === "same") return null;
    await tx
      .update(squadRooms)
      .set({ queue: next.queue, idx: next.idx, startedAt: next.startedAt === null ? null : new Date(next.startedAt), version: next.version })
      .where(eq(squadRooms.id, roomId));
    return { next, playedBefore: s.startedAt !== null && roomAt(s, seconds, now).phase === "playing" };
  });
  if (!next) return null;
  const how: SquadSongHow = typeof change === "object" ? ("seek" in change ? "seek" : "add") : change === "random" ? "add" : change;
  // a song started: by 开始, ⏭, 重来, or added with none playing
  if (how === "start" || how === "next" || how === "restart" || (how === "add" && !next.playedBefore && next.next.startedAt !== null)) {
    countStat(COUNTED.squadPlay, 1, now);
  }
  forgetList();
  const rows = await hearersOf(roomId);
  const tell: SquadTell = { t: "songs", room: roomId, how, ...next.next };
  tellSquad(
    rows.map((r) => r.userId),
    tell,
  );
  return next.next;
}

/**
 * What the host does to the room's songs (src/lib/listen.ts changeQueue): start, next, restart, add a song, add
 * RANDOM_ADD at random (随机加: none already in its songs), go to a second of the one playing (seek), or 停 (stop).
 * Only where 听歌 is open to the host, not paused, and the site not gray.
 */
export async function changeSquadSongs(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  const change: SquadSongChange | null =
    body.start === true
      ? "start"
      : body.next === true
        ? "next"
        : body.restart === true
          ? "restart"
          : body.random === true
            ? "random"
            : body.stop === true
              ? "stop"
              : isSongId(body.add)
                ? { add: body.add }
                : isSeek(body.seek)
                  ? { seek: body.seek }
                  : null;
  if (!change) throw refuse(400, T.server.common.badRequest);
  if (!listenOpen(user)) throw refuse(403, T.server.squad.noMusic);
  refuseSongsNow(now);
  if (typeof change === "object" && "add" in change && !(await songOf(change.add))) throw refuse(404, T.server.listen.noSong, NO_SONG);
  const mine = await hostedBy(user.id);
  await changeSongsIn(mine.room.id, change, now);
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * 点歌: someone in the room (not its host, who plays what they like) asks for a song: REQUESTS_EACH waiting each at
 * most, one every REQUEST_EVERY_MS. The host alone is told, and takes it into the songs or drops it, unsaid.
 */
export async function requestSong(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseSongsNow(now);
  const song = await songOf(body.song);
  if (!song) throw refuse(404, T.server.listen.noSong, NO_SONG);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (mine.room.hostId === user.id) throw refuse(409, T.server.squad.hostAdds);
  if (!listenOpen(user)) throw refuse(403, T.server.squad.noMusic);
  await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    const waiting = await tx
      .select({ at: squadRequests.createdAt })
      .from(squadRequests)
      .where(and(eq(squadRequests.roomId, mine.room.id), eq(squadRequests.handle, mine.me.handle)))
      .orderBy(desc(squadRequests.createdAt));
    if (waiting.length >= REQUESTS_EACH) throw refuse(429, fmt(T.server.squad.asked, { n: waiting.length }));
    const last = waiting[0]?.at.getTime();
    if (last !== undefined && last > now - REQUEST_EVERY_MS) throw refuse(429, fmt(T.server.squad.askWait, { s: Math.ceil((last + REQUEST_EVERY_MS - now) / 1000) }));
    await tx.insert(squadRequests).values({ roomId: mine.room.id, handle: mine.me.handle, song: song.id, createdAt: new Date(now) });
  });
  const tell: SquadTell = { t: "room", room: mine.room.id, what: { kind: "ask" } };
  tellSquad([mine.room.hostId], tell);
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/** The host takes a song asked for (id) into the room's songs, or drops it (nobody told); either way it is no longer asked */
export async function answerRequest(user: UserRow, body: Record<string, unknown>, take: boolean, now = Date.now()) {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id < 1) throw refuse(400, T.server.common.badRequest);
  const mine = await hostedBy(user.id);
  const [asked] = await db
    .delete(squadRequests)
    .where(and(eq(squadRequests.id, id), eq(squadRequests.roomId, mine.room.id)))
    .returning({ song: squadRequests.song });
  if (!asked) throw refuse(409, T.server.squad.noRequest);
  if (take) {
    if (!listenOpen(user)) throw refuse(403, T.server.squad.noMusic);
    refuseSongsNow(now);
    if (!(await songOf(asked.song))) throw refuse(404, T.server.listen.noSong, NO_SONG);
    await changeSongsIn(mine.room.id, { add: asked.song }, now);
  }
  return { room: await roomView(mine.room.id, user.id, now), now };
}

// ---- 拉黑, 举报 ----

/**
 * Who has the number h in a room (sq:<room>:<h>), for 拉黑 and 举报 there (src/lib/server/safety.ts): only by someone
 * in it now, of anyone else in it now; with the room's 难度 and tags and TA's card there, for the case. Names show to
 * all in a room, so TA is known.
 */
export async function squadSender(userId: string, roomId: string, h: number) {
  if (!UUID.test(roomId) || handleOf(h) === null) return null;
  const rows = await db
    .select({ m: squadMembers, level: squadRooms.level, tags: squadRooms.tags, ended: squadRooms.endedAt })
    .from(squadMembers)
    .innerJoin(squadRooms, eq(squadRooms.id, squadMembers.roomId))
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
  const me = rows.find((r) => r.m.userId === userId);
  const them = rows.find((r) => r.m.handle === h && r.m.userId !== userId);
  if (!me || me.ended || !them) return null;
  return { other: them.m.userId, known: true, level: them.level, tags: them.tags, card: roomCard(them.m) };
}

/**
 * One blocked the other (拉黑, or 举报, which blocks too): in a room they are both in now, they part. Its host blocking
 * you asks you to leave for good (请出去, as TA would); otherwise the one who blocked leaves, so nobody can block someone
 * out of a room. Never in one room again (joinRoom), and neither sees the other's rooms on the list.
 */
export async function separateSquadBlocked(blockerId: string, blockedId: string, now = Date.now()) {
  const both = await db
    .select({ m: squadMembers, hostId: squadRooms.hostId })
    .from(squadMembers)
    .innerJoin(squadRooms, eq(squadRooms.id, squadMembers.roomId))
    .where(and(inArray(squadMembers.userId, [blockerId, blockedId]), isNull(squadMembers.leftAt), isNull(squadRooms.endedAt)));
  const a = both.find((r) => r.m.userId === blockerId);
  const b = both.find((r) => r.m.userId === blockedId);
  forgetLists();
  if (!a || !b || a.m.roomId !== b.m.roomId) return;
  if (a.hostId === blockerId) {
    await kickIn(a.m.roomId, blockerId, b.m.handle, now);
    return;
  }
  const left = await db.transaction(async (tx) => {
    await lockPlayer(tx, blockerId);
    return leaveIn(tx, blockerId, now);
  });
  await told(left);
  if (left) {
    const tell: SquadTell = { t: "you", room: a.m.roomId, why: "left" };
    tellSquad([blockerId], tell);
  }
}

// ---- the set lines ----

/**
 * A set line in the room you are in, by its number (src/lib/squad.ts isPhrase): one every SAY_EVERY_MS and
 * SAY_PER_HOUR an hour, counted in memory alone, and never written down but as how many a day. Those of a second go
 * out together (SAY_BATCH_MS) to everyone in the room. sent: false when it was one too many.
 */
export async function sayInRoom(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (!isPhrase(body.p)) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (!allow(`squad:sayEvery:${user.id}`, 1, SAY_EVERY_MS)) return { sent: false, now };
  if (!allow(`squad:sayHour:${user.id}`, SAY_PER_HOUR, HOUR)) return { sent: false, full: true, now };
  addSay(mine.room.id, mine.me.handle, body.p);
  countStat(COUNTED.squadSay, 1, now);
  return { sent: true, now };
}

function addSay(roomId: string, h: number, p: number) {
  let b = says.get(roomId);
  if (!b) {
    b = { items: [], timer: setTimeout(() => void flushSay(roomId), SAY_BATCH_MS) };
    b.timer.unref?.();
    says.set(roomId, b);
  }
  b.items.push({ h, p });
}

async function flushSay(roomId: string) {
  const b = says.get(roomId);
  says.delete(roomId);
  if (!b?.items.length) return;
  try {
    const rows = await hearersOf(roomId);
    const tell: SquadTell = { t: "say", room: roomId, items: b.items };
    tellSquad(
      rows.map((r) => r.userId),
      tell,
    );
  } catch (e) {
    console.error("squad: telling a room its lines failed", e);
  }
}

/** For tests: the lines waiting to go out now, gone */
export async function flushSaysNow() {
  for (const [roomId, b] of [...says]) {
    clearTimeout(b.timer);
    await flushSay(roomId);
  }
}

// ---- the list ----

type Snap = {
  id: string;
  hostId: string;
  server: string;
  level: number;
  tags: number[];
  state: SquadState;
  friendsOnly: boolean;
  at: number;
  keyAt: number;
  /** The host's songs, for ♪ 在放歌 */
  songs: RoomSchedule;
  members: { userId: string; h: number; name: string; avatar: string; color: string; card: SquadCard }[];
};

const snapHeld = (g.squadSnap ??= { at: -Infinity, rooms: null, loading: null });
const listsHeld = (g.squadLists ??= new Map());

/** The rooms open now, with who is in them, as this process read them at most SNAP_MS ago */
async function snapshot(now: number): Promise<Snap[]> {
  if (snapHeld.rooms && now - snapHeld.at < SNAP_MS && now >= snapHeld.at) return snapHeld.rooms;
  if (snapHeld.loading) return snapHeld.loading;
  const loading = (async () => {
    try {
      const rows = await db
        .select({
          r: squadRooms,
          m: squadMembers,
          u: { id: users.id, anonymous: users.anonymous, name: users.name, drPrefix: users.drPrefix, avatar: users.avatar, color: users.color },
        })
        .from(squadRooms)
        .innerJoin(squadMembers, and(eq(squadMembers.roomId, squadRooms.id), isNull(squadMembers.leftAt)))
        .innerJoin(users, eq(users.id, squadMembers.userId))
        .where(isNull(squadRooms.endedAt));
      const byRoom = new Map<string, Snap>();
      for (const { r, m, u } of rows) {
        let s = byRoom.get(r.id);
        if (!s) {
          s = {
            id: r.id,
            hostId: r.hostId,
            server: r.server,
            level: r.level,
            tags: r.tags,
            state: r.state as SquadState,
            friendsOnly: r.friendsOnly,
            at: r.createdAt.getTime(),
            keyAt: r.keyAt.getTime(),
            songs: scheduleOf(r),
            members: [],
          };
          byRoom.set(r.id, s);
        }
        s.members.push({
          userId: u.id,
          h: m.handle,
          name: displayName(u),
          avatar: drawnLook(u.avatar),
          color: ROACH_COLORS.find((c) => c === u.color) ?? "cyan",
          card: roomCard(m),
        });
      }
      for (const s of byRoom.values()) s.members.sort((a, b) => a.h - b.h);
      const rooms = [...byRoom.values()];
      snapHeld.rooms = rooms;
      snapHeld.at = now;
      return rooms;
    } finally {
      snapHeld.loading = null;
    }
  })();
  snapHeld.loading = loading;
  return loading;
}

/** Read the rooms again at the next list on this process (the others read them within SNAP_MS anyway) */
function forgetList() {
  snapHeld.rooms = null;
}

/** Each player's list made again at the next asking: who blocked whom changed */
function forgetLists() {
  forgetList();
  listsHeld.clear();
}

/** For tests: nothing kept */
export function forgetSquad() {
  forgetLists();
  hearersHeld.clear();
}

/**
 * Whether a teammate is named on the list to this viewer: only their own 触须之交 (the host always is). The one place
 * this is decided, as Breeze may want every name shown.
 */
const isNamed = (memberId: string, friends: Set<string>) => friends.has(memberId);

/**
 * Rooms waiting first: those with a 触须之交 of the viewer's first, then those missing fewest, and of those the one
 * whose key was pasted last (the likelier to work still); then those playing, the newest first
 */
function byOrder(a: SquadListRoom, b: SquadListRoom) {
  if (a.state !== b.state) return a.state === "wait" ? -1 : 1;
  if (a.state === "go") return b.at - a.at;
  if (a.friend !== b.friend) return a.friend ? -1 : 1;
  if (a.seats.length !== b.seats.length) return b.seats.length - a.seats.length;
  return b.keyAt - a.keyAt;
}

function listRoom(s: Snap, viewerId: string, friends: Set<string>, seconds: (id: string) => number, now: number): SquadListRoom {
  const host = s.members.find((m) => m.userId === s.hostId);
  const seats: SquadSeat[] = s.members.map((m) => {
    const role: SquadSeat["role"] = m.userId === s.hostId ? "host" : m.userId === viewerId ? "you" : isNamed(m.userId, friends) ? "friend" : "mate";
    return { role, ...(role === "friend" ? { name: m.name } : {}), ...m.card };
  });
  return {
    id: s.id,
    host: { name: host?.name ?? "", friend: friends.has(s.hostId), avatar: host?.avatar ?? "hood", color: host?.color ?? "cyan" },
    server: s.server,
    level: s.level,
    tags: s.tags,
    state: s.state,
    friendsOnly: s.friendsOnly,
    seats,
    at: s.at,
    keyAt: s.keyAt,
    music: s.songs.startedAt !== null && roomAt(s.songs, seconds, now).phase === "playing",
    friend: s.members.some((m) => m.userId !== viewerId && friends.has(m.userId)),
    mine: s.members.some((m) => m.userId === viewerId),
  };
}

/** The server a player's list is of when none is asked for: their 明日方舟 UID's, else 官服 */
const serverOf = (user: Pick<UserRow, "uidServerArknights">) => (isSquadServer(user.uidServerArknights) ? user.uidServerArknights : DEFAULT_SERVER);

/**
 * The list for this player (src/lib/squad.ts SquadList): the rooms of a server (as asked, else their own) and of one
 * 难度 (level, or all), cut from the snapshot for them; LIST_MAX at most. Asked again within LIST_MIN_MS, the same.
 * With an ETag over what it holds.
 */
export async function squadList(user: UserRow, query: { server?: unknown; level?: unknown }, now = Date.now()) {
  const server = isSquadServer(query.server) ? query.server : serverOf(user);
  const level = isLevel(query.level) ? query.level : null;
  const ask = `${server}|${level ?? ""}`;
  const last = listsHeld.get(user.id);
  if (last && last.key === ask && now - last.at < LIST_MIN_MS && now >= last.at) return last;
  const [rooms, friends, blocked, seconds] = await Promise.all([snapshot(now), friendIdsOf(user.id), blockedWith(user.id), secondsOf()]);
  const shown = rooms
    .filter((r) => r.server === server && (level === null || r.level === level))
    // nothing with anyone they blocked, or who blocked them, in it
    .filter((r) => !r.members.some((m) => blocked.has(m.userId)))
    // a room only for 触须之交, to the host's alone (and those in it)
    .filter((r) => !r.friendsOnly || friends.has(r.hostId) || r.members.some((m) => m.userId === user.id))
    .map((r) => listRoom(r, user.id, friends, seconds, now))
    .sort(byOrder)
    .slice(0, LIST_MAX);
  const s = squadSettings();
  const list: SquadList = { rooms: shown, server, closed: s.closed ? s.note : null, now };
  const etag = `"${createHash("sha1")
    .update(JSON.stringify({ rooms: shown, server, closed: list.closed }))
    .digest("base64url")
    .slice(0, 20)}"`;
  const held = { at: now, key: ask, list, etag };
  hold(listsHeld, user.id, held);
  return held;
}

// ---- the 管理台 ----

/** What the 管理台 shows of 一起卫戍: the switch, closed or not, rooms open now, and today's rooms, comings in and lines */
export async function squadDesk(now = Date.now()): Promise<SquadDesk> {
  const day = beijingDate(now);
  const names = [COUNTED.squadRoom, COUNTED.squadJoin, COUNTED.squadSay, COUNTED.squadPlay];
  const [open, counted] = await Promise.all([
    db.select({ state: squadRooms.state, n: count() }).from(squadRooms).where(isNull(squadRooms.endedAt)).groupBy(squadRooms.state),
    db
      .select({ name: statCounts.name, n: statCounts.n })
      .from(statCounts)
      .where(and(eq(statCounts.day, day), inArray(statCounts.name, names))),
  ]);
  // what this process counted and has not saved yet goes on top (another process's shows within a minute)
  const unsaved = unsavedStats();
  const today = (name: string) => Number(counted.find((r) => r.name === name)?.n ?? 0) + (unsaved.get(`${day}|${name}`) ?? 0);
  const s = squadSettings();
  return {
    mode: squadMode(),
    closed: s.closed,
    note: s.note,
    waiting: open.find((r) => r.state === "wait")?.n ?? 0,
    playing: open.find((r) => r.state === "go")?.n ?? 0,
    opened: today(COUNTED.squadRoom),
    joins: today(COUNTED.squadJoin),
    says: today(COUNTED.squadSay),
    plays: today(COUNTED.squadPlay),
  };
}

// ---- the sweep ----

/**
 * The main process, every minute: rooms end that waited WAIT_IDLE_MS with nobody coming or going, played GO_MAX_MS,
 * or were open LIFE_MS, and all of them while 一起卫戍 is closed for now; rooms over for KEEP_MS go, with who was in
 * them. Says how many ended.
 */
export async function sweepSquad(now = Date.now()) {
  const closed = squadSettings().closed;
  const open = await db.select().from(squadRooms).where(isNull(squadRooms.endedAt));
  let ended = 0;
  for (const room of open) {
    const ends = endsOf(room);
    const why: SquadEnd | null = closed ? "admin" : ends.at <= now ? ends.why : null;
    if (why && (await endSquadRoom(room.id, why, now))) ended += 1;
  }
  await db.delete(squadRooms).where(lt(squadRooms.endedAt, new Date(now - KEEP_MS)));
  return ended;
}
