"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import { GUIDES, type GuideId } from "@/lib/guides";
import { capCount } from "@/lib/inboxTabs";
import type { ListenTrack } from "@/lib/listen";
import { SQUAD_MAX } from "@/lib/squad";
import type { Basemap, RoachColor } from "@/lib/types";
import type { UiFold } from "@/lib/uiChoice";
import type { Radar } from "@/lib/world/types";
import type { FishNote } from "../fish/winStore";
import type { RoachOpts } from "@/lib/roachSvg";
import { seeDiscoHint, setDiscoChosen, setDiscoRoomMode, useDiscoChosen, useDiscoHintSeen, useDiscoRoomMode } from "@/lib/disco";
import RoachIcon from "../../RoachIcon";
import { SpeakerIcon } from "../DockFx";
import { FriendsMark } from "../FriendsSheet";
import { useListenIntro, useListenPlayer, useListenRoom } from "../listening";

/**
 * What the map page's three layouts (src/lib/uiChoice.ts) are made of: the same buttons doing the same things, laid
 * out three ways. MapApp.tsx says what each does; FloatChrome.tsx, DrawerChrome.tsx and HudChrome.tsx draw them.
 */

/** The guides everyone has, in the order they are listed everywhere (香艳制作人 follows them where she shows: ChromeProps.guides) */
export const GUIDE_ORDER: GuideId[] = ["amiya", "perlica", "talulah", "minghe", "si"];

/** Where a layout puts its buttons the way a computer's wide screen has room for */
export const WIDE_QUERY = "(min-width: 900px)";

/**
 * Whether the screen is wide (WIDE_QUERY), following it as the window changes. Read at once, so only for what is drawn
 * in the browser alone (抽屉 and 游戏风, loaded when used), never for what the server draws too.
 */
export function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const q = window.matchMedia(WIDE_QUERY);
    const read = () => setWide(q.matches);
    read();
    q.addEventListener("change", read);
    return () => q.removeEventListener("change", read);
  }, []);
  return wide;
}

/** How many roaches the counts say, and how they say it: the numbers already written out (src/lib/counts.ts) */
export type Counts =
  | { kind: "loading" }
  | { kind: "arriving" }
  /** a visitor who has not signed in: the world's count only */
  | { kind: "guest"; total: string; players?: string }
  /** 全员隐匿: nobody's roaches drawn */
  | { kind: "hidden"; total: string; players?: string }
  /** mainsOnly: 只看本体 is on, so the counts are of players (once the server says how many there are) */
  | { kind: "here"; here: string; total: string; players?: string; mainsOnly?: boolean };

/** The player's own buttons: their look and name (我的资料), 消息, 触须之交, and the pair that act */
export type ChromeMe = {
  name: string;
  color: RoachColor;
  look: RoachOpts;
  /** DockFx plays on these (MapApp.tsx dockAt) */
  avRef: RefObject<HTMLSpanElement | null>;
  anim: string | null;
  mailRef: RefObject<HTMLButtonElement | null>;
  /** red: what came to them, unread (src/lib/inboxTabs.ts dockCounts); say: a declaration sent nearby is unread */
  envelope: { red: number; say: boolean };
  badgePop: boolean;
  /** 求助: someone asks, or answered theirs */
  help: boolean;
  /** Their main roach is on the map */
  main: boolean;
  onProfile: () => void;
  onInbox: () => void;
  onFriends: () => void;
  onMine: () => void;
  onAnnounce: () => void;
  onPlaceMain: () => void;
};

export type ChromeProps = {
  /** Putting a roach down: only what that needs */
  placing: boolean;
  /** The 站长's 看被举报的蟑螂 panel takes the top: the radar, the hot list and the guides make room */
  reported: boolean;
  /** A step of the tutorial is on, which 界面 waits for */
  tutorial: boolean;
  /** A roach's card is open over the bottom */
  card: boolean;
  /** Our roach, with the site's name, as big as the layout has it */
  brand: (size: number) => ReactNode;
  noticeDot: boolean;
  onBoard: () => void;
  /** 地图画风: the pill (with its name), or a round button */
  stylePicker: (round: boolean) => ReactNode;
  /** 高德 / OSM, where there is a choice (not in mainland China) */
  basemap: { now: Basemap | null; amapOk: boolean; onSwitch: (b: Basemap) => void } | null;
  /** 卡通 / 写实, while that is offered */
  look: ReactNode;
  /** The style's card or its hint is out: what holds the picker sits over the rest */
  raised: boolean;
  counts: Counts;
  /** Signed in, the counts open 地图上看哪些蟑螂 (只看本体) */
  onCounts?: () => void;
  /** Under the counts: the notice strip, the 站长's pills and panel, the test identities */
  top: ReactNode;
  onRadar: () => void;
  onHot: () => void;
  /** 通行证寻访, for a player who may draw (src/lib/passes.ts); dot: ten tickets or more, or the first ones waiting */
  passes: { dot: boolean; tickets: number; onOpen: () => void } | null;
  /**
   * 325大学习, where it is open to them (src/lib/study); dot: today's course not played yet; days: the days studied,
   * null for a visitor (their browser counts none)
   */
  study: { dot: boolean; days: number | null; onOpen: () => void } | null;
  /**
   * 钓鳞, where it is open to them (me.fish, FISH): its small window; note, how it stands (the window open or small, a
   * line in the water, bitten), for a word and a dot by it
   */
  fish: { onOpen: () => void; note?: FishNote | null } | null;
  /** 一起卫戍, where the server shows it to them (me.squad, SQUAD); room: how many are in the one they are in, if any */
  squad: { room: { n: number } | null; onOpen: () => void } | null;
  /**
   * 听歌, where the server opened it to them (LISTEN) and the site is not gray; open: its panel is out; disco: 听歌's
   * disco is open to them too (DISCO), its button beside 听歌 (DiscoButton); song: a song is on (playing or not);
   * mini: its little bar, while a song is on and the player shut: tucked into the buttons along the bottom or pulled
   * out of them (ListenMini.tsx), null without one
   */
  listen: { open: boolean; onToggle: () => void; disco: boolean; song: boolean; mini: "tuck" | "out" | null } | null;
  /** 支持舟P地图, where the server shows it to them (me.sponsor, SPONSOR) and the site is not gray: opens its card */
  sponsor: { onOpen: () => void } | null;
  /** The guides to list, in their order: GUIDE_ORDER, and 香艳制作人 after them where she shows (HAIMAO) */
  guides: GuideId[];
  onGuide: (id: GuideId) => void;
  /** 界面, unless there is nothing in its menu here */
  ui: { open: boolean; onToggle: () => void; deskHint: boolean; onDeskHintDone: () => void } | null;
  fold: UiFold;
  onFold: (fold: UiFold) => void;
  me: ChromeMe | null;
  /** Not signed in, as far as the page knows */
  visitor: { onPlace: () => void; onSignIn: () => void } | null;
  /** Who is signed in has not come yet; failed: it could not be read */
  waiting: { failed: boolean; onRetry: () => void } | null;
  disclaimer: ReactNode;
  /** 方舟雷达's last scan on this page, for 抽屉's card */
  radar: Radar | null;
  drawerOpen: boolean;
  onDrawer: (open: boolean) => void;
};

/** 界面: four small tiles, one of them yellow */
export function UiIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="2.2" fill="#ffd23f" />
      <rect x="13" y="3" width="8" height="8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="13" width="8" height="8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="8" height="8" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

/** The arrow that folds a side away: only the arrow, black with a white edge so it shows on a crowded map */
export function FoldArrow({ dir }: { dir: "left" | "right" }) {
  const d = dir === "right" ? "M3.5 3.5 8.5 10l-5 6.5" : "M8.5 3.5 3.5 10l5 6.5";
  return (
    <svg viewBox="0 0 12 20" width="10" height="17" aria-hidden="true">
      <path d={d} fill="none" stroke="#fff" strokeOpacity=".92" strokeWidth="5.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#0d0e10" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A small ‹ or › */
export function Chev({ dir, size = 11 }: { dir: "left" | "right"; size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true">
      <path
        d={dir === "right" ? "M4.5 2.5 8 6l-3.5 3.5" : "M7.5 2.5 4 6l3.5 3.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 方舟雷达's scope, turning unless still (its size is the layout's, in globals.css) */
export function RadarScope({ still = false }: { still?: boolean }) {
  return (
    <span className="radar-scope" aria-hidden="true">
      {!still && <span className="radar-sweep" />}
    </span>
  );
}

/** 高德 / OSM */
export function BasemapSwitch({ now, amapOk, onSwitch }: { now: Basemap | null; amapOk: boolean; onSwitch: (b: Basemap) => void }) {
  return (
    <div className="basemap-switch" role="group" aria-label={T.map.style.basemap}>
      <button className={now === "amap" ? "on" : ""} onClick={() => onSwitch("amap")} disabled={!amapOk} title={amapOk ? T.map.style.amapTitle : T.map.style.noAmapKey}>
        {T.map.style.amap}
      </button>
      <button className={now === "osm" ? "on" : ""} onClick={() => onSwitch("osm")}>
        OSM
      </button>
    </div>
  );
}

/** 热榜's flame */
export function HotFlame({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 2.5c.8 3.2 4.6 5.4 4.6 10a4.6 4.6 0 0 1-9.2 0c0-2.3 1.1-3.8 2.4-5 .1 1.9.9 3 2 3.4-.7-2.9-.6-5.5.2-8.4Z" fill="#ffd23f" />
      <path d="M12 21.6a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.3-2.4 2.1-3.6.4 1.2 1.6 1.8 2.3 2.6.5.6.8 1.1.8 1.8a2.6 2.6 0 0 1-2.6 2.6Z" fill="#ff8a3d" />
    </svg>
  );
}

/** 通行证寻访's ticket, with its notches; dot: a yellow one on it */
/** 一起卫戍: a small shield, yellow, with a cross */
export function ShieldIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 2.6 4.4 5.5v5.7c0 4.7 3.2 8.7 7.6 10.2 4.4-1.5 7.6-5.5 7.6-10.2V5.5z" fill="#ffd23f" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M12 7v10M8.2 11h7.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** 一起卫戍's word under its icon: 卫戍, or 卫戍中 n/4 while in a room; and its name for a screen reader */
export const squadWord = (squad: NonNullable<ChromeProps["squad"]>) =>
  squad.room ? fmt(T.squad.inRoom, { n: squad.room.n, max: SQUAD_MAX }) : T.squad.entry;
export const squadLabel = (squad: NonNullable<ChromeProps["squad"]>) =>
  squad.room ? fmt(T.squad.inRoomLabel, { n: squad.room.n, max: SQUAD_MAX }) : T.squad.entryLabel;

export function TicketIcon({ size = 24, dot = false }: { size?: number; dot?: boolean }) {
  return (
    <span className="ticket-ico">
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <g transform="rotate(-14 12 12)">
          <path
            d="M3.5 7.2c0-.8.6-1.4 1.4-1.4h14.2c.8 0 1.4.6 1.4 1.4v2.4a2.4 2.4 0 0 0 0 4.8v2.4c0 .8-.6 1.4-1.4 1.4H4.9c-.8 0-1.4-.6-1.4-1.4v-2.4a2.4 2.4 0 0 0 0-4.8Z"
            fill="#ffd23f"
          />
          <path d="M9.2 7.4v9.2" stroke="#1b1d22" strokeWidth="1.3" strokeDasharray="1.5 1.5" />
          <path d="M12.2 10.4h4.6M12.2 13.6h3.2" stroke="#1b1d22" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      </svg>
      {dot && <span className="dot" aria-hidden="true" />}
    </span>
  );
}

/** 325大学习's notebook, a few lines written in it; dot: a red one, while today's course is not played */
/** 钓鳞's way in: a float on the water, red over white, its line going up; note: a dot for a line in the water (orange, bitten) */
export function FishIcon({ size = 24, note = null }: { size?: number; note?: FishNote | null }) {
  return (
    <span className="fish-ico">
      {note?.dot && <span className={note.bite ? "dot bite" : "dot"} aria-hidden="true" />}
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M12 1.8v6.4" stroke="#1b1d22" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M5.2 14.4a6.8 6.6 0 0 1 13.6 0Z" fill="#ff4a2e" />
        <path d="M5.2 14.4a6.8 6.6 0 0 0 13.6 0Z" fill="#fff" />
        <path d="M5.2 14.4a6.8 6.6 0 0 1 13.6 0a6.8 6.6 0 0 1-13.6 0Z" fill="none" stroke="#1b1d22" strokeWidth="1.3" />
        <path d="M2.5 21.2q2.4-1.4 4.8 0t4.8 0t4.8 0t4.6 0" fill="none" stroke="#3ea6ee" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function StudyIcon({ size = 24, dot = false }: { size?: number; dot?: boolean }) {
  return (
    <span className="study-ico">
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <rect x="3.5" y="2.5" width="17.5" height="19" rx="2.6" fill="#fffdf5" />
        <path d="M3.5 5.1a2.6 2.6 0 0 1 2.6-2.6h1.6v19H6.1a2.6 2.6 0 0 1-2.6-2.6Z" fill="#ffd23f" />
        <path d="M10.6 8.4h7M10.6 12h7M10.6 15.6h4.4" stroke="#1b1d22" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
      {dot && <span className="dot" aria-hidden="true" />}
    </span>
  );
}

/** 支持舟P地图's red heart */
export function SponsorIcon({ size = 24 }: { size?: number }) {
  return (
    <svg className="sponsor-ico" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M12 21.4C12 21.4 2.6 15.9 2.6 9.3C2.6 6.5 4.8 4.3 7.5 4.3C9.4 4.3 11.1 5.4 12 7C12.9 5.4 14.6 4.3 16.5 4.3C19.2 4.3 21.4 6.5 21.4 9.3C21.4 15.9 12 21.4 12 21.4Z"
        fill="#f5333f"
      />
      <path d="M6.3 9.6a2.8 2.8 0 0 1 2.4-2.5" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

/** 宣言一起听's megaphone, drawn as 公告's (NoticeBoard.tsx) */
export function MegaphoneIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 10.2v3.6c0 .8.6 1.4 1.4 1.4H7l8.5 4.3V4.5L7 8.8H4.9c-.8 0-1.4.6-1.4 1.4z" />
      <path d="M8.2 15.3l1.2 4.2h2.3l-.9-3.3" />
      <path d="M18.6 9.3a3.6 3.6 0 0 1 0 5.4" />
    </svg>
  );
}

/** 听歌's note */
export function NoteIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M9 17.2V6.2l10-2.2v11" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.6" cy="17.4" r="2.6" fill="currentColor" />
      <circle cx="16.6" cy="15.2" r="2.6" fill="currentColor" />
    </svg>
  );
}

/**
 * 听歌 while a song plays: its note, or three bars going up and down (still where less motion is asked for, chrome.css);
 * still and low too while the song does not sound yet (still: asked for, or waiting for more of it)
 */
export function ListenIcon({ on, still = false, size }: { on: boolean; still?: boolean; size: number }) {
  if (!on) return <NoteIcon size={size} />;
  return (
    <span className={`listen-bars${still ? " still" : ""}`} style={{ "--lb": `${size}px` } as CSSProperties} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * What 听歌's entry shows, from what plays (src/components/app/listening.ts): on while a song plays; buffering while it
 * does not sound yet (asked for, or waiting for more of it); together: how many are in your room of 一起听 (null: none),
 * which keeps it lit; 新 until its panel is first opened; asks: to the host of the room, how many songs asked for (点歌)
 * wait on an answer
 */
export type ListenEntry = {
  on: boolean;
  buffering: boolean;
  lit: boolean;
  together: number | null;
  track: ListenTrack | null;
  fresh: boolean;
  asks: number;
};

export function useListenEntry(): ListenEntry {
  const p = useListenPlayer();
  const intro = useListenIntro();
  const room = useListenRoom();
  const on = p.status === "playing" || p.status === "starting";
  const buffering = p.status === "starting" || (p.status === "playing" && p.buffering);
  const together = room ? room.members.filter((m) => m.state === "in").length : null;
  return { on, buffering, lit: on || together !== null, together, track: p.track, fresh: intro === "new", asks: room?.host ? room.requests.length : 0 };
}

/** 听歌's name for a screen reader, with the song while one plays (or buffers), or how many listen together (and 点歌 waiting) */
export function listenLabel(e: ListenEntry) {
  const label =
    e.together !== null
      ? fmt(T.map.bar.listenTogetherLabel, { n: e.together })
      : e.on && e.track
        ? fmt(e.buffering ? T.map.bar.listenBufferingLabel : T.map.bar.listenNowLabel, { name: e.track.name })
        : T.map.bar.listen;
  return withAsks(label, e.asks);
}

/** A name for a screen reader, and the host's 点歌 waiting on an answer (n), if any */
export const withAsks = (label: string, n: number) => (n > 0 ? fmt(T.listen.asks.withLabel, { label, n }) : label);

/** To the host, the 点歌 waiting on an answer: a red count on 听歌's entry and the little bar's handles (said in their names) */
export function AsksDot({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="badge listen-asks" aria-hidden="true">
      {n}
    </span>
  );
}

/** 听歌's word under its icon: 在听 while a song plays, 缓冲中 while it does not sound yet, 一起 N 人 in a room (its bars still meanwhile) */
export function listenWord(e: ListenEntry) {
  if (e.together !== null) return fmt(T.map.bar.listenTogether, { n: e.together });
  if (e.on && e.buffering) return T.map.bar.listenBuffering;
  return e.on ? T.map.bar.listenNow : T.map.bar.listen;
}

/** 听歌's disco's button stays this long after the song stops (the disco does too, PAUSE_MS in disco/engine.ts) */
const DISCO_LINGER_MS = 2000;
/** 「点我蹦迪」 goes after this long, or once the button is tapped */
const DISCO_HINT_MS = 6000;

/** on, and for ms after it goes off */
function useLinger(on: boolean, ms: number) {
  const [late, setLate] = useState(on);
  useEffect(() => {
    if (on) {
      setLate(true);
      return;
    }
    const t = window.setTimeout(() => setLate(false), ms);
    return () => window.clearTimeout(t);
  }, [on, ms]);
  return on || late;
}

/** 听歌's disco's mirror ball, small (as the design's button) */
export function DiscoBallIcon({ size = 24 }: { size?: number }) {
  // gradients by ids of this one's own, as there may be two buttons on the page
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}g`} cx="38%" cy="34%" r="72%">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".5" stopColor="#c3c9d4" />
          <stop offset="1" stopColor="#5a616e" />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <circle cx="12" cy="13.5" r="8.5" />
        </clipPath>
      </defs>
      <line x1="12" y1="0.5" x2="12" y2="5" stroke="#c3c9d4" strokeWidth="1.5" />
      <circle cx="12" cy="13.5" r="8.5" fill={`url(#${id}g)`} />
      <g clipPath={`url(#${id}c)`}>
        <g stroke="#262a31" strokeOpacity=".5" strokeWidth=".8" fill="none">
          <path d="M3 10h18M3 13.5h18M3 17h18M12 4.5v18M7.6 5.2c-1.7 2.5-1.7 14.1 0 16.6M16.4 5.2c1.7 2.5 1.7 14.1 0 16.6" />
        </g>
        <rect x="13" y="14.3" width="2.6" height="2.2" fill="#ff4fd8" />
        <rect x="8.4" y="10.9" width="2.6" height="2.2" fill="#3fd0ff" />
        <rect x="13" y="7.4" width="2.6" height="2" fill="#ffd23f" />
      </g>
      <circle cx="12" cy="13.5" r="8.5" fill="none" stroke="#0d0e10" strokeWidth="1.2" />
    </svg>
  );
}

/** An element in a row that slides sideways, the row slid so all of it is in sight (nothing else is moved) */
function slideInto(el: HTMLElement | null) {
  const row = el?.parentElement;
  if (!el || !row || row.scrollWidth <= row.clientWidth) return;
  const r = el.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  const pad = 10;
  if (r.right > box.right - pad) row.scrollLeft += r.right - box.right + pad;
  else if (r.left < box.left + pad) row.scrollLeft -= box.left + pad - r.left;
}

/**
 * 听歌's disco's switch, kept in this browser (src/lib/disco.ts), as each of its buttons has it: on or off, its name for
 * a screen reader, and 「点我蹦迪」 by it the first time a song sounds while it shows (once on this device), gone after
 * DISCO_HINT_MS or once it is tapped
 */
export function useDiscoSwitch(shown: boolean) {
  const p = useListenPlayer();
  const chosen = useDiscoChosen();
  const seen = useDiscoHintSeen();
  const sounding = p.status === "playing" && !p.buffering;
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!shown || !sounding || seen || chosen) return;
    seeDiscoHint();
    setHint(true);
  }, [shown, sounding, seen, chosen]);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(false), DISCO_HINT_MS);
    return () => window.clearTimeout(t);
  }, [hint]);
  const tap = () => {
    setHint(false);
    setDiscoChosen(!chosen);
  };
  return { chosen, hint, tap, label: chosen ? T.map.bar.discoOff : T.map.bar.discoOn };
}

/** 短评: a speech bubble, three dots in it (💬 beside 听歌's entry in a room, and the player's 短评) */
export function ChatIcon({ size }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7.5L7 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="8.5" cy="11" r="1.1" fill="currentColor" />
      <circle cx="12" cy="11" r="1.1" fill="currentColor" />
      <circle cx="15.5" cy="11" r="1.1" fill="currentColor" />
    </svg>
  );
}

/**
 * 听歌's disco's switch beside 听歌's entry (the player has its own): shown while a song plays, and for a moment after it
 * stops; pink while on. The first time a song sounds, 「点我蹦迪」 beside it, once on this device. round: beside 在听
 * (浮岛, 游戏风), the words in a bubble; chip: a tab of 抽屉's, the words inside it while they show. What floats beside
 * 听歌's entry (ListenOverlay.tsx) goes past it (data-listen-beside).
 */
export function DiscoButton({ kind }: { kind: "round" | "chip" }) {
  const e = useListenEntry();
  const shown = useLinger(e.on, DISCO_LINGER_MS);
  const { chosen, hint, tap, label } = useDiscoSwitch(shown);
  const chip = useRef<HTMLButtonElement>(null);
  // 抽屉's tabs slide sideways: on a narrow phone this one may be past the edge, so the row slides to show its words
  useEffect(() => {
    if (hint) slideInto(chip.current);
  }, [hint]);
  if (!shown) return null;
  if (kind === "chip") {
    return (
      <button
        ref={chip}
        className={`dchip glass disco-chip${chosen ? " disco-on" : ""}${hint ? " with-hint" : ""}`}
        aria-pressed={chosen}
        aria-label={label}
        title={label}
        onClick={tap}
        data-listen-beside
      >
        <span className="ico">
          <DiscoBallIcon size={22} />
        </span>
        {hint && <span aria-hidden="true">{T.map.bar.discoHint}</span>}
      </button>
    );
  }
  return (
    <span className="disco-slot">
      <button
        className={`disco-ball glass${chosen ? " disco-on" : ""}`}
        aria-pressed={chosen}
        aria-label={label}
        title={label}
        onClick={tap}
        data-listen-beside
      >
        <DiscoBallIcon size={24} />
      </button>
      {hint && (
        <span className="disco-hint" aria-hidden="true">
          {T.map.bar.discoHint}
        </span>
      )}
    </span>
  );
}

/**
 * 一起听's disco, 舞台 or 拉远, as picked on this device (src/lib/disco.ts): over the map after 💬 by 听歌's entry while
 * the player is shut (ListenOverlay.tsx), and last of the player's round buttons while it is open (ListenPanel.tsx)
 */
export function DiscoModeSwitch({ style, inPanel = false }: { style?: CSSProperties; inPanel?: boolean }) {
  const mode = useDiscoRoomMode();
  return (
    <span className={`lf-mode${inPanel ? " in-panel" : " glass"}`} role="group" aria-label={T.listen.far.switch} style={style}>
      <button type="button" aria-pressed={mode === "stage"} onClick={() => setDiscoRoomMode("stage")}>
        {T.listen.far.stage}
      </button>
      <button type="button" aria-pressed={mode === "far"} onClick={() => setDiscoRoomMode("far")}>
        {T.listen.far.far}
      </button>
    </span>
  );
}

/** 消息's envelope */
export function Envelope({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 7.5 12 13l8-5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Your look, where your dock's scenes play (DockFx.tsx) */
export function MeAvatar({ me, size }: { me: ChromeMe; size: number }) {
  return (
    <span ref={me.avRef} className={`dock-av ${me.anim ?? ""}`}>
      <RoachIcon color={me.color} size={size} {...me.look} />
    </span>
  );
}

/**
 * On 消息's corner: the red count of what came to them, and a yellow speaker, with no number, while a declaration sent
 * nearby is unread; with both, the red count on top and the speaker behind it, a little up and to the right
 */
export function MailBadge({ me }: { me: ChromeMe }) {
  const { red, say } = me.envelope;
  return (
    <>
      {say && (
        <span className={`say-mark${red ? " under" : ""}`} aria-hidden="true">
          <SpeakerIcon size={12} stroke={1.8} />
        </span>
      )}
      {red > 0 && <span className={`badge ${me.badgePop ? "ta-dbadge" : ""}`}>{capCount(red)}</span>}
    </>
  );
}

/** 消息's name for a screen reader: how many came to them, and whether a declaration nearby is new */
export function mailLabel(me: ChromeMe) {
  const { red, say } = me.envelope;
  if (red) return fmt(say ? T.map.bar.messagesForYouNear : T.map.bar.messagesForYou, { n: red });
  return say ? T.map.bar.messagesNear : T.map.bar.messages;
}

/** What makes the counts open 地图上看哪些蟑螂 when they can (ChromeProps.onCounts), as a button would */
export function countsTap(onTap: (() => void) | undefined) {
  if (!onTap) return {};
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": T.onlyMains.title,
    onClick: onTap,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onTap();
    },
  } as const;
}

/** A guide's small picture */
export function GuideFace({ id, size }: { id: GuideId; size: number }) {
  const g = GUIDES[id];
  return <RoachIcon color={g.color} size={size} avatar={g.avatar} />;
}

/**
 * Once a device, a bubble beside 界面 that 存到桌面 is in it, going by itself after 8 seconds (HomeScreen.tsx
 * deskHintSeen); a tap on it opens the menu.
 */
export function DeskHint({ onTap, onDone }: { onTap: () => void; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 8000);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <button className="desk-hint" onClick={onTap}>
      {T.desk.saveHint}
    </button>
  );
}

/**
 * A side folds away with a swipe towards the edge of the screen it is on, as with its arrow: the handlers for it,
 * and the tap the swipe ended with is not taken as a tap on what it started on.
 */
export function useSwipeAway(toward: "left" | "right", onSwipe: () => void) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
  }, []);
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId || swiped.current) return;
      const dx = (e.clientX - s.x) * (toward === "right" ? 1 : -1);
      const dy = Math.abs(e.clientY - s.y);
      if (dx > 36 && dx > dy * 1.5) {
        swiped.current = true;
        start.current = null;
        onSwipe();
      }
    },
    [toward, onSwipe],
  );
  const onPointerEnd = useCallback(() => {
    start.current = null;
  }, []);
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!swiped.current) return;
    swiped.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);
  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onClickCapture };
}

/** 我的资料 (your look and name), 消息 and 触须之交: small buttons with their names under them (浮岛's bar, 抽屉's drawer) */
export function MeSlots({ me }: { me: ChromeMe }) {
  return (
    <div className="slots">
      <button className="slot slot-me" onClick={me.onProfile}>
        <MeAvatar me={me} size={30} />
        <small>{me.name}</small>
      </button>
      <button ref={me.mailRef} className="slot" aria-label={mailLabel(me)} onClick={me.onInbox}>
        <span className="ic">
          <Envelope size={22} />
        </span>
        <small aria-hidden="true">{T.map.bar.messages}</small>
        <MailBadge me={me} />
      </button>
      <button className="slot" onClick={me.onFriends}>
        <span className="ic">
          <FriendsMark size={26} arch="#fff" />
        </span>
        <small>{T.map.bar.friends}</small>
        {/* 求助: someone asks, or answered yours; a quiet dot, never a red count */}
        {me.help && <span className="help-dot" aria-label={T.map.bar.friendsHelp} />}
      </button>
    </div>
  );
}

/** 我的蟑螂 and 我宣布个事儿; before the main roach is down, 放下我的蟑螂 */
export function ActButtons({ me }: { me: ChromeMe }) {
  return (
    <div className="btns">
      {me.main ? (
        <>
          <button className="b mine" onClick={me.onMine}>
            {T.map.bar.mine}
          </button>
          {/* on one line, or on two where the narrowest phones have no room for it (chrome.css) */}
          <button className="b say announce" onClick={me.onAnnounce}>
            <span className="one-line">{T.map.bar.announce}</span>
            <span className="two-lines">
              <span>{T.map.bar.announceTop}</span>
              <span>{T.map.bar.announceBottom}</span>
            </span>
          </button>
        </>
      ) : (
        <button className="b say" onClick={me.onPlaceMain}>
          {T.map.bar.placeMine}
        </button>
      )}
    </div>
  );
}

/** Who is signed in has not come yet: one button that waits, or tries again once it failed */
export function WaitingButton({ waiting }: { waiting: NonNullable<ChromeProps["waiting"]> }) {
  return (
    <button className="b mine waiting" disabled={!waiting.failed} onClick={waiting.onRetry}>
      {waiting.failed ? T.map.bar.retry : T.map.bar.loadingMine}
    </button>
  );
}

/** Not signed in: 放下我的蟑螂 (which asks to sign in first) and 登录 */
export function VisitorButtons({ visitor }: { visitor: NonNullable<ChromeProps["visitor"]> }) {
  return (
    <>
      <button className="b say" onClick={visitor.onPlace}>
        {T.map.bar.placeMine}
      </button>
      <button className="b mine" onClick={visitor.onSignIn}>
        {T.map.bar.signIn}
      </button>
    </>
  );
}

/** 钓鳞's way in, as read out: with how it stands, when there is something to say */
export const fishLabel = (fish: NonNullable<ChromeProps["fish"]>) => (fish.note ? fmt(T.map.bar.fishLabelNote, { note: fish.note.text }) : T.map.bar.fishLabel);
