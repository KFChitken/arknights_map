import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import { fmt, T } from "@/i18n";
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
  isModeKind,
  MODE_AGAIN_MS,
  modeEnds,
  quizUntil,
  type DanceSong,
  type GiftData,
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
import { danceInRoom, raceInRoom, roomOf, tellSquadPlay } from "./squad";
import { forgetGift, giftRooms, makeGift, passIn, reseatGift, settleGift, watchGift } from "./squadGift";
import { forgetRace, makeRace, raceLatest, relaneRace, runIn, settleRace, watchRace } from "./squadRace";
import { endQuiz, makeQuiz } from "./squadQuiz";

/**
 * 玩点什么 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑥; the rules in src/lib/squadMode.ts), kept on the room's row and its
 * members': the one mode playing, its opener, those in it. 开 (none playing, and not within MODE_AGAIN_MS of the end of
 * one's own last), 加入 and 不跳了 tell the room. 龙门广场舞: its song is 卫戍的一起听's while one plays (from where it
 * is), else one of 听歌's at random with a table of beats, DANCE_LEAD_MS on; each tap of 跳 is judged on the server's
 * clock against the song's beats, the combo kept on the member's row and told to the room with the next batch. A mode
 * over (its song ended, or DANCE_IDLE_MS since the last tap) is cleared by the next request to it, or by sweepModes
 * (the main process, every few seconds), which tells the room.
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

/**
 * The room's mode gone (a quiz's last wearing 漏勺 first), its members out of it; its opener may open another
 * MODE_AGAIN_MS after it ended (at)
 */
async function endModeIn(tx: Tx, room: Pick<RoomRow, "id" | "modeBy" | "mode" | "modeData">, at: number) {
  if (room.mode === "quiz") await endQuiz(tx, room.id, at);
  if (room.mode === "gift") forgetGift(room.id);
  if (room.mode === "race") forgetRace(room.id);
  await tx
    .update(squadRooms)
    .set({ mode: null, modeBy: null, modeAt: null, modeSong: null, modeSongAt: null, modeUntil: null, modeLast: null, modeData: null })
    .where(eq(squadRooms.id, room.id));
  // 企鹅物流急件赛: those who came in during it (in, with no lane) stay in for the next one
  const lanes = room.mode === "race" && room.modeData ? (room.modeData as RaceData).lanes.map((l) => l.h) : null;
  await tx
    .update(squadMembers)
    .set({ modeIn: false, modeCombo: 0, modeTapAt: null })
    .where(
      and(
        eq(squadMembers.roomId, room.id),
        isNull(squadMembers.leftAt),
        lanes ? or(eq(squadMembers.modeIn, false), inArray(squadMembers.handle, lanes.length ? lanes : [0])) : undefined,
      ),
    );
  if (room.modeBy !== null) {
    await tx
      .update(squadMembers)
      .set({ modeAgainAt: new Date(at + MODE_AGAIN_MS) })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, room.modeBy), isNull(squadMembers.leftAt)));
  }
}

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

// ---- 开, 加入, 不跳了 ----

/**
 * 开 a mode (玩点什么, kind): none playing in the room (one over is cleared first), and the player not within
 * MODE_AGAIN_MS of the end of the last they opened. 龙门广场舞 dances to 卫戍的一起听's song while one plays with
 * LISTEN_LEFT_MS or more left of it (from where it is), else to one of 听歌's at random with beats, from its start
 * DANCE_LEAD_MS on. Its opener is in it; the room is told.
 */
export async function openMode(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now(), rand: (n: number) => number = randomInt) {
  if (!isModeKind(body.kind)) throw refuse(400, T.server.squad.badMode);
  const mine = await roomOf(db, user.id);
  if (!mine) throw notInRoom();
  const people = await db
    .select({ u: users })
    .from(squadMembers)
    .innerJoin(users, eq(users.id, squadMembers.userId))
    .where(and(eq(squadMembers.roomId, mine.room.id), isNull(squadMembers.leftAt)));
  let fields: Pick<RoomRow, "modeSong" | "modeSongAt" | "modeUntil" | "modeLast" | "modeData">;
  let gift: GiftData | null = null;
  let race: RaceData | null = null;
  if (body.kind === "quiz") {
    const quiz: QuizData | null = await makeQuiz(
      people.map((p) => p.u),
      now,
      rand,
    );
    if (!quiz) throw refuse(409, T.server.squad.noQuiz);
    const until = new Date(quizUntil(quiz.qs));
    fields = { modeSong: null, modeSongAt: null, modeUntil: until, modeLast: until, modeData: quiz };
  } else if (body.kind === "race") {
    // its lanes: the opener, then those who asked for the next race, as they asked
    const queued = await db
      .select({ h: squadMembers.handle })
      .from(squadMembers)
      .where(and(eq(squadMembers.roomId, mine.room.id), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true), ne(squadMembers.handle, mine.me.handle)))
      .orderBy(asc(squadMembers.modeTapAt), asc(squadMembers.handle));
    race = await makeRace(
      mine.room.id,
      [mine.me.handle, ...queued.map((q) => q.h)],
      now,
      rand,
    );
    const until = new Date(raceLatest(race.start));
    fields = { modeSong: null, modeSongAt: null, modeUntil: until, modeLast: until, modeData: race };
  } else if (body.kind === "gift") {
    // its rounds, and a song to drum to: 一起听's while one plays (from where it is), else one long enough at random
    gift = await makeGift(mine.room.id, mine.me.handle, now, rand);
    const until = giftUntil(gift.plan);
    const [host] = await db.select({ hostId: squadRooms.hostId }).from(squadRooms).where(eq(squadRooms.id, mine.room.id));
    const together = host ? await squadListenSongNow({ id: mine.room.id, hostId: host.hostId, people: people.map((p) => p.u.id) }, now) : null;
    const listenSong = together ? await songOf(together.song) : undefined;
    const song = together && listenSong && beatsOf(listenSong) ? listenSong : await anyDanceSong(rand, until - now - GIFT_LEAD_MS);
    if (!song) throw refuse(409, T.server.squad.noGiftSong);
    const songAt = song === listenSong && together ? together.start : now + GIFT_LEAD_MS;
    fields = { modeSong: song.id, modeSongAt: new Date(songAt), modeUntil: new Date(until), modeLast: new Date(until), modeData: gift };
  } else {
    const [host] = await db.select({ hostId: squadRooms.hostId }).from(squadRooms).where(eq(squadRooms.id, mine.room.id));
    const together = host ? await squadListenSongNow({ id: mine.room.id, hostId: host.hostId, people: people.map((p) => p.u.id) }, now) : null;
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
    const ends = endsOfMode(room);
    // a race settled (its results showing) gives way to the next at once (再来一场)
    const settled = room.mode === "race" && Boolean((room.modeData as RaceData | null)?.end);
    if (ends !== null && (ends <= now || settled)) await endModeIn(tx, room, Math.min(ends, now));
    else if (ends !== null) throw refuse(409, T.server.squad.modeOn);
    // the opener's own wait, as it is now (the mode just cleared may have been theirs)
    const [fresh] = await tx
      .select({ again: squadMembers.modeAgainAt })
      .from(squadMembers)
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
    const again = fresh?.again?.getTime() ?? 0;
    if (again > now) throw refuse(429, fmt(T.server.squad.modeAgain, { s: Math.ceil((again - now) / 1000) }));
    await tx
      .update(squadRooms)
      .set({ mode: body.kind as string, modeBy: me.handle, modeAt: new Date(now), ...fields })
      .where(eq(squadRooms.id, room.id));
    // everyone else out of it, but those with a lane of this race (who asked for it, or ran the last one: 再来一场)
    const lanes = race ? race.lanes.map((l) => l.h).filter((h) => h >= 0 && h !== me.handle) : [];
    await tx
      .update(squadMembers)
      .set({ modeIn: false, modeCombo: 0, modeTapAt: null })
      .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), ne(squadMembers.handle, me.handle), lanes.length ? notInArray(squadMembers.handle, lanes) : undefined));
    if (lanes.length) {
      await tx
        .update(squadMembers)
        .set({ modeIn: true, modeCombo: 0 })
        .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt), inArray(squadMembers.handle, lanes)));
    }
    await tx
      .update(squadMembers)
      .set({ modeIn: true, modeCombo: 0, modeTapAt: body.kind === "gift" || race ? new Date(now) : null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
    return { roomId: room.id, h: me.handle };
  });
  if (gift) watchGift(done.roomId, gift, (id) => settleRoom(id));
  if (race) watchRace(done.roomId, race, (id) => settleRaceRoom(id));
  await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: true });
  return { now };
}

/** 加入 (in, from watching it) or 不跳了，去围观 (out): the mode playing, the combo from 0; the room told */
export async function joinMode(user: Pick<UserRow, "id">, body: Record<string, unknown>, now = Date.now()) {
  const into = body.in !== false;
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const ends = endsOfMode(room);
    if (ends === null || ends <= now) throw refuse(409, T.server.squad.noMode);
    // in a quiz, one coming in answers from the next question on (as having answered this one); in W 的礼物, when one
    // came is where they sit, from the next round on
    await tx
      .update(squadMembers)
      .set({ modeIn: into, modeCombo: 0, modeTapAt: into && (room.mode === "quiz" || room.mode === "gift" || room.mode === "race") ? new Date(now) : null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
    if (room.mode === "gift" && room.modeData) {
      const data = structuredClone(room.modeData as GiftData);
      if (await reseatGift(tx, room.id, data, now)) await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    }
    if (room.mode === "race" && room.modeData) {
      const data = structuredClone(room.modeData as RaceData);
      if (relaneRace(data, me.handle, into, now)) await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    }
    return { roomId: room.id, h: me.handle };
  });
  await tellSquadPlay(done.roomId, { kind: "mode", h: done.h, on: into });
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
 * The main process, every few seconds: the modes over (their song ended, or DANCE_IDLE_MS since the last tap)
 * cleared, and their rooms told. Says how many.
 */
export async function sweepModes(now = Date.now()) {
  let n = 0;
  // W 的礼物's rounds whose song stopped, and races over, with no one there to see it (their own timers gone with a process)
  for (const id of await giftRooms()) await settleRoom(id, now);
  for (const id of await raceRooms()) if ((await settleRaceRoom(id, now)).over) n += 1;
  const over = await db
    .select()
    .from(squadRooms)
    .where(
      and(
        isNull(squadRooms.endedAt),
        isNotNull(squadRooms.mode),
        or(lte(squadRooms.modeUntil, new Date(now)), lte(squadRooms.modeLast, new Date(now - DANCE_IDLE_MS))),
      ),
    );
  for (const r of over) {
    const ended = await db.transaction(async (tx) => {
      const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, r.id)).for("update");
      const ends = room ? endsOfMode(room) : null;
      if (!room || ends === null || ends > now) return false;
      await endModeIn(tx, room, ends);
      return true;
    });
    if (ended) {
      n += 1;
      await tellSquadPlay(r.id, { kind: "mode", on: false });
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
    if (!room || room.endedAt || room.mode !== "gift" || !room.modeData) return { changed: false, ended: false };
    const data = structuredClone(room.modeData as GiftData);
    const { changed, empty } = await settleGift(tx, roomId, data, now);
    if (changed) await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, roomId));
    if (empty) await endModeIn(tx, room, now);
    return { changed, ended: empty };
  });
  if (done.ended) await tellSquadPlay(roomId, { kind: "mode", on: false });
  else if (done.changed) await tellSquadPlay(roomId, { kind: "gift" });
  return done;
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
    if (room.mode !== "gift" || !room.modeData || ends === null || ends <= now) throw refuse(409, T.server.squad.noMode);
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
 * the room told; and ended at that end. Its own timer, the sweep and every 加油 or 跳 come here. over: it is gone.
 */
export async function settleRaceRoom(roomId: string, now = Date.now()) {
  const done = await db.transaction(async (tx) => {
    const [room] = await tx.select().from(squadRooms).where(eq(squadRooms.id, roomId)).for("update");
    if (!room || room.endedAt || room.mode !== "race" || !room.modeData || !room.modeUntil) return { changed: false, ended: false, gone: true };
    const data = structuredClone(room.modeData as RaceData);
    const until = await settleRace(tx, roomId, data, now);
    if (until !== null) {
      await tx.update(squadRooms).set({ modeData: data, modeUntil: new Date(until), modeLast: new Date(until) }).where(eq(squadRooms.id, roomId));
    }
    const ends = until ?? room.modeUntil.getTime();
    if (data.end && ends <= now) {
      await endModeIn(tx, { ...room, modeData: data }, ends);
      return { changed: until !== null, ended: true, gone: true };
    }
    return { changed: until !== null, ended: false, gone: false };
  });
  if (done.ended) await tellSquadPlay(roomId, { kind: "mode", on: false });
  else if (done.changed) await tellSquadPlay(roomId, { kind: "race" });
  return { over: done.gone };
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
    if (room.mode !== "race" || !room.modeData) throw refuse(409, T.server.squad.noMode);
    if (!me.modeIn) throw refuse(409, T.server.squad.notRacing);
    const data = structuredClone(room.modeData as RaceData);
    const did = runIn(data, me.handle, body, now);
    await tx.update(squadRooms).set({ modeData: data }).where(eq(squadRooms.id, room.id));
    return { roomId: room.id, did };
  });
  raceInRoom(done.roomId, done.did);
  return { now, ...done.did };
}
