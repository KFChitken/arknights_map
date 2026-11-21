import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import { T } from "@/i18n";
import { readDance, type DanceBeats } from "../dance";
import { NOT_IN_ROOM } from "../squad";
import {
  beatOff,
  DANCE_IDLE_MS,
  DANCE_LEAD_MS,
  DANCE_TAP_EARLY_MS,
  DANCE_TAP_EVERY_MS,
  DANCE_TAP_LATE_MS,
  DANCE_WINDOW_MS,
  GIFT_LEAD_MS,
  giftUntil,
  isLobbyData,
  isMatchKind,
  isModeKind,
  LOBBY_IDLE_MS,
  MODE_KINDS,
  modeEnds,
  quizUntil,
  stackHeight,
  towerNow,
  type DanceSong,
  type GiftData,
  type LobbyData,
  type MatchRound,
  type QuizData,
  type RaceData,
} from "../squadMode";
import { db } from "./db";
import { HttpError } from "./http";
import { listenOpen } from "./listen";
import { squadListenSongNow } from "./listenRooms";
import { musicLink } from "./musicLinks";
import { squadMembers, squadRooms, users, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { songList, songOf, type HeldSong } from "./songs";
import { danceInRoom, raceInRoom, roomOf, stackInRoom, tellSquadPlay } from "./squad";
import { forgetGift, giftRooms, makeGift, passIn, reseatGift, settleGift, watchGift } from "./squadGift";
import { clearMode, handLobby, lobbyTell, type LobbyNews } from "./squadLobby";
import { forgetRace, makeRace, raceLatest, relaneRace, runIn, settleRace, watchRace } from "./squadRace";
import { endQuiz, makeQuiz } from "./squadQuiz";
import { countBlock, dropIn } from "./squadStack";

/**
 * 玩点什么 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑥; the rules in src/lib/squadMode.ts), kept on the room's row and its
 * members': the one mode playing, its opener, those in it. 开 (none playing), 加入 and 不跳了 tell the room. 龙门广场舞:
 * its song is 卫戍的一起听's while one plays (from where it is), else one of 听歌's at random with a table of beats,
 * DANCE_LEAD_MS on; each tap of 跳 is judged on the server's clock against the song's beats, the combo kept on the
 * member's row and told to the room with the next batch. A mode over (its song ended, or DANCE_IDLE_MS since the last
 * tap) is cleared by the next request to it, or by sweepModes (the main process, every few seconds), which tells the room.
 *
 * A match (MATCH_KINDS) waits first (mode_data LobbyData): its initiator is mode_by, those ready are in (mode_in) as
 * they readied (mode_tap_at), and it lives on LOBBY_IDLE_MS from the last thing anyone did in it (mode_last,
 * mode_until). Its initiator's 开始 (startMatch) plays a round with those ready: its own data with begun, those who
 * readied since asking for the next (inRound). A round over waits again (toLobby); one gone hands it on or ends it
 * (squadLobby.ts handLobby).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RoomRow = typeof squadRooms.$inferSelect;

const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
const notInRoom = () => refuse(409, T.server.squad.notInRoom, NOT_IN_ROOM);
/** 卫戍的一起听's song with less than this left is not danced to (it would be over before anyone joined) */
const LISTEN_LEFT_MS = 20_000;

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

/** When the room's mode ends by itself, or null while none plays */
const endsOfMode = (room: Pick<RoomRow, "mode" | "modeUntil" | "modeLast">) =>
  room.mode && room.modeUntil && room.modeLast ? modeEnds(room.mode, room.modeUntil.getTime(), room.modeLast.getTime()) : null;

/** A match's round as kept (null: no match, or one waiting) */
const roundOf = (room: Pick<RoomRow, "mode" | "modeData">) =>
  isMatchKind(room.mode) && room.modeData && !isLobbyData(room.modeData) ? (room.modeData as Partial<MatchRound>) : null;
/** When the round playing began: its initiator's 开始 (one opened before rounds were begun so: as it opened) */
const begunOf = (room: Pick<RoomRow, "mode" | "modeData" | "modeAt">) => roundOf(room)?.begun ?? room.modeAt?.getTime() ?? 0;

/** The room's mode gone, its members out of it: a quiz's round ending first (its last wearing 漏勺, as it ended at `at`) */
async function endModeIn(tx: Tx, room: Pick<RoomRow, "id" | "mode" | "modeData" | "modeAt">, at: number) {
  if (room.mode === "quiz" && roundOf(room)) await endQuiz(tx, room.id, at, begunOf(room));
  if (room.mode === "gift") forgetGift(room.id);
  if (room.mode === "race") forgetRace(room.id);
  await clearMode(tx, room.id);
}

/**
 * A match's round over (at `at`): its own end first (a quiz's last wearing 漏勺, its timers stopped), then it waits
 * again, LOBBY_IDLE_MS from now, everyone who played it or asked for the next still ready, the combos from 0; handed on
 * when its initiator is not among them, gone when nobody is (handLobby). Says what became of it.
 */
async function toLobby(tx: Tx, room: Pick<RoomRow, "id" | "mode" | "modeData" | "modeAt">, at: number, now: number): Promise<LobbyNews | null> {
  const played = (roundOf(room)?.played ?? 0) + 1;
  if (room.mode === "quiz") await endQuiz(tx, room.id, at, begunOf(room));
  if (room.mode === "gift") forgetGift(room.id);
  if (room.mode === "race") forgetRace(room.id);
  const data: LobbyData = { wait: true, played };
  await tx
    .update(squadRooms)
    .set({ modeData: data, modeSong: null, modeSongAt: null, modeLast: new Date(now), modeUntil: new Date(now + LOBBY_IDLE_MS) })
    .where(eq(squadRooms.id, room.id));
  await tx
    .update(squadMembers)
    .set({ modeCombo: 0 })
    .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)));
  return handLobby(tx, room.id);
}

/** What the room is told of a round over: what became of its match when it was handed on or went, else to look again */
const backTell = (news: LobbyNews | null) => (news ? lobbyTell(news) : ({ kind: "mode" } as const));

// ---- the songs danced to ----

const g = globalThis as unknown as { danceBeats?: Map<string, DanceBeats | null> };
const beatsHeld = (g.danceBeats ??= new Map());

/** A song's beats (its 听歌 disco table), or null when it has none to dance to; read once a song */
function beatsOf(song: Pick<HeldSong, "id" | "dance">): DanceBeats | null {
  if (beatsHeld.has(song.id)) return beatsHeld.get(song.id)!;
  const map = song.dance ? readDance(song.dance) : null;
  const beats = map && !map.none && map.beats.length > 1 ? map : null;
  beatsHeld.set(song.id, beats);
  return beats;
}

/** One of 听歌's songs with beats to dance to, at random (one of those at least `ms` long, where there are any), or undefined when there is none */
async function anyDanceSong(rand: (n: number) => number, ms = 0): Promise<HeldSong | undefined> {
  const songs = [...(await songList()).byId.values()].filter((s) => beatsOf(s));
  const long = songs.filter((s) => s.seconds * 1000 >= ms);
  const from = long.length ? long : songs;
  return from.length ? from[rand(from.length)] : undefined;
}

/** For the tests: the songs' beats read afresh */
export function forgetDanceBeats() {
  beatsHeld.clear();
}

// ---- 开, 加入, 不跳了; a match's 准备, 开始 ----

/**
 * The room's mode as one is opened: one playing, or a match's round over that has not gone back to waiting yet (the
 * sweep's to do), refused; one over by itself cleared
 */
async function makeRoom(tx: Tx, room: RoomRow, now: number) {
  const ends = endsOfMode(room);
  if (ends !== null && (ends > now || roundOf(room))) throw refuse(409, T.server.squad.modeOn);
  if (ends !== null) await endModeIn(tx, room, ends);
}

/**
 * 开 a mode (玩点什么, kind): none playing in the room (one over is cleared first). A match waits for people (its
 * opener its initiator, ready); W 的礼物 only while there is a song to drum to. 龙门广场舞 dances to 卫戍的一起听's song
 * while one plays with LISTEN_LEFT_MS or more left of it (from where it is), else to one of 听歌's at random with beats,
 * from its start DANCE_LEAD_MS on. Its opener is in it; the room is told.
 */
export async function openMode(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now(), rand: (n: number) => number = randomInt) {
  if (!isModeKind(body.kind)) throw refuse(400, T.server.squad.badMode);
  const kind = body.kind;
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  if (isMatchKind(kind)) {
    if (kind === "gift" && !(await anyDanceSong(rand))) throw refuse(409, T.server.squad.noGiftSong);
    const done = await db.transaction(async (tx) => {
      const { room, me } = await lockedMine(tx, user.id);
      await makeRoom(tx, room, now);
      const data: LobbyData = { wait: true, played: 0 };
      await tx
        .update(squadRooms)
        .set({ mode: kind, modeBy: me.handle, modeAt: new Date(now), modeSong: null, modeSongAt: null, modeData: data, modeLast: new Date(now), modeUntil: new Date(now + LOBBY_IDLE_MS) })
        .where(eq(squadRooms.id, room.id));
      await tx
        .update(squadMembers)
        .set({ modeIn: false, modeCombo: 0, modeTapAt: null })
        .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), ne(squadMembers.handle, me.handle)));
      await tx
        .update(squadMembers)
        .set({ modeIn: true, modeCombo: 0, modeTapAt: new Date(now) })
        .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
      return { roomId: room.id, h: me.handle };
    });
    await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: true, lobby: "open", mode: kind });
    return { now };
  }
  let fields: Pick<RoomRow, "modeSong" | "modeSongAt" | "modeUntil" | "modeLast" | "modeData">;
  {
    const together = await listenSongIn(mine.room.id, now);
    let song: HeldSong | undefined;
    let songAt: number;
    let until: number;
    const listenSong = together ? await songOf(together.song) : undefined;
    if (together && listenSong && beatsOf(listenSong)) {
      if (together.end - now < LISTEN_LEFT_MS) throw refuse(409, T.server.squad.danceSongEnding);
      song = listenSong;
      songAt = together.start;
      until = together.end;
    } else {
      song = await anyDanceSong(rand);
      if (!song) throw refuse(409, T.server.squad.noDanceSong);
      songAt = now + DANCE_LEAD_MS;
      until = songAt + song.seconds * 1000;
    }
    fields = { modeSong: song.id, modeSongAt: new Date(songAt), modeUntil: new Date(until), modeLast: new Date(now), modeData: null };
  }
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    await makeRoom(tx, room, now);
    await tx
      .update(squadRooms)
      .set({ mode: kind, modeBy: me.handle, modeAt: new Date(now), ...fields })
      .where(eq(squadRooms.id, room.id));
    await tx
      .update(squadMembers)
      .set({ modeIn: false, modeCombo: 0, modeTapAt: null })
      .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), ne(squadMembers.handle, me.handle)));
    await tx
      .update(squadMembers)
      .set({ modeIn: true, modeCombo: 0, modeTapAt: null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
    return { roomId: room.id, h: me.handle };
  });
  await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: true });
  return { now };
}

/** 卫戍的一起听's song in the room now (its host's 一起听, with someone of the room in it), or null */
async function listenSongIn(roomId: string, now: number) {
  const [host] = await db.select({ hostId: squadRooms.hostId }).from(squadRooms).where(eq(squadRooms.id, roomId));
  if (!host) return null;
  const people = await db
    .select({ id: squadMembers.userId })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)));
  return squadListenSongNow({ id: roomId, hostId: host.hostId, people: people.map((p) => p.id) }, now);
}

/**
 * 加入 (in) or out (不跳了，去围观; a match's 不玩了), the combo from 0; the room told. A match waiting: 准备 or not;
 * playing: in asks for the next round (下一局算我), out goes to watch this one (W 的礼物's seat a 人机's from the next
 * round, 急件赛's lane a 人机's before its start). Its initiator going out hands it on, or a match waiting goes with
 * nobody ready. 龙门广场舞 and 基建加盖 as they always were.
 */
export async function joinMode(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const into = body.in !== false;
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const ends = endsOfMode(room);
    if (ends === null || ends <= now) throw refuse(409, T.server.squad.noMode);
    const mine = and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt));
    const out = { roomId: room.id, h: me.handle, kind: room.mode, news: null as LobbyNews | null, changed: me.modeIn !== into, waiting: false };
    if (!isMatchKind(room.mode)) {
      await tx.update(squadMembers).set({ modeIn: into, modeCombo: 0, modeTapAt: null }).where(mine);
      return { ...out, changed: true };
    }
    const round = roundOf(room);
    out.waiting = !round;
    if (me.modeIn === into) return out;
    // asking for the next round: readied after this one began, even within its very millisecond
    const tapAt = round ? Math.max(now, begunOf(room) + 1) : now;
    await tx
      .update(squadMembers)
      .set({ modeIn: into, modeCombo: 0, modeTapAt: into ? new Date(tapAt) : null })
      .where(mine);
    if (!round) {
      await tx
        .update(squadRooms)
        .set({ modeLast: new Date(now), modeUntil: new Date(now + LOBBY_IDLE_MS) })
        .where(eq(squadRooms.id, room.id));
    } else if (!into && room.mode === "gift") {
      const data = structuredClone(room.modeData as GiftData & MatchRound);
      if (await reseatGift(tx, room.id, data, now, begunOf(room))) await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    } else if (!into && room.mode === "race") {
      const data = structuredClone(room.modeData as RaceData & MatchRound);
      if (relaneRace(data, me.handle, now)) await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    }
    if (!into && me.handle === room.modeBy) out.news = await handLobby(tx, room.id);
    return out;
  });
  if (!done.changed) return { now };
  if (done.news) await tellSquadPlay(done.roomId, lobbyTell(done.news));
  else if (into && done.waiting && isMatchKind(done.kind)) await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: true, lobby: "ready", mode: done.kind });
  else await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: into });
  return { now };
}

/**
 * 开始, by a match's initiator while it waits: a round with those ready (its initiator first, then as they readied;
 * 人机 in the empty seats of W 的礼物 and 企鹅物流急件赛; a quiz asks for everyone in the room's ears), counting down
 * its lead from now. The room told: the cards of those in it open.
 */
export async function startMatch(user: Pick<UserRow, "id">, now = Date.now(), rand: (n: number) => number = randomInt) {
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  const people = await db
    .select({ u: users })
    .from(squadMembers)
    .innerJoin(users, eq(users.id, squadMembers.userId))
    .where(and(eq(squadMembers.roomId, mine.room.id), isNull(squadMembers.leftAt)));
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const ends = endsOfMode(room);
    if (!isMatchKind(room.mode) || ends === null || ends <= now) throw refuse(409, T.server.squad.noMode);
    if (!isLobbyData(room.modeData)) throw refuse(409, T.server.squad.begunAlready);
    if (room.modeBy !== me.handle) throw refuse(409, T.server.squad.notInitiator);
    const ready = await tx
      .select({ h: squadMembers.handle })
      .from(squadMembers)
      .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true)))
      .orderBy(asc(squadMembers.modeTapAt), asc(squadMembers.handle));
    const players = [me.handle, ...ready.map((r) => r.h).filter((h) => h !== me.handle)];
    const round: MatchRound = { begun: now, played: room.modeData.played };
    let fields: Pick<RoomRow, "modeSong" | "modeSongAt" | "modeUntil" | "modeLast" | "modeData">;
    let gift: GiftData | null = null;
    let race: RaceData | null = null;
    if (room.mode === "quiz") {
      const quiz: QuizData | null = await makeQuiz(
        people.map((p) => p.u),
        now,
        rand,
      );
      if (!quiz) throw refuse(409, T.server.squad.noQuiz);
      const until = new Date(quizUntil(quiz.qs));
      fields = { modeSong: null, modeSongAt: null, modeUntil: until, modeLast: until, modeData: { ...quiz, ...round } };
    } else if (room.mode === "race") {
      race = await makeRace(tx, room.id, players, now, rand);
      const until = new Date(raceLatest(race.start));
      fields = { modeSong: null, modeSongAt: null, modeUntil: until, modeLast: until, modeData: { ...race, ...round } };
    } else {
      // its rounds, and a song to drum to: 一起听's while one plays (from where it is), else one long enough at random
      gift = await makeGift(tx, room.id, players, now, rand);
      const until = giftUntil(gift.plan);
      const together = await listenSongIn(room.id, now);
      const listenSong = together ? await songOf(together.song) : undefined;
      const song = together && listenSong && beatsOf(listenSong) ? listenSong : await anyDanceSong(rand, until - now - GIFT_LEAD_MS);
      if (!song) throw refuse(409, T.server.squad.noGiftSong);
      const songAt = song === listenSong && together ? together.start : now + GIFT_LEAD_MS;
      fields = { modeSong: song.id, modeSongAt: new Date(songAt), modeUntil: new Date(until), modeLast: new Date(until), modeData: { ...gift, ...round } };
    }
    await tx.update(squadRooms).set(fields).where(eq(squadRooms.id, room.id));
    await tx
      .update(squadMembers)
      .set({ modeCombo: 0 })
      .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)));
    return { roomId: room.id, h: me.handle, kind: room.mode, gift, race };
  });
  if (done.gift) watchGift(done.roomId, done.gift, (id) => settleRoom(id));
  if (done.race) watchRace(done.roomId, done.race, (id) => settleRaceRoom(id));
  await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: true, lobby: "start", mode: done.kind });
  return { now };
}

// ---- 跳 ----

/**
 * 跳: a tap in 龙门广场舞 at `at` (the server's clock as the page has it: taken when within DANCE_TAP_EARLY_MS before
 * now and DANCE_TAP_LATE_MS after, else now), on the beat when within DANCE_WINDOW_MS of one of its song's: the combo
 * one up, else back to 0. Taps closer together than DANCE_TAP_EVERY_MS count once (the same answer, nothing changed).
 * The dance lives on DANCE_IDLE_MS from it; the room is told with the next batch.
 */
export async function danceTap(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  const [room] = await db.select().from(squadRooms).where(eq(squadRooms.id, mine.room.id));
  const ends = room ? endsOfMode(room) : null;
  if (!room || room.mode !== "dance" || ends === null || ends <= now || !room.modeSong || !room.modeSongAt) throw refuse(409, T.server.squad.noMode);
  if (!mine.me.modeIn) throw refuse(409, T.server.squad.notDancing);
  const song = await songOf(room.modeSong);
  const beats = song ? beatsOf(song) : null;
  const asked = typeof body.at === "number" && Number.isFinite(body.at) ? body.at : now;
  const at = asked >= now - DANCE_TAP_EARLY_MS && asked <= now + DANCE_TAP_LATE_MS ? asked : now;
  const ok = Boolean(beats) && beatOff(beats!.beats, at - room.modeSongAt.getTime()) <= DANCE_WINDOW_MS;
  const combo = ok ? mine.me.modeCombo + 1 : 0;
  const where = and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, mine.me.handle), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true));
  // only one tap a DANCE_TAP_EVERY_MS: one sooner changes nothing
  const [kept] = await db
    .update(squadMembers)
    .set({ modeCombo: combo, modeTapAt: new Date(now) })
    .where(and(where, or(isNull(squadMembers.modeTapAt), lte(squadMembers.modeTapAt, new Date(now - DANCE_TAP_EVERY_MS)))))
    .returning({ combo: squadMembers.modeCombo });
  if (!kept) return { now, combo: mine.me.modeCombo, ok: false, counted: false };
  await db.update(squadRooms).set({ modeLast: new Date(now) }).where(and(eq(squadRooms.id, room.id), eq(squadRooms.mode, "dance")));
  danceInRoom(room.id, { h: mine.me.handle, combo, ok, at: now });
  return { now, combo, ok, counted: true };
}

// ---- the song, for the page ----

/**
 * 龙门广场舞's song for a page in the room: its table of beats, and to one 听歌 is open to (LISTEN), while it is not
 * paused and the site not gray, its link and its smaller copy's (省流量), as 325 节拍's clips go out: not counted as
 * listening
 */
export async function danceSong(user: Pick<UserRow, "id" | "email">, now = Date.now()): Promise<DanceSong> {
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  const [room] = await db.select({ mode: squadRooms.mode, song: squadRooms.modeSong }).from(squadRooms).where(eq(squadRooms.id, mine.room.id));
  const song = (room?.mode === "dance" || room?.mode === "gift") && room.song ? await songOf(room.song) : undefined;
  if (!song || !song.dance) throw refuse(409, T.server.squad.noMode);
  const hear = listenOpen(user) && !listenSettings().paused && !grayUntil(now);
  return {
    song: song.id,
    dance: song.dance,
    ...(hear ? { url: musicLink(song.file, now), ...(song.lite ? { lite: musicLink(song.lite, now) } : {}) } : {}),
    now,
  };
}

// ---- the sweep ----

/**
 * The main process, every few seconds: the modes over (their song ended, or DANCE_IDLE_MS since the last tap) cleared,
 * a match's round over waiting again, a match waiting LOBBY_IDLE_MS with nobody doing anything gone; their rooms told.
 * A mode of before there is no more (基建加盖 was one, opened before the tower was the room's own) is cleared too. Says
 * how many.
 */
export async function sweepModes(now = Date.now()) {
  let n = 0;
  // W 的礼物's rounds whose song stopped, and races over, with no one there to see it (their own timers gone with a process)
  for (const id of await giftRooms()) if ((await settleRoom(id, now)).ended) n += 1;
  for (const id of await raceRooms()) if ((await settleRaceRoom(id, now)).ended) n += 1;
  const over = await db
    .select()
    .from(squadRooms)
    .where(
      and(
        isNull(squadRooms.endedAt),
        isNotNull(squadRooms.mode),
        or(
          lte(squadRooms.modeUntil, new Date(now)),
          and(eq(squadRooms.mode, "dance"), lte(squadRooms.modeLast, new Date(now - DANCE_IDLE_MS))),
          notInArray(squadRooms.mode, [...MODE_KINDS]),
        ),
      ),
    );
  for (const r of over) {
    const told = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, r.id)).for("update");
      const ends = room ? endsOfMode(room) : null;
      if (room && room.mode && !isModeKind(room.mode)) {
        await endModeIn(tx, room, now);
        return { kind: "mode", on: false } as const;
      }
      if (!room || ends === null || ends > now) return null;
      if (isMatchKind(room.mode) && roundOf(room)) return backTell(await toLobby(tx, room, ends, now));
      await endModeIn(tx, room, ends);
      return isMatchKind(room.mode) ? ({ kind: "mode", on: false, lobby: "idle", mode: room.mode } as const) : ({ kind: "mode", on: false } as const);
    });
    if (told) {
      n += 1;
      await tellSquadPlay(r.id, told);
    }
  }
  return n;
}

// ---- W 的礼物 ----

/**
 * The rounds of W 的礼物 in this room whose song has stopped by now settled (squadGift.ts settleGift), and the room
 * told; it ends when no player is left in it. Each round's own timer, the sweep and every 传 come here.
 */
export async function settleRoom(roomId: string, now = Date.now()) {
  const done = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt || room.mode !== "gift" || !roundOf(room)) return { changed: false, ended: false, news: null };
    const data = structuredClone(room.modeData as GiftData & MatchRound);
    const { changed, empty } = await settleGift(tx, roomId, data, now, begunOf(room));
    if (changed) await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, roomId));
    // nobody plays it any more: this round over, and the match waits again
    const news = empty ? await toLobby(tx, { ...room, modeData: data }, now, now) : null;
    return { changed, ended: empty, news };
  });
  if (done.ended) await tellSquadPlay(roomId, backTell(done.news));
  else if (done.changed) await tellSquadPlay(roomId, { kind: "gift" });
  return { changed: done.changed, ended: done.ended };
}

/**
 * 传 in W 的礼物 (at: the server's clock as the page has it): the rounds settled first, then the gift, in the
 * player's hands, on to the next seat; the room told. Its time as taken.
 */
export async function passGift(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  await settleRoom(mine.room.id, now);
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const ends = endsOfMode(room);
    if (room.mode !== "gift" || !roundOf(room) || ends === null || ends <= now) throw refuse(409, T.server.squad.noMode);
    if (!me.modeIn) throw refuse(409, T.server.squad.notPassing);
    const data = structuredClone(room.modeData as GiftData);
    const passed = passIn(data, me.handle, body.at, now);
    await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    return { roomId: room.id, h: me.handle, at: passed.at };
  });
  await tellSquadPlay(done.roomId, { kind: "gift", h: done.h });
  return { now, at: done.at };
}

// ---- 企鹅物流急件赛 ----

/** The rooms running 企鹅物流急件赛 now, for the sweep */
async function raceRooms(): Promise<string[]> {
  const rows = await db
    .select({ id: squadRooms.id })
    .from(squadRooms)
    .where(and(isNull(squadRooms.endedAt), eq(squadRooms.mode, "race")));
  return rows.map((r) => r.id);
}

/**
 * 企鹅物流急件赛 in this room settled once it is over by now (squadRace.ts settleRace: its end RACE_RESULT_MS on),
 * the room told; and waiting again at that end. Its own timer, the sweep and every 加油 or 跳 come here. over: no
 * round of it runs (any more); ended: this one went back to waiting just now.
 */
export async function settleRaceRoom(roomId: string, now = Date.now()) {
  const done = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt || room.mode !== "race" || !roundOf(room) || !room.modeUntil) return { changed: false, ended: false, gone: true, news: null };
    const data = structuredClone(room.modeData as RaceData & MatchRound);
    const until = await settleRace(tx, roomId, data, now);
    if (until !== null) {
      await tx.update(squadRooms).set({ modeData: data, modeUntil: new Date(until), modeLast: new Date(until) }).where(eq(squadRooms.id, roomId));
    }
    const ends = until ?? room.modeUntil.getTime();
    if (data.end && ends <= now) {
      const news = await toLobby(tx, { ...room, modeData: data }, ends, now);
      return { changed: until !== null, ended: true, gone: true, news };
    }
    return { changed: until !== null, ended: false, gone: false, news: null };
  });
  if (done.ended) await tellSquadPlay(roomId, backTell(done.news));
  else if (done.changed) await tellSquadPlay(roomId, { kind: "race" });
  return { over: done.gone, ended: done.ended };
}

/**
 * 加油 (tap: how many) or 跳 (jump) in 企鹅物流急件赛 (at: the server's clock as the page has it): the race settled
 * first, then kept, and told to the room with the next quarter second's
 */
export async function runRace(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  await settleRaceRoom(mine.room.id, now);
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    if (room.mode !== "race" || !roundOf(room)) throw refuse(409, T.server.squad.noMode);
    if (!me.modeIn) throw refuse(409, T.server.squad.notRacing);
    const data = structuredClone(room.modeData as RaceData);
    const did = runIn(data, me.handle, body, now);
    await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    return { roomId: room.id, did };
  });
  raceInRoom(done.roomId, done.did);
  return { now, ...done.did };
}

// ---- 基建加盖 ----

/**
 * 基建加盖's 放 (stack {do: drop, round, at}) by anyone in the room (a player; 人机 put none), on the room's tower as it
 * is now (a new round begun once one that fell has waited STACK_REBUILD_MS: squadMode.ts towerNow), beside whatever
 * mode plays: the room's highest kept (squad_rooms.stack_best), counted for 基建周榜, and told to the room with the
 * next quarter second's (never by the room read again).
 */
export async function stackDrop(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  if (body.do !== "drop") throw refuse(400, T.server.squad.badMode);
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const tower = structuredClone(towerNow(room.stack, room.createdAt.getTime(), now));
    const put = dropIn(tower, me.handle, body, now);
    const best = Math.max(room.stackBest, stackHeight(tower));
    await tx.update(squadRooms).set({ stack: tower, stackBest: best }).where(eq(squadRooms.id, room.id));
    await countBlock(tx, room.id, put, user.id, now);
    return { roomId: room.id, h: me.handle, put, best };
  });
  const { put } = done;
  stackInRoom(done.roomId, { h: done.h, x: put.x, at: put.at, round: put.round, n: put.n, ...(put.falls ? { falls: true as const } : {}), swingAt: put.swingAt });
  return { now, round: put.round, n: put.n, x: put.x, falls: put.falls, wobbles: put.wobbles, best: done.best, swingAt: put.swingAt };
}
