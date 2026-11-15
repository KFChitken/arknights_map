import { useSyncExternalStore } from "react";
import { T } from "@/i18n";
import { isGray, onGrayChange } from "@/lib/grayMode";
import { indexCatalog, nextOnAlbum, type ListenCatalog, type ListenTrack } from "@/lib/listen";
import { listenApi, ListenRefused } from "@/lib/listenClient";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "@/lib/world/types";
import { stopMusic } from "./amiyaMusic";
import { stopPartyMusic } from "./partyMusic";

/**
 * 听歌 on the map page: one <audio> for the whole page, never Web Audio (which would hold a song decoded, tens of MB).
 * It is made, and first played, within a tap, which is what lets a phone play it at all; every song after plays in
 * it too, so a phone asks for a tap only once a page. A song goes on to the next of its album by itself, which is
 * fetched early so it starts at once, and the album's last one stops it; the lock screen shows the song, with play,
 * pause and next. The page's other music (阿米娅向导's dance, ⚡舟友的酒⚡) keeps quiet while a song plays
 * (isListening), and the site going gray (全站变灰) fades it out. A page opened again offers the song it played, from
 * where it got to, for a tap.
 */

/** The next song is fetched this long before the one playing ends */
const EARLY_S = 20;
/** The server counts a player until the song should end, and a little more (listeningUntil): asked again within this */
const UNTIL_MARGIN_MS = 30_000;
/** The song playing and where it got to, kept for the page opened again in this tab (sessionStorage), this long */
const SAVED_KEY = "zhoup.listenAt";
const SAVED_MS = 12 * 3_600_000;
const SAVE_EVERY_MS = 5_000;
/** 新 on the entry until the panel is first opened, and the panel's line on privacy until 知道了 (localStorage) */
const INTRO_KEY = "zhoup.listenIntro";
/** The list of songs is asked for again when the panel opens this long after (the browser keeps it: mostly a 304) */
const SONGS_KEEP_MS = 10 * 60_000;
/** A song that breaks this often in a minute is given up */
const FIXES_MAX = 3;

export type ListenStatus = "idle" | "starting" | "playing" | "paused";

export type ListenPlayer = {
  /** The song playing, paused, or played last; null before the first */
  track: ListenTrack | null;
  /** starting: asked for, not sounding yet; playing; paused (by the player, or the album over) */
  status: ListenStatus;
  /** Waiting for more of the song to come */
  buffering: boolean;
  /** ▶ goes on with it: the page was opened again, or the browser would not start it without a tap */
  tap: boolean;
  /** Why the last song was refused or given up; code: what the server said (src/lib/listen.ts), if it did */
  problem: { message: string; code: string | null } | null;
};

export type ListenSongs =
  | { state: "none" | "loading" }
  | { state: "failed"; message: string }
  | { state: "ok"; catalog: ListenCatalog; tracks: Map<string, ListenTrack> };

/** 新: never opened; opened; ok: its line on privacy read (知道了) */
export type ListenIntro = "new" | "opened" | "ok";

// ---- what the page reads, through the hooks below ----

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

const IDLE: ListenPlayer = { track: null, status: "idle", buffering: false, tap: false, problem: null };
const NONE: ListenSongs = { state: "none" };
const player = kept<ListenPlayer>(IDLE);
const songs = kept<ListenSongs>(NONE);
/** The whole seconds the song has got to */
const second = kept(0);
const intro = kept(0);
const change = (p: Partial<ListenPlayer>) => player.set({ ...player.get(), ...p });

/** What plays, and the list of songs, now; and as hooks, following them */
export const listenPlayerNow = player.get;
export const listenSongsNow = songs.get;
export const useListenPlayer = () => useSyncExternalStore(player.on, player.get, () => IDLE);
export const useListenSongs = () => useSyncExternalStore(songs.on, songs.get, () => NONE);
export const useListenSecond = () => useSyncExternalStore(second.on, second.get, () => 0);
export const useListenIntro = () => useSyncExternalStore(intro.on, readIntro, () => "ok" as ListenIntro);

/** A song is playing, or about to: the guides' music keeps quiet (src/components/app/amiyaMusic.ts, partyMusic.ts) */
export function isListening() {
  const s = player.get().status;
  return s === "playing" || s === "starting";
}

// ---- the element, and what it holds ----

let audio: HTMLAudioElement | null = null;
/** The silent clip the element was unlocked with, or a song (current's) */
let holding: "silent" | "song" | null = null;
/** The song in the element, as the server gave it: the next one on its album, its link, and until when the server counts us */
let current: { track: ListenTrack; next: string | null; nextUrl: string | null; until: number; early: boolean } | null = null;
/** Counts what is asked of the server, so an answer that a later tap overtook is dropped */
let asked = 0;
/** Counts songs put in the element, so a seek or a fade meant for one is not done to the next */
let loads = 0;
/** Seconds the song got to */
let lastAt = 0;
/** The server counts us as listening, as far as we know; away: told we were going, so only for a little longer */
let counted = false;
let away = false;
/** The album's last song ended: ▶ plays it again from its start */
let ended = false;
let fixes: number[] = [];
let savedAt = 0;
/** How far the server's clock is ahead of ours (ms): the middle one of the last few answers */
const offsets: number[] = [];
let offset = 0;
let songsAt = 0;
let refusedTo: ((e: WorldError) => void) | null = null;
let watching = false;

function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "auto";
  a.addEventListener("playing", onPlaying);
  a.addEventListener("waiting", onWaiting);
  a.addEventListener("pause", onPause);
  a.addEventListener("ended", onEnded);
  a.addEventListener("error", onError);
  a.addEventListener("timeupdate", onTime);
  audio = a;
  if (!watching && typeof window !== "undefined") {
    watching = true;
    window.addEventListener("pagehide", onLeave);
    onGrayChange(() => {
      if (isGray()) silence();
    });
  }
  return a;
}

let silentUrl: string | null = null;
/** A tenth of a second of silence (8 kHz, 8 bits, one channel), which the element plays in the tap that unlocks it */
function silent(): string {
  if (silentUrl) return silentUrl;
  const n = 800;
  const b = new Uint8Array(44 + n);
  const v = new DataView(b.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  text(36, "data");
  v.setUint32(40, n, true);
  b.fill(128, 44);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return (silentUrl = `data:audio/wav;base64,${btoa(s)}`);
}

// ---- what the page does ----

/** A song from the list, from its start or `at` seconds in. Call it within the tap itself, which is what lets a phone play. */
export function playTrack(track: ListenTrack, at = 0) {
  if (isGray()) return;
  const a = element();
  // within the tap: a phone lets an element start only from one, and this one then plays every song after it
  holding = "silent";
  a.src = silent();
  a.play().catch(() => {});
  quietOthers();
  begin(track, at, null);
}

/** ▶ or ⏸, within the tap */
export function toggle() {
  const v = player.get();
  if (!v.track) return;
  if (v.status === "playing" || v.status === "starting") return pauseNow();
  if (isGray()) return;
  const a = element();
  if (ended || holding !== "song" || current?.track.id !== v.track.id) return playTrack(v.track, ended ? 0 : lastAt);
  // the server counts a player until the song should have ended: a pause that outlasted that asks again
  const left = Math.max(0, v.track.seconds - a.currentTime) * 1000;
  if (away || !counted || Date.now() + left > current.until - UNTIL_MARGIN_MS) return playTrack(v.track, a.currentTime);
  quietOthers();
  change({ status: "starting", buffering: true, tap: false, problem: null });
  a.play().catch(() => change({ status: "paused", buffering: false }));
}

/** The next song of the album, if there is one (the lock screen's ⏭) */
export function skip() {
  const v = player.get();
  const id = v.track && nextOnAlbum(v.track);
  const next = id ? tracks()?.get(id) : undefined;
  if (!v.track || !next || isGray()) return;
  quietOthers();
  begin(next, 0, current?.track.id === v.track.id && current.next === id ? current.nextUrl : null);
}

/** The list of songs, as the panel opens: asked for once, and again when it is old (the list held stays meanwhile) */
export function loadSongs() {
  const s = songs.get();
  if (s.state === "loading" || (s.state === "ok" && Date.now() - songsAt < SONGS_KEEP_MS)) return;
  if (s.state !== "ok") songs.set({ state: "loading" });
  listenApi.songs().then(
    (catalog) => {
      songsAt = Date.now();
      songs.set({ state: "ok", catalog, tracks: indexCatalog(catalog) });
      offerSaved();
    },
    (e: unknown) => {
      if (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded) refusedTo?.(e);
      if (songs.get().state === "ok") return;
      songs.set({ state: "failed", message: e instanceof WorldError ? e.message : T.requests.serverTrouble });
    },
  );
}

/** Who shows what the server asks first (to sign in, the age question, the privacy policy): the map page */
export function onListenRefused(fn: (e: WorldError) => void) {
  refusedTo = fn;
  return () => {
    if (refusedTo === fn) refusedTo = null;
  };
}

let introHere: ListenIntro | null = null;
function readIntro(): ListenIntro {
  if (introHere) return introHere;
  try {
    const v = localStorage.getItem(INTRO_KEY);
    return v === "opened" || v === "ok" ? v : "new";
  } catch {
    return "new";
  }
}

/** The panel was opened (新 goes), or its line on privacy read */
export function markIntro(to: "opened" | "ok") {
  const was = readIntro();
  if (was === to || was === "ok") return;
  introHere = to;
  try {
    localStorage.setItem(INTRO_KEY, to);
  } catch {}
  intro.set(intro.get() + 1);
}

/** The server's clock now (ms), as its answers put it */
export const serverNow = () => Date.now() + offset;

// ---- inside ----

const tracks = () => {
  const s = songs.get();
  return s.state === "ok" ? s.tracks : null;
};

function quietOthers() {
  stopMusic();
  stopPartyMusic();
}

/** Ask the server for the song, and play it: from `url` at once where the server gave it ahead, else from its answer */
function begin(track: ListenTrack, at: number, url: string | null) {
  const mine = ++asked;
  const next = nextOnAlbum(track);
  ended = false;
  lastAt = at;
  second.set(Math.floor(at));
  current = { track, next, nextUrl: null, until: 0, early: false };
  change({ track, status: "starting", buffering: true, tap: false, problem: null });
  meta(track);
  if (url) load(url, at);
  const sent = Date.now();
  listenApi.play(track.id, at, next).then(
    (r) => {
      if (mine !== asked) return;
      heard(r.now, sent, Date.now());
      counted = true;
      away = false;
      current = { track, next, nextUrl: r.nextUrl ?? null, until: r.until - offset, early: false };
      if (!url) load(r.url, at);
    },
    (e: unknown) => {
      if (mine === asked) refused(e);
    },
  );
}

function load(url: string, at: number) {
  const a = element();
  const mine = ++loads;
  holding = "song";
  a.src = url;
  if (at > 0) {
    a.addEventListener(
      "loadedmetadata",
      () => {
        if (mine === loads) a.currentTime = at;
      },
      { once: true },
    );
  }
  a.play().catch((e: unknown) => {
    // the browser would not start it without a tap (the first one did not unlock it): ▶ does
    if (mine === loads && (e as { name?: string } | null)?.name === "NotAllowedError") change({ status: "paused", buffering: false, tap: true });
  });
}

function heard(now: number, sent: number, got: number) {
  if (!Number.isFinite(now)) return;
  offsets.push(now - (sent + got) / 2);
  if (offsets.length > 5) offsets.shift();
  const sorted = [...offsets].sort((x, y) => x - y);
  offset = sorted[Math.floor(sorted.length / 2)];
}

function pauseNow() {
  ++asked;
  element().pause();
  change({ status: "paused", buffering: false });
  state("paused");
  save();
}

/** The album is over: the song stays shown, ▶ plays it again from its start */
function finish() {
  ++asked;
  ++loads;
  holding = null;
  current = null;
  ended = true;
  change({ status: "paused", buffering: false, tap: false });
  state("paused");
  stopCounting();
  forgetSaved();
}

/** A song refused (or the network failed it): nothing plays, and the player says why */
function refused(e: unknown) {
  unload();
  if (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded) {
    player.set(IDLE);
    refusedTo?.(e);
  } else {
    if (!(e instanceof WorldError)) console.error(e);
    const message = e instanceof WorldError ? e.message : T.map.common.tryAgain;
    player.set({ ...IDLE, problem: { message, code: e instanceof ListenRefused ? e.code : null } });
  }
  stopCounting();
  forgetSaved();
}

function unload() {
  ++loads;
  holding = null;
  current = null;
  const a = element();
  a.pause();
  a.removeAttribute("src");
  try {
    a.load();
  } catch {}
  meta(null);
}

function stopCounting() {
  if (!counted) return;
  counted = false;
  listenApi.stop().catch(() => {});
}

/** The site went gray: the song fades out and nothing plays until it is over (the entry is gone meanwhile) */
function silence() {
  const a = audio;
  if (!a || player.get().status === "idle") return;
  ++asked;
  const was = holding === "song" && !a.paused;
  const mine = ++loads;
  holding = null;
  current = null;
  ended = false;
  player.set(IDLE);
  meta(null);
  stopCounting();
  forgetSaved();
  if (!was) return void a.pause();
  // faded, as the guides' music is; a phone that keeps the volume to itself just stops
  const from = a.volume;
  let step = 0;
  const fade = setInterval(() => {
    step += 1;
    if (mine === loads && step < 10) {
      try {
        a.volume = Math.max(0, from * (1 - step / 10));
      } catch {}
      return;
    }
    clearInterval(fade);
    if (mine === loads) a.pause();
    try {
      a.volume = from;
    } catch {}
  }, 60);
}

function onPlaying() {
  if (holding !== "song" || element().paused) return;
  change({ status: "playing", buffering: false, tap: false });
  state("playing");
}

function onWaiting() {
  if (holding === "song" && player.get().status === "playing") change({ buffering: true });
}

function onPause() {
  const a = element();
  if (holding !== "song" || a.ended || player.get().status !== "playing") return;
  // stopped by the phone itself (a call, the headphones out)
  change({ status: "paused", buffering: false });
  state("paused");
  save();
}

function onEnded() {
  if (holding !== "song" || !current) return;
  const next = current.next ? tracks()?.get(current.next) : undefined;
  if (!next) return finish();
  // at once, from the link the server gave ahead, so a phone in a pocket goes on to it; the server is told meanwhile
  begin(next, 0, current.nextUrl);
}

function onError() {
  if (holding !== "song" || !current) return;
  // a link gone stale (each lasts 6 to 12 hours), or the network gave way: the song again, from where it got to
  const t = Date.now();
  fixes = fixes.filter((x) => t - x < 60_000);
  if (fixes.length >= FIXES_MAX) {
    const track = current.track;
    unload();
    stopCounting();
    player.set({ ...IDLE, track, status: "paused", problem: { message: T.listen.broken, code: null } });
    return;
  }
  fixes.push(t);
  begin(current.track, lastAt, null);
}

function onTime() {
  const a = element();
  if (holding !== "song" || !current) return;
  lastAt = a.currentTime;
  second.set(Math.floor(lastAt));
  const left = (Number.isFinite(a.duration) ? a.duration : current.track.seconds) - a.currentTime;
  if (!current.early && current.nextUrl && left <= EARLY_S) {
    current.early = true;
    // into the browser's cache, which the element then reads from; if it does not, the next song only starts a little later
    fetch(current.nextUrl)
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
  }
  if (Date.now() - savedAt > SAVE_EVERY_MS) save();
}

function onLeave() {
  save();
  if (!counted || away) return;
  away = true;
  listenApi.away();
}

// ---- kept for the page opened again ----

function save() {
  savedAt = Date.now();
  const v = player.get();
  if (!v.track || v.status === "idle" || ended) return forgetSaved();
  try {
    sessionStorage.setItem(SAVED_KEY, JSON.stringify({ song: v.track.id, at: Math.floor(lastAt), t: savedAt }));
  } catch {}
}

function forgetSaved() {
  try {
    sessionStorage.removeItem(SAVED_KEY);
  } catch {}
}

function offerSaved() {
  const v = player.get();
  const all = tracks();
  if (!all || v.track || v.status !== "idle") return;
  let was: { song?: unknown; at?: unknown; t?: unknown } | null = null;
  try {
    was = JSON.parse(sessionStorage.getItem(SAVED_KEY) ?? "null");
  } catch {}
  if (!was || typeof was.song !== "string" || typeof was.at !== "number" || typeof was.t !== "number" || Date.now() - was.t > SAVED_MS) return;
  const track = all.get(was.song);
  if (!track) return;
  lastAt = Math.min(Math.max(0, was.at), track.seconds);
  second.set(Math.floor(lastAt));
  player.set({ ...IDLE, track, status: "paused", tap: true });
}

// ---- the lock screen ----

const session = () => (typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null);

function handle(action: MediaSessionAction, fn: (() => void) | null) {
  try {
    session()?.setActionHandler(action, fn);
  } catch {}
}

/** What the lock screen shows (no cover), and its buttons: play and pause, and next where the album has one */
function meta(track: ListenTrack | null) {
  const ms = session();
  if (!ms) return;
  try {
    ms.metadata = track ? new MediaMetadata({ title: track.name, artist: track.artists.join(" / "), album: track.album.name }) : null;
  } catch {}
  handle("play", track ? () => !isListening() && toggle() : null);
  handle("pause", track ? () => isListening() && toggle() : null);
  handle("nexttrack", track && nextOnAlbum(track) ? skip : null);
  for (const action of ["previoustrack", "seekbackward", "seekforward", "seekto", "stop"] as const) handle(action, null);
  if (!track) ms.playbackState = "none";
}

function state(s: MediaSessionPlaybackState) {
  const ms = session();
  const a = audio;
  if (!ms || !a) return;
  ms.playbackState = s;
  try {
    if (Number.isFinite(a.duration)) ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: 1 });
  } catch {}
}

/** For tests: as on a page just opened */
export function forgetListening() {
  ++asked;
  ++loads;
  audio = null;
  holding = null;
  current = null;
  counted = false;
  away = false;
  ended = false;
  fixes = [];
  lastAt = 0;
  savedAt = 0;
  offsets.length = 0;
  offset = 0;
  songsAt = 0;
  introHere = null;
  player.set(IDLE);
  songs.set(NONE);
  second.set(0);
}
