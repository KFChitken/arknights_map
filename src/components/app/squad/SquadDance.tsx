"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { DANCE_MATES, danceMove, mateCombo, type GiftBot } from "@/lib/squadMode";
import { beatAt } from "../../disco/clock";
import { danceTraits, planOf, wildMove, type Plan } from "../../disco/choreo";
import { isListening, listenLiteNow, listenTap, useListenPlayer } from "../listening";
import { SquadRoach } from "./SquadRoach";
import { closeSquadDance, soloEnds, squadDanceOpen, squadDanceTap, squadServerNow, useSquadRoom, useSquadSolo, type SoloDanceNow } from "./squading";
import "./squadModes.css";

/**
 * 龙门广场舞, danced alone (src/lib/squadMode.ts SoloDance), its card at the map's foot, no veil over the rest: the
 * fight and the room go on above it. You lead in the middle; those of the room dance beside you (DANCE_MATES at most;
 * one alone, the two 人机 the server gave), each by this page alone: their own accuracy by their seed, their combo as
 * they hit or miss each beat (mateCombo), their move as their combo has it, and 群魔乱舞 in the song's climaxes (disco's
 * plan) or once you are in it. Your 跳 is judged here (squading.ts squadDanceTap), the dance getting fancier every five
 * in a row (晃 → 跳 → 转圈 → 左右横跳 → 甩头 → 后空翻 → 群魔乱舞: each of the six in turn by the dancer's seed, a new
 * one every four bars, the stage's lights on the beat and its floor changing colour). Over it the song and where it is,
 * your COMBO, and 准！ or 歪了 as you tap; under it the beats coming to the line, 跳, the music (yours alone: kept on
 * this device). It ends with its song or DANCE_IDLE_MS with no tap: your best and fanciest, and 再跳一首. Nothing goes
 * to the server while you dance. The music is 听歌's song (only to those 听歌 is open to), kept where the server's
 * clock has it, silent while 听歌 itself plays another; while it plays this very song (卫戍的一起听), its own.
 */

/** Beats are this far apart (px a second) on the strip, coming to its line at HIT_X */
const STRIP_SPEED = 110;
const HIT_X = 40;
/** Dots drawn on the strip at most */
const DOTS = 12;
/** With no beats yet, the dancers sway at this pace (s a beat) */
const FREE_BEAT_S = 0.6;
/** The music is put back where the song is when this far off it (s) */
const DRIFT_S = 0.3;
/** 准！ or 歪了 shows this long */
const JUDGE_MS = 600;

const MUSIC_KEY = "squad.danceMusic";
export function musicWanted() {
  try {
    return window.localStorage.getItem(MUSIC_KEY) !== "off";
  } catch {
    return true;
  }
}
export function keepMusicWanted(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(MUSIC_KEY);
    else window.localStorage.setItem(MUSIC_KEY, "off");
  } catch {
    // for this page alone
  }
}

/** The dance's music, one element for the page (made at the first play) */
let el: HTMLAudioElement | null = null;
let elSrc: string | null = null;
const audio = () => (el ??= Object.assign(new Audio(), { preload: "auto" }));

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The six moves 群魔乱舞 picks from, in the order disco's wildMove numbers them */
const SIX = ["sway", "hop", "spin", "side", "bang", "flip"] as const;
type Drawn = (typeof SIX)[number];

/** A dancer's pose at beat b (its whole part the beat, the rest how far on to the next): lands on each beat */
function moveAt(mv: Drawn, b: number) {
  const k = Math.floor(b);
  const ph = b - k;
  const odd = ((k % 2) + 2) % 2;
  if (mv === "hop") return `translateY(${(-12 * Math.sin(Math.PI * ph)).toFixed(1)}px)`;
  if (mv === "spin") {
    // a turn in two beats, up and down again
    const q = (odd + ph) / 2;
    return `translateY(${(-16 * Math.sin(Math.PI * q)).toFixed(1)}px) rotate(${Math.round(360 * q)}deg)`;
  }
  if (mv === "side") {
    // a step to one side each beat, back the next, a little hop on the way
    const x = odd ? 12 - 24 * ph : -12 + 24 * ph;
    return `translate(${x.toFixed(1)}px, ${(-9 * Math.sin(Math.PI * ph)).toFixed(1)}px)`;
  }
  if (mv === "bang") {
    // a hard nod forward on the beat, squashed as it lands, up again by the next
    const hit = (1 - ph) ** 3;
    return `rotate(${(24 * hit).toFixed(1)}deg) scale(${(1 + 0.12 * hit).toFixed(3)}, ${(1 - 0.18 * hit).toFixed(3)})`;
  }
  if (mv === "flip") {
    // two beats: down into a crouch and up, then over backwards
    const q = (odd + ph) / 2;
    if (q < 0.5) return `scale(1.06, ${(1 - 0.22 * Math.sin(2 * Math.PI * q)).toFixed(3)})`;
    const f = 2 * q - 1;
    return `translateY(${(-26 * Math.sin(Math.PI * f)).toFixed(1)}px) rotate(${Math.round(-360 * f)}deg)`;
  }
  return `rotate(${(6 * Math.cos(Math.PI * b)).toFixed(2)}deg)`;
}

/** The beats coming to the strip's line, at song time t (s) */
function drawStrip(strip: HTMLElement, beats: Float64Array, t: number) {
  const dots = strip.querySelectorAll<HTMLElement>("i");
  const w = strip.clientWidth;
  // the first beat no further back than the line's left
  let lo = 0;
  let hi = beats.length;
  const from = t - HIT_X / STRIP_SPEED;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  dots.forEach((dot, j) => {
    const b = beats[lo + j];
    const x = b === undefined ? Number.NaN : HIT_X + (b - t) * STRIP_SPEED;
    if (Number.isNaN(x) || x > w + 10) {
      dot.style.opacity = "0";
      return;
    }
    dot.style.opacity = "1";
    dot.style.transform = `translateX(${x.toFixed(1)}px)`;
  });
}

/**
 * The music put where the song is now on the server's clock (songAt its 0, len its length in s), from src (its copy
 * liteS behind the song, 省流量), and played; or, before its start, held at 0: says how long till then (ms, else 0).
 * refused: the browser will play it only from a tap.
 */
function placeMusic(src: string, songAt: number, liteS: number, len: number, refused: () => void, played: () => void): number {
  const a = audio();
  if (elSrc !== src) {
    a.src = src;
    elSrc = src;
  }
  const t = (squadServerNow() - songAt) / 1000 - liteS;
  if (t < 0) {
    if (!a.paused) a.pause();
    if (a.currentTime > 0.05) a.currentTime = 0;
    return -t * 1000;
  }
  // the song over: left as it is (the dance ends with it)
  if (t >= len - liteS - 0.2) return 0;
  if (Math.abs(a.currentTime - t) > DRIFT_S) a.currentTime = t;
  if (a.paused)
    a.play().then(played, (e: unknown) => {
      if (e instanceof DOMException && e.name === "NotAllowedError") refused();
    });
  return 0;
}

type Music = { can: boolean; want: boolean; src: string | null; songAt: number; liteS: number; len: number };

/**
 * The music while wanted (m.want; m.can: all but the player's own switch), kept where the song is, put back when it
 * drifts; it waits for the song's start. Says whether the browser refused to play it without a tap, and gives what
 * plays it from one (start; on: as the switch is about to be, else as it is), which also lets it play later on.
 */
export function useDanceMusic(m: Music) {
  const [blocked, setBlocked] = useState(false);
  const latest = useRef(m);
  useEffect(() => {
    latest.current = m;
  });
  const { want, src, songAt, liteS, len } = m;
  useEffect(() => {
    if (!want || !src) {
      el?.pause();
      return;
    }
    let timer = 0;
    const go = () => {
      window.clearTimeout(timer);
      const wait = placeMusic(src, songAt, liteS, len, () => setBlocked(true), () => setBlocked(false));
      if (wait > 0) timer = window.setTimeout(go, wait);
    };
    go();
    const a = audio();
    a.addEventListener("loadedmetadata", go);
    const keep = window.setInterval(go, 2_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(keep);
      a.removeEventListener("loadedmetadata", go);
      a.pause();
    };
  }, [want, src, songAt, liteS, len]);
  useEffect(() => () => el?.pause(), []);
  const start = (on?: boolean) => {
    const p = latest.current;
    if (!(on ?? p.want) || !p.can || !p.src) return;
    const wait = placeMusic(p.src, p.songAt, p.liteS, p.len, () => setBlocked(true), () => setBlocked(false));
    // before the song starts: played and held at once, within the tap, so it may play by itself at the start
    if (wait > 0) {
      const a = audio();
      a.play().catch(() => {});
      a.pause();
    }
  };
  return { blocked: want && blocked, start };
}

/**
 * The music's button: none (听歌 not open to the player), here (听歌 plays this very song), else (听歌 plays another),
 * blocked (the browser waits for a tap), or the player's own switch, on or off
 */
export type DanceMusic = "none" | "here" | "else" | "blocked" | "on" | "off";
export function musicWords(m: DanceMusic): { line: string; sub: string; off: boolean } {
  const t = T.squad.dance;
  if (m === "none") return { line: t.musicNone, sub: t.musicNoneSub, off: true };
  if (m === "here") return { line: t.musicHere, sub: t.musicHereSub, off: true };
  if (m === "else") return { line: t.musicElse, sub: t.musicElseSub, off: true };
  if (m === "blocked") return { line: t.musicBlocked, sub: t.musicOnly, off: false };
  return { line: m === "on" ? t.musicOn : t.musicOff, sub: t.musicOnly, off: false };
}

/** How many of the song's beats (s from its start) have come by song time t (s) */
export function beatsBy(beats: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether the k-th beat (from 1) is in one of the song's climaxes (disco's plan: a phrase loud enough) */
export function climaxAt(plan: Plan | null, k: number): boolean {
  if (!plan || k <= plan.first) return false;
  return Boolean(plan.phrases[Math.floor((k - 1 - plan.first) / plan.per)]?.climax);
}

/** One dancing's seed (h: their number in the room, or a 人机's) in the dance whose song starts at songAt */
export const danceSeed = (h: number, songAt: number) => (Math.imul(h + 4099, 2654435761) ^ Math.floor(songAt / 1000)) >>> 0;

/**
 * What one dances at beat b (of the song): the move their combo has, or in 群魔乱舞 (theirs, or wild: the song's
 * climax for a mate, yours for all) one of the six by their seed, a new one every four bars
 */
export function danceNow(combo: number, seed: number, b: number, wild: boolean): { mv: Drawn; wild: boolean } {
  const own = danceMove(combo);
  if (!wild && own !== "wild") return { mv: own, wild: false };
  return { mv: SIX[wildMove(danceTraits(seed), Math.max(0, b))] ?? "sway", wild: true };
}

/** Those dancing beside you: the room's others (players and 人机) as they are, DANCE_MATES at most; alone, the two 人机 given */
export function danceMates(room: SquadRoom, bots: readonly GiftBot[] | undefined): SquadMember[] {
  const others = room.members.filter((m) => !m.you).slice(0, DANCE_MATES);
  if (others.length) return others;
  return (bots ?? []).map((b) => ({
    h: b.h,
    name: fmt(T.squad.bot.name, { n: b.no }),
    host: false,
    you: false,
    friend: false,
    inGame: true,
    pose: 0,
    avatar: b.avatar,
    color: b.color,
    core: 0,
    strategy: null,
    extras: [],
    bot: true,
  }));
}

/** The card as it shows, for your dance and the room as they are now (on the server's clock) */
export function DanceView({
  room,
  d,
  now,
  mates,
  plan,
  judge,
  wild,
  music,
  stageRef,
  stripRef,
  onClose,
  onTap,
  onTapClick,
  onMusic,
  onAgain,
}: {
  room: SquadRoom;
  d: SoloDanceNow;
  now: number;
  mates: SquadMember[];
  /** The song's plan (disco's), for its climaxes */
  plan: Plan | null;
  /** 准！ or 歪了, while it shows (at: when it was tapped, to start its pop again) */
  judge: { ok: boolean; at: number } | null;
  /** 群魔乱舞 come just now: by when, while its word shows */
  wild: number | null;
  music: DanceMusic;
  stageRef?: RefObject<HTMLDivElement | null>;
  stripRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  /** 跳, as a finger or the mouse goes down on it */
  onTap: () => void;
  /** 跳 clicked: by a key (detail 0), a tap of its own; else after the finger's, where the music may start */
  onTapClick: (byKey: boolean) => void;
  onMusic: () => void;
  /** 再跳一首, once it is over */
  onAgain: () => void;
}) {
  const t = T.squad.dance;
  const song = d.song;
  const over = Boolean(song) && now >= soloEnds(d);
  const songT = song ? (now - song.songAt) / 1000 : -1;
  const going = Boolean(song) && songT >= 0 && !over;
  const k = going && d.beats ? beatsBy(d.beats.beats, songT) : 0;
  const b = going ? (d.beats ? beatAt(d.beats.beats, songT, d.beats.bpm) : songT / FREE_BEAT_S) : 0;
  const songAt = song?.songAt ?? 0;
  const yours = going ? d.combo : 0;
  const allWild = going && danceMove(yours) === "wild";
  const climax = going && climaxAt(plan, k);
  const me = room.members.find((m) => m.you);
  const lead = me ? [{ m: me, lead: true, ...danceNow(yours, danceSeed(me.h, songAt), b, false) }] : [];
  const others = mates.map((m) => {
    const seed = danceSeed(m.h, songAt);
    return { m, lead: false, ...danceNow(going && k > 0 ? mateCombo(seed, k - 1) : 0, seed, b, allWild || climax) };
  });
  // the first to your left, the next to your right, and so on
  const row = [...others.filter((_, i) => i % 2 === 0).reverse(), ...lead, ...others.filter((_, i) => i % 2 === 1)];
  const startsIn = song ? song.songAt - now : 0;
  const songLine = !song
    ? (d.err ?? t.loading)
    : startsIn > 0
      ? fmt(t.startsIn, { name: song.name, s: Math.ceil(startsIn / 1000) })
      : fmt(t.song, { name: song.name, at: clock(Math.min(now - song.songAt, song.seconds * 1000)), len: clock(song.seconds * 1000) });
  const moveText = over ? fmt(t.result, { n: d.best, move: t.moveNames[danceMove(d.best)] }) : t.moves[danceMove(yours)];
  const mw = musicWords(music);
  return (
    <div className={`sq-dance${allWild ? " wild" : ""}`} role="dialog" aria-label={t.title}>
      <header>
        <b>{fmt(t.count, { n: row.length })}</b>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      <div className="stage" ref={stageRef}>
        <i className="lt l" aria-hidden="true" />
        <i className="lt r" aria-hidden="true" />
        <i className="floor" aria-hidden="true" />
        <span className="song">{songLine}</span>
        {yours > 0 && (
          <span className="combo">
            <b>{yours}</b>
            <small>{t.combo}</small>
          </span>
        )}
        <div className="line">
          {row.map((x) => (
            <span key={x.m.h} className={`dancer${x.lead ? " lead" : ""}${x.m.you ? " you" : ""}${x.wild ? " wild" : ""}`}>
              {x.lead && <em>{t.lead}</em>}
              <span className="body" data-mv={x.mv}>
                <SquadRoach m={{ ...x.m, pose: 0 }} size={x.lead ? 70 : 58} />
              </span>
              <span className="nm">{x.m.you ? T.squad.room.you : x.m.name}</span>
            </span>
          ))}
        </div>
        {judge && !over && (
          <span key={`j${judge.at}`} className={`judge${judge.ok ? " ok" : ""}`} role="status">
            {judge.ok ? t.ok : t.miss}
          </span>
        )}
        {wild !== null && !over && (
          <span key={`w${wild}`} className="wildw" role="status">
            {t.wild}
          </span>
        )}
        <span className="mv">{moveText}</span>
      </div>
      <div className="strip" ref={stripRef} aria-hidden="true">
        {Array.from({ length: DOTS }, (_, i) => (
          <i key={i} />
        ))}
        <b className="hit" />
      </div>
      <div className="acts">
        {over ? (
          <button type="button" className="tap again" onClick={onAgain}>
            {t.again}
          </button>
        ) : (
          <button
            type="button"
            className="tap"
            disabled={!song}
            aria-label={t.tapLabel}
            onPointerDown={(e) => {
              if (e.button === 0) onTap();
            }}
            onClick={(e) => onTapClick(e.detail === 0)}
          >
            {t.tap}
          </button>
        )}
        <button type="button" className="music" disabled={mw.off} aria-pressed={music === "on"} onClick={onMusic}>
          {mw.line}
          <small>{mw.sub}</small>
        </button>
      </div>
      <p className="note">{t.note}</p>
    </div>
  );
}

/** 群魔乱舞's word over the stage shows this long */
const WILD_MS = 1_400;

export default function SquadDance() {
  const d = useSquadSolo();
  const room = useSquadRoom();
  useListenPlayer();
  const [now, setNow] = useState(() => squadServerNow());
  const [wanted, setWanted] = useState(musicWanted);
  const [judged, setJudged] = useState<number | null>(null);
  const [wildAt, setWildAt] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const open = Boolean(d && room);
  const song = d?.song ?? null;
  const beats = d?.beats ?? null;
  const songAt = song?.songAt ?? 0;
  const len = song?.seconds ?? 0;
  const plan = useMemo(() => (beats ? planOf(beats) : null), [beats]);
  const judge = d?.judge ?? null;
  const wild = d?.wildAt ?? null;

  useEffect(() => {
    if (!open) return;
    setNow(squadServerNow());
    const t = window.setInterval(() => setNow(squadServerNow()), 250);
    return () => window.clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!judge) return;
    setJudged(judge.at);
    const t = window.setTimeout(() => setJudged(null), JUDGE_MS);
    return () => window.clearTimeout(t);
  }, [judge]);

  useEffect(() => {
    if (wild === null) return;
    setWildAt(wild);
    const t = window.setTimeout(() => setWildAt(null), WILD_MS);
    return () => window.clearTimeout(t);
  }, [wild]);

  // the dancers on the beat, 群魔乱舞's lights and floor, and the beats coming along the strip, every frame
  useEffect(() => {
    if (!open) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const tick = () => {
      raf = window.requestAnimationFrame(tick);
      const t = (squadServerNow() - songAt) / 1000;
      const stage = stageRef.current;
      if (stage && !still) {
        const b = t < 0 ? Number.NaN : beats ? beatAt(beats.beats, t, beats.bpm) : t / FREE_BEAT_S;
        stage.querySelectorAll<HTMLElement>("[data-mv]").forEach((el) => {
          const mv = el.dataset.mv as Drawn;
          el.style.transform = Number.isNaN(b) ? "" : moveAt(mv, b);
          // a sway rocks on the feet, a spin and a flip turn about the middle
          el.style.transformOrigin = mv === "spin" || mv === "flip" ? "50% 55%" : "";
        });
        if (!Number.isNaN(b)) {
          stage.style.setProperty("--flash", (1 - (b - Math.floor(b))).toFixed(2));
          stage.style.setProperty("--floor", `${(Math.floor(b / 4) * 53) % 360}deg`);
        }
      }
      if (stripRef.current && beats) drawStrip(stripRef.current, beats.beats, t);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [open, songAt, beats]);

  const lite = Boolean(song?.lite && listenLiteNow());
  const src = song?.url ? (lite ? (song.lite ?? null) : song.url) : null;
  const liteS = lite ? (beats?.liteS ?? 0) : 0;
  const listening = isListening();
  const here = listening && Boolean(song) && listenTap()?.song === song?.song;
  const over = !d || !song || now >= soloEnds(d);
  const can = open && !listening && !over && Boolean(src);
  const music = useDanceMusic({ can, want: can && wanted, src, songAt, liteS, len });

  if (!d || !room) return null;
  const state: DanceMusic = song && !song.url ? "none" : here ? "here" : listening ? "else" : music.blocked ? "blocked" : wanted ? "on" : "off";
  return (
    <DanceView
      room={room}
      d={d}
      now={now}
      mates={danceMates(room, song?.bots)}
      plan={plan}
      judge={judge && judged === judge.at ? judge : null}
      wild={wild !== null && wildAt === wild ? wild : null}
      music={state}
      stageRef={stageRef}
      stripRef={stripRef}
      onClose={closeSquadDance}
      onTap={squadDanceTap}
      onTapClick={(byKey) => {
        // a key (Enter, space) taps here; a finger or the mouse did on its way down, and the music may start here
        if (byKey) squadDanceTap();
        if (music.blocked) music.start();
      }}
      onMusic={() => {
        if (music.blocked) return music.start();
        const on = !wanted;
        setWanted(on);
        keepMusicWanted(on);
        if (on) music.start(true);
      }}
      onAgain={() => void squadDanceOpen().catch(() => {})}
    />
  );
}
