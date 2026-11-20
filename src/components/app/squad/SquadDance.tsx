"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmt, T } from "@/i18n";
import { readDance, type DanceBeats } from "@/lib/dance";
import type { SquadRoom } from "@/lib/squad";
import { danceMove, type DanceMode, type DanceMove, type DanceSong, type SquadMode } from "@/lib/squadMode";
import { WorldError } from "@/lib/world/types";
import { beatAt } from "../../disco/clock";
import { isListening, listenLiteNow, listenTap, useListenPlayer } from "../listening";
import { SquadRoach } from "./SquadRoach";
import { closeSquadModeCard, squadDanceSong, squadDanceTap, squadModeIn, squadServerNow, useSquadDanceJudge, useSquadModeCard, useSquadRoom } from "./squading";
import "./squadModes.css";

/**
 * 龙门广场舞 (玩点什么, src/lib/squadMode.ts), its card at the map's foot, no veil over the rest: the fight and the
 * room go on above it. Its opener leads in the middle (领舞), those in it in a row round TA, each as their combo has
 * it (晃 → 跳 → 转圈, from DANCE_HOP and DANCE_SPIN), on the song's beats; the others watch at the sides (围观). Over
 * it the song and where it is, your COMBO, and 准！ or 歪了 as you tap; under it the beats coming to the line, 跳 (or
 * 加入一起跳 to one watching), the music (yours alone: kept on this device), 不跳了，去围观. The server judges the
 * taps (squadDanceTap); the music is 听歌's song (only to those 听歌 is open to), played while the card is open,
 * kept where the server's clock has the song, and silent while 听歌 itself plays (the same song or another).
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

/** A dancer's pose at beat b (its whole part the beat, the rest how far on to the next): lands on each beat */
function moveAt(mv: DanceMove, b: number) {
  const k = Math.floor(b);
  const ph = b - k;
  if (mv === "hop") return `translateY(${(-12 * Math.sin(Math.PI * ph)).toFixed(1)}px)`;
  if (mv === "spin") {
    // a turn in two beats, up and down again
    const q = ((((k % 2) + 2) % 2) + ph) / 2;
    return `translateY(${(-16 * Math.sin(Math.PI * q)).toFixed(1)}px) rotate(${Math.round(360 * q)}deg)`;
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
 * Who dances where: the one leading in the middle (none, while TA watches or is gone), the others round TA, the first
 * to the left, the next to the right, and so on, each with their combo; the rest of the room watching
 */
export function danceRow(room: SquadRoom, mode: SquadMode) {
  const byH = new Map(room.members.map((m) => [m.h, m]));
  const dancers = mode.in.flatMap((x) => {
    const m = byH.get(x.h);
    return m ? [{ m, combo: x.combo, lead: x.h === mode.by }] : [];
  });
  const lead = dancers.find((d) => d.lead);
  const rest = dancers.filter((d) => !d.lead);
  const row = lead ? [...rest.filter((_, i) => i % 2 === 0).reverse(), lead, ...rest.filter((_, i) => i % 2 === 1)] : rest;
  return { row, watchers: room.members.filter((m) => !mode.in.some((x) => x.h === m.h)) };
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

/** The card as it shows, for the room and its dance as they are now (on the server's clock) */
export function DanceView({
  room,
  mode,
  now,
  judge,
  music,
  busy,
  msg,
  stageRef,
  stripRef,
  onClose,
  onTap,
  onTapClick,
  onJoin,
  onMusic,
  onLeave,
}: {
  room: SquadRoom;
  mode: DanceMode;
  now: number;
  /** 准！ or 歪了, while it shows (by: when it was tapped, to start its pop again) */
  judge: { ok: boolean; at: number } | null;
  music: DanceMusic;
  busy: boolean;
  msg: string | null;
  stageRef?: RefObject<HTMLDivElement | null>;
  stripRef?: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  /** 跳, as a finger or the mouse goes down on it */
  onTap: () => void;
  /** 跳 clicked: by a key (detail 0), a tap of its own; else after the finger's, where the music may start */
  onTapClick: (byKey: boolean) => void;
  onJoin: () => void;
  onMusic: () => void;
  onLeave: () => void;
}) {
  const t = T.squad.dance;
  const me = mode.in.find((m) => m.h === room.you);
  const combo = me?.combo ?? 0;
  const { row, watchers } = danceRow(room, mode);
  const over = mode.endsAt <= now;
  const startsIn = mode.songAt - now;
  const songLine =
    startsIn > 0
      ? fmt(t.startsIn, { name: mode.name, s: Math.ceil(startsIn / 1000) })
      : fmt(t.song, { name: mode.name, at: clock(Math.min(now, mode.until) - mode.songAt), len: clock(mode.until - mode.songAt) });
  const moveText = over ? t.ended : me ? t.moves[danceMove(combo)] : t.watching;
  const mw = musicWords(music);
  return (
    <div className="sq-dance" role="dialog" aria-label={t.title}>
      <header>
        <b>{fmt(t.count, { n: mode.in.length })}</b>
        <button type="button" className="x" onClick={onClose} aria-label={t.close}>
          ×
        </button>
      </header>
      <div className="stage" ref={stageRef}>
        <i className="lt l" aria-hidden="true" />
        <i className="lt r" aria-hidden="true" />
        <i className="floor" aria-hidden="true" />
        <span className="song">{songLine}</span>
        {me && combo > 0 && (
          <span className="combo">
            <b>{combo}</b>
            <small>{t.combo}</small>
          </span>
        )}
        <div className="line">
          {row.map(({ m, combo: c, lead }) => (
            <span key={m.h} className={`dancer${lead ? " lead" : ""}${m.you ? " you" : ""}`}>
              {lead && <em>{t.lead}</em>}
              <span className="body" data-mv={danceMove(c)}>
                <SquadRoach m={{ ...m, pose: 0 }} size={lead ? 70 : 58} />
              </span>
              <span className="nm">{m.you ? T.squad.room.you : m.name}</span>
            </span>
          ))}
        </div>
        {watchers.slice(0, 3).map((m, i) => (
          <span key={m.h} className={`watch w${i}`}>
            <SquadRoach m={{ ...m, pose: 0 }} size={36} />
            <small>{m.you ? `${T.squad.room.you}${T.squad.dot}${t.watch}` : t.watch}</small>
          </span>
        ))}
        {judge && (
          <span key={judge.at} className={`judge${judge.ok ? " ok" : ""}`} role="status">
            {judge.ok ? t.ok : t.miss}
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
        {me ? (
          <button
            type="button"
            className="tap"
            disabled={over}
            aria-label={t.tapLabel}
            onPointerDown={(e) => {
              if (e.button === 0) onTap();
            }}
            onClick={(e) => onTapClick(e.detail === 0)}
          >
            {t.tap}
          </button>
        ) : (
          <button type="button" className="tap join" disabled={busy || over} onClick={onJoin}>
            {t.join}
          </button>
        )}
        <button type="button" className="music" disabled={mw.off} aria-pressed={music === "on"} onClick={onMusic}>
          {mw.line}
          <small>{mw.sub}</small>
        </button>
      </div>
      {me && (
        <button type="button" className="leave" disabled={busy} onClick={onLeave}>
          {t.leave}
        </button>
      )}
      {msg && (
        <p className="dmsg" role="status">
          {msg}
        </p>
      )}
      <p className="note">{t.note}</p>
    </div>
  );
}

export default function SquadDance() {
  const openAt = useSquadModeCard();
  const room = useSquadRoom();
  const judge = useSquadDanceJudge();
  useListenPlayer();
  const [now, setNow] = useState(() => squadServerNow());
  const [song, setSong] = useState<{ key: string; got: DanceSong; beats: DanceBeats | null } | null>(null);
  const [wanted, setWanted] = useState(musicWanted);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [judged, setJudged] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const mode = room?.mode?.kind === "dance" && room.mode.at === openAt ? room.mode : null;
  const open = Boolean(mode);
  const key = mode ? `${mode.at}:${mode.song}` : null;
  const songAt = mode?.songAt ?? 0;
  const len = mode ? (mode.until - mode.songAt) / 1000 : 0;
  const beats = song?.key === key ? song.beats : null;

  useEffect(() => {
    if (!open) return;
    setNow(squadServerNow());
    const t = window.setInterval(() => setNow(squadServerNow()), 250);
    return () => window.clearInterval(t);
  }, [open]);

  // the song's beats and link, once a dance
  useEffect(() => {
    if (!key) return;
    let gone = false;
    setMsg(null);
    squadDanceSong()
      .then((got) => {
        if (gone) return;
        const map = readDance(got.dance);
        setSong({ key, got, beats: map && !map.none ? map : null });
      })
      .catch((e: unknown) => !gone && setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
    return () => {
      gone = true;
    };
  }, [key]);

  useEffect(() => {
    if (!judge) return;
    setJudged(judge.at);
    const t = window.setTimeout(() => setJudged(null), JUDGE_MS);
    return () => window.clearTimeout(t);
  }, [judge]);

  // the dancers on the beat, and the beats coming along the strip, every frame
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
        stage.querySelectorAll<HTMLElement>("[data-mv]").forEach((d) => {
          const mv = d.dataset.mv as DanceMove;
          d.style.transform = Number.isNaN(b) ? "" : moveAt(mv, b);
          // a sway rocks on the feet, a spin turns about the middle
          d.style.transformOrigin = mv === "spin" ? "50% 55%" : "";
        });
      }
      if (stripRef.current && beats) drawStrip(stripRef.current, beats.beats, t);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [open, songAt, beats]);

  const got = song?.key === key ? song.got : null;
  const lite = Boolean(got?.lite && listenLiteNow());
  const src = got?.url ? (lite ? (got.lite ?? null) : got.url) : null;
  const liteS = lite ? (beats?.liteS ?? 0) : 0;
  const listening = isListening();
  const here = listening && Boolean(mode) && listenTap()?.song === mode?.song;
  const over = !mode || mode.endsAt <= now;
  const can = open && !listening && !over && Boolean(src);
  const music = useDanceMusic({ can, want: can && wanted, src, songAt, liteS, len });

  if (!mode || !room) return null;
  const me = mode.in.some((m) => m.h === room.you);
  const run = async (p: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await p();
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  const tap = () => {
    if (over || !me) return;
    squadDanceTap(beats?.beats ?? null).catch((e: unknown) => setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain));
  };
  const state: DanceMusic =
    got && !got.url ? "none" : here ? "here" : listening ? "else" : music.blocked ? "blocked" : wanted ? "on" : "off";
  return (
    <DanceView
      room={room}
      mode={mode}
      now={now}
      judge={judge && judged === judge.at ? judge : null}
      music={state}
      busy={busy}
      msg={msg}
      stageRef={stageRef}
      stripRef={stripRef}
      onClose={closeSquadModeCard}
      onTap={tap}
      onTapClick={(byKey) => {
        // a key (Enter, space) taps here; a finger or the mouse did on its way down, and the music may start here
        if (byKey) tap();
        if (music.blocked) music.start();
      }}
      onJoin={() => {
        music.start();
        void run(() => squadModeIn(true));
      }}
      onMusic={() => {
        if (music.blocked) return music.start();
        const on = !wanted;
        setWanted(on);
        keepMusicWanted(on);
        if (on) music.start(true);
      }}
      onLeave={() => void run(() => squadModeIn(false))}
    />
  );
}
