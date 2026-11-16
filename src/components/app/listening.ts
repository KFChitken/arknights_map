import { useSyncExternalStore } from "react";
import { fmt, T } from "@/i18n";
import { isGray, onGrayChange } from "@/lib/grayMode";
import {
  clock,
  COVER_PX,
  coverLink,
  DRIFT_OK_S,
  heardAfter,
  indexCatalog,
  isRx,
  keepUp,
  nextInList,
  nextOnAlbum,
  roomAt,
  RX_EVERY_MS,
  RX_MERGE_MS,
  RX_ROOM_FROM,
  RX_SHOW_MS,
  shuffleNext,
  SYNC_EVERY_MS,
  type HotSong,
  type InviteSent,
  type ListenCall,
  type ListenCatalog,
  type ListenFriend,
  type ListenFrom,
  type ListenRoom,
  type ListenTell,
  type ListenTrack,
  type QueueChange,
  type RoomAt,
  type RoomEnd,
  type SongSaid,
} from "@/lib/listen";
import { listenApi, ListenRefused } from "@/lib/listenClient";
import type { PassesDot } from "@/lib/passes";
import { siteDay } from "@/lib/siteDay";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError, type TouchResult } from "@/lib/world/types";
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
 *
 * A song tapped again (or ▶ after a long pause, or after the album's last) starts at once from the link the server gave
 * for it before, as the next song does, the server told meanwhile; the element still holding it goes on from what of it
 * came. Chrome keeps what came of a song in its cache, but Safari keeps nothing once the element plays another, so a
 * song left by a tap with all of it downloaded stays paused in an element of its own, the last two (KEPT_MAX), and a
 * tap on it goes on from that. One left part way is let go: kept, it would go on downloading, and on a slow line the
 * song after it would start later.
 *
 * 省流量: a song with a smaller copy (half the bytes, scripts/make-lite-music.mjs) plays that instead while it is on.
 * It is the player's own choice, kept in this browser; not chosen either way, it comes on by itself for the page once
 * a song has not sounded LITE_AFTER_MS after it was put in the element, or has waited that long for more of it: that
 * song goes over to its copy from where it got to, and the page says so once. Off, it never comes on by itself.
 *
 * 一起听: in a room the element plays what the room's songs say should play now (src/lib/listen.ts roomAt), by the
 * server's clock as its answers put it, and keeps in step with it (keepUp): every SYNC_EVERY_MS, as each song ends,
 * as the room is told something (heardListen, from the page's event stream), and as the page comes back into view.
 * Between two songs, and before the first, it plays silence, so a phone in a pocket goes on to the next one by itself.
 * A pause is the player's own: the room goes on, and ▶ goes back to where everyone is. 短评 float a moment
 * (useListenBubbles), the same one from several at once shown once, ×N. Someone in the room is touched (碰) or asked
 * to leave (请出去) by their number there; how you touched each of them from this page today stays while the room does
 * (useListenTouched).
 *
 * Alone, the first two rows of 短评 may be said to the song playing (sendRx): only how many times each is counted, and
 * the most said come back with each song played as 大家都在说 under it (useListenSaid). 想一起听 asks a 触须之交 who is
 * listening to invite you (askToListen); TA's 一起听 at it opens a room, or takes TA's own, and invites you (answerAsk).
 *
 * A song played alone goes on as the list it was tapped in (ListenFrom): 全部, to the next of its album; 收藏 and 热播榜,
 * to the next in that list, as it showed then, the last one stopping it. 随机播放 (the player's own choice, kept in this
 * browser, as 省流量 is) goes instead to a song of that list at random, none again until all of it played (a round),
 * and on for ever; the list's 随机播放 starts one so. ⏭ goes to what would come next by itself. 收藏 (useListenFavs) are
 * the player's own, kept by the server; 热播榜 (useListenHot) is everyone's. A song heard HEARD_S of (a shorter one, to
 * its last second), as it played on this page, alone or in a room, counts once for 热播榜 (the server checks it was
 * played that long).
 *
 * The bar under the song goes where it is tapped or dragged to (seekTo), and so does the lock screen's: alone, the
 * element goes there at once (or once the song's link came), the server told again only when going back makes the
 * song end after it stops counting us; a song shown but not in the element (a page opened again, an album over) plays
 * from there at ▶. In a room the host's bar alone does: the server moves the start of the song playing, and every
 * phone in it jumps there in the element it plays in, telling the server again as alone where the song now ends later
 * (a guest's bar only shows). A jump is never heard (热播榜).
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
/** A song that breaks this often in a minute is given up */
const FIXES_MAX = 3;
/** A clip of silence between a room's songs lasts this long at most (seconds); a longer wait is looked at again after */
const GAP_CLIP_S = 5;
/** A room's song fades out over this long as the room ends */
const END_FADE_MS = 2_000;
/** Who is in the room is asked again this long after the room was told it changed, at random, so not all at once */
const MEMBERS_AFTER_MS = [250, 1_500] as const;
/** A room's song that would not start for want of the network is tried again this long after; one refused waits for ▶ */
const RETRY_MS = 10_000;
/** The room is asked again as the page comes back into view, at most this often */
const BACK_EVERY_MS = 10_000;
/** 短评 and what happened in the room: this many kept to show at most (the page shows two of them) */
const BUBBLES_KEPT = 4;
/** A link the server gives lasts 6 to 12 hours (src/lib/server/musicLinks.ts): used again for this long after */
const LINK_KEEP_MS = 5 * 3_600_000;
/** Links kept, the latest given */
const LINKS_MAX = 200;
/** Songs left by a tap with all of them downloaded, each kept paused in an element of its own: this many */
const KEPT_MAX = 2;
/** 省流量 as the player chose it in this browser: on or off; not there, not chosen (localStorage) */
const LITE_KEY = "zhoup.listenLite";
/** A song not sounding this long after it went in the element, or waiting this long for more of it, goes over to its smaller copy */
const LITE_AFTER_MS = 3_000;
/** 随机播放 as the player chose it in this browser: on or off (localStorage); off until chosen */
const SHUFFLE_KEY = "zhoup.listenShuffle";
/** 收藏 and 热播榜 are asked for again as the panel opens this long after (热播榜 changes every 10 minutes at most) */
const FAVS_KEEP_MS = 10 * 60_000;
const HOT_KEEP_MS = 5 * 60_000;
/** Seconds of a song played between two looks that count as heard: more is a jump, not listening */
const HEARD_STEP_S = 5;

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

/** Your 收藏 (the latest first), and 热播榜, as the server last gave them */
export type ListenFavs = { state: "none" | "loading" } | { state: "failed"; message: string } | { state: "ok"; ids: string[] };
export type ListenHot = { state: "none" | "loading" } | { state: "failed"; message: string } | { state: "ok"; list: HotSong[] };

/** A line floating over the page: a 短评 (yours, someone's, or the same one from n at once), or what happened in the room */
export type ListenBubble = { key: number; text: string; kind: "me" | "rx" | "agg" | "sys" };
/** 短评 now: waiting (one every RX_EVERY_MS), or this song's used up (RX_PER_SONG) */
export type ListenRxState = { cool: boolean; full: boolean };

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

/** A bubble as kept: its 短评's number (merging: the same one within RX_MERGE_MS of the first), how many sent it */
type Bubble = ListenBubble & { r: number | null; n: number; first: number };

const IDLE: ListenPlayer = { track: null, status: "idle", buffering: false, tap: false, problem: null };
const NONE: ListenSongs = { state: "none" };
const NO_FAVS: ListenFavs = { state: "none" };
const NO_HOT: ListenHot = { state: "none" };
const NO_BUBBLES: Bubble[] = [];
const RX_FREE: ListenRxState = { cool: false, full: false };
const NO_SAID: SongSaid[] = [];
const player = kept<ListenPlayer>(IDLE);
const songs = kept<ListenSongs>(NONE);
/** The whole seconds the song has got to (in a room, where the room is) */
const second = kept(0);
const intro = kept(0);
const room = kept<ListenRoom | null>(null);
const bubbles = kept<Bubble[]>(NO_BUBBLES);
const rxNow = kept<ListenRxState>(RX_FREE);
/** What was said as the last room was over for you (ended, or you left), until you are in another */
const roomEnd = kept<string | null>(null);
/** How you touched someone in the room from this page today, by their number there: one bold touch is all a day */
const touchedIn = kept<{ room: string; day: string; by: Readonly<Record<number, "sneaky" | "bold">> } | null>(null);
/** 大家都在说 under each song, as the server last gave it with the song */
const said = kept<ReadonlyMap<string, SongSaid[]>>(new Map());
const favs = kept<ListenFavs>(NO_FAVS);
const hot = kept<ListenHot>(NO_HOT);
/** The list the song alone was tapped in (null: none yet, as 全部) */
const fromNow = kept<ListenFrom | null>(null);
const change = (p: Partial<ListenPlayer>) => player.set({ ...player.get(), ...p });

/** What plays, and the list of songs, now; and as hooks, following them */
export const listenPlayerNow = player.get;
export const listenSongsNow = songs.get;
export const useListenPlayer = () => useSyncExternalStore(player.on, player.get, () => IDLE);
export const useListenSongs = () => useSyncExternalStore(songs.on, songs.get, () => NONE);
export const useListenSecond = () => useSyncExternalStore(second.on, second.get, () => 0);
export const useListenIntro = () => useSyncExternalStore(intro.on, readIntro, () => "ok" as ListenIntro);
/** The room of 一起听 you are in (null: none), its 短评 floating, and whether you may send one now */
export const listenRoomNow = room.get;
export const listenBubblesNow = (): ListenBubble[] => bubbles.get();
export const listenRxNow = rxNow.get;
export const useListenRoom = () => useSyncExternalStore(room.on, room.get, () => null);
export const useListenBubbles = (): ListenBubble[] => useSyncExternalStore(bubbles.on, bubbles.get, () => NO_BUBBLES);
export const useListenRx = () => useSyncExternalStore(rxNow.on, rxNow.get, () => RX_FREE);
export const useListenRoomEnd = () => useSyncExternalStore(roomEnd.on, roomEnd.get, () => null);
export const useListenTouched = () => useSyncExternalStore(touchedIn.on, touchedIn.get, () => null);
/** 大家都在说 under a song: its most said 短评 (src/lib/listen.ts SongSaid), none before it was played on this page */
export const listenSaidNow = (song: string): SongSaid[] => said.get().get(song) ?? NO_SAID;
export const useListenSaid = (song: string | null) =>
  useSyncExternalStore(
    said.on,
    () => (song ? listenSaidNow(song) : NO_SAID),
    () => NO_SAID,
  );
const inRoom = () => room.get() !== null;
/** Only whether you are in a room, for what changes with that alone (a layout keeps 听歌's entry through the tutorial) */
export const useInListenRoom = () => useSyncExternalStore(room.on, inRoom, () => false);
/** Your 收藏 and 热播榜, as the server last gave them */
export const listenFavsNow = favs.get;
export const useListenFavs = () => useSyncExternalStore(favs.on, favs.get, () => NO_FAVS);
export const useListenHot = () => useSyncExternalStore(hot.on, hot.get, () => NO_HOT);

/** A song is playing, or about to: the guides' music keeps quiet (src/components/app/amiyaMusic.ts, partyMusic.ts) */
export function isListening() {
  const s = player.get().status;
  return s === "playing" || s === "starting";
}

// ---- the element, and what it holds ----

let audio: HTMLAudioElement | null = null;
/** The silent clip the element was unlocked with, silence between a room's songs, or a song (current's) */
let holding: "silent" | "gap" | "song" | null = null;
/**
 * The song in the element, as the server gave it: its smaller copy's link (省流量; null: none, or not given yet), the
 * next one (on its album, or in the room) and its links, until when the server counts us; and in a room, when the song
 * starts on the server's clock (null: played alone)
 */
let current: {
  track: ListenTrack;
  lite: string | null;
  next: string | null;
  nextUrl: string | null;
  nextLite: string | null;
  until: number;
  early: boolean;
  start: number | null;
} | null = null;
/** Counts what is asked of the server, so an answer that a later tap overtook is dropped */
let asked = 0;
/** Counts songs put in the element, so a seek or a fade meant for one is not done to the next */
let loads = 0;
/** Seconds the song got to */
let lastAt = 0;
/** Alone: a second gone to on the bar before the song's link came, to start there (null: none) */
let seekWanted: number | null = null;
/** In a room: the song playing moved by the host's seek, from its start to another; the element takes it on as it is */
let seeked: { from: number; to: number } | null = null;
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
/** The list as last answered (its JSON), and whether it is being asked for */
let songsText = "";
let songsAsking = false;
let refusedTo: ((e: WorldError) => void) | null = null;
let saidTo: ((text: string) => void) | null = null;
let watching = false;

/** The element was played within a tap on this page, so songs may start in it by themselves */
let unlocked = false;
/** In a room: paused by the player (▶ goes to where everyone is); playing a little faster or slower to catch up */
let selfPaused = false;
let catching = false;
/** In a room: the links the server gave ahead for the room's next song */
let ahead: { id: string; url: string; lite: string | null } | null = null;
/** In a room: a song that would not start (its start on the server's clock), not tried again before until */
let stuck: { start: number; until: number } | null = null;
let beat: ReturnType<typeof setInterval> | null = null;
let checkedAt = 0;
/** Where the room was when it was last looked at (placeKey), so a beat that finds it moved on looks again at once */
let syncedAt = "";
let gapTimer: ReturnType<typeof setTimeout> | undefined;
let membersTimer: ReturnType<typeof setTimeout> | undefined;
let rxTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts what is asked of the server about the room, so an answer that a later one overtook is dropped */
let roomAsked = 0;
let backAt = 0;
let bubbleKeys = 0;

/**
 * The links the server gave, by song (its smaller copy's too, if it has one), and when (this page's clock): a song
 * tapped again starts from its link at once
 */
const links = new Map<string, { url: string; lite: string | null; got: number }>();
/** The song alone in the element (not a room's), at which link, given when; null: silence, a room's song, or nothing */
let held: { song: string; url: string; got: number } | null = null;
/** Songs left by a tap, all of each downloaded, each paused in an element of its own (the oldest first) */
let keptSongs: { a: HTMLAudioElement; song: string; url: string; got: number }[] = [];

/** 随机播放 as chosen in this browser (undefined: not read yet); the songs of the list played this round */
let shuffleHere: "on" | "off" | undefined;
let played = new Set<string>();
/** Counts each change of 随机播放, for the hook */
const shuffleChanged = kept(0);
/** The song counted for 热播榜 (in a room, with its start): seconds of it heard, where it was at last, sent */
let heardNow: { song: string; start: number | null; s: number; last: number; sent: boolean } | null = null;
let favsAt = 0;
let hotAt = 0;
/** 收藏 changes asked of the server, one after another; how many are still to answer */
let favChain: Promise<unknown> = Promise.resolve();
let favsPending = 0;
/** Counts 收藏 changes, so a list asked for before one is not taken over what it made */
let favSeq = 0;

/** 省流量 as chosen in this browser (undefined: not read yet; null: not chosen); come on by itself on this page */
let liteHere: "on" | "off" | null | undefined;
let liteAuto = false;
/** The element plays a song's smaller copy */
let onLite = false;
/** Songs whose smaller copy would not play on this page: their own file instead */
const liteFailed = new Set<string>();
let slowTimer: ReturnType<typeof setTimeout> | undefined;
/** Counts each change of 省流量, for the hook */
const liteChanged = kept(0);

/** The element in use: made within a tap, the first time */
function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = make();
  watch();
  return audio;
}

/** Another element, within a tap: its events count only while it is the one in use */
function make(): HTMLAudioElement {
  const a = new Audio();
  a.preload = "auto";
  a.addEventListener("playing", onPlaying);
  a.addEventListener("waiting", onWaiting);
  a.addEventListener("pause", onPause);
  a.addEventListener("ended", onEnded);
  a.addEventListener("error", onError);
  a.addEventListener("timeupdate", onTime);
  return a;
}

/** What the element in use plays: a song alone (song: its id, so a tap on it again goes on in it), or else silence or a room's song */
function source(a: HTMLAudioElement, src: string, song: string | null) {
  a.src = src;
  const l = song ? links.get(song) : undefined;
  held = song ? { song, url: src, got: l && (l.url === src || l.lite === src) ? l.got : Date.now() } : null;
}

/** The links the server gave for a song (the next one's too), kept to start from at once when the song is tapped again */
function remember(song: string, url: string, lite: string | null) {
  const l = links.get(song);
  if (l?.url === url && l.lite === lite) return;
  links.delete(song);
  links.set(song, { url, lite, got: Date.now() });
  if (links.size > LINKS_MAX) links.delete(links.keys().next().value!);
}

/** A song's link to play now (its smaller copy's while 省流量 is on), still good */
function linkFor(song: string): string | null {
  const l = links.get(song);
  return l && Date.now() - l.got < LINK_KEEP_MS ? pick(song, l.url, l.lite) : null;
}

/** Which of a song's links to play: its smaller copy's while 省流量 is on, if it has one that plays */
function pick(song: string, url: string, lite: string | null | undefined): string {
  return lite && liteOn() && !liteFailed.has(song) ? lite : url;
}

/** The next song's link, as the server gave it with this one: its smaller copy's while 省流量 is on */
function nextLink(c: NonNullable<typeof current>): string | null {
  return c.next && c.nextUrl ? pick(c.next, c.nextUrl, c.nextLite) : null;
}

/** All of the song came, from its start: kept, it costs the line nothing more */
function allIn(a: HTMLAudioElement): boolean {
  const d = a.duration;
  const b = a.buffered;
  return Number.isFinite(d) && d > 0 && b.length === 1 && b.start(0) <= 0.5 && b.end(0) >= d - 0.5;
}

function drop(a: HTMLAudioElement) {
  a.pause();
  a.removeAttribute("src");
  try {
    a.load();
  } catch {}
}

function dropKept() {
  for (const k of keptSongs) drop(k.a);
  keptSongs = [];
}

/** The element in use, leaving its song for another: kept, paused, if all of the song came */
function keepNow(): boolean {
  const a = audio;
  if (!a || !held || a.error || !allIn(a) || Date.now() - held.got >= LINK_KEEP_MS) return false;
  a.pause();
  keptSongs.push({ a, ...held });
  held = null;
  return true;
}

/**
 * The element that still has the song, its link good, within a tap: the one in use, or one kept, which then is the
 * one in use (the one it takes over from is kept in turn if all of its song came, else let go); null: none has it
 */
function heldIn(song: string): HTMLAudioElement | null {
  const a = element();
  const now = Date.now();
  if (held?.song === song && now - held.got < LINK_KEEP_MS && !a.error) return a;
  const k = keptSongs.find((x) => x.song === song);
  if (!k) return null;
  keptSongs = keptSongs.filter((x) => x !== k);
  if (now - k.got >= LINK_KEEP_MS || k.a.error) {
    drop(k.a);
    return null;
  }
  if (!keepNow()) drop(a);
  audio = k.a;
  held = { song: k.song, url: k.url, got: k.got };
  return k.a;
}

/** The element a new song goes in, within the tap: the one in use, unless its song came whole and is kept; then another */
function forNew(): HTMLAudioElement {
  const a = element();
  if (!keepNow()) return a;
  // the oldest kept beyond KEPT_MAX makes way: its element plays the new song
  const el = keptSongs.length > KEPT_MAX ? keptSongs.shift()!.a : make();
  audio = el;
  return el;
}

// ---- 省流量 ----

function liteChoice(): "on" | "off" | null {
  if (liteHere !== undefined) return liteHere;
  try {
    const v = localStorage.getItem(LITE_KEY);
    liteHere = v === "on" || v === "off" ? v : null;
  } catch {
    liteHere = null;
  }
  return liteHere;
}

/** 省流量 is on: chosen, or come on by itself on this page (not chosen either way) */
function liteOn(): boolean {
  const c = liteChoice();
  return c === "on" || (c === null && liteAuto);
}

/**
 * A song just put in the element (mine: its count), or waiting for more of it: over to its smaller copy if it does not
 * sound within LITE_AFTER_MS; 省流量 then comes on for the page, said once, unless the player chose it either way
 */
function watchSlow(mine: number) {
  clearTimeout(slowTimer);
  if (onLite || liteChoice() === "off") return;
  slowTimer = setTimeout(() => {
    const p = player.get();
    // sounding by then, paused, or another song in
    if (mine !== loads || holding !== "song" || !(p.status === "starting" || (p.status === "playing" && p.buffering))) return;
    if (!toLite() || liteChoice() !== null || liteAuto) return;
    liteAuto = true;
    liteChanged.set(liteChanged.get() + 1);
    saidTo?.(T.listen.liteAuto);
  }, LITE_AFTER_MS);
}

/** The song in the element over to its smaller copy, from where it got to (in a room, to where the room is); false: it has none */
function toLite(): boolean {
  const a = audio;
  const c = current;
  if (!a || holding !== "song" || !c?.lite || onLite || liteFailed.has(c.track.id)) return false;
  if (c.start !== null) loadRoomSong(c.lite, c.start);
  else load(c.lite, Math.max(lastAt, a.currentTime || 0), c.track.id);
  return true;
}

/** 省流量 is on now (chosen, or come on by itself), and as a hook */
export const listenLiteNow = () => liteOn();
export const useListenLite = () => useSyncExternalStore(liteChanged.on, liteOn, () => false);

/**
 * The panel's 省流量 switch, within the tap, kept in this browser. On: the song playing goes over to its smaller copy at
 * once, unless all of it came already. Off: the next song plays its own file, the one playing going on as it is; and
 * 省流量 never comes on by itself again.
 */
export function setLite(on: boolean) {
  liteHere = on ? "on" : "off";
  liteAuto = false;
  try {
    localStorage.setItem(LITE_KEY, liteHere);
  } catch {}
  liteChanged.set(liteChanged.get() + 1);
  const s = player.get().status;
  if (on && audio && (s === "playing" || s === "starting") && !allIn(audio)) toLite();
  else if (!on) clearTimeout(slowTimer);
}

// ---- 随机播放, and what comes next ----

function shuffleOn(): boolean {
  if (shuffleHere === undefined) {
    try {
      shuffleHere = localStorage.getItem(SHUFFLE_KEY) === "on" ? "on" : "off";
    } catch {
      shuffleHere = "off";
    }
  }
  return shuffleHere === "on";
}

/** 随机播放 is on, and as a hook */
export const listenShuffleNow = () => shuffleOn();
export const useListenShuffle = () => useSyncExternalStore(shuffleChanged.on, shuffleOn, () => false);

/** The songs of a list, as its 随机播放 picks from them: 全部 without a search, every song */
function idsOf(f: ListenFrom | null): readonly string[] {
  if (f?.ids.length) return f.ids;
  const all = tracks();
  return all ? [...all.keys()] : [];
}

const sameFrom = (a: ListenFrom | null, b: ListenFrom) =>
  Boolean(a && a.view === b.view && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]));

/** The list a song is played from now on (another one: a new round of 随机播放) */
function goFrom(f: ListenFrom) {
  if (sameFrom(fromNow.get(), f)) return;
  fromNow.set(f);
  played = new Set();
}

/** The song to go on to after this one alone: at random from its list, else the next in it, or on its album (全部) */
function upNext(track: ListenTrack): string | null {
  const f = fromNow.get();
  if (shuffleOn()) {
    const pick = shuffleNext(idsOf(f), track.id, played);
    if (!pick) return null;
    if (pick.fresh) played = new Set([track.id]);
    return pick.next;
  }
  return f && f.view !== "all" ? nextInList(f.ids, track.id) : nextOnAlbum(track);
}

/** Whether ⏭ has a song to go to, alone */
function hasNext(): boolean {
  const t = player.get().track;
  if (!t || room.get() || isGray()) return false;
  if (current?.track === t && current.start === null) return current.next !== null;
  const f = fromNow.get();
  if (shuffleOn()) return idsOf(f).some((id) => id !== t.id);
  return (f && f.view !== "all" ? nextInList(f.ids, t.id) : nextOnAlbum(t)) !== null;
}
const nextKey = kept(0);
const onNext = (fn: () => void) => {
  const offs = [player.on(fn), shuffleChanged.on(fn), fromNow.on(fn), songs.on(fn), room.on(fn), nextKey.on(fn)];
  return () => offs.forEach((off) => off());
};
/** ⏭ in the player: whether there is a song to go to */
export const useListenHasNext = () => useSyncExternalStore(onNext, hasNext, () => false);

/**
 * The player's 随机播放 switch, kept in this browser. The song playing alone goes on to one at random of its list (or,
 * off, as its list goes) instead of the one it was to go to, whose link is asked for at once, so a phone in a pocket
 * still goes straight on to it.
 */
export function setShuffle(on: boolean) {
  shuffleHere = on ? "on" : "off";
  try {
    localStorage.setItem(SHUFFLE_KEY, shuffleHere);
  } catch {}
  shuffleChanged.set(shuffleChanged.get() + 1);
  const c = current;
  if (!c || c.start !== null || room.get()) return;
  const next = upNext(c.track);
  if (next === c.next) return;
  current = { ...c, next, nextUrl: null, nextLite: null, early: false };
  nextKey.set(nextKey.get() + 1);
  meta(c.track);
  // before the song's own answer, that answer asks for it
  const s = player.get().status;
  if (next && (s === "playing" || s === "starting") && c.until > 0) askAhead(current);
}

/**
 * The song playing asked for again, as going on with it from where it is (which counts nothing): for the next song's
 * link when the next one changed, and so the server counts us until it ends when a jump back made it end later
 */
function askAhead(c: NonNullable<typeof current>) {
  const sent = Date.now();
  listenApi.play(c.track.id, Math.max(1, Math.floor(lastAt)), c.next).then(
    (r) => {
      if (c.next && r.nextUrl) remember(c.next, r.nextUrl, r.nextLite ?? null);
      const now = current;
      if (!now || now.track !== c.track || now.next !== c.next || now.start !== null) return;
      heard(r.now, sent, Date.now());
      current = { ...now, nextUrl: r.nextUrl ?? null, nextLite: r.nextLite ?? null, until: r.until - offset };
    },
    // the next song then asks for its link as it starts
    () => {},
  );
}

/** ⏭ in the player, within the tap: the song this one would go on to by itself */
export function playNext() {
  const v = player.get();
  if (!v.track || room.get() || isGray()) return;
  const id = current?.track === v.track && current.start === null ? current.next : upNext(v.track);
  const next = id ? tracks()?.get(id) : undefined;
  if (next) playTrack(next);
}

/** A list's 随机播放, within the tap: 随机播放 on, and a song of the list at random, not the one playing (where there is another) */
export function shufflePlay(f: ListenFrom) {
  if (isGray() || room.get()) return;
  shuffleHere = "on";
  try {
    localStorage.setItem(SHUFFLE_KEY, shuffleHere);
  } catch {}
  shuffleChanged.set(shuffleChanged.get() + 1);
  goFrom(f);
  const ids = idsOf(f);
  // the song playing was just heard: not again soon
  const now = player.get().track?.id ?? "";
  if (now) played.add(now);
  const pick = shuffleNext(ids, now, played);
  if (pick?.fresh) played = new Set(now ? [now] : []);
  const id = pick?.next ?? (ids.length === 1 ? ids[0] : null);
  const track = id ? tracks()?.get(id) : undefined;
  if (track) playTrack(track);
}

// ---- 收藏 and 热播榜 ----

/** Your 收藏, as the panel opens: asked for once, and again when it is old (what is held stays meanwhile) */
export function loadFavs() {
  const f = favs.get();
  if (f.state === "loading" || (f.state === "ok" && (Date.now() - favsAt < FAVS_KEEP_MS || favsPending > 0))) return;
  if (f.state !== "ok") favs.set({ state: "loading" });
  const seq = favSeq;
  listenApi.favs().then(
    (r) => {
      // a change asked meanwhile answers with what it made of them
      if (seq !== favSeq || favsPending > 0) return;
      favsAt = Date.now();
      favs.set({ state: "ok", ids: r.favs });
    },
    (e: unknown) => {
      if (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded) refusedTo?.(e);
      if (favs.get().state === "ok") return;
      favs.set({ state: "failed", message: e instanceof WorldError ? e.message : T.requests.serverTrouble });
    },
  );
}

/**
 * A song put in your 收藏 (on) or taken out: shown so at once, then asked of the server, one change after another;
 * what the server made of them once all are answered. Refused, it is said, and 收藏 is as the server has it.
 */
export function setFav(song: string, on: boolean) {
  const f = favs.get();
  const ids = f.state === "ok" ? f.ids : [];
  if (f.state === "ok") favs.set({ state: "ok", ids: on ? [song, ...ids.filter((x) => x !== song)] : ids.filter((x) => x !== song) });
  favSeq += 1;
  favsPending += 1;
  favChain = favChain.then(() =>
    listenApi.fav(song, on).then(
      (r) => {
        favsPending -= 1;
        favsAt = Date.now();
        if (favsPending === 0) favs.set({ state: "ok", ids: r.favs });
      },
      (e: unknown) => {
        favsPending -= 1;
        failed(e);
        // as the server has them
        favsAt = 0;
        if (favsPending === 0) {
          if (favs.get().state === "ok") favs.set({ state: "ok", ids: on ? ids.filter((x) => x !== song) : ids });
          loadFavs();
        }
      },
    ),
  );
}

/** 热播榜, as the panel shows it: asked for once, and again when it is old (what is held stays meanwhile) */
export function loadHot() {
  const h = hot.get();
  if (h.state === "loading" || (h.state === "ok" && Date.now() - hotAt < HOT_KEEP_MS)) return;
  if (h.state !== "ok") hot.set({ state: "loading" });
  listenApi.hot().then(
    (r) => {
      hotAt = Date.now();
      hot.set({ state: "ok", list: r.hot });
    },
    (e: unknown) => {
      if (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded) refusedTo?.(e);
      if (hot.get().state === "ok") return;
      hot.set({ state: "failed", message: e instanceof WorldError ? e.message : T.requests.serverTrouble });
    },
  );
}

// ---- 热播榜: a song heard ----

/** A song begun (in a room, the one starting at start), from at seconds in: counted afresh, unless going on with it alone */
function hearFrom(track: ListenTrack, start: number | null, at: number) {
  const h = heardNow;
  if (h && h.song === track.id && h.start === start && at > 0) {
    h.last = at;
    return;
  }
  heardNow = { song: track.id, start, s: 0, last: at, sent: false };
}

/** As the song plays: what of it was heard, told to the server once there is HEARD_S of it */
function hearing(a: HTMLAudioElement, c: NonNullable<typeof current>) {
  const h = heardNow;
  if (!h || h.sent || h.song !== c.track.id || h.start !== c.start) return;
  const t = a.currentTime;
  const step = t - h.last;
  h.last = t;
  if (a.paused || !(step > 0 && step <= HEARD_STEP_S)) return;
  h.s += step;
  if (h.s < heardAfter(c.track.seconds)) return;
  h.sent = true;
  listenApi.heard(c.track.id).catch(() => {});
}

/** The page going, coming back into view, going gray: once a page */
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  window.addEventListener("pagehide", onLeave);
  window.addEventListener("pageshow", onBack);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onBack);
  onGrayChange(() => {
    if (isGray()) silence();
  });
}

const silentUrls = new Map<number, string>();
/** seconds of silence (8 kHz, 8 bits, one channel): a tenth of a second unlocks the element within a tap */
function silent(seconds = 0.1): string {
  const n = Math.max(80, Math.round(seconds * 10) * 800);
  const had = silentUrls.get(n);
  if (had) return had;
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
  const url = `data:audio/wav;base64,${btoa(s)}`;
  silentUrls.set(n, url);
  return url;
}

// ---- what the page does ----

/**
 * A song from the list, from its start or `at` seconds in; from: the list it was tapped in, which it goes on as (none:
 * as the song before it did). Call it within the tap itself, which is what lets a phone play.
 */
export function playTrack(track: ListenTrack, at = 0, from?: ListenFrom) {
  // in a room the room's songs play (the host adds to them instead)
  if (isGray() || room.get()) return;
  if (from) goFrom(from);
  quietOthers();
  unlocked = true;
  // still in an element: on from what of it came
  const had = heldIn(track.id);
  if (had) return again(had, track, at);
  const a = forNew();
  // within the tap: a phone lets an element start only from one, and this one then plays every song after it
  ++loads;
  holding = "silent";
  source(a, silent(), null);
  a.play().catch(() => {});
  begin(track, at, linkFor(track.id));
}

/** ▶ or ⏸, within the tap */
export function toggle() {
  if (room.get()) return roomToggle();
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

/** The song this one goes on to by itself, if there is one (the lock screen's ⏭); in a room, the host's 下一首 */
export function skip() {
  const r = room.get();
  if (r) {
    if (r.host) void hostQueue("next");
    return;
  }
  const v = player.get();
  const id = v.track && current?.track === v.track && current.start === null ? current.next : null;
  const next = id ? tracks()?.get(id) : undefined;
  if (!v.track || !next || isGray()) return;
  quietOthers();
  begin(next, 0, linkFor(next.id));
}

/**
 * To s seconds into the song shown (its last second at most), from the bar or the lock screen. Alone: there at once,
 * as it was (playing or paused); before its link came, from there once it does; a song shown but not in the element
 * (a page opened again, the album over) plays from there at ▶. In a room the host's moves everyone there (the server
 * moves the song's start), and what the server answered is what it gives back; a guest's does nothing.
 */
export function seekTo(s: number): Promise<boolean> | undefined {
  if (!Number.isFinite(s) || isGray()) return;
  const r = room.get();
  if (r) return r.host ? hostQueue({ seek: Math.max(0, s) }) : undefined;
  const v = player.get();
  if (!v.track) return;
  const at = Math.min(Math.max(0, s), Math.max(0, v.track.seconds - 1));
  lastAt = at;
  second.set(Math.floor(at));
  // a jump is not listening (热播榜)
  if (heardNow?.song === v.track.id) heardNow.last = at;
  const c = current;
  if (c && c.track === v.track && c.start === null) {
    // its link not come yet (the element silent, or still the song before)
    if (holding !== "song" || held?.song !== c.track.id) seekWanted = at;
    else {
      seekIn(element(), at);
      const on = v.status === "playing" || v.status === "starting";
      // the server counts us until the song should have ended: gone back past that, it is told again
      if (on && c.until > 0 && Date.now() + (v.track.seconds - at) * 1000 > c.until - UNTIL_MARGIN_MS) askAhead(c);
    }
  } else ended = false;
  positionAt(v.track.seconds, at);
  save();
}

/** The element to at seconds of its song: at once, or once it knows how long the song is */
function seekIn(a: HTMLAudioElement, at: number) {
  const mine = loads;
  if (a.readyState >= 1) {
    try {
      a.currentTime = at;
    } catch {}
    return;
  }
  a.addEventListener(
    "loadedmetadata",
    () => {
      if (mine === loads) a.currentTime = at;
    },
    { once: true },
  );
}

/**
 * The list of songs, each time the panel opens (mostly a 304: the browser keeps it), so new songs, covers and 省流量's
 * copies show at once; the list held stays meanwhile, and one answered the same as it changes nothing
 */
export function loadSongs() {
  const s = songs.get();
  if (s.state === "loading" || songsAsking) return;
  if (s.state !== "ok") songs.set({ state: "loading" });
  songsAsking = true;
  listenApi.songs().then(
    (catalog) => {
      songsAsking = false;
      const text = JSON.stringify(catalog);
      if (songs.get().state === "ok" && text === songsText) return;
      songsText = text;
      songs.set({ state: "ok", catalog, tracks: indexCatalog(catalog) });
      offerSaved();
      if (room.get()) syncRoom();
    },
    (e: unknown) => {
      songsAsking = false;
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

/** Who shows a short line of 一起听 (a toast): why a room ended, what a tap did, why it was refused; the map page */
export function onListenSaid(fn: (text: string) => void) {
  saidTo = fn;
  return () => {
    if (saidTo === fn) saidTo = null;
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

/**
 * Ask the server for the song, and play it: from `url` at once where the server gave it before (or ahead), else from
 * its answer; loaded: the element has it already, playing from `at`
 */
function begin(track: ListenTrack, at: number, url: string | null, loaded = false) {
  const mine = ++asked;
  seekWanted = null;
  played.add(track.id);
  const next = upNext(track);
  ended = false;
  lastAt = at;
  second.set(Math.floor(at));
  hearFrom(track, null, at);
  current = { track, lite: links.get(track.id)?.lite ?? null, next, nextUrl: null, nextLite: null, until: 0, early: false, start: null };
  // a song of its own: its own 短评
  if (rxNow.get().full) rxNow.set({ ...rxNow.get(), full: false });
  change({ track, status: "starting", buffering: true, tap: false, problem: null });
  meta(track);
  if (url && !loaded) load(url, at, track.id);
  const sent = Date.now();
  listenApi.play(track.id, at, next).then(
    (r) => {
      sawSaid(track.id, r.said);
      remember(track.id, r.url, r.lite ?? null);
      if (next && r.nextUrl) remember(next, r.nextUrl, r.nextLite ?? null);
      if (mine !== asked) return;
      heard(r.now, sent, Date.now());
      counted = true;
      away = false;
      // 随机播放 switched meanwhile: the song it now goes on to, whose link is asked for
      const goes = current?.track === track ? current.next : next;
      current = {
        track,
        lite: r.lite ?? null,
        next: goes,
        nextUrl: goes === next ? (r.nextUrl ?? null) : null,
        nextLite: goes === next ? (r.nextLite ?? null) : null,
        until: r.until - offset,
        early: false,
        start: null,
      };
      if (goes !== next && goes) askAhead(current);
      // gone to another second on the bar meanwhile: from there
      if (!url) load(pick(track.id, r.url, r.lite), seekWanted ?? at, track.id);
      seekWanted = null;
    },
    (e: unknown) => {
      if (mine === asked) refused(e);
    },
  );
}

function load(url: string, at: number, song: string) {
  const a = element();
  const mine = ++loads;
  holding = "song";
  source(a, url, song);
  onLite = url === current?.lite;
  watchSlow(mine);
  if (at > 0) {
    a.addEventListener(
      "loadedmetadata",
      () => {
        if (mine === loads) a.currentTime = at;
      },
      { once: true },
    );
  }
  start(a, mine);
}

/** The song still in its element (a tap on it again): on from `at` at once, within the tap; the server told meanwhile */
function again(a: HTMLAudioElement, track: ListenTrack, at: number) {
  const mine = ++loads;
  holding = "song";
  onLite = held!.url === links.get(track.id)?.lite;
  watchSlow(mine);
  if (a.ended || Math.abs(a.currentTime - at) > 0.5) {
    if (a.readyState >= 1) a.currentTime = at;
    else {
      a.addEventListener(
        "loadedmetadata",
        () => {
          if (mine === loads) a.currentTime = at;
        },
        { once: true },
      );
    }
  }
  start(a, mine);
  begin(track, at, held!.url, true);
}

function start(a: HTMLAudioElement, mine: number) {
  a.play().catch((e: unknown) => {
    // the browser would not start it without a tap (the first one did not unlock it): ▶ does
    if (mine === loads && (e as { name?: string } | null)?.name === "NotAllowedError") {
      unlocked = false;
      change({ status: "paused", buffering: false, tap: true });
    }
  });
}

/** 大家都在说 under a song, as its play answered (none: nothing said often enough yet) */
function sawSaid(song: string, list: SongSaid[] | undefined) {
  const was = said.get();
  const got = list?.length ? list : NO_SAID;
  if (JSON.stringify(was.get(song) ?? NO_SAID) === JSON.stringify(got)) return;
  const next = new Map(was);
  next.set(song, got);
  said.set(next);
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

/** A song refused (or the network failed it): nothing plays, and the player says why; the next tap asks first */
function refused(e: unknown) {
  unload();
  links.clear();
  dropKept();
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
  held = null;
  onLite = false;
  clearTimeout(slowTimer);
  drop(element());
  meta(null);
}

function stopCounting() {
  if (!counted) return;
  counted = false;
  listenApi.stop().catch(() => {});
}

/** The site went gray: the song fades out and nothing plays until it is over (the entry is gone meanwhile); a room ends */
function silence() {
  if (room.get()) return roomOver(null);
  const a = audio;
  dropKept();
  if (!a || player.get().status === "idle") return;
  ++asked;
  const was = holding === "song" && !a.paused;
  holding = null;
  current = null;
  ended = false;
  player.set(IDLE);
  meta(null);
  stopCounting();
  forgetSaved();
  if (!was) {
    ++loads;
    return void a.pause();
  }
  fadeOut(a, 600);
}

/** Faded over ms, as the guides' music is; a phone that keeps the volume to itself just stops */
function fadeOut(a: HTMLAudioElement, ms: number) {
  const mine = ++loads;
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
  }, ms / 10);
}

/** An event of the element in use; one kept, or let go, plays no part */
const inUse = (e: Event) => (e.target === audio ? audio : null);

function onPlaying(e: Event) {
  const a = inUse(e);
  if (!a || holding !== "song" || a.paused) return;
  clearTimeout(slowTimer);
  change({ status: "playing", buffering: false, tap: false });
  state("playing");
}

function onWaiting(e: Event) {
  if (!inUse(e) || holding !== "song" || player.get().status !== "playing") return;
  change({ buffering: true });
  // waiting for more of it: its smaller copy, if this goes on
  watchSlow(loads);
}

function onPause(e: Event) {
  const a = inUse(e);
  if (!a || holding !== "song" || a.ended || player.get().status !== "playing") return;
  // stopped by the phone itself (a call, the headphones out): in a room, as if the player paused it
  if (room.get()) selfPaused = true;
  change({ status: "paused", buffering: false });
  state("paused");
  save();
}

function onEnded(e: Event) {
  if (!inUse(e)) return;
  if (room.get()) {
    if (holding === "song" || holding === "gap") syncRoom();
    return;
  }
  if (holding !== "song" || !current) return;
  const next = current.next ? tracks()?.get(current.next) : undefined;
  if (!next) return finish();
  // at once, in the same element, from the link the server gave ahead, so a phone in a pocket goes on to it; the
  // server is told meanwhile
  begin(next, 0, nextLink(current) ?? linkFor(next.id));
}

function onError(e: Event) {
  if (!inUse(e)) {
    // one kept went wrong: let go
    const k = keptSongs.find((x) => x.a === e.target);
    if (k) {
      keptSongs = keptSongs.filter((x) => x !== k);
      drop(k.a);
    }
    return;
  }
  if (holding !== "song" || !current) return;
  // a smaller copy that would not play: the song's own file from now on
  if (onLite) liteFailed.add(current.track.id);
  // a link gone stale (each lasts 6 to 12 hours), or the network gave way: the song again, from where it got to, at a
  // new link
  links.delete(current.track.id);
  held = null;
  const t = Date.now();
  fixes = fixes.filter((x) => t - x < 60_000);
  const inRoom = current.start !== null && room.get();
  if (fixes.length >= FIXES_MAX) {
    const track = current.track;
    if (inRoom) stuck = { start: current.start!, until: Infinity };
    unload();
    stopCounting();
    player.set({ ...IDLE, track, status: "paused", problem: { message: T.listen.broken, code: null } });
    return;
  }
  fixes.push(t);
  if (!inRoom) return begin(current.track, lastAt, null);
  // the room's song again, with a new link, from where the room is now
  ++loads;
  holding = null;
  current = null;
  syncRoom();
}

function onTime(e: Event) {
  const a = inUse(e);
  if (!a || holding !== "song" || !current) return;
  hearing(a, current);
  lastAt = a.currentTime;
  // in a room the bar follows the room's clock (the beat), whatever this phone is at
  if (current.start === null) second.set(Math.floor(lastAt));
  const left = (Number.isFinite(a.duration) ? a.duration : current.track.seconds) - a.currentTime;
  const early = nextLink(current);
  if (!current.early && early && left <= EARLY_S) {
    current.early = true;
    // into the browser's cache, which the element then reads from; if it does not, the next song only starts a little later
    fetch(early)
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
  }
  if (Date.now() - savedAt > SAVE_EVERY_MS) save();
}

function onLeave() {
  save();
  // in a room, the server keeps your place for a while (AWAY_MS), for the page that comes straight back
  if (away || (!counted && !room.get())) return;
  away = true;
  listenApi.away();
}

/** The page is in view again (or back from the browser's cache): a room is asked again, in case anything was missed */
function onBack() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (!room.get()) return;
  const t = Date.now();
  if (!away && t - backAt < BACK_EVERY_MS) return;
  backAt = t;
  void loadRoom();
}

// ---- 一起听 ----

const lengthOf = (all: Map<string, ListenTrack>) => (id: string) => all.get(id)?.seconds ?? 0;

/** Where the room's songs are now, by the server's clock; null until the list of songs is in */
export function roomPlace(r: Pick<ListenRoom, "queue" | "idx" | "startedAt">): RoomAt | null {
  const all = tracks();
  return all ? roomAt(r, lengthOf(all), serverNow()) : null;
}

/** What placeKey tells apart: another song, its start come, the songs over or not begun */
const placeKey = (at: RoomAt) => (at.phase === "playing" ? `${at.i}@${at.start}${at.offset < 0 ? "-" : ""}` : at.phase);

const say = (text: string) => saidTo?.(text);

/** A tap that may start the room's songs: within it, the element plays (silence first), so the songs after may too */
function unlockNow() {
  if (isGray()) return;
  const a = element();
  quietOthers();
  if ((holding === "song" || holding === "gap") && !a.paused) {
    unlocked = true;
    return;
  }
  ++loads;
  holding = "silent";
  source(a, silent(), null);
  unlocked = true;
  a.play().catch((e: unknown) => {
    if ((e as { name?: string } | null)?.name === "NotAllowedError") unlocked = false;
  });
}

/** The room as the server answered (sent: when it was asked, got: when the answer came; now: the server's clock) */
function enter(next: ListenRoom, sent: number, got: number, now: number): boolean {
  heard(now, sent, got);
  watch();
  away = false;
  const was = room.get();
  let r = next;
  // the room's songs told since this answer was made stay
  if (was?.id === r.id && was.version > r.version) r = { ...r, queue: was.queue, idx: was.idx, startedAt: was.startedAt, version: was.version };
  if (was?.id !== r.id) {
    // a room new to the page: nothing of one before it is left, nor songs kept from playing alone (a room plays in
    // the element in use)
    dropKept();
    selfPaused = false;
    catching = false;
    ahead = null;
    stuck = null;
    syncedAt = "";
    bubbles.set(NO_BUBBLES);
    rxNow.set(RX_FREE);
    forgetSaved();
  } else cameWent(was, r);
  roomEnd.set(null);
  room.set(r);
  startBeat();
  // the songs' lengths are what the room's clock goes by: asked for first, if they are not in
  syncRoom();
  return Boolean(was && was.id === r.id && r.version > was.version);
}

/** Who came in and who went, since the room was last asked for */
function cameWent(was: ListenRoom, now: ListenRoom) {
  const inBefore = new Set(was.members.filter((m) => m.state === "in").map((m) => m.h));
  const inNow = new Set(now.members.filter((m) => m.state === "in").map((m) => m.h));
  for (const m of now.members) {
    if (m.h !== now.you && m.state === "in" && !inBefore.has(m.h)) sys(fmt(T.listen.came, { name: m.card.displayName }));
  }
  for (const m of was.members) {
    if (m.h !== now.you && inBefore.has(m.h) && !inNow.has(m.h)) sys(fmt(T.listen.went, { name: m.card.displayName }));
  }
}

/** Play what the room should be playing now, where it should be */
function syncRoom() {
  const r = room.get();
  if (!r || isGray()) return;
  const all = tracks();
  if (!all) return void loadSongs();
  const now = serverNow();
  const at = roomAt(r, lengthOf(all), now);
  checkedAt = Date.now();
  syncedAt = placeKey(at);
  if (at.phase !== "playing") return holdRoom(r, at, all);
  const track = all.get(r.queue[at.i]) ?? null;
  second.set(Math.max(0, Math.floor(at.offset)));
  if (!unlocked || selfPaused || (stuck?.start === at.start && Date.now() < stuck.until)) return waitRoom(track, at.start);
  if (!track || at.offset < 0) return gap(at.start - now, track);
  const a = element();
  if (inElement(at, track.id)) {
    if (!a.ended) return keepUpNow(a, at.offset);
    // over before the room's clock says (a file a little shorter than its length): silence until the next
    return gap(at.start + track.seconds * 1000 - now, track);
  }
  beginRoom(r, track, at.i, at.start);
}

/**
 * The room's song at (queue's id) is the one in the element: started at its start, or moved there by the host's seek
 * from the start the element had, which it then takes on (the same play, heard on as it was)
 */
function inElement(at: { start: number }, id: string): boolean {
  const c = current;
  if (holding !== "song" || !c || c.start === null || c.track.id !== id) return false;
  if (c.start === at.start) return true;
  if (!seeked || c.start !== seeked.from || at.start !== seeked.to) return false;
  if (heardNow && heardNow.start === c.start) heardNow.start = at.start;
  current = { ...c, start: at.start };
  seeked = null;
  roomAhead(current);
  return true;
}

/**
 * The room's song moved by the host's seek to end after the server stops counting us: asked for again, as going on
 * with it from where the room is (which counts nothing), so it counts us until it ends
 */
function roomAhead(c: NonNullable<typeof current>) {
  if (c.start === null || !(c.until > 0)) return;
  const at = (serverNow() - c.start) / 1000;
  if (Date.now() + (c.track.seconds - at) * 1000 <= c.until - UNTIL_MARGIN_MS) return;
  const sent = Date.now();
  listenApi.play(c.track.id, Math.max(1, Math.floor(at)), c.next).then(
    (p) => {
      const now = current;
      if (!now || now.track !== c.track || now.start !== c.start) return;
      heard(p.now, sent, Date.now());
      current = { ...now, until: p.until - offset };
    },
    // counted a little less long, at worst: the next song asks again as it starts
    () => {},
  );
}

/** The host went to another second of the song playing: it starts at `to` now, whatever start the element has */
function sawSeek(to: number | null) {
  if (to !== null && current?.start != null) seeked = { from: current.start, to };
}

/** Silence until the room's next song starts (ms from now), so the element goes on by itself; then that song */
function gap(ms: number, track: ListenTrack | null) {
  const a = element();
  clearTimeout(gapTimer);
  gapTimer = setTimeout(syncRoom, Math.max(0, ms) + 30);
  const p = player.get();
  if (p.status !== "starting" || p.buffering || p.tap || p.problem || (track && p.track !== track)) {
    change({ track: track ?? p.track, status: "starting", buffering: false, tap: false, problem: null });
  }
  if (holding === "gap" && !a.paused && !a.ended) return;
  ++loads;
  holding = "gap";
  catching = false;
  setRate(a, 1);
  source(a, silent(Math.min(GAP_CLIP_S, Math.max(0.1, ms / 1000))), null);
  a.play().catch(() => {});
}

/** The room's song shown, not playing here: the browser wants a tap first, the player paused it, or it would not start */
function waitRoom(track: ListenTrack | null, start: number) {
  clearTimeout(gapTimer);
  const a = audio;
  if (a && (holding === "song" || holding === "gap") && !a.paused) {
    ++asked;
    a.pause();
  }
  if (holding === "gap") holding = null;
  const p = player.get();
  const problem = stuck?.start === start ? p.problem : null;
  const tap = !unlocked;
  if (p.status === "paused" && !p.buffering && p.tap === tap && p.problem === problem && (!track || p.track === track)) return;
  change({ track: track ?? p.track, status: "paused", buffering: false, tap, problem });
}

/** Nothing plays in the room: before the host starts it, or after its last song; its first or last song shown */
function holdRoom(r: ListenRoom, at: RoomAt, all: Map<string, ListenTrack>) {
  clearTimeout(gapTimer);
  if (holding === "song" || holding === "gap") {
    ++asked;
    ++loads;
    holding = null;
    current = null;
    audio?.pause();
    meta(null);
  }
  stopCounting();
  catching = false;
  const id = at.phase === "done" ? r.queue[r.queue.length - 1] : r.queue[Math.max(0, r.idx)];
  const track = (id && all.get(id)) || null;
  second.set(at.phase === "done" && track ? Math.floor(track.seconds) : 0);
  const p = player.get();
  if (p.track === track && p.status === "paused" && !p.buffering && !p.tap && !p.problem) return;
  player.set({ track, status: "paused", buffering: false, tap: false, problem: null });
}

/** The room's song i, started (or to start) at start: from the link given ahead at once, else from the server's answer */
function beginRoom(r: ListenRoom, track: ListenTrack, i: number, start: number) {
  const mine = ++asked;
  clearTimeout(gapTimer);
  seeked = null;
  const next = r.queue[i + 1] ?? null;
  // a song of its own: its own 短评
  if (current?.start !== start && rxNow.get().full) rxNow.set({ ...rxNow.get(), full: false });
  const given = ahead?.id === track.id ? ahead : null;
  ahead = null;
  current = { track, lite: given?.lite ?? null, next, nextUrl: null, nextLite: null, until: 0, early: false, start };
  hearFrom(track, start, (serverNow() - start) / 1000);
  stuck = null;
  change({ track, status: "starting", buffering: true, tap: false, problem: null });
  meta(track);
  const url = given ? pick(track.id, given.url, given.lite) : null;
  if (url) loadRoomSong(url, start);
  const sent = Date.now();
  const at = (serverNow() - start) / 1000;
  // one started within its first second counts as played from its start
  listenApi.play(track.id, at < 1 ? 0 : Math.floor(at), next).then(
    (p) => {
      sawSaid(track.id, p.said);
      if (mine !== asked) return;
      heard(p.now, sent, Date.now());
      counted = true;
      away = false;
      // this song, at its start or at the one the host's seek moved it to meanwhile
      if (current?.track === track && current.start !== null) {
        current = { ...current, lite: p.lite ?? null, nextUrl: p.nextUrl ?? null, nextLite: p.nextLite ?? null, until: p.until - offset };
      }
      ahead = next && p.nextUrl ? { id: next, url: p.nextUrl, lite: p.nextLite ?? null } : null;
      if (!url) loadRoomSong(pick(track.id, p.url, p.lite), start);
    },
    (e: unknown) => {
      if (mine === asked) roomSongRefused(e, track, start);
    },
  );
}

/** The room's song from its link, gone on to where the room is once the element knows enough of it */
function loadRoomSong(url: string, start: number) {
  const a = element();
  const mine = ++loads;
  holding = "song";
  catching = false;
  source(a, url, null);
  onLite = url === current?.lite;
  watchSlow(mine);
  setRate(a, 1);
  // joining part way, or a slow network: once it can play, to where the room is by then
  const catchUp = () => {
    if (mine !== loads || a.seeking) return;
    const want = (serverNow() - (current?.start ?? start)) / 1000;
    if (want > DRIFT_OK_S && Math.abs(a.currentTime - want) > DRIFT_OK_S) a.currentTime = want;
  };
  a.addEventListener("loadedmetadata", catchUp, { once: true });
  a.addEventListener("canplay", catchUp, { once: true });
  a.play().catch((e: unknown) => {
    if (mine === loads && (e as { name?: string } | null)?.name === "NotAllowedError") {
      unlocked = false;
      change({ status: "paused", buffering: false, tap: true });
    }
  });
}

/** A room's song refused: the player says why; not tried again until ▶, or a while when the network gave way */
function roomSongRefused(e: unknown, track: ListenTrack, start: number) {
  const first = e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded;
  if (!first && !(e instanceof WorldError)) console.error(e);
  stuck = { start, until: first || e instanceof ListenRefused ? Infinity : Date.now() + RETRY_MS };
  if (holding === "song" || holding === "gap") {
    ++loads;
    holding = null;
    audio?.pause();
  }
  current = null;
  const message = e instanceof WorldError ? e.message : T.map.common.tryAgain;
  player.set({ ...IDLE, track, status: "paused", problem: first ? null : { message, code: e instanceof ListenRefused ? e.code : null } });
  if (first) refusedTo?.(e as WorldError);
}

/** In step with the room: want is where it is (seconds into the song) */
function keepUpNow(a: HTMLAudioElement, want: number) {
  if (a.paused || a.seeking || a.readyState < 3) return;
  const k = keepUp(a.currentTime - want, catching);
  if (k === "seek") {
    catching = false;
    setRate(a, 1);
    a.currentTime = want;
    // a jump is not listening (热播榜)
    if (heardNow) heardNow.last = want;
    return;
  }
  catching = k.rate !== 1;
  setRate(a, k.rate);
}

function setRate(a: HTMLAudioElement, rate: number) {
  try {
    if (a.playbackRate !== rate) a.playbackRate = rate;
  } catch {}
}

/** ▶ or ⏸ in a room: ⏸ pauses only you; ▶ goes back to where everyone is now */
function roomToggle() {
  const v = player.get();
  if (v.status === "playing" || v.status === "starting") {
    selfPaused = true;
    ++asked;
    clearTimeout(gapTimer);
    audio?.pause();
    if (holding === "gap") holding = null;
    change({ status: "paused", buffering: false });
    state("paused");
    return say(T.listen.pausedSelf);
  }
  const r = room.get()!;
  const at = roomPlace(r);
  // before it starts the host's ▶ is 开始; after its last song, a line on what comes next
  if (!at || at.phase === "ready") return r.host ? void hostQueue("start") : say(T.listen.waitStart);
  if (at.phase === "done") return say(r.host ? T.listen.doneHost : T.listen.waitMore);
  if (isGray()) return;
  const was = selfPaused;
  selfPaused = false;
  stuck = null;
  // back from a pause of your own, or in at last on a page opened again: where everyone is
  if (was || v.tap) say(fmt(was ? T.listen.jumped : T.listen.following, { at: clock(Math.max(0, at.offset)) }));
  const a = element();
  const id = r.queue[at.i];
  if (id && inElement(at, id) && !a.ended && at.offset >= 0) {
    // the same song, still in the element: on from where the room is, within the tap
    quietOthers();
    unlocked = true;
    change({ status: "starting", buffering: true, tap: false, problem: null });
    if (Math.abs(a.currentTime - at.offset) > DRIFT_OK_S) a.currentTime = at.offset;
    a.play().catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name === "NotAllowedError") {
        unlocked = false;
        change({ status: "paused", buffering: false, tap: true });
      }
    });
    return;
  }
  unlockNow();
  syncRoom();
}

/** What the room's songs did, as the room is told, or as the host's tap answered: a line for everyone in it */
function announce(how: "start" | "next" | "restart" | "add" | "seek", was: ListenRoom, now: ListenRoom) {
  const song = tracks()?.get(now.queue[now.idx] ?? "")?.name;
  if (!song) return;
  if (how === "seek") {
    if (now.startedAt !== null) sys(fmt(T.listen.seeked, { at: clock(Math.max(0, (serverNow() - now.startedAt) / 1000)), song }));
    return;
  }
  if (how === "start") sys(fmt(T.listen.started, { song }));
  else if (how === "next") sys(fmt(T.listen.nextSong, { song }));
  else if (how === "restart") sys(fmt(T.listen.restarted, { song }));
  // one added after all of them were over starts at once; otherwise it waits its turn, unannounced
  else if (now.startedAt !== null && now.startedAt !== was.startedAt) sys(fmt(T.listen.nextSong, { song }));
}

const rxText = (r: number) => T.listen.rx.flat()[r] ?? null;

/** A 短评 from the room's number h: the same one within RX_MERGE_MS of the first shows once, ×N */
function showRx(r: ListenRoom, h: number, x: number) {
  const text = rxText(x);
  if (!text) return;
  const t = Date.now();
  const all = bubbles.get();
  const same = all.find((b) => b.r === x && t - b.first <= RX_MERGE_MS);
  if (same) {
    const n = same.n + 1;
    return put([...all.filter((b) => b !== same), { ...same, key: ++bubbleKeys, n, text: fmt(T.listen.rxMany, { text, n }), kind: "agg" }]);
  }
  // yours as 你; the room's number for someone not in its list yet (just in, the list not asked again): the 短评 alone
  const who = h === r.you ? T.listen.rxYou : r.members.find((m) => m.h === h)?.card.displayName;
  const line = who ? fmt(T.listen.rxSay, { name: who, text }) : text;
  put([...all, { key: ++bubbleKeys, text: line, kind: h === r.you ? "me" : "rx", r: x, n: 1, first: t }]);
}

/** What happened in the room, floating as a 短评 does */
function sys(text: string) {
  put([...bubbles.get(), { key: ++bubbleKeys, text, kind: "sys", r: null, n: 1, first: Date.now() }]);
}

function put(list: Bubble[]) {
  const shown = list.slice(-BUBBLES_KEPT);
  bubbles.set(shown);
  const key = shown[shown.length - 1]?.key;
  if (key === undefined) return;
  setTimeout(() => {
    const now = bubbles.get();
    if (now.some((b) => b.key === key)) bubbles.set(now.filter((b) => b.key !== key));
  }, RX_SHOW_MS + 200);
}

/** What the room is told on the page's event stream (event: listen), as it came */
export function heardListen(raw: unknown) {
  let d: ListenTell | null = null;
  try {
    d = (typeof raw === "string" ? JSON.parse(raw) : raw) as ListenTell;
  } catch {
    return;
  }
  const r = room.get();
  if (!d || typeof d !== "object" || !r || d.room !== r.id) return;
  if (d.t === "state") {
    if (!Array.isArray(d.queue) || !(d.version > r.version)) return;
    const next = { ...r, queue: d.queue, idx: d.idx, startedAt: d.startedAt, version: d.version };
    if (d.how === "seek") sawSeek(d.startedAt);
    room.set(next);
    announce(d.how, r, next);
    return syncRoom();
  }
  if (d.t === "members") return membersLater();
  if (d.t === "rx") {
    for (const x of Array.isArray(d.items) ? d.items : []) if (x.h !== r.you && isRx(x.r)) showRx(r, x.h, x.r);
    return;
  }
  if (d.t === "end") return roomOver(endNote(d.why, r));
  // to you alone: the host asked you to leave, or you blocked the host
  if (d.t === "you") return roomOver(fmt(d.why === "kicked" ? T.listen.kickedYou : T.listen.leftNote, { name: r.hostName }));
}

/** What the room's end says, to someone in it */
function endNote(why: RoomEnd, r: ListenRoom): string | null {
  if (why === "host") return r.host ? null : fmt(T.listen.endedHost, { name: r.hostName });
  if (why === "admin") return T.listen.endedAdmin;
  if (why === "idle") return T.listen.endedIdle;
  return null;
}

/** Who is in the room changed: asked again in a moment, each page at its own */
function membersLater() {
  if (membersTimer !== undefined) return;
  const [lo, hi] = MEMBERS_AFTER_MS;
  membersTimer = setTimeout(
    () => {
      membersTimer = undefined;
      void loadRoom();
    },
    lo + Math.random() * (hi - lo),
  );
}

/** Out of the room: its song fades out, and nothing of it is left; note: what the page says of it */
function roomOver(note: string | null) {
  if (!room.get()) return;
  ++roomAsked;
  ++asked;
  room.set(null);
  stopBeat();
  clearTimeout(gapTimer);
  clearTimeout(membersTimer);
  membersTimer = undefined;
  clearTimeout(rxTimer);
  selfPaused = false;
  catching = false;
  ahead = null;
  stuck = null;
  syncedAt = "";
  bubbles.set(NO_BUBBLES);
  rxNow.set(RX_FREE);
  touchedIn.set(null);
  const a = audio;
  const sounding = Boolean(a && (holding === "song" || holding === "gap") && !a.paused);
  holding = null;
  current = null;
  player.set(IDLE);
  second.set(0);
  meta(null);
  stopCounting();
  if (a && sounding) fadeOut(a, END_FADE_MS);
  else if (a) {
    ++loads;
    a.pause();
  }
  roomEnd.set(note);
  if (note) say(note);
}

function startBeat() {
  if (beat === null) beat = setInterval(onBeat, 1_000);
}

function stopBeat() {
  if (beat !== null) clearInterval(beat);
  beat = null;
}

/** Every second in a room: the bar follows its clock; in step every SYNC_EVERY_MS, every second while catching up */
function onBeat() {
  const r = room.get();
  if (!r) return stopBeat();
  const at = roomPlace(r);
  if (!at) return;
  if (at.phase === "playing") second.set(Math.max(0, Math.floor(at.offset)));
  if (placeKey(at) !== syncedAt || Date.now() - checkedAt >= (catching ? 1_000 : SYNC_EVERY_MS)) syncRoom();
}

/** An action refused: what the server asks first goes to the map page, anything else is said */
function failed(e: unknown) {
  if (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded) return refusedTo?.(e);
  if (!(e instanceof WorldError)) console.error(e);
  say(e instanceof WorldError ? e.message : T.map.common.tryAgain);
}

/** The room you are in, asked of the server: on a page opened again in one, after who is in it changed, back in view */
export function loadRoom(): Promise<void> {
  const mine = ++roomAsked;
  const sent = Date.now();
  return listenApi.room().then(
    (res) => {
      if (mine !== roomAsked) return;
      if (res.room) return void enter(res.room, sent, Date.now(), res.now);
      // it ended while this page was not told (asleep, offline)
      roomOver(T.listen.endedIdle);
    },
    (e: unknown) => {
      if (mine === roomAsked && (e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded)) refusedTo?.(e);
    },
  );
}

/**
 * A room of your own, song first (null: 新歌's first, as the server has it), with invitations to these 触须之交 (their
 * Friend ids); within the tap. null: refused
 */
export async function openRoomWith(song: string | null, invite: string[]): Promise<InviteSent[] | null> {
  if (isGray()) return null;
  unlockNow();
  const mine = ++roomAsked;
  const sent = Date.now();
  try {
    const res = await listenApi.open(song, invite);
    if (res.room && mine === roomAsked) enter(res.room, sent, Date.now(), res.now);
    return res.sent;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** More invitations to your room. null: refused */
export async function inviteMore(friends: string[]): Promise<InviteSent[] | null> {
  const sent = Date.now();
  try {
    const res = await listenApi.invite(friends);
    if (res.room) enter(res.room, sent, Date.now(), res.now);
    return res.sent;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** In at an invitation to you (its id, without 消息's li:); within the tap */
export async function joinAt(invite: string): Promise<boolean> {
  if (isGray()) return false;
  unlockNow();
  const mine = ++roomAsked;
  const sent = Date.now();
  try {
    const res = await listenApi.join(invite);
    if (mine !== roomAsked) return true;
    enter(res.room, sent, Date.now(), res.now);
    const at = roomPlace(res.room);
    if (at?.phase === "playing" && at.offset >= 1) say(fmt(T.listen.following, { at: clock(at.offset) }));
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/** 下次吧 */
export async function laterAt(invite: string): Promise<boolean> {
  try {
    await listenApi.later(invite);
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/** The line under a 宣言一起听 you got (in 消息, on its card, in 一起听), by how its room is now */
export function callLine(call: ListenCall): string {
  if (call.state === "open") return fmt(T.listen.call.open, { n: call.n, max: call.max });
  return T.listen.call[call.state];
}

/** In at a 宣言一起听 you got (its id, without 消息's d:); within the tap */
export async function joinCall(declaration: string): Promise<boolean> {
  if (isGray()) return false;
  unlockNow();
  const mine = ++roomAsked;
  const sent = Date.now();
  try {
    const res = await listenApi.joinCall(declaration);
    if (mine !== roomAsked) return true;
    enter(res.room, sent, Date.now(), res.now);
    const at = roomPlace(res.room);
    if (at?.phase === "playing" && at.offset >= 1) say(fmt(T.listen.following, { at: clock(at.offset) }));
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/**
 * 发宣言招附近的人, from these roaches (null: your main one): for your room, or, in none, one of your own first with this
 * song first (null: 新歌's first); within the tap. What it reached, as a declaration says; null: refused (said)
 */
export async function declareRoom(from: string[] | null, song: string | null): Promise<({ reach: string } & PassesDot) | null> {
  if (isGray()) return null;
  const r = room.get();
  if (r && !r.host) return null;
  if (!r) unlockNow();
  const mine = ++roomAsked;
  const sent = Date.now();
  try {
    const res = await listenApi.declare(from, song);
    if (res.room && mine === roomAsked) enter(res.room, sent, Date.now(), res.now);
    return { reach: res.reach, ...(res.passesDot === undefined ? {} : { passesDot: res.passesDot }) };
  } catch (e) {
    failed(e);
    return null;
  }
}

/** 请出去: the host asks someone in the room to leave it (h: their number there); said when done */
export async function kickMember(h: number): Promise<boolean> {
  const r = room.get();
  const name = r?.members.find((m) => m.h === h)?.card.displayName;
  if (!r?.host || !name) return false;
  const sent = Date.now();
  try {
    const res = await listenApi.kick(h);
    if (res.room && room.get()?.id === res.room.id) enter(res.room, sent, Date.now(), res.now);
    say(fmt(T.listen.kickedTip, { name }));
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/** 偷偷碰 or 大胆碰 someone in the room (h: their number there): the touch's answer, as on the map; null: refused (said) */
export async function touchMember(h: number, bold: boolean): Promise<TouchResult | null> {
  const r = room.get();
  if (!r) return null;
  try {
    const res = await listenApi.touch(h, bold);
    const day = siteDay();
    const was = touchedIn.get();
    const by = was && was.room === r.id && was.day === day ? was.by : {};
    touchedIn.set({ room: r.id, day, by: { ...by, [h]: bold || by[h] === "bold" ? "bold" : "sneaky" } });
    return res;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** Out of the room: the host's 结束 ends it, anyone else's 离开 goes on without them */
export async function leaveListen(): Promise<boolean> {
  const r = room.get();
  if (!r) return true;
  try {
    await (r.host ? listenApi.end() : listenApi.leave());
  } catch (e) {
    failed(e);
    return false;
  }
  roomOver(r.host ? null : fmt(T.listen.leftNote, { name: r.hostName }));
  return true;
}

/**
 * What the host does to the room's songs: 开始, 下一首, 这首从头再来, one added (点歌), 随机加 10 首, or a second of the
 * one playing gone to (its bar: everyone goes there); within the tap
 */
export async function hostQueue(what: QueueChange): Promise<boolean> {
  const r = room.get();
  if (!r?.host) return false;
  const how = typeof what === "object" ? ("seek" in what ? "seek" : "add") : what === "random" ? "add" : what;
  if (how !== "add" && how !== "seek") {
    // the host means to hear it: a pause of their own is over
    selfPaused = false;
    stuck = null;
    unlockNow();
  }
  const sent = Date.now();
  try {
    const res = await listenApi.queue(what);
    // as the room is now: the event stream may have told it the change before this answer came
    const told = room.get();
    if (!res.room || !told) return true;
    // the songs before the tap: 随机加's are none of them
    const had = new Set(r.queue);
    // gone to another second of the song playing, and not told so yet: the element takes it on
    if (how === "seek" && res.room.version > told.version) sawSeek(res.room.startedAt);
    if (enter(res.room, sent, Date.now(), res.now)) announce(how, told, room.get()!);
    const after = room.get()!;
    // started at once (all were over): its line is there already
    const waits = !(after.startedAt !== null && after.startedAt !== r.startedAt);
    if (typeof what === "object" && "add" in what) {
      const name = tracks()?.get(what.add)?.name;
      // one that waits its turn: the host is told it is in
      if (name && waits) say(fmt(T.listen.added, { name }));
    } else if (what === "random") {
      const n = after.queue.filter((id) => !had.has(id)).length;
      say(n ? fmt(T.listen.randomAdded, { n }) : T.listen.randomNone);
    }
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/**
 * A 短评, by its number: in the room, shown here at once, then to everyone in it; alone, one of the first two rows to
 * the song playing, shown here alone (only how many times each is said is kept). One every RX_EVERY_MS.
 */
export function sendRx(x: number) {
  const r = room.get();
  const s = rxNow.get();
  const song = player.get().track?.id ?? null;
  if (!isRx(x) || s.cool || s.full) return;
  if (!r && (x >= RX_ROOM_FROM || !song || !isListening())) return;
  rxNow.set({ cool: true, full: false });
  clearTimeout(rxTimer);
  rxTimer = setTimeout(() => rxNow.set({ ...rxNow.get(), cool: false }), RX_EVERY_MS);
  if (r) showRx(r, r.you, x);
  else {
    const text = rxText(x);
    if (text) put([...bubbles.get(), { key: ++bubbleKeys, text: fmt(T.listen.rxSay, { name: T.listen.rxYou, text }), kind: "me", r: x, n: 1, first: Date.now() }]);
  }
  listenApi.react(x).then(
    (res) => {
      if (res.sent || !res.full) return;
      // still where it was said: the room, or the song played alone
      if (r ? room.get()?.id === r.id : !room.get() && player.get().track?.id === song) rxNow.set({ ...rxNow.get(), full: true });
    },
    (e: unknown) => {
      // alone, the song had stopped counting as played (a long pause): said, as any refusal
      if (!r) failed(e);
    },
  );
}

/** 想一起听: ask a 触须之交 who is listening (their Friend id) to invite you; false: refused (said) */
export async function askToListen(friend: string): Promise<boolean> {
  try {
    await listenApi.ask(friend);
    return true;
  } catch (e) {
    failed(e);
    return false;
  }
}

/**
 * 一起听 at a 想一起听 to you (its item id in 消息): the room you host, or a new one of yours with what you play (else
 * the song it asked about), TA invited to it; within the tap. How the invitation went; null: refused (said)
 */
export async function answerAsk(item: string): Promise<InviteSent[] | null> {
  if (isGray()) return null;
  const r = room.get();
  if (r && !r.host) {
    say(T.listen.leaveFirst);
    return null;
  }
  if (!r) unlockNow();
  const mine = ++roomAsked;
  const sent = Date.now();
  try {
    const res = await listenApi.askOk(item);
    if (res.room && mine === roomAsked) enter(res.room, sent, Date.now(), res.now);
    return res.sent;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** Your 触须之交 you may invite; null: they could not be asked for (said) */
export async function listenFriendsList(): Promise<ListenFriend[] | null> {
  try {
    return (await listenApi.friends()).friends;
  } catch (e) {
    failed(e);
    return null;
  }
}

/** The page's event stream is back after a drop: what the room was told meanwhile is lost, so it is asked again */
export function listenStreamBack() {
  if (room.get()) void loadRoom();
}

// ---- kept for the page opened again ----

function save() {
  savedAt = Date.now();
  const v = player.get();
  // a room's song is the room's: a page opened again finds the room itself
  if (room.get() || !v.track || v.status === "idle" || ended) return forgetSaved();
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
  if (!all || v.track || v.status !== "idle" || room.get()) return;
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

function handle(action: MediaSessionAction, fn: MediaSessionActionHandler | null) {
  try {
    session()?.setActionHandler(action, fn);
  } catch {}
}

/**
 * What the lock screen shows (the album's cover, once there is one), and its buttons: play and pause, next where the
 * album has one (in a room, for the host), and its bar to go to a second of the song (in a room, the host's)
 */
function meta(track: ListenTrack | null) {
  const ms = session();
  if (!ms) return;
  try {
    const cover = track?.album.cover;
    ms.metadata = track
      ? new MediaMetadata({
          title: track.name,
          artist: track.artists.join(" / "),
          album: track.album.name,
          ...(cover ? { artwork: [{ src: coverLink(cover), sizes: `${COVER_PX}x${COVER_PX}`, type: "image/jpeg" }] } : {}),
        })
      : null;
  } catch {}
  const r = room.get();
  handle("play", track ? () => !isListening() && toggle() : null);
  handle("pause", track ? () => isListening() && toggle() : null);
  handle("nexttrack", track && (r ? r.host : current?.track === track && current.next) ? skip : null);
  handle("seekto", track && (!r || r.host) ? (d) => void seekTo(d.seekTime ?? Number.NaN) : null);
  for (const action of ["previoustrack", "seekbackward", "seekforward", "stop"] as const) handle(action, null);
  if (!track) ms.playbackState = "none";
}

function state(s: MediaSessionPlaybackState) {
  const ms = session();
  const a = audio;
  if (!ms || !a) return;
  ms.playbackState = s;
  if (Number.isFinite(a.duration)) positionAt(a.duration, a.currentTime);
}

/** Where the lock screen's bar is: at seconds of a song this long */
function positionAt(duration: number, at: number) {
  try {
    if (duration > 0) session()?.setPositionState({ duration, position: Math.min(Math.max(0, at), duration), playbackRate: 1 });
  } catch {}
}

/** For tests: as on a page just opened */
export function forgetListening() {
  ++asked;
  ++loads;
  ++roomAsked;
  stopBeat();
  clearTimeout(gapTimer);
  clearTimeout(membersTimer);
  membersTimer = undefined;
  clearTimeout(rxTimer);
  audio = null;
  holding = null;
  current = null;
  held = null;
  keptSongs = [];
  links.clear();
  liteHere = undefined;
  liteAuto = false;
  onLite = false;
  liteFailed.clear();
  clearTimeout(slowTimer);
  liteChanged.set(0);
  shuffleHere = undefined;
  played = new Set();
  shuffleChanged.set(0);
  fromNow.set(null);
  heardNow = null;
  favs.set(NO_FAVS);
  hot.set(NO_HOT);
  favsAt = 0;
  hotAt = 0;
  favChain = Promise.resolve();
  favsPending = 0;
  favSeq = 0;
  counted = false;
  away = false;
  ended = false;
  fixes = [];
  lastAt = 0;
  seekWanted = null;
  seeked = null;
  savedAt = 0;
  offsets.length = 0;
  offset = 0;
  songsText = "";
  songsAsking = false;
  introHere = null;
  unlocked = false;
  selfPaused = false;
  catching = false;
  ahead = null;
  stuck = null;
  checkedAt = 0;
  syncedAt = "";
  backAt = 0;
  player.set(IDLE);
  songs.set(NONE);
  second.set(0);
  room.set(null);
  bubbles.set(NO_BUBBLES);
  rxNow.set(RX_FREE);
  roomEnd.set(null);
  said.set(new Map());
}
