"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import { GUIDES, type GuideId } from "@/lib/guides";
import { capCount } from "@/lib/inboxTabs";
import type { Basemap, RoachColor } from "@/lib/types";
import type { UiFold } from "@/lib/uiChoice";
import type { Radar } from "@/lib/world/types";
import type { RoachOpts } from "@/lib/roachSvg";
import RoachIcon from "../../RoachIcon";
import { SpeakerIcon } from "../DockFx";
import { FriendsMark } from "../FriendsSheet";

/**
 * What the map page's three layouts (src/lib/uiChoice.ts) are made of: the same buttons doing the same things, laid
 * out three ways. MapApp.tsx says what each does; FloatChrome.tsx, DrawerChrome.tsx and HudChrome.tsx draw them.
 */

/** The guides, in the order they are listed everywhere */
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
