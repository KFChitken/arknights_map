"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { T } from "@/i18n";
import {
  HAIMAO,
  HAIMAO_LAYERS,
  HAIMAO_LINES,
  HAIMAO_LOVE_MAX,
  HAIMAO_MIC,
  HAIMAO_VIEWBOX,
  haimaoLayerClass,
  haimaoLayerUrl,
} from "@/lib/haimao";
import { FRIEND, HEART } from "@/lib/roachSvg";
import type { HaimaoMe } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { playSound, preloadClip, setSoundOn, soundOn } from "./haimaoSound";
import Sheet from "./Sheet";

/** 香艳制作人 (src/lib/haimao.ts) on the page: her Q figure, her card, and the card that tells players she is here. */

/**
 * Her Q figure, size px square, its tentacles and gull moving (globals.css .hm-l); her still picture, or the hood when
 * that is off too, once a layer will not load. friend: a 触须之交's pink ground in place of her shadow, and a heart.
 * singing: her microphone in hand, swaying, her tentacles and gull quicker (dame dame).
 */
export function HaimaoFigure({ size, friend = false, singing = false }: { size: number; friend?: boolean; singing?: boolean }) {
  const [plain, setPlain] = useState(false);
  if (plain) return <RoachIcon color={HAIMAO.color} size={size} avatar={HAIMAO.avatar} friend={friend} />;
  const layer = (l: (typeof HAIMAO_LAYERS)[number]) => (
    <Fragment key={l.part}>
      {/* her microphone over her body, under her gull */}
      {l.part === "gull" && <g dangerouslySetInnerHTML={{ __html: HAIMAO_MIC }} />}
      <image
        className={haimaoLayerClass(l.part)}
        href={haimaoLayerUrl(l.part)}
        x={l.x}
        y={l.y}
        width={l.w}
        height={l.h}
        preserveAspectRatio="none"
        onError={() => setPlain(true)}
      />
    </Fragment>
  );
  return (
    <svg className={singing ? "hm-fig singing" : "hm-fig"} viewBox={HAIMAO_VIEWBOX} width={size} height={size} aria-hidden="true">
      {friend && <ellipse cx="32" cy="54.4" rx="15" ry="3.2" fill={FRIEND} stroke="#1b1d22" strokeWidth="1.2" />}
      {!friend && HAIMAO_LAYERS.filter((l) => l.part === "shadow").map(layer)}
      {/* swaying as she sings, inside the figure: the whole of it moving, Chromium drawing without a graphics card put
          her card's head at the top of the screen as a dark box */}
      <g className="hm-sway">{HAIMAO_LAYERS.filter((l) => l.part !== "shadow").map(layer)}</g>
      {friend && <g dangerouslySetInnerHTML={{ __html: HEART }} />}
    </svg>
  );
}

/** Notes rising from her as she sings (none where motion is turned down), a new few each time sing moves on */
function SingNotes({ sing }: { sing: HaimaoSing }) {
  return (
    <span className="hm-notes" aria-hidden="true">
      {sing.notes.map((n, i) => (
        <i key={`${sing.at}-${i}`} style={{ left: `${n.left}%`, top: `${n.top}%`, "--dx": `${n.dx}px`, animationDelay: `${n.delay}s` } as CSSProperties}>
          {i % 2 ? "♪" : "♫"}
        </i>
      ))}
    </span>
  );
}

/** Her figure on her card, a button: her gull says 喵, out loud and in a bubble. sing: she sings dame dame */
function GullButton({ size, friend, sing }: { size: number; friend: boolean; sing: HaimaoSing | null }) {
  const [meowing, setMeowing] = useState(0);
  useEffect(() => {
    if (!meowing) return;
    const t = window.setTimeout(() => setMeowing(0), 1400);
    return () => window.clearTimeout(t);
  }, [meowing]);
  return (
    <button
      type="button"
      className="hm-avatar"
      aria-label={T.guides.haimao.gull}
      onClick={() => {
        playSound("meow", true);
        setMeowing(Date.now());
      }}
    >
      <HaimaoFigure size={size} friend={friend} singing={Boolean(sing)} />
      {sing && <SingNotes sing={sing} />}
      {meowing > 0 && (
        <span key={meowing} className="hm-meow" aria-live="polite">
          {HAIMAO_LINES.meow}
        </span>
      )}
    </button>
  );
}

// ---- dame dame ----

/** She sings at least this long (the design's), or as long as her song */
const SING_MS = 2400;
/** While she sings, a few notes rise from her this often, if they have the time to rise before she stops */
const NOTES_EVERY_MS = 1800;
const NOTE_MS = 1700;
/** Three taps within this, and 全场 damedane flies across the screen */
const TAPS_MS = 2600;
/** How long what she says after her song stays over her head */
const AGAIN_MS = 3000;

/** She sings dame dame: since when the latest notes rose from her, and where they rise from (shares of her figure) */
export type HaimaoSing = { at: number; notes: { left: number; top: number; dx: number; delay: number }[] };
/** 全场 damedane across the screen: each line where, how fast and when; still, where motion is turned down */
type Danmaku = { at: number; still: boolean; w: number; lines: { text: string; top: number; left: number; dur: number; delay: number }[] };

/** A few notes from about her microphone, drifting right, away from the edge of her card */
const notesFrom = (at: number): HaimaoSing => ({
  at,
  notes: Array.from({ length: 4 }, (_, i) => ({
    left: 40 + Math.random() * 24,
    top: 34 + Math.random() * 14,
    dx: Math.round(Math.random() * 60),
    delay: i * 0.25,
  })),
});

/**
 * dame dame, her card's button: she takes up her microphone and sings (her clip, or her song made in code, over
 * whatever of hers plays), swaying, notes rising from her, a tap starting her song again; three taps close together
 * and 全场 damedane flies across this screen, nobody else's. Nothing goes to the server: her 好感度 stays as it is.
 * sing: she sings (null: she does not); flying: the lines across the screen.
 */
export function useHaimaoDame() {
  const [sing, setSing] = useState<HaimaoSing | null>(null);
  const [flying, setFlying] = useState<Danmaku | null>(null);
  const taps = useRef<number[]>([]);
  const timers = useRef<number[]>([]);
  const flyTimer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(flyTimer.current);
    },
    [],
  );

  const fly = () => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const at = Date.now();
    const words = T.guides.haimao.dame.danmaku;
    setFlying({
      at,
      still,
      w: window.innerWidth,
      lines: Array.from({ length: 14 }, (_, i) => ({
        text: words[i % words.length],
        top: 4 + Math.random() * 72,
        left: 4 + Math.random() * 56,
        dur: 4 + Math.random() * 2.5,
        delay: Math.random() * 1.2,
      })),
    });
    window.clearTimeout(flyTimer.current);
    flyTimer.current = window.setTimeout(() => setFlying(null), still ? 3000 : 8500);
  };

  /** A tap of dame dame, within the tap itself (which is what lets a browser play her song). say: over her head, so long */
  const dame = (say: (line: string, ms: number) => void) => {
    const now = Date.now();
    const ms = Math.max(SING_MS, playSound("dame", true) * 1000);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setSing(notesFrom(now));
    for (let t = NOTES_EVERY_MS; t + NOTE_MS <= ms; t += NOTES_EVERY_MS) {
      timers.current.push(window.setTimeout(() => setSing(notesFrom(Date.now())), t));
    }
    timers.current.push(
      window.setTimeout(() => {
        setSing(null);
        say(T.guides.haimao.dame.again, AGAIN_MS);
      }, ms),
    );
    say(T.guides.haimao.dame.singing, ms);
    taps.current = [...taps.current.filter((t) => now - t < TAPS_MS), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      fly();
    }
  };

  return { sing, flying, dame };
}

/** 全场 damedane across the whole screen, over the map and her card, letting taps through */
export function HaimaoDanmaku({ flying }: { flying: Danmaku }) {
  return (
    <div className="hm-dm-screen" aria-hidden="true">
      {flying.lines.map((l, i) => (
        <span
          key={`${flying.at}-${i}`}
          className={flying.still ? "still" : undefined}
          style={
            (flying.still
              ? { top: `${l.top}%`, left: `${l.left}%` }
              : { top: `${l.top}%`, "--w": `${flying.w}px`, animationDuration: `${l.dur.toFixed(2)}s`, animationDelay: `${l.delay.toFixed(2)}s` }) as CSSProperties
          }
        >
          {l.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Her card, the same for everyone who opens it: who she is (and who she is not, word for word), her 个性签名, the
 * 好感度 she keeps for you once you are signed in, 今日剧情, dame dame, and the two touches, with her sounds' 静音 kept
 * in this browser. Visitors see it all but her 好感度, and are asked to sign in as they touch her or open her story;
 * dame dame asks nobody.
 */
export function HaimaoCard({
  me,
  friend,
  signedIn,
  waiting,
  touching,
  sharesUid,
  sing,
  onTouch,
  onSignIn,
  onStory,
  onReview,
  onDame,
  onOpenFriend,
  under,
  onClose,
}: {
  me: HaimaoMe | null;
  friend: boolean;
  signedIn: boolean;
  waiting: boolean;
  touching: boolean;
  sharesUid: boolean;
  /** She sings dame dame (useHaimaoDame) */
  sing: HaimaoSing | null;
  onTouch: (bold: boolean) => void;
  onSignIn: () => void;
  /** 今日剧情: her story, the day's part of it */
  onStory: () => void;
  /** 回顾剧情: the scenes of it seen, to see again */
  onReview: () => void;
  /** dame dame, within the tap */
  onDame: () => void;
  onOpenFriend?: () => void;
  /** Roaches under her picture: to pick one of them (StackUnderGuide) */
  under?: ReactNode;
  onClose: () => void;
}) {
  const [sound, setSound] = useState(true);
  // what this browser keeps, read once in it; her damedane on its way, for dame dame
  useEffect(() => {
    setSound(soundOn());
    preloadClip();
  }, []);
  const love = me ? Math.min(HAIMAO_LOVE_MAX, Math.max(0, me.love)) : null;
  return (
    <div className="card stack haimao-card" role="dialog" aria-label={HAIMAO.name}>
      <div className="card-head">
        <GullButton size={56} friend={friend} sing={sing} />
        <div>
          <strong>{HAIMAO.name}</strong>
          <p className="muted">{HAIMAO.note}</p>
          <button
            type="button"
            className="hm-mute"
            aria-pressed={!sound}
            onClick={() => {
              setSoundOn(!sound);
              setSound(!sound);
              if (!sound) preloadClip();
            }}
          >
            {sound ? T.guides.haimao.mute : T.guides.haimao.unmute}
          </button>
        </div>
      </div>
      <p className="hm-sign">
        <span>{T.guides.haimao.signature}</span>
        <b>{HAIMAO_LINES.signature}</b>
      </p>
      <p className="hm-note">{HAIMAO_LINES.disclaimer}</p>
      {love !== null && (
        <div className="hm-love">
          <span>{T.guides.haimao.love}</span>
          <span
            className="hm-bar"
            role="meter"
            aria-label={T.guides.haimao.love}
            aria-valuemin={0}
            aria-valuemax={HAIMAO_LOVE_MAX}
            aria-valuenow={love}
          >
            <i style={{ width: `${(love / HAIMAO_LOVE_MAX) * 100}%` }} />
          </span>
          <b>{love}</b>
          <span className="muted">/{HAIMAO_LOVE_MAX}</span>
        </div>
      )}
      <div className="hm-acts">
        <button type="button" className="pill" disabled={waiting} onClick={() => (signedIn ? onStory() : onSignIn())}>
          {T.guides.haimao.today}
        </button>
        {signedIn && me && me.days > 0 && (
          <button type="button" className="pill" disabled={waiting} onClick={onReview}>
            {T.guides.haimao.review}
          </button>
        )}
        <button type="button" className="pill" onClick={onDame}>
          {T.guides.haimao.dame.button}
        </button>
      </div>
      {onOpenFriend && (
        <div className="row-actions">
          <button className="pill" onClick={onOpenFriend}>
            {T.common.seeThem}
          </button>
        </div>
      )}
      <div className="touch-buttons">
        <button disabled={touching || waiting} onClick={() => (signedIn ? onTouch(false) : onSignIn())}>
          {T.common.reachSneaky}
          <small>{T.guides.haimao.sneakyNote}</small>
        </button>
        <button disabled={touching || waiting} className="bold" onClick={() => (signedIn ? onTouch(true) : onSignIn())}>
          {T.common.reachBold}
          <small>{sharesUid ? T.guides.haimao.boldUid : T.guides.haimao.bold}</small>
        </button>
      </div>
      {under}
      <button className="close" onClick={onClose} aria-label={T.common.close}>
        ×
      </button>
    </div>
  );
}

/** Once in each browser, for every signed-in player with a main roach she shows to, after the other guides' cards. */
export function HaimaoIntroSheet({ onGo, onLater }: { onGo: () => void; onLater: () => void }) {
  const [picture, setPicture] = useState(true);
  const ref = useRef<HTMLImageElement>(null);
  // a picture that failed before the page could listen
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && !img.naturalWidth) setPicture(false);
  }, []);
  return (
    <Sheet title={T.guides.haimao.introTitle} onClose={onLater}>
      <div className="amiya-greet">
        {picture ? (
          // her face from her picture as she was first drawn, from the server's own folder; her Q figure when it is off
          <span className="hm-intro-pic">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={ref} src={HAIMAO_BASE} alt="" onError={() => setPicture(false)} />
          </span>
        ) : (
          <HaimaoFigure size={96} />
        )}
      </div>
      <p className="consent-place">{HAIMAO_LINES.introCard}</p>
      <p className="hm-note hm-note-c">{HAIMAO_LINES.disclaimer}</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onGo}>
          {T.guides.haimao.goSee}
        </button>
        <button className="pill" onClick={onLater}>
          {T.common.later}
        </button>
      </div>
    </Sheet>
  );
}

/** Her picture as she was first drawn (立绘), for her introduction */
const HAIMAO_BASE = "/guide-art/haimao-base.webp?v=1";

// ---- what this browser remembers about her, per player ----

const introKey = (userId: string) => `zhoup.haimaoIntro.${userId}`;

export function haimaoIntroShown(userId: string) {
  try {
    return localStorage.getItem(introKey(userId)) === "1";
  } catch {
    // without storage, rather say it happened than repeat it on every visit
    return true;
  }
}
export function markHaimaoIntroShown(userId: string) {
  try {
    localStorage.setItem(introKey(userId), "1");
  } catch {}
}

/** 清掉我和香艳制作人的记录 (local testing only) */
export function forgetHaimaoHere(userId: string) {
  try {
    localStorage.removeItem(introKey(userId));
  } catch {}
}
