import { useSyncExternalStore } from "react";
import { T } from "@/i18n";
import { DRIFT_OK_S, heardAfter, indexCatalog, keepUp, roomAt, SYNC_EVERY_MS, type ListenTrack, type RoomSchedule } from "@/lib/listen";
import { listenApi } from "@/lib/listenClient";
import { WorldError } from "@/lib/world/types";

/**
 * The host's songs in a room of 一起卫戍, heard on this page (跟着听): an <audio> of its own, so 听歌's is never touched,
 * in step with the room's clock (src/lib/listen.ts roomAt) as 一起听's phones are (keepUp), each song's link from 听歌's
 * play, which counts the player against the 管理台's cap of those listening at once and for 热播榜 as listening alone
 * does. It sounds only after a tap (跟着听), and 不听 stops it, and the downloading with it. The smaller copy (省流量)
 * plays unless the player switched to the full one, kept in this browser. 听歌 starting stops it
 * (listening.ts stopSquadMusic), and it starting quiets 听歌 (setQuietListening, wired by MapApp.tsx), so the two
 * never sound together.
 */

function kept<S>(first: S) {
  let now = first;
  const fns = new Set<() => void>();
  return {
    get: () => now,
    set(next: S) {
      if (Object.is(next, now)) return;
      now = next;
      for (const fn of [...fns]) fn();
    },
    on(fn: () => void) {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
  };
}

/** What the room's player shows: following or not, what it does, the song, why it could not play */
export type SquadMusic = {
  following: boolean;
  status: "off" | "starting" | "playing" | "waiting";
  song: string | null;
  problem: string | null;
};
const OFF: SquadMusic = { following: false, status: "off", song: null, problem: null };
const music = kept<SquadMusic>(OFF);
export const useSquadMusic = () => useSyncExternalStore(music.on, music.get, () => OFF);
const set = (p: Partial<SquadMusic>) => music.set({ ...music.get(), ...p });

/** The songs' list, for their names and lengths (asked once, the browser keeping it while it is the server's) */
const tracksKept = kept<Map<string, ListenTrack> | null>(null);
export const useSquadTracks = () => useSyncExternalStore(tracksKept.on, tracksKept.get, () => null);
let loadingTracks: Promise<void> | null = null;
/** A song's name, when the list is in */
export const squadTrackName = (id: string) => tracksKept.get()?.get(id)?.name ?? null;
export function loadSquadTracks() {
  if (tracksKept.get() || loadingTracks) return loadingTracks ?? Promise.resolve();
  loadingTracks = listenApi
    .songs()
    .then((c) => tracksKept.set(indexCatalog(c)))
    .catch(() => {})
    .finally(() => {
      loadingTracks = null;
    });
  return loadingTracks;
}

// ---- 省流量 ----

const LITE = "squad.full";
/** The smaller copy unless the player chose the full one in this browser */
function liteOn() {
  try {
    return window.localStorage.getItem(LITE) !== "1";
  } catch {
    return true;
  }
}
const liteKept = kept(true);
export const useSquadLite = () => useSyncExternalStore(liteKept.on, liteKept.get, () => true);
export function setSquadLite(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(LITE);
    else window.localStorage.setItem(LITE, "1");
  } catch {}
  liteKept.set(on);
  // the song again from its link of the other size, where the room is
  if (music.get().following) {
    current = null;
    sync();
  }
}

// ---- in step with the room ----

let room: (RoomSchedule & { id: string }) | null = null;
/** The server's clock less this device's */
let offset = 0;
const serverNow = () => Date.now() + offset;
let audio: HTMLAudioElement | null = null;
/** The song in the element: which, when it starts by the room's clock, and whether its first 30 s are counted yet */
let current: { song: string; start: number; heard: boolean; fromStart: boolean } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
let asked = 0;
let quietListening: () => void = () => {};

/** How the page quiets 听歌 as the room's songs start (MapApp.tsx, so neither module loads the other) */
export function setQuietListening(fn: () => void) {
  quietListening = fn;
}

function element() {
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("playing", () => set({ status: "playing", problem: null }));
    audio.addEventListener("waiting", () => music.get().following && set({ status: "starting" }));
    audio.addEventListener("timeupdate", heardYet);
  }
  return audio;
}

/** A moment of silence, played within a tap so the songs after it may play too */
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";

/**
 * The room's songs as the room view or what it is told gives them, and the server's clock then (now). Followed, the
 * page plays along at once; null: out of the room, which stops it.
 */
export function squadSongs(next: (RoomSchedule & { id: string }) | null, now?: number) {
  if (now !== undefined) offset = now - Date.now();
  const was = room;
  room = next;
  if (!next) return unfollowSquad();
  if (was && was.id !== next.id) unfollowSquad();
  if (music.get().following) sync();
}

/** 跟着听, within the tap: the element unlocked, 听歌 quieted, and the room's song now */
export function followSquad() {
  const a = element();
  quietListening();
  a.src = SILENCE;
  a.play().catch(() => {});
  set({ following: true, problem: null, status: "starting" });
  liteKept.set(liteOn());
  void loadSquadTracks().then(sync);
  timer ??= setInterval(sync, SYNC_EVERY_MS);
}

/** 不听, or out of the room: nothing plays, nothing more downloads, and the server stops counting the player soon */
export function unfollowSquad() {
  const wasFollowing = music.get().following;
  stopHere();
  music.set(OFF);
  if (wasFollowing) listenApi.stop().catch(() => {});
}

/** 听歌 is starting (listening.ts): the room's songs stop here, as 听歌 takes over what the server counts */
export function stopSquadMusic() {
  if (!music.get().following) return;
  stopHere();
  music.set(OFF);
}

function stopHere() {
  ++asked;
  current = null;
  if (timer) clearInterval(timer);
  timer = null;
  if (soon) clearTimeout(soon);
  soon = null;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

const secondsOf = (id: string) => tracksKept.get()?.get(id)?.seconds ?? Number.NaN;

/** Where the room's song is now; what plays here follows it */
function sync() {
  if (!music.get().following || !room) return;
  if (!tracksKept.get()) return void loadSquadTracks().then(() => tracksKept.get() && sync());
  const now = serverNow();
  const at = roomAt(room, secondsOf, now);
  if (soon) clearTimeout(soon);
  soon = null;
  if (at.phase !== "playing") {
    // nothing to play: before the host starts, after the last song, or stopped
    if (current && audio) {
      ++asked;
      current = null;
      audio.pause();
    }
    return set({ status: "waiting", song: at.phase === "done" ? (room.queue[room.queue.length - 1] ?? null) : null });
  }
  const song = room.queue[at.i];
  if (at.offset < 0) {
    // between two songs: the next one when it starts
    if (audio && current?.song !== song) audio.pause();
    soon = setTimeout(sync, Math.max(0, -at.offset * 1000) + 30);
    return set({ status: "waiting", song });
  }
  const a = element();
  if (current && current.song === song && current.start === at.start && !a.paused) {
    const k = keepUp(a.currentTime - at.offset, false);
    if (k === "seek") a.currentTime = at.offset;
    else if (a.playbackRate !== k.rate) a.playbackRate = k.rate;
    return;
  }
  begin(song, at.start, at.offset, room.queue[at.i + 1] ?? null);
}

/** The room's song, from its link, gone on to where the room is */
function begin(song: string, start: number, at: number, next: string | null) {
  const mine = ++asked;
  current = { song, start, heard: false, fromStart: at < 1 };
  set({ status: "starting", song, problem: null });
  listenApi.play(song, at < 1 ? 0 : Math.floor(at), next).then(
    (p) => {
      if (mine !== asked) return;
      offset = p.now - Date.now();
      const a = element();
      a.src = liteKept.get() && p.lite ? p.lite : p.url;
      a.playbackRate = 1;
      const there = () => {
        if (mine !== asked) return;
        const want = (serverNow() - start) / 1000;
        if (want > DRIFT_OK_S && Math.abs(a.currentTime - want) > DRIFT_OK_S) a.currentTime = want;
      };
      a.addEventListener("loadedmetadata", there, { once: true });
      a.addEventListener("canplay", there, { once: true });
      a.play().catch(() => {
        if (mine === asked) set({ status: "waiting", problem: T.squad.dj.tapAgain });
      });
    },
    (e: unknown) => {
      if (mine !== asked) return;
      current = null;
      set({ status: "waiting", problem: e instanceof WorldError ? e.message : T.map.common.tryAgain });
    },
  );
}

/** 热播榜: a song heard from its start for 30 s (or a shorter one to its last second) counts once */
function heardYet() {
  const c = current;
  if (!c || c.heard || !c.fromStart || !audio) return;
  const len = secondsOf(c.song);
  if (!Number.isFinite(len) || audio.currentTime < heardAfter(len)) return;
  c.heard = true;
  listenApi.heard(c.song).catch(() => {});
}
