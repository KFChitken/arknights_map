import "server-only";
import { randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
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
  danceEnds,
  isModeKind,
  MODE_AGAIN_MS,
  type DanceSong,
} from "../squadMode";
import { db } from "./db";
import { HttpError } from "./http";
import { listenOpen } from "./listen";
import { squadListenSongNow } from "./listenRooms";
import { musicLink } from "./musicLinks";
import { squadMembers, squadRooms, type UserRow } from "./schema";
import { grayUntil, listenSettings } from "./siteSettings";
import { songList, songOf, type HeldSong } from "./songs";
import { danceInRoom, roomOf, tellSquadPlay } from "./squad";

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
  room.mode && room.modeUntil && room.modeLast ? danceEnds(room.modeUntil.getTime(), room.modeLast.getTime()) : null;

/** The room's mode gone, its members out of it; its opener may open another MODE_AGAIN_MS after it ended (at) */
async function endModeIn(tx: Tx, room: Pick<RoomRow, "id" | "modeBy">, at: number) {
  await tx
    .update(squadRooms)
    .set({ mode: null, modeBy: null, modeAt: null, modeSong: null, modeSongAt: null, modeUntil: null, modeLast: null })
    .where(eq(squadRooms.id, room.id));
  await tx
    .update(squadMembers)
    .set({ modeIn: false, modeCombo: 0, modeTapAt: null })
    .where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)));
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

/** One of 听歌's songs with beats to dance to, at random, or undefined when there is none */
async function anyDanceSong(rand: (n: number) => number): Promise<HeldSong | undefined> {
  const songs = [...(await songList()).byId.values()].filter((s) => beatsOf(s));
  return songs.length ? songs[rand(songs.length)] : undefined;
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
    .select({ userId: squadMembers.userId })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, mine.room.id), isNull(squadMembers.leftAt)));
  const [host] = await db.select({ hostId: squadRooms.hostId }).from(squadRooms).where(eq(squadRooms.id, mine.room.id));
  const together = host ? await squadListenSongNow({ id: mine.room.id, hostId: host.hostId, people: people.map((p) => p.userId) }, now) : null;
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
  const picked = song;
  const done = await db.transaction(async (tx) => {
    const { room, me } = await lockedMine(tx, user.id);
    const ends = endsOfMode(room);
    if (ends !== null && ends <= now) await endModeIn(tx, room, ends);
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
      .set({
        mode: body.kind as string,
        modeBy: me.handle,
        modeAt: new Date(now),
        modeSong: picked.id,
        modeSongAt: new Date(songAt),
        modeUntil: new Date(until),
        modeLast: new Date(now),
      })
      .where(eq(squadRooms.id, room.id));
    await tx
      .update(squadMembers)
      .set({ modeIn: true, modeCombo: 0, modeTapAt: null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
    return { roomId: room.id, h: me.handle };
  });
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
    await tx
      .update(squadMembers)
      .set({ modeIn: into, modeCombo: 0, modeTapAt: null })
      .where(and(eq(squadMembers.roomId, room.id), eq(squadMembers.handle, me.handle), isNull(squadMembers.leftAt)));
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
  const song = room?.mode === "dance" && room.song ? await songOf(room.song) : undefined;
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
  let n = 0;
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
