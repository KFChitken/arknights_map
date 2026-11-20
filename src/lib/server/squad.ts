import "server-only";
import { createHash, randomInt } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { COUNTED } from "../dashboard";
import { SQUAD_TEMPLATE } from "../declarations";
import { INVITE_MS, QUIET_AFTER_LATER_MS } from "../listen";
import { displayName } from "../profile";
import { beijingDate } from "../beijing";
import { siteDay, siteDayStart } from "../siteDay";
import { fireEnd, playOn } from "../squadFire";
import { danceEnds, type SquadMode } from "../squadMode";
import {
  BOT_EXTRAS_MAX,
  BOT_SAY_EVERY_MS,
  cardNow,
  CORES,
  DEFAULT_SERVER,
  EXTRAS,
  extrasNow,
  findKey,
  GO_MAX_MS,
  isBotDo,
  isBotHandle,
  isLevel,
  isMove,
  isPhrase,
  isPose,
  isSquadServer,
  isTag,
  JOINS_PER_HOUR,
  KEEP_MS,
  KEY_CHANGES,
  KEY_EVERY_MS,
  LIFE_MS,
  LIST_MAX,
  MOVE_EVERY_MS,
  movesTo,
  NEED_CARD,
  NOT_IN_ROOM,
  NOT_READY,
  notYet,
  mayStart,
  OPEN_EVERY_MS,
  OPENS_PER_DAY,
  PHRASE_ROWS,
  POSE_EVERY_MS,
  POSES,
  POSES_PER_HOUR,
  PREFS_EVERY_MS,
  readCard,
  readRound,
  picksNow,
  ROOM_FULL,
  ROOM_GONE,
  ROOM_PLAYING,
  ROOM_SHUT,
  SAY_EVERY_MS,
  SAY_PER_HOUR,
  sameStrategy,
  SQUAD_CLOSED,
  SQUAD_MAX,
  STATE_EVERY_MS,
  STRATEGIES,
  STRATEGY_LOCKED,
  STRATEGY_TAKEN,
  TO,
  isToPhrase,
  TAGS_MAX,
  WAIT_IDLE_MS,
  type SquadBotDo,
  type SquadCall,
  type SquadCard,
  type SquadPicks,
  type SquadDesk,
  type SquadEnd,
  type SquadFriend,
  type SquadInvited,
  type SquadInviteSent,
  type SquadList,
  type SquadListRoom,
  type SquadMe,
  type SquadMember,
  type SquadMove,
  type SquadRoom,
  type SquadSeat,
  type SquadState,
  type SquadTell,
} from "../squad";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { WorldError, type InboxItem, type TouchResult } from "../world/types";
import { isModHere, isOwnerEmail } from "./admins";
import { blockedWith } from "./blocks";
import { canSeeDeclaration } from "./declarationInbox";
import { db } from "./db";
import { lockPlayer, type Exec } from "./guides";
import { asRoachPass, passesOffCards } from "./passes";
import { squadMode } from "./env";
import { HttpError } from "./http";
import { listenOpen } from "./listen";
import { nudge, onToldSquad, tellSquad } from "./live";
import { drawnLook } from "./looks";
import { allow } from "./rateLimit";
import { kickFromHostListen, squadListensPlaying, squadListenView } from "./listenRooms";
import { fishDays, fishLines, roaches, squadBots, squadInvites, squadMembers, squadRooms, statCounts, users, type UserRow } from "./schema";
import { grayUntil, listenSettings, squadSettings } from "./siteSettings";
import { songOf } from "./songs";
import { squadOpen, squadShown } from "./squadOpen";
import { countStat, unsavedStats } from "./stats";
import { cardsOf, declare, friendIdsOf, friendKey, touch } from "./world";

/**
 * 一起卫戍 on the server (src/lib/squad.ts), through src/app/api/squad/[op]. A host opens a room with the game's
 * 同盟密钥 and what it is for; others come in at it from the list, four at most, and see the key, each other's names
 * and the card each chose for the room (taken from their 卫戍名片, changed there for the room alone). Each readies
 * (准备) once in the game's alliance; the host starts a round when all are (开始游戏: closed, at the bottom of the
 * list), ends it (结束这局: open again, everyone readies anew), destroys the room (销毁房间), asks someone to leave for
 * good, and changes the key a few times. Whoever goes in is known in the room by a number of its own (handle), never
 * by an id, and by it is touched (碰), blocked or reported there (sq:<room>:<number>, src/lib/server/safety.ts). What
 * a room does goes to the phones in it at once (live.ts tellSquad, SquadTell): that it changed (each phone asks
 * again), the set lines of the last second, that it ended. The lines are never written down, only how many a day.
 *
 * A room ends when its host destroys or leaves it, opens another or goes in at another; when it waited WAIT_IDLE_MS
 * with nothing happening (endsOf), played GO_MAX_MS since its round started, or was open LIFE_MS, whether or not its
 * host's page is there (they play in the game meanwhile); and every room ends when it is closed for now in the 管理台.
 * KEEP_MS after, it is deleted with who was in it (sweepSquad, on the main process).
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

const cardOf = (u: Pick<UserRow, "squadCore" | "squadStrategy" | "squadLevel">) => cardNow(u.squadCore, u.squadStrategy, u.squadLevel);
/** A card as a room keeps it, read against this season */
/** One's picks in a room, as kept there */
const roomCard = (m: { core: number; strategy: number | null }): SquadPicks => picksNow(m.core, m.strategy);
/** What one brings into a room from their card: its picks, and no extras (those are marked for a round, 第 4 版) */
const intoRoom = (card: SquadCard) => ({ core: card.core, strategy: card.strategy, extras: [] as number[] });

// ---- 人机 (src/lib/squad.ts BOT_DOS) ----

type Bot = typeof squadBots.$inferSelect;

/** The 站长 or an admin: who may put 人机 in a room they host (as SQUAD=admins lets them in) */
const isStaff = (u: Pick<UserRow, "id" | "email">) => isOwnerEmail(u.email) || isModHere(u.id);

/** The 人机 in these rooms now (not asked to leave), by room, in the order they came */
async function botsIn(exec: Exec, roomIds: readonly string[]): Promise<Map<string, Bot[]>> {
  const out = new Map<string, Bot[]>();
  if (!roomIds.length) return out;
  const rows = await exec
    .select()
    .from(squadBots)
    .where(and(inArray(squadBots.roomId, [...roomIds]), isNull(squadBots.goneAt)))
    .orderBy(asc(squadBots.addedAt), desc(squadBots.handle));
  for (const b of rows) out.set(b.roomId, [...(out.get(b.roomId) ?? []), b]);
  return out;
}

const botsOf = async (exec: Exec, roomId: string) => (await botsIn(exec, [roomId])).get(roomId) ?? [];

/** The looks a 人机 comes in, at random: those anyone may pick on their card (鸭爵 is a thanks, never theirs) */
const BOT_LOOKS = ROACH_AVATARS.filter((a) => a !== "duck");

const botLook = (b: Pick<Bot, "avatar" | "color">) => ({ avatar: drawnLook(b.avatar), color: ROACH_COLORS.find((c) => c === b.color) ?? "cyan" });

/** A 人机 as the room shows it: after everyone else, known by its number below 0 */
const botMember = (b: Bot): SquadMember => ({
  h: b.handle,
  name: fmt(T.squad.bot.name, { n: b.no }),
  ...botLook(b),
  host: false,
  you: false,
  friend: false,
  inGame: b.inGame,
  pose: isPose(b.pose) ? b.pose : 0,
  ...roomCard(b),
  extras: extrasNow(b.extras),
  bot: true,
});

const pickOne = <V>(list: readonly V[]): V => list[randomInt(list.length)];

/** n of these at random, each once */
function pickSome<V>(list: readonly V[], n: number): V[] {
  const left = [...list];
  const out: V[] = [];
  while (out.length < n && left.length) out.push(left.splice(randomInt(left.length), 1)[0]);
  return out;
}

/** A strategy of this season at random that none in the room has, nor the one it had (none left: none) */
function freeStrategy(taken: readonly (number | null)[], had: number | null = null): number | null {
  const free = STRATEGIES.filter((s) => !s.gone && s.id !== had && !taken.some((t) => sameStrategy(t, s.id)));
  return free.length ? pickOne(free).id : null;
}

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
export async function roomOf(exec: Exec, userId: string) {
  const [r] = await exec
    .select({ room: squadRooms, me: squadMembers })
    .from(squadMembers)
    .innerJoin(squadRooms, eq(squadRooms.id, squadMembers.roomId))
    .where(and(eq(squadMembers.userId, userId), isNull(squadMembers.leftAt), isNull(squadRooms.endedAt)));
  return r ?? null;
}

/** Whether 卫戍的一起听 shows to this player: 听歌 open to them, not paused in the 管理台, the site not gray */
const hearFor = (user: Pick<UserRow, "id" | "email">, now: number) => listenOpen(user) && !listenSettings().paused && !grayUntil(now);

/**
 * What a page of before (with the host's own songs, gone since 卫戍的一起听) reads in a room: nothing playing, nothing
 * asked for, the songs' bar not shown (dj)
 */
const SONGS_BEFORE = { dj: false, queue: [] as string[], idx: 0, startedAt: null, version: 0, requests: [] as never[], listening: null };

/** When a room ends by itself unless something happens (someone in or out, ready or picks changed, a new key, a round ended), and why it would */
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
type Moved = { h: number; move: SquadMove; to?: number };
/** The lines said and moves done in a room in the last SAY_BATCH_MS, told to it at once */
type Fished = { h: number; no: number; variant: number; cm: number | null };
type Thrown = Extract<SquadTell, { t: "throw" }>["items"][number];
type Danced = Extract<SquadTell, { t: "dance" }>["items"][number];
type Said = {
  items: { h: number; p: number; to?: number }[];
  moves: Moved[];
  fish?: Fished[];
  throws?: Thrown[];
  dance?: Danced[];
  timer: ReturnType<typeof setTimeout>;
};
const g = globalThis as unknown as {
  squadHearers?: Map<string, { at: number; rows: Hearer[] }>;
  squadSays?: Map<string, Said>;
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

/** For 篝火 (src/lib/server/squadPlay.ts): tell the room a stick went on, or one's roach was woken by 白开水 (pose) */
export const tellSquadPlay = (roomId: string, what: Extract<SquadTell, { t: "room" }>["what"]) => tellRoom(roomId, what);

/** For 扔东西 (src/lib/server/squadPlay.ts): told to the whole room with the next batch */
export function throwInRoom(roomId: string, thrown: Thrown) {
  (batchOf(roomId).throws ??= []).push(thrown);
}

/** For 龙门广场舞 (src/lib/server/squadModes.ts): a tap, told to the whole room with the next batch (the latest of each one's) */
export function danceInRoom(roomId: string, danced: Danced) {
  const batch = batchOf(roomId);
  const b: Danced[] = (batch.dance ??= []);
  const i = b.findIndex((d) => d.h === danced.h);
  if (i >= 0) b.splice(i, 1);
  b.push(danced);
}

/** For 卫戍池塘 (src/lib/server/fish.ts): tell the room someone's line went in or came out, or a 鱼群 came */
export const tellSquadPond = (roomId: string, h?: number) => tellRoom(roomId, { kind: "pond", ...(h === undefined ? {} : { h }) });

/** For 卫戍池塘: purple or better caught there by the one with the number h, said to the whole room with the next batch */
export function sayFishInRoom(roomId: string, fished: Fished) {
  (batchOf(roomId).fish ??= []).push(fished);
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
  const bots = await botsOf(db, roomId);
  // the pass each wears (cardsOf: only to a viewer 寻访 shows to), hung on their card in the room as on the map's, unless they keep it off
  const offCards = await passesOffCards(rows.flatMap((r) => (cards.get(r.u.id)?.pass ? [r.u.id] : [])));
  const people: SquadMember[] = rows
    .sort((a, b) => a.m.handle - b.m.handle)
    .map(({ m, u }) => {
      const card = cards.get(u.id)!;
      const pass = card.pass && !offCards.has(u.id) ? asRoachPass(card.pass) : null;
      return {
        h: m.handle,
        name: card.displayName,
        avatar: card.avatar,
        color: card.color,
        host: u.id === room.hostId,
        you: u.id === viewerId,
        friend: friends.has(u.id),
        inGame: m.inGame,
        pose: isPose(m.pose) ? m.pose : 0,
        ...roomCard(m),
        extras: extrasNow(m.extras),
        ...(pass ? { pass } : {}),
      };
    });
  // 卫戍池塘: who has a line in it, the 鳞 of this 局, today's 空军司令
  const ids = rows.map((r) => r.u.id);
  const [inPond, admirals] = await Promise.all([
    db.select({ userId: fishLines.userId }).from(fishLines).where(and(inArray(fishLines.userId, ids), eq(fishLines.spot, "pond"))),
    db.select({ userId: fishDays.userId }).from(fishDays).where(and(inArray(fishDays.userId, ids), eq(fishDays.day, siteDay(now)), eq(fishDays.admiral, true))),
  ]);
  const fishing = new Set(inPond.map((r) => r.userId));
  const admiral = new Set(admirals.map((r) => r.userId));
  for (const [i, { m, u }] of rows.sort((a, b) => a.m.handle - b.m.handle).entries()) {
    if (fishing.has(u.id)) people[i].fishing = true;
    if (m.fishN) people[i].fishN = m.fishN;
    if (admiral.has(u.id)) people[i].admiral = true;
    // 篝火's sticks, yours alone; 扔东西: what of it stays on each, while it does
    if (u.id === viewerId) Object.assign(people[i], { wood: m.wood, woodAt: m.woodAt?.getTime() ?? null });
    Object.assign(people[i], playOn(m, now));
    if (u.squadNoThrow) people[i].noThrow = true;
  }
  // the 人机 after everyone else
  const members = [...people, ...bots.map(botMember)];
  const ends = endsOf(room);
  // your own invitations to it, the latest to each not in it, never one TA went in at
  const sent = await db
    .select({ i: squadInvites, u: users })
    .from(squadInvites)
    .innerJoin(users, eq(users.id, squadInvites.toUserId))
    .where(and(eq(squadInvites.roomId, roomId), eq(squadInvites.fromUserId, viewerId)))
    .orderBy(desc(squadInvites.createdAt));
  const latest = new Map<string, (typeof sent)[number]>();
  for (const s of sent) if (!latest.has(s.u.id)) latest.set(s.u.id, s);
  const out = [...latest.values()].filter((s) => s.i.answer !== "joined" && !rows.some((r) => r.u.id === s.u.id));
  const theirCards = await cardsOf(
    out.map((s) => s.u),
    viewerId,
  );
  const invited: SquadInvited[] = out.map(({ i, u }) => ({
    card: theirCards.get(u.id)!,
    state: !i.answer && i.createdAt.getTime() > now - INVITE_MS ? "waiting" : "missed",
  }));
  const viewer = rows.find((r) => r.u.id === viewerId)!.u;
  // 卫戍的一起听, to one 听歌 is open to
  const hear = hearFor(viewer, now);
  const listen = hear
    ? await squadListenView(
        room,
        rows.map((r) => ({ userId: r.u.id, h: r.m.handle })),
        viewerId,
        now,
      )
    : null;
  return {
    ...SONGS_BEFORE,
    declared: Boolean(room.declaredAt),
    invited,
    hear,
    listen,
    id: room.id,
    server: room.server,
    level: room.level,
    tags: room.tags,
    state: room.state as SquadState,
    friendsOnly: room.friendsOnly,
    stopped: Boolean(room.stoppedAt),
    key: room.key,
    keyAt: room.keyAt.getTime(),
    keyLeft: Math.max(0, KEY_CHANGES - room.keyChanges),
    you: me.handle,
    host: room.hostId === viewerId,
    staff: isStaff(viewer),
    members,
    wentAt: room.state === "go" && room.wentAt ? room.wentAt.getTime() : null,
    ...(room.schoolUntil && room.schoolUntil.getTime() > now ? { school: room.schoolUntil.getTime() } : {}),
    fire: { level: room.fireLevel, at: room.fireAt?.getTime() ?? now, by: room.fireBy, best: room.fireBest, last: room.fireLast },
    mode: await modeView(room, rows, now),
    ...(me.modeAgainAt && me.modeAgainAt.getTime() > now ? { modeAgain: me.modeAgainAt.getTime() } : {}),
    endsAt: ends.at,
    endsWhy: ends.why,
    now,
  };
}

/**
 * 玩点什么's mode as the room's pages have it (src/lib/squadMode.ts), while it plays (one over is cleared by the next
 * request to it, or the sweep: src/lib/server/squadModes.ts); those in it in their numbers' order
 */
async function modeView(room: typeof squadRooms.$inferSelect, rows: { m: typeof squadMembers.$inferSelect }[], now: number): Promise<SquadMode | null> {
  if (room.mode !== "dance" || !room.modeAt || !room.modeSong || !room.modeSongAt || !room.modeUntil || !room.modeLast) return null;
  const endsAt = danceEnds(room.modeUntil.getTime(), room.modeLast.getTime());
  if (endsAt <= now) return null;
  return {
    kind: "dance",
    by: room.modeBy ?? 0,
    at: room.modeAt.getTime(),
    in: rows
      .filter((r) => r.m.modeIn)
      .sort((a, b) => a.m.handle - b.m.handle)
      .map((r) => ({ h: r.m.handle, combo: r.m.modeCombo })),
    endsAt,
    song: room.modeSong,
    name: (await songOf(room.modeSong))?.name ?? "",
    songAt: room.modeSongAt.getTime(),
    until: room.modeUntil.getTime(),
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
  return {
    card: cardOf(user),
    showName: user.squadShowName,
    noThrow: user.squadNoThrow,
    room: Boolean(await roomOf(db, user.id)),
    closed: s.closed ? s.note : null,
  };
}

// ---- 卫戍名片 ----

/**
 * The player's 卫戍名片, as given (card), kept for the rooms they open or go in at from now on; null clears it, and
 * 列表上显示我的名字 with it. showName, when given: that switch, which the lists follow from their next asking.
 * noThrow, when given: 别人扔我 turned off (true) or on, kept whatever the card (clearing it leaves it as it is).
 */
export async function saveCard(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (body.showName !== undefined && typeof body.showName !== "boolean") throw refuse(400, T.server.common.badRequest);
  if (body.noThrow !== undefined && typeof body.noThrow !== "boolean") throw refuse(400, T.server.common.badRequest);
  const noThrow = typeof body.noThrow === "boolean" ? { squadNoThrow: body.noThrow } : {};
  if (body.card === null) {
    const [kept] = await db
      .update(users)
      .set({ squadCore: null, squadStrategy: null, squadLevel: null, squadShowName: false, ...noThrow })
      .where(eq(users.id, user.id))
      .returning({ noThrow: users.squadNoThrow });
    forgetList();
    return { card: null, showName: false, noThrow: kept?.noThrow ?? false, now };
  }
  const card = readCard(body.card);
  if (!card) throw refuse(400, T.server.common.badRequest);
  const showName = typeof body.showName === "boolean" ? body.showName : undefined;
  const [saved] = await db
    .update(users)
    .set({ squadCore: card.core, squadStrategy: card.strategy, squadLevel: card.level, ...(showName === undefined ? {} : { squadShowName: showName }), ...noThrow })
    .where(eq(users.id, user.id))
    .returning({ showName: users.squadShowName, noThrow: users.squadNoThrow });
  if (showName !== undefined) forgetList();
  return { card, showName: saved?.showName ?? false, noThrow: saved?.noThrow ?? false, now };
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

/** End a room (the host's 销毁房间, the sweep, the 管理台) and tell everyone in it */
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
    await tx.insert(squadMembers).values({ roomId: room.id, userId: user.id, handle: 1, joinedAt: at, ...intoRoom(card) });
    return { id: room.id, left };
  });
  await told(left);
  forgetList();
  countStat(COUNTED.squadRoom, 1, now);
  return { room: await roomView(id, user.id, now), now };
}

/**
 * In at a room from the list (room: its id), with the 卫戍名片 as this room's card: while it waits for players
 * and is not full; never one asked to leave it, nor with anyone in it either has blocked; one only for 触须之交, only
 * by a 触须之交 of its host. JOINS_PER_HOUR rooms an hour at most. Out of the room they were in first.
 */
export async function joinRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseClosed();
  const card = cardOf(user);
  if (!card) throw refuse(409, T.server.squad.needCard, NEED_CARD);
  const called = await calledTo(user.id, body, now);
  const roomId = called.roomId;
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
    // 停止加入: nobody, from the list, an invitation or a 宣言招人, nor one who was in it before
    if (room.stoppedAt) throw refuse(403, T.server.squad.stopped, ROOM_SHUT);
    if (room.state !== "wait") throw refuse(409, T.server.squad.playing, ROOM_PLAYING);
    const rows = await tx.select().from(squadMembers).where(eq(squadMembers.roomId, room.id));
    const mine = rows.find((m) => m.userId === user.id);
    if (mine?.kicked) throw refuse(403, T.server.squad.shut, ROOM_SHUT);
    const inNow = rows.filter((m) => !m.leftAt);
    if (inNow.some((m) => blocked.has(m.userId))) throw refuse(403, T.server.squad.shut, ROOM_SHUT);
    // an invitation lets one in where only the host's 触须之交 may come (it was someone in it who asked TA)
    if (room.friendsOnly && !friends.has(room.hostId) && !called.invite) throw refuse(403, T.server.squad.friendsOnly, ROOM_SHUT);
    // the 人机 in it take seats as anyone does
    if (inNow.length + (await botsOf(tx, room.id)).length >= SQUAD_MAX) throw refuse(409, T.server.squad.full, ROOM_FULL);
    const left = await leaveIn(tx, user.id, now);
    const at = new Date(now);
    let handle: number;
    if (mine) {
      handle = mine.handle;
      await tx
        .update(squadMembers)
        .set({ leftAt: null, joinedAt: at, inGame: false, ...intoRoom(card) })
        .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id)));
    } else {
      handle = rows.reduce((h, m) => Math.max(h, m.handle), 0) + 1;
      await tx.insert(squadMembers).values({ roomId: room.id, userId: user.id, handle, joinedAt: at, ...intoRoom(card) });
    }
    await tx.update(squadRooms).set({ movedAt: at }).where(eq(squadRooms.id, room.id));
    if (called.invite) {
      await tx
        .update(squadInvites)
        .set({ answer: "joined", answeredAt: at, seenAt: sql`coalesce(${squadInvites.seenAt}, now())` })
        .where(eq(squadInvites.id, called.invite));
    }
    return { left, handle };
  });
  await told(left);
  forgetList();
  countStat(COUNTED.squadJoin, 1, now);
  if (called.declaration) countStat(COUNTED.squadJoinDecl, 1, now);
  await tellRoom(roomId, { kind: "in", h: handle });
  const room = await roomView(roomId, user.id, now);
  if (!room) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
  return { room, now };
}

/**
 * The room one goes in at: from the list (room), an invitation to them still good (invite), or a 宣言招人 they see in
 * 消息 now (declaration, src/lib/server/declarationInbox.ts)
 */
async function calledTo(
  userId: string,
  body: Record<string, unknown>,
  now: number,
): Promise<{ roomId: string; invite: string | null; declaration: boolean }> {
  if (body.declaration !== undefined) {
    const id = uuid(body.declaration);
    const d = id ? await canSeeDeclaration(userId, id, now) : null;
    if (!d || d.template !== SQUAD_TEMPLATE) throw refuse(404, T.server.squad.declarationGone, ROOM_GONE);
    if (!d.squadRoomId) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    return { roomId: d.squadRoomId, invite: null, declaration: true };
  }
  if (body.invite !== undefined) {
    const id = uuid(body.invite);
    const [invite] = id
      ? await db
          .select()
          .from(squadInvites)
          .where(and(eq(squadInvites.id, id), eq(squadInvites.toUserId, userId)))
      : [];
    if (!invite || invite.createdAt.getTime() <= now - INVITE_MS) throw refuse(410, T.server.squad.inviteGone, ROOM_GONE);
    return { roomId: invite.roomId, invite: invite.id, declaration: false };
  }
  const roomId = uuid(body.room);
  if (!roomId) throw refuse(400, T.server.common.badRequest);
  return { roomId, invite: null, declaration: false };
}

/**
 * Out of the room you are in: anyone else's goes on without you; the host's ends, unless they hand it to one in it
 * first (to: TA's number there), who is its host from then on (its key, 开始游戏, everything a host does; 卫戍的一起听
 * stays the old host's own, the room's again once the new host invites it), the room going on as it was, whether it
 * waits or plays. A 人机 never hosts.
 */
export async function leaveRoom(user: Pick<UserRow, "id">, body: Record<string, unknown> = {}, now = Date.now()) {
  if (body.to !== undefined) return handOver(user, body.to, now);
  const left = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    return leaveIn(tx, user.id, now);
  });
  await told(left);
  return { now };
}

/** The host hands the room to the one numbered to, and leaves it; told to the room */
async function handOver(user: Pick<UserRow, "id">, to: unknown, now: number) {
  if (isBotHandle(to)) throw refuse(409, T.server.squad.botNoHost);
  const h = handleOf(to);
  if (h === null) throw refuse(400, T.server.common.badRequest);
  const mine = await hostedBy(user.id);
  const roomId = mine.room.id;
  const handed = await db.transaction(async (tx) => {
    await lockPlayer(tx, user.id);
    // after any coming in or going at once, as they count it (joinRoom, kickIn)
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    if (room.hostId !== user.id) throw refuse(403, T.server.squad.notHost);
    const [them] = await tx
      .select()
      .from(squadMembers)
      .where(and(eq(squadMembers.roomId, roomId), eq(squadMembers.handle, h), isNull(squadMembers.leftAt)));
    if (!them || them.userId === user.id) throw refuse(409, T.server.squad.notThere);
    const at = new Date(now);
    await tx.update(squadRooms).set({ hostId: them.userId, movedAt: at }).where(eq(squadRooms.id, roomId));
    await tx
      .update(squadMembers)
      .set({ leftAt: at })
      .where(and(eq(squadMembers.roomId, roomId), eq(squadMembers.userId, user.id)));
    return them.handle;
  });
  forgetList();
  await tellRoom(roomId, { kind: "host", h: handed });
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
 * The host's 开始游戏 (go: closed, at the bottom of the list; only with someone in it, everyone else ready and no two
 * strategies the same, src/lib/squad.ts notYet), 结束这局 (wait: open again, everyone readying again for the next) and
 * 销毁房间 (end). Between the first two every STATE_EVERY_MS at most.
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
    if (room.state === to) return false;
    if (room.stateAt && room.stateAt.getTime() > now - STATE_EVERY_MS) throw refuse(429, T.server.squad.tooFast);
    const others = and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), ne(squadMembers.userId, room.hostId));
    if (to === "go") {
      // someone with the host, everyone else ready, no two strategies the same
      const rows = await tx.select().from(squadMembers).where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)));
      const bots = await botsOf(tx, room.id);
      const blocks = notYet([
        ...rows.map((m) => ({ host: m.userId === room.hostId, inGame: m.inGame, strategy: roomCard(m).strategy })),
        ...bots.map((b) => ({ host: false, inGame: b.inGame, strategy: roomCard(b).strategy })),
      ]);
      if (!mayStart(blocks)) throw refuse(409, T.server.squad.notReady, NOT_READY);
    } else {
      // the round over: everyone readies again for the next, and marks its extras anew (the picks stay)
      await tx.update(squadMembers).set({ inGame: false }).where(others);
      await tx
        .update(squadMembers)
        .set({ extras: [] })
        .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)));
      // the 人机 are ready again at once
      await tx
        .update(squadBots)
        .set({ inGame: true, extras: [] })
        .where(and(eq(squadBots.roomId, room.id), isNull(squadBots.goneAt)));
      // 卫戍池塘: a new 局 from here, its 鳞 counted and its 鱼群 come anew
      await tx
        .update(squadMembers)
        .set({ fishN: 0 })
        .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)));
    }
    const at = new Date(now);
    // 篝火: how long it burnt this 局, the room's longest kept; the fire goes on into the next as it is
    const fire = fireEnd({ level: room.fireLevel, at: room.fireAt?.getTime() ?? null, burn: room.fireBurn }, now);
    const ended = {
      waitedAt: at,
      schools: 0,
      schoolUntil: null,
      fireLevel: fire.level,
      fireAt: fire.at === null ? null : new Date(fire.at),
      fireBurn: fire.burn,
      fireLast: fire.burnt,
      fireBest: Math.max(room.fireBest, fire.burnt),
    };
    await tx
      .update(squadRooms)
      .set({ state: to, stateAt: at, ...(to === "go" ? { wentAt: at } : ended) })
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
    // a new alliance in the game: everyone but the host goes in again, and readies again
    await tx
      .update(squadMembers)
      .set({ inGame: false })
      .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), ne(squadMembers.userId, room.hostId)));
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

/** The room the player is in, with the 人机 numbered h in it */
async function withBot(userId: string, h: number) {
  const mine = await roomOf(db, userId);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (!(await botsOf(db, mine.room.id)).some((b) => b.handle === h)) throw refuse(409, T.server.squad.notThere);
  return mine;
}

/**
 * 请出去: the host asks someone in the room to leave it (h), for good, while it waits (not once a round has started);
 * TA alone is told so. A 人机 (h below 0) goes as its own, whenever.
 */
export async function kickMember(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (isBotHandle(body.h)) {
    const mine = await hostedBy(user.id);
    await botDoes(mine.room.id, body.h, "kick", now);
    return { room: await roomView(mine.room.id, user.id, now), now };
  }
  const h = handleOf(body.h);
  if (h === null) throw refuse(400, T.server.common.badRequest);
  const mine = await hostedBy(user.id);
  // once the round has started, nobody is asked out till it ends (a 人机 still may be, above)
  if (mine.room.state === "go") throw refuse(409, T.server.squad.noKickPlaying, ROOM_PLAYING);
  const them = await kickIn(mine.room.id, user.id, h, now);
  if (!them) throw refuse(409, T.server.squad.notThere);
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * 停止加入 (on) and 恢复加入: the host keeps everyone else out of the room, from the list, invitations and 宣言招人
 * alike (joinRoom), whether it waits or plays, till they let them in again; those in it go on as before. It counts as
 * something happening, and the room is told.
 */
export async function setStopped(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (typeof body.on !== "boolean") throw refuse(400, T.server.common.badRequest);
  const on = body.on;
  const mine = await hostedBy(user.id);
  const [changed] = await db
    .update(squadRooms)
    .set({ stoppedAt: on ? new Date(now) : null, movedAt: new Date(now) })
    .where(and(eq(squadRooms.id, mine.room.id), isNull(squadRooms.endedAt), on ? isNull(squadRooms.stoppedAt) : sql`${squadRooms.stoppedAt} is not null`))
    .returning({ id: squadRooms.id });
  if (changed) {
    forgetList();
    await tellRoom(mine.room.id, { kind: "stop", on });
  }
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * Out for good, by its host: the one with the number h in the room (never the host), or null when nobody is; out of
 * the host's 一起听 too, when TA is in it (卫戍的一起听)
 */
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
    return them.userId;
  });
  if (!gone) return null;
  await kickFromHostListen(hostId, gone, now).catch((e) => console.error("squad: asking someone out of the host's 一起听 failed", e));
  forgetList();
  const tell: SquadTell = { t: "you", room: roomId, why: "kicked" };
  tellSquad([gone], tell);
  await tellRoom(roomId);
  return gone;
}

/**
 * 人机 in the room the player hosts (src/lib/squad.ts BOT_DOS), for the 站长 and the admins alone (do): add one to an
 * empty seat while it waits (add), ready from the start, its look and picks at random (a strategy nobody in it has, a
 * core alliance, 0–BOT_EXTRAS_MAX 附加盟约); or, of the one with the number h: tick its 准备 (ready), give it another
 * strategy nobody has (strategy), have it say a line (say: 组队 or 开局 while it waits, 局内 while it plays; from the
 * room's 人机 one every BOT_SAY_EVERY_MS), change its pose or wave (pose), ask it to leave (kick). Told to the room as
 * anyone's is; nothing of theirs is counted.
 */
export async function botInRoom(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  const what = body.do;
  if (!isBotDo(what) || (what !== "add" && !isBotHandle(body.h))) throw refuse(400, T.server.common.badRequest);
  if (!isStaff(user)) throw refuse(403, T.server.squad.botsStaff);
  const mine = await hostedBy(user.id);
  if (what === "add") await addBot(mine.room.id, now);
  else await botDoes(mine.room.id, body.h as number, what, now);
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/** A 人机 in an empty seat of a room waiting for players: its number the next below 0, its name's the smallest free */
async function addBot(roomId: string, now: number) {
  const h = await db.transaction(async (tx) => {
    // after any coming in at once, as they count it (joinRoom)
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    if (room.state !== "wait") throw refuse(409, T.server.squad.notWaiting, ROOM_PLAYING);
    if (room.stoppedAt) throw refuse(409, T.server.squad.botStopped, ROOM_SHUT);
    const members = await tx.select().from(squadMembers).where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
    const all = await tx.select().from(squadBots).where(eq(squadBots.roomId, roomId));
    const bots = all.filter((b) => !b.goneAt);
    if (members.length + bots.length >= SQUAD_MAX) throw refuse(409, T.server.squad.full, ROOM_FULL);
    const used = new Set(bots.map((b) => b.no));
    let no = 1;
    while (used.has(no)) no += 1;
    const handle = -(all.length + 1);
    const at = new Date(now);
    await tx.insert(squadBots).values({
      roomId,
      handle,
      no,
      avatar: pickOne(BOT_LOOKS),
      color: pickOne(ROACH_COLORS),
      core: pickOne(CORES.filter((c) => !c.gone)).id,
      strategy: freeStrategy([...members, ...bots].map((m) => roomCard(m).strategy)),
      extras: pickSome(
        EXTRAS.filter((x) => !x.gone).map((x) => x.id),
        randomInt(BOT_EXTRAS_MAX + 1),
      ),
      addedAt: at,
    });
    await tx.update(squadRooms).set({ movedAt: at }).where(eq(squadRooms.id, roomId));
    return handle;
  });
  forgetList();
  await tellRoom(roomId, { kind: "in", h });
}

type RoomWhat = Extract<SquadTell, { t: "room" }>["what"];

/** What a 人机 in the room (h) does at its host's tap, or by itself from the host's page (BOT_ACT_MS) */
async function botDoes(roomId: string, h: number, what: Exclude<SquadBotDo, "add">, now: number) {
  // what the room is told (what: undefined, only that it changed), and whether the list shows it changed
  const done = await db.transaction(async (tx): Promise<{ what: RoomWhat; list: boolean } | null> => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    const [bot] = await tx
      .select()
      .from(squadBots)
      .where(and(eq(squadBots.roomId, roomId), eq(squadBots.handle, h), isNull(squadBots.goneAt)));
    if (!bot) throw refuse(409, T.server.squad.notThere);
    const at = new Date(now);
    const it = and(eq(squadBots.roomId, roomId), eq(squadBots.handle, h));
    const moved = () => tx.update(squadRooms).set({ movedAt: at }).where(eq(squadRooms.id, roomId));
    if (what === "say") {
      if (!allow(`squad:botSay:${roomId}`, 1, BOT_SAY_EVERY_MS)) throw refuse(429, T.server.squad.tooFast);
      const rows = room.state === "go" ? ["fight"] : ["team", "open"];
      addSay(roomId, h, pickOne(PHRASE_ROWS.filter(([row]) => rows.includes(row)).flatMap(([, ids]) => ids)));
      return null;
    }
    if (what === "pose") {
      // another pose, or a wave (挥手, done once)
      const next = pickOne([...POSES.filter((p) => p !== bot.pose), "wave" as const]);
      if (next === "wave") {
        batchOf(roomId).moves.push({ h, move: "wave" });
        return null;
      }
      await tx.update(squadBots).set({ pose: next }).where(it);
      return { what: { kind: "pose", h, pose: next }, list: false };
    }
    if (what === "ready") {
      await tx.update(squadBots).set({ inGame: !bot.inGame }).where(it);
      await moved();
      return { what: bot.inGame ? undefined : { kind: "game", h }, list: false };
    }
    if (what === "strategy") {
      if (room.state === "go" && bot.strategy !== null) throw refuse(409, T.server.squad.strategyLocked, STRATEGY_LOCKED);
      const members = await tx.select().from(squadMembers).where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
      const others = (await botsOf(tx, roomId)).filter((b) => b.handle !== h);
      const strategy = freeStrategy(
        [...members, ...others].map((m) => roomCard(m).strategy),
        bot.strategy,
      );
      await tx.update(squadBots).set({ strategy }).where(it);
      await moved();
      return { what: { kind: "round", h, round: { ...roomCard({ core: bot.core, strategy }), extras: extrasNow(bot.extras) } }, list: true };
    }
    await tx.update(squadBots).set({ goneAt: at }).where(it);
    await moved();
    return { what: undefined, list: true };
  });
  if (!done) return;
  if (done.list) forgetList();
  await tellRoom(roomId, done.what);
}

/** 准备 (on: in the game's alliance and ready), ticked by the player for everyone in the room to see; told to them when it comes on */
export async function setInGame(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (typeof body.on !== "boolean") throw refuse(400, T.server.common.badRequest);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (mine.me.inGame !== body.on) {
    await db
      .update(squadMembers)
      .set({ inGame: body.on })
      .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.userId, user.id)));
    // something happening: the wait starts over
    await db.update(squadRooms).set({ movedAt: new Date(now) }).where(eq(squadRooms.id, mine.room.id));
    await tellRoom(mine.room.id, body.on ? { kind: "game", h: mine.me.handle } : undefined);
  }
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/**
 * The player's picks in this room alone, their 卫戍名片 as it was: round (SquadRound) from a page of now, card (the
 * picks alone) from one of before. Never a strategy someone else in it has (sameStrategy, a 人机's too: 409
 * STRATEGY_TAKEN), counted inside the room's lock; none (无偏好) always. While it waits, the core alliance and the
 * strategy; while a round plays (这局), the 附加盟约 too, and the strategy is locked till 结束这局 (409
 * STRATEGY_LOCKED): one who has none may fill one in (补位), once. Every PREFS_EVERY_MS at most.
 */
export async function setPrefs(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const round = readRound(body.round ?? body.card);
  if (!round) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (!allow(`squad:prefsEvery:${user.id}`, 1, PREFS_EVERY_MS)) throw refuse(429, T.server.squad.tooFast);
  const told = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, mine.room.id)).for("update");
    if (!room || room.endedAt) throw refuse(410, T.server.squad.roomGone, ROOM_GONE);
    const playing = room.state === "go";
    const [self] = await tx.select().from(squadMembers).where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id)));
    if (!self || self.leftAt) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
    const had = roomCard(self).strategy;
    if (round.strategy !== null && round.strategy !== had) {
      const others = await tx
        .select()
        .from(squadMembers)
        .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), ne(squadMembers.userId, user.id)));
      const bots = await botsOf(tx, room.id);
      if ([...others, ...bots].some((o) => sameStrategy(round.strategy, roomCard(o).strategy))) throw refuse(409, T.server.squad.strategyTaken, STRATEGY_TAKEN);
    }
    // a round playing: the strategy stays as it is (none may be filled in once)
    if (playing && had !== null && round.strategy !== had) throw refuse(409, T.server.squad.strategyLocked, STRATEGY_LOCKED);
    // a page of before sends no extras: those marked stay
    const extras = playing && body.round !== undefined ? round.extras : null;
    const [me] = await tx
      .update(squadMembers)
      .set({ core: round.core, strategy: round.strategy, ...(extras ? { extras } : {}) })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.userId, user.id)))
      .returning();
    // something happening: the wait starts over
    await tx.update(squadRooms).set({ movedAt: new Date(now) }).where(eq(squadRooms.id, room.id));
    return { ...roomCard(me), extras: extrasNow(me.extras) };
  });
  forgetList();
  await tellRoom(mine.room.id, { kind: "round", h: mine.me.handle, round: told });
  return { room: await roomView(mine.room.id, user.id, now), now };
}

/** What the player's roach keeps doing in the room (pose: src/lib/squad.ts POSES); every POSE_EVERY_MS, POSES_PER_HOUR an hour */
export async function setPose(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const pose = body.pose;
  if (!isPose(pose)) throw refuse(400, T.server.common.badRequest);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (!allow(`squad:poseEvery:${user.id}`, 1, POSE_EVERY_MS) || !allow(`squad:poseHour:${user.id}`, POSES_PER_HOUR, HOUR)) {
    throw refuse(429, T.server.squad.tooFast);
  }
  if (mine.me.pose !== pose) {
    await db
      .update(squadMembers)
      .set({ pose })
      .where(and(eq(squadMembers.roomId, mine.room.id), eq(squadMembers.userId, user.id)));
    await tellRoom(mine.room.id, { kind: "pose", h: mine.me.handle, pose });
  }
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

// ---- calling others in: invitations, 宣言招人 ----

/** An invitation to as many at once at most */
const INVITE_AT_ONCE = 30;

/** Plays 明日方舟, or no game yet, and 一起卫戍 is open to them */
const mayCome = (u: UserRow) => squadOpen(u) && (u.games.length === 0 || u.games.includes("arknights"));

/**
 * Your 触须之交 you may invite to the room you are in: those of 明日方舟 (or of no game yet) 一起卫戍 is open to,
 * with the server of their UID; those whose 资料 names another server than the room's last, who may still play on
 * another account; by name, and those of one name (as all who are anonymous are) by id, so they keep their places.
 * How many more times today, and whether they are in it already.
 */
export async function squadFriends(user: Pick<UserRow, "id">, now = Date.now()): Promise<{ friends: SquadFriend[]; now: number }> {
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  const ids = [...(await friendIdsOf(user.id))];
  if (!ids.length) return { friends: [], now };
  const blocked = await blockedWith(user.id);
  const people = (await db.select().from(users).where(inArray(users.id, ids))).filter((u) => !blocked.has(u.id) && mayCome(u));
  const inRoom = new Set(
    (
      await db
        .select({ id: squadMembers.userId })
        .from(squadMembers)
        .where(and(eq(squadMembers.roomId, mine.room.id), isNull(squadMembers.leftAt)))
    ).map((r) => r.id),
  );
  const waiting = new Set(
    (
      await db
        .select({ to: squadInvites.toUserId })
        .from(squadInvites)
        .where(
          and(
            eq(squadInvites.roomId, mine.room.id),
            eq(squadInvites.fromUserId, user.id),
            isNull(squadInvites.answer),
            gt(squadInvites.createdAt, new Date(now - INVITE_MS)),
          ),
        )
    ).map((r) => r.to),
  );
  const cards = await cardsOf(people, user.id);
  const other = (server: string) => server !== "" && server !== mine.room.server;
  const friends = people
    .map(
      (u): SquadFriend => ({
        id: friendKey(user.id, u.id),
        card: cards.get(u.id)!,
        server: u.uidServerArknights,
        inRoom: inRoom.has(u.id),
        waiting: waiting.has(u.id),
      }),
    )
    .sort(
      (a, b) =>
        Number(other(a.server)) - Number(other(b.server)) ||
        a.card.displayName.localeCompare(b.card.displayName, "zh") ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return { friends, now };
}

/**
 * Invitations from anyone in a room to their 触须之交 given (friends: their Friend ids), while it waits for players and
 * is not full; one lets TA in even where only the host's 触须之交 may come. Each gets one unless TA may not come
 * (SQUAD, blocking), is in the room already, or has one to it still good; as many as they like, none of the day's
 * touches. TA hears of it as of anything new in 消息, but quietly (seen at once, never pushed, the one who invites told
 * the same) when TA said 下次吧 to one of theirs lately (QUIET_AFTER_LATER_MS, to 一起卫戍).
 */
export async function inviteToSquad(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseClosed();
  if (!Array.isArray(body.friends)) throw refuse(400, T.server.common.badRequest);
  const keys = [...new Set(body.friends.map(String))].slice(0, INVITE_AT_ONCE);
  const mine = await roomOf(db, user.id);
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  // 停止加入: nobody would come in at one (the host may let them in first)
  if (mine.room.stoppedAt) throw refuse(409, mine.room.hostId === user.id ? T.server.squad.inviteStopped : T.server.squad.stopped, ROOM_SHUT);
  if (mine.room.state !== "wait") throw refuse(409, T.server.squad.notWaiting, ROOM_PLAYING);
  const roomId = mine.room.id;
  const [{ there }] = await db
    .select({ there: count() })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
  if (there + (await botsOf(db, roomId)).length >= SQUAD_MAX) throw refuse(409, T.server.squad.fullNoCall, ROOM_FULL);
  const byKey = new Map([...(await friendIdsOf(user.id))].map((id) => [friendKey(user.id, id), id]));
  const ids = keys.map((k) => byKey.get(k)).filter((id): id is string => Boolean(id));
  const people = ids.length ? await db.select().from(users).where(inArray(users.id, ids)) : [];
  const blocked = await blockedWith(user.id);
  const sent: SquadInviteSent[] = [];
  const made: string[] = [];
  const nudged: string[] = [];
  await db.transaction(async (tx) => {
    // one player's invitations one at a time, so two taps cannot both send TA one to the room
    await lockPlayer(tx, user.id);
    const inNow = new Set(
      (
        await tx
          .select({ id: squadMembers.userId })
          .from(squadMembers)
          .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)))
      ).map((r) => r.id),
    );
    for (const key of keys) {
      const to = byKey.get(key);
      const u = people.find((p) => p.id === to);
      if (!to || !u) {
        sent.push({ id: key, ok: false, why: T.server.common.notFriends });
        continue;
      }
      if (blocked.has(to) || !mayCome(u)) {
        sent.push({ id: key, ok: false, why: T.server.squad.cantInvite });
        continue;
      }
      if (inNow.has(to)) {
        sent.push({ id: key, ok: true });
        continue;
      }
      const [still] = await tx
        .select({ id: squadInvites.id })
        .from(squadInvites)
        .where(and(eq(squadInvites.roomId, roomId), eq(squadInvites.toUserId, to), isNull(squadInvites.answer), gt(squadInvites.createdAt, new Date(now - INVITE_MS))))
        .limit(1);
      if (still) {
        sent.push({ id: key, ok: true });
        continue;
      }
      // TA said 下次吧 to one of this player's lately: this one goes quietly
      const [later] = await tx
        .select({ id: squadInvites.id })
        .from(squadInvites)
        .where(
          and(
            eq(squadInvites.fromUserId, user.id),
            eq(squadInvites.toUserId, to),
            eq(squadInvites.answer, "later"),
            gt(squadInvites.answeredAt, new Date(now - QUIET_AFTER_LATER_MS)),
          ),
        )
        .limit(1);
      await tx.insert(squadInvites).values({ roomId, fromUserId: user.id, toUserId: to, createdAt: new Date(now), seenAt: later ? new Date(now) : null });
      sent.push({ id: key, ok: true });
      made.push(to);
      if (!later) nudged.push(to);
    }
  });
  if (made.length) {
    countStat(COUNTED.squadInvite, made.length, now);
    if (nudged.length) nudge(nudged);
    // your own list of who is invited, on your other pages
    tellSquad([user.id], { t: "room", room: roomId });
  }
  return { room: await roomView(roomId, user.id, now), sent, now };
}

/** 下次吧: the one who invited sees TA as not come, as an invitation that ran out; never as said no */
export async function laterSquadInvite(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const id = uuid(body.invite);
  if (!id) throw refuse(400, T.server.common.badRequest);
  const [done] = await db
    .update(squadInvites)
    .set({ answer: "later", answeredAt: new Date(now), seenAt: sql`coalesce(${squadInvites.seenAt}, now())` })
    .where(and(eq(squadInvites.id, id), eq(squadInvites.toUserId, user.id), isNull(squadInvites.answer)))
    .returning({ from: squadInvites.fromUserId, room: squadInvites.roomId });
  if (done) tellSquad([done.from], { t: "room", room: done.room });
  return { now };
}

/**
 * The rooms of these 宣言招人 and invitations (by room id; one deleted, a day after it ended, is not there) as they are
 * now to this player: open, full, playing, they are in it, closed to them, or over (src/lib/squad.ts SquadCall)
 */
export async function squadCalls(userId: string, roomIds: string[]): Promise<Map<string, SquadCall>> {
  const ids = [...new Set(roomIds.filter((id) => UUID.test(id)))];
  const out = new Map<string, SquadCall>();
  if (!ids.length) return out;
  const [rooms, members, blocked, bots] = await Promise.all([
    db
      .select({ id: squadRooms.id, endedAt: squadRooms.endedAt, stoppedAt: squadRooms.stoppedAt, state: squadRooms.state, server: squadRooms.server, level: squadRooms.level })
      .from(squadRooms)
      .where(inArray(squadRooms.id, ids)),
    db
      .select({ roomId: squadMembers.roomId, userId: squadMembers.userId, leftAt: squadMembers.leftAt, kicked: squadMembers.kicked })
      .from(squadMembers)
      .where(inArray(squadMembers.roomId, ids)),
    blockedWith(userId),
    botsIn(db, ids),
  ]);
  for (const r of rooms) {
    const inIt = members.filter((m) => m.roomId === r.id);
    const mine = inIt.find((m) => m.userId === userId);
    const there = inIt.filter((m) => !m.leftAt);
    const n = there.length + (bots.get(r.id)?.length ?? 0);
    const state: SquadCall["state"] = r.endedAt
      ? "over"
      : mine && !mine.leftAt
        ? "in"
        : mine?.kicked || there.some((m) => blocked.has(m.userId))
          ? "shut"
          : r.stoppedAt
            ? "stopped"
            : r.state === "go"
              ? "playing"
              : n >= SQUAD_MAX
                ? "full"
                : "open";
    out.set(r.id, { state, n: state === "over" ? 0 : n, server: r.server, level: r.level });
  }
  return out;
}

/** The invitations to you in 消息 → 触须之交 (qi:<id>), with their rooms as they are now; none from those blocked */
export async function squadInbox(userId: string, blocked: Set<string>, now = Date.now()): Promise<InboxItem[]> {
  const rows = (
    await db
      .select({ i: squadInvites, from: users })
      .from(squadInvites)
      .innerJoin(users, eq(users.id, squadInvites.fromUserId))
      .where(eq(squadInvites.toUserId, userId))
      .orderBy(desc(squadInvites.createdAt))
      .limit(20)
  ).filter((r) => !blocked.has(r.from.id));
  if (!rows.length) return [];
  const cards = await cardsOf(
    rows.map((r) => r.from),
    userId,
  );
  const calls = await squadCalls(
    userId,
    rows.map((r) => r.i.roomId),
  );
  return rows.map(({ i, from }): InboxItem => {
    const call = calls.get(i.roomId) ?? { state: "over" as const, n: 0, server: "", level: 0 };
    const state =
      call.state === "over" || call.state === "shut"
        ? "over"
        : call.state === "in"
          ? "in"
          : i.createdAt.getTime() <= now - INVITE_MS
            ? "over"
            : i.answer === "later"
              ? "later"
              : "open";
    return {
      kind: "squadInvite",
      id: `qi:${i.id}`,
      at: i.createdAt.getTime(),
      seen: Boolean(i.seenAt),
      from: cards.get(from.id)!,
      friendId: friendKey(userId, from.id),
      call,
      state,
      until: i.createdAt.getTime() + INVITE_MS,
      replied: true,
    };
  });
}

/** Seen in 消息 (qi:<id>) */
export async function seeSquadInvites(userId: string, itemIds: string[]) {
  const ids = itemIds
    .filter((i) => typeof i === "string" && i.startsWith("qi:"))
    .map((i) => i.slice(3))
    .filter((i) => UUID.test(i));
  if (!ids.length) return;
  await db
    .update(squadInvites)
    .set({ seenAt: new Date() })
    .where(and(inArray(squadInvites.id, ids), eq(squadInvites.toUserId, userId), isNull(squadInvites.seenAt)));
}

/**
 * 宣言招人: the host calls those nearby to their room, once a room, with 卫戍协议，启动！还差 N 个，来吗？
 * (src/lib/server/world.ts declare: from their main roach, within today's twenty, a minute apart; to those near enough,
 * never to those blocked). Only a room waiting for players, open to all, not full, with no 人机 in it. A declaration
 * refused leaves the room free to call again.
 */
export async function declareSquad(user: UserRow, body: Record<string, unknown>, now = Date.now()) {
  refuseClosed();
  const mine = await hostedBy(user.id);
  if (mine.room.friendsOnly) throw refuse(409, T.server.squad.declareFriendsOnly);
  // a room tried with 人机 calls nobody nearby, nor one stopped (停止加入)
  if ((await botsOf(db, mine.room.id)).length) throw refuse(409, T.server.squad.botsNoDeclare);
  if (mine.room.stoppedAt) throw refuse(409, T.server.squad.declareStopped, ROOM_SHUT);
  if (mine.room.state !== "wait") throw refuse(409, T.server.squad.notWaiting, ROOM_PLAYING);
  const [{ n }] = await db
    .select({ n: count() })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, mine.room.id), isNull(squadMembers.leftAt)));
  if (n >= SQUAD_MAX) throw refuse(409, T.server.squad.fullNoCall, ROOM_FULL);
  // once a room, however many taps come at once
  const [claimed] = await db
    .update(squadRooms)
    .set({ declaredAt: new Date(now) })
    .where(and(eq(squadRooms.id, mine.room.id), isNull(squadRooms.declaredAt), isNull(squadRooms.endedAt)))
    .returning({ id: squadRooms.id });
  if (!claimed) throw refuse(409, T.server.squad.declaredAlready);
  const from = Array.isArray(body.from) ? body.from.map(String) : undefined;
  let sent: Awaited<ReturnType<typeof declare>>;
  try {
    sent = await declare(user.id, { template: SQUAD_TEMPLATE, server: mine.room.server, level: mine.room.level, need: SQUAD_MAX - n, room: mine.room.id }, from, false, false, true);
  } catch (e) {
    await db.update(squadRooms).set({ declaredAt: null }).where(eq(squadRooms.id, mine.room.id));
    throw e;
  }
  // the host's other pages show it sent
  tellSquad([user.id], { t: "room", room: mine.room.id });
  return { ...sent, room: await roomView(mine.room.id, user.id, now), now };
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
  return { other: them.m.userId, known: true, level: them.level, tags: them.tags, card: { ...roomCard(them.m), extras: extrasNow(them.m.extras) } };
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
 * out together (SAY_BATCH_MS) to everyone in the room. sent: false when it was one too many. 对 TA 说's lines (the
 * row "to") go to one in the room (to: their number there, a 人机's too), only while it waits, everyone in it seeing
 * them; a 人机 answers by itself (answerBot).
 */
export async function sayInRoom(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const p = body.p;
  if (!isPhrase(p) || isToPhrase(p) !== (body.to !== undefined)) throw refuse(400, T.server.common.badRequest);
  const to = body.to === undefined ? null : (handleOf(body.to) ?? (isBotHandle(body.to) ? body.to : null));
  if (body.to !== undefined && to === null) throw refuse(400, T.server.common.badRequest);
  // to one in the room, never yourself: a 人机 (withBot) or a member (memberAt)
  const mine = to === null ? await roomOf(db, user.id) : to < 0 ? await withBot(user.id, to) : (await memberAt(user.id, to)).mine;
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (to !== null && mine.room.state !== "wait") throw refuse(409, T.server.squad.toPlaying, ROOM_PLAYING);
  if (!allow(`squad:sayEvery:${user.id}`, 1, SAY_EVERY_MS)) return { sent: false, now };
  if (!allow(`squad:sayHour:${user.id}`, SAY_PER_HOUR, HOUR)) return { sent: false, full: true, now };
  addSay(mine.room.id, mine.me.handle, p, to ?? undefined);
  countStat(COUNTED.squadSay, 1, now);
  if (to !== null && to < 0) answerLater(mine.room.id, to, mine.me.handle, p);
  return { sent: true, now };
}

// ---- 人机 named (对 TA 说): an answer by itself, BOT_ANSWER_MS after ----

/** A 人机 named answers this long after */
const BOT_ANSWER_MS = 2_000;
const g2 = globalThis as unknown as { squadBotAnswers?: Map<ReturnType<typeof setTimeout>, () => Promise<void>> };
const botAnswers = (g2.squadBotAnswers ??= new Map());

function answerLater(roomId: string, bot: number, asker: number, p: number) {
  const run = () => answerBot(roomId, bot, asker, p).catch((e) => console.error("squad: a 人机's answer failed", e));
  const t = setTimeout(() => {
    botAnswers.delete(t);
    void run();
  }, BOT_ANSWER_MS);
  t.unref?.();
  botAnswers.set(t, run);
}

/** For tests: the answers waiting, given now */
export async function answerBotsNow() {
  for (const [t, run] of [...botAnswers]) {
    clearTimeout(t);
    botAnswers.delete(t);
    await run();
  }
}

/**
 * What a 人机 named says back, to the one who said it (none once the round started or the 人机 left): asked to
 * change or give theirs up (36, 37), 好，我换 and another strategy nobody has; asked to pick one (38), 好嘞 and one
 * picked when it had none; asked to ready (39), 好嘞 (they always are); thanked (40), nothing.
 */
async function answerBot(roomId: string, bot: number, asker: number, p: number) {
  if (p === TO.thanks || !isToPhrase(p) || p > TO.thanks) return;
  const [room] = await db.select().from(squadRooms).where(eq(squadRooms.id, roomId));
  if (!room || room.endedAt || room.state !== "wait") return;
  const [b] = await db
    .select()
    .from(squadBots)
    .where(and(eq(squadBots.roomId, roomId), eq(squadBots.handle, bot), isNull(squadBots.goneAt)));
  if (!b) return;
  if (p === TO.change || p === TO.giveUp) {
    addSay(roomId, bot, TO.ok, asker);
    await botDoes(roomId, bot, "strategy", Date.now());
    return;
  }
  addSay(roomId, bot, TO.sure, asker);
  if (p === TO.pick && b.strategy === null) await botDoes(roomId, bot, "strategy", Date.now());
}

/**
 * A move of the player's roach (动作: move, and to, the number of the teammate for 击掌 and 贴贴), never written down:
 * told to the room with its lines, one every MOVE_EVERY_MS and counted with the lines (SAY_PER_HOUR). sent: false
 * when it was one too many (full: the hour's are used up).
 */
export async function moveInRoom(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const move = body.move;
  if (!isMove(move)) throw refuse(400, T.server.common.badRequest);
  const to = movesTo(move) ? (handleOf(body.to) ?? (isBotHandle(body.to) ? body.to : null)) : null;
  if (movesTo(move) ? to === null : body.to !== undefined) throw refuse(400, T.server.common.badRequest);
  // with a teammate: TA must be in the room (memberAt; a 人机 too), never yourself
  const mine = to === null ? await roomOf(db, user.id) : to < 0 ? await withBot(user.id, to) : (await memberAt(user.id, to)).mine;
  if (!mine) throw refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
  if (!allow(`squad:moveEvery:${user.id}`, 1, MOVE_EVERY_MS)) return { sent: false, now };
  if (!allow(`squad:sayHour:${user.id}`, SAY_PER_HOUR, HOUR)) return { sent: false, full: true, now };
  batchOf(mine.room.id).moves.push({ h: mine.me.handle, move, ...(to === null ? {} : { to }) });
  return { sent: true, now };
}

/** The room's batch of what is said and done, told to it SAY_BATCH_MS after the first */
function batchOf(roomId: string) {
  let b = says.get(roomId);
  if (!b) {
    b = { items: [], moves: [], timer: setTimeout(() => void flushSay(roomId), SAY_BATCH_MS) };
    b.timer.unref?.();
    says.set(roomId, b);
  }
  return b;
}

function addSay(roomId: string, h: number, p: number, to?: number) {
  batchOf(roomId).items.push({ h, p, ...(to === undefined ? {} : { to }) });
}

async function flushSay(roomId: string) {
  const b = says.get(roomId);
  says.delete(roomId);
  if (!b || (!b.items.length && !b.moves.length && !b.fish?.length && !b.throws?.length && !b.dance?.length)) return;
  try {
    const ids = (await hearersOf(roomId)).map((r) => r.userId);
    if (b.items.length) tellSquad(ids, { t: "say", room: roomId, items: b.items } satisfies SquadTell);
    if (b.moves.length) tellSquad(ids, { t: "move", room: roomId, items: b.moves } satisfies SquadTell);
    if (b.fish?.length) tellSquad(ids, { t: "fish", room: roomId, items: b.fish } satisfies SquadTell);
    if (b.throws?.length) tellSquad(ids, { t: "throw", room: roomId, items: b.throws } satisfies SquadTell);
    if (b.dance?.length) tellSquad(ids, { t: "dance", room: roomId, items: b.dance } satisfies SquadTell);
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
  /** 停止加入: on the list of those in it alone */
  stopped: boolean;
  at: number;
  keyAt: number;
  /** 卫戍的一起听 plays a song now (♪) */
  music: boolean;
  /** showName: 列表上显示我的名字, from their 卫戍名片 */
  members: { userId: string; h: number; name: string; showName: boolean; avatar: string; color: string; card: SquadPicks }[];
  /** The 人机 in it, after them */
  bots: { avatar: string; color: string; card: SquadPicks }[];
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
          u: {
            id: users.id,
            anonymous: users.anonymous,
            name: users.name,
            drPrefix: users.drPrefix,
            avatar: users.avatar,
            color: users.color,
            showName: users.squadShowName,
          },
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
            stopped: Boolean(r.stoppedAt),
            at: r.createdAt.getTime(),
            keyAt: r.keyAt.getTime(),
            music: false,
            members: [],
            bots: [],
          };
          byRoom.set(r.id, s);
        }
        s.members.push({
          userId: u.id,
          h: m.handle,
          name: displayName(u),
          showName: u.showName,
          avatar: drawnLook(u.avatar),
          color: ROACH_COLORS.find((c) => c === u.color) ?? "cyan",
          card: roomCard(m),
        });
      }
      for (const s of byRoom.values()) s.members.sort((a, b) => a.h - b.h);
      for (const [id, bots] of await botsIn(db, [...byRoom.keys()])) {
        const s = byRoom.get(id);
        if (s) s.bots = bots.map((b) => ({ ...botLook(b), card: roomCard(b) }));
      }
      const rooms = [...byRoom.values()];
      const playing = await squadListensPlaying(
        rooms.map((s) => ({ id: s.id, hostId: s.hostId, people: s.members.map((m) => m.userId) })),
        now,
      );
      for (const s of rooms) s.music = playing.has(s.id);
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
 * Whether a teammate is named on the list to this viewer: one who chose 列表上显示我的名字 on their 卫戍名片, to
 * everyone; any other to their own 触须之交 alone (the host always is). The one place this is decided.
 */
const isNamed = (m: Snap["members"][number], friends: Set<string>) => m.showName || friends.has(m.userId);

/**
 * Rooms waiting first: those with a 触须之交 of the viewer's first, then those missing fewest (人机 fill seats too),
 * and of those the one whose key was pasted last (the likelier to work still); then those playing, the newest first
 */
function byOrder(a: SquadListRoom, b: SquadListRoom) {
  if (a.state !== b.state) return a.state === "wait" ? -1 : 1;
  if (a.state === "go") return b.at - a.at;
  if (a.friend !== b.friend) return a.friend ? -1 : 1;
  if (a.seats.length !== b.seats.length) return b.seats.length - a.seats.length;
  return b.keyAt - a.keyAt;
}

function listRoom(s: Snap, viewerId: string, friends: Set<string>): SquadListRoom {
  const host = s.members.find((m) => m.userId === s.hostId);
  const seats: SquadSeat[] = s.members.map((m) => {
    const role: SquadSeat["role"] = m.userId === s.hostId ? "host" : m.userId === viewerId ? "you" : friends.has(m.userId) ? "friend" : "mate";
    return {
      role,
      ...((role === "friend" || role === "mate") && isNamed(m, friends) ? { name: m.name } : {}),
      avatar: m.avatar,
      color: m.color,
      ...m.card,
    };
  });
  // a 人机 sits as a teammate, never named
  for (const b of s.bots) seats.push({ role: "mate", avatar: b.avatar, color: b.color, ...b.card });
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
    music: s.music,
    friend: s.members.some((m) => m.userId !== viewerId && friends.has(m.userId)),
    mine: s.members.some((m) => m.userId === viewerId),
    ...(s.bots.length ? { test: true as const } : {}),
  };
}

/** The server a player's list is of when none is asked for: their 明日方舟 UID's, else 官服 */
const serverOf = (user: Pick<UserRow, "uidServerArknights">) => (isSquadServer(user.uidServerArknights) ? user.uidServerArknights : DEFAULT_SERVER);

/**
 * The list for this player (src/lib/squad.ts SquadList): the rooms of a server (as asked, else their own) and of one
 * 难度 (level, or all), cut from the snapshot for them (one with 人机 in it to the 站长 and the admins alone, and to
 * those in it); LIST_MAX at most. Asked again within LIST_MIN_MS, the same.
 * With an ETag over what it holds.
 */
export async function squadList(user: UserRow, query: { server?: unknown; level?: unknown }, now = Date.now()) {
  const server = isSquadServer(query.server) ? query.server : serverOf(user);
  const level = isLevel(query.level) ? query.level : null;
  const ask = `${server}|${level ?? ""}`;
  const last = listsHeld.get(user.id);
  if (last && last.key === ask && now - last.at < LIST_MIN_MS && now >= last.at) return last;
  const [rooms, friends, blocked] = await Promise.all([snapshot(now), friendIdsOf(user.id), blockedWith(user.id)]);
  const staff = isStaff(user);
  const shown = rooms
    .filter((r) => r.server === server && (level === null || r.level === level))
    // nothing with anyone they blocked, or who blocked them, in it
    .filter((r) => !r.members.some((m) => blocked.has(m.userId)))
    // a room only for 触须之交, to the host's alone (and those in it)
    .filter((r) => !r.friendsOnly || friends.has(r.hostId) || r.members.some((m) => m.userId === user.id))
    // one tried with 人机, to the 站长 and the admins alone (and those in it); one stopped (停止加入) to those in it alone
    .filter((r) => !r.bots.length || staff || r.members.some((m) => m.userId === user.id))
    .filter((r) => !r.stopped || r.members.some((m) => m.userId === user.id))
    .map((r) => listRoom(r, user.id, friends))
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
  const names = [COUNTED.squadRoom, COUNTED.squadJoin, COUNTED.squadSay, COUNTED.squadPlay, COUNTED.squadInvite, COUNTED.squadJoinDecl];
  const [open, counted, [tried]] = await Promise.all([
    db.select({ state: squadRooms.state, n: count() }).from(squadRooms).where(isNull(squadRooms.endedAt)).groupBy(squadRooms.state),
    db
      .select({ name: statCounts.name, n: statCounts.n })
      .from(statCounts)
      .where(and(eq(statCounts.day, day), inArray(statCounts.name, names))),
    db
      .select({ n: sql<number>`count(distinct ${squadBots.roomId})::int` })
      .from(squadBots)
      .innerJoin(squadRooms, eq(squadRooms.id, squadBots.roomId))
      .where(and(isNull(squadBots.goneAt), isNull(squadRooms.endedAt))),
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
    invites: today(COUNTED.squadInvite),
    called: today(COUNTED.squadJoinDecl),
    botRooms: Number(tried?.n ?? 0),
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
