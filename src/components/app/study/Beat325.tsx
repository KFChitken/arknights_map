"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { mulberry32 } from "@/lib/prng";
import {
  type BeatDigit,
  type BeatResult,
  beatChart,
  beatTune,
  type Chart,
  missed,
  roundEnd,
  type Sound,
  type Tally,
  tallyStart,
  tapAt,
} from "@/lib/study/beat325";
import { calmNow, roundRect, useCanvasSize } from "./arena";
import { type Player, playTune } from "./beatSound";
import type { GameProps, Round } from "./games";
import { listenTaps, onClock, useKeys } from "./taps";

/** From 开始 to the tune's first beat (ms): the first notes come down into sight meanwhile */
const LEAD_IN = 1500;
/** How long a word under the line stays, and a hit note's ring spreads (ms) */
const SAID_MS = 550;
const RING_MS = 260;
/** How long the closing crash is let ring once the round is over (ms) */
const RING_OUT_MS = 1500;
/** Whether the sound is on, kept in the browser: "off" or not */
const SOUND_KEY = "zhoup.study.beatSound";
/** Each group's colour: fixed, the same every round */
const FILL: Record<BeatDigit, string> = { 3: "#ffd23f", 2: "#8fd0ff", 5: "#c8b6ff" };
const INK = "#1b1d22";
const FONT = 'system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';

/** What a tap did, said under the line */
type Said = "exact" | "hit" | "early" | "late" | "stray";

/** A round being played: its chart and tune, how it goes, when the tune's time 0 is (performance.now()), its sound */
type Play = {
  chart: Chart;
  tune: Sound[];
  tally: Tally;
  t0: number;
  player: Player | null;
  /** Notes just hit, for their rings: which, and when (performance.now()) */
  rings: { i: number; at: number }[];
  /** The word under the line: for the last tap, from when */
  said: { did: Said; at: number } | null;
  over: boolean;
};

/**
 * 325 节拍 (src/lib/study/beat325.ts): a tune of about 40 seconds made up afresh each round and played in the browser
 * (beatSound.ts), its notes coming down a lane on a canvas, each marked 3, 2 or 5 in its group's colour, to a line
 * near the bottom; the player taps anywhere on the screen (Space on a keyboard, taps.ts) as each reaches it. The next
 * two seconds or so of notes are in sight, a bar along the top goes the length of the tune, and the hits and strays
 * are counted over the lane. A note hit goes (with a ring, unless motion is turned down) and 正好 or 打中 shows under
 * the line, a tap a little off one 早了 or 晚了, a stray 乱敲; a note let go by goes on down grey. Each tap is judged by when it was made against when its note is at the
 * line, so the screen being drawn late moves nothing; the sound is started ahead to be heard then too. 声音 at the top
 * right turns it off and on, kept in the browser; the game plays the same without it. A page put away makes the round
 * void: nothing is told, and 重新开始 plays another. Nothing flashes.
 */
export default function Beat325({ seed, onRound }: GameProps) {
  const [phase, setPhase] = useState<"ready" | "play" | "void" | "over">("ready");
  /** Rounds begun again after being made void: each has a chart of its own */
  const [tries, setTries] = useState(0);
  const [hud, setHud] = useState({ hits: 0, strays: 0 });
  const [sound, setSound] = useState(soundKept);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const box = useRef(size);
  box.current = size;
  const bar = useRef<HTMLElement>(null);
  const play = useRef<Play | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const keys = useKeys();
  const total = chartFor(seed, tries).notes.length;

  const paint = (t: number, now: number, calm: boolean) => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (ctx && w && h) draw(ctx, w, h, dpr, play.current, t, now, calm);
    if (bar.current) {
      const p = play.current;
      bar.current.style.transform = `scaleX(${p ? Math.min(1, Math.max(0, t / p.chart.end)) : 0})`;
    }
  };

  // the lane before and after a round, and again whenever its size changes
  useEffect(() => {
    if (phase === "play") return;
    const p = play.current;
    paint(phase === "over" && p ? p.chart.end : -LEAD_IN, performance.now(), true);
  });

  const start = (stamp: number, n: number) => {
    const chart = chartFor(seed, n);
    const tune = beatTune(chart);
    const t0 = stamp + LEAD_IN;
    play.current?.player?.close();
    play.current = { chart, tune, tally: tallyStart(chart), t0, player: sound ? playTune(tune, t0, true) : null, rings: [], said: null, over: false };
    setHud({ hits: 0, strays: 0 });
    setPhase("play");
  };

  useEffect(() => {
    if (phase !== "play" || !play.current) return;
    const p = play.current;
    const calm = calmNow();
    let frame = 0;
    /** The round played out, or its page put away: told, or void */
    const stop = (why: "played" | "hidden") => {
      if (p.over) return;
      p.over = true;
      cancelAnimationFrame(frame);
      const r = roundEnd(p.chart, p.tally, why);
      if (r) {
        setPhase("over");
        roundRef.current(roundOf(r));
        window.setTimeout(() => p.player?.close(), RING_OUT_MS);
      } else {
        p.player?.close();
        p.player = null;
        setHud({ hits: 0, strays: 0 });
        setPhase("void");
      }
    };
    const tick = () => {
      const now = performance.now();
      const t = now - p.t0;
      if (t >= p.chart.end) return stop("played");
      paint(t, now, calm);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const unlisten = listenTaps((at) => {
      if (p.over) return;
      const r = tapAt(p.chart, p.tally, at - p.t0);
      if (r.did === "off") return;
      p.tally = r.tally;
      p.said = { did: r.did, at };
      if (r.did === "exact" || r.did === "hit") p.rings.push({ i: r.i, at });
      setHud({ hits: p.tally.got.filter((g) => g > 0).length, strays: p.tally.strays });
    });
    const onShow = () => document.hidden && stop("hidden");
    document.addEventListener("visibilitychange", onShow);
    return () => {
      cancelAnimationFrame(frame);
      unlisten();
      document.removeEventListener("visibilitychange", onShow);
      // gone in the middle of the round (不玩了): its sound with it
      if (!p.over) {
        p.over = true;
        p.player?.close();
      }
    };
  }, [phase]);

  // a round's sound goes with the game
  useEffect(() => () => play.current?.player?.close(), []);

  const toggleSound = (e: MouseEvent<HTMLButtonElement>) => {
    const on = !sound;
    setSound(on);
    keepSound(on);
    const p = play.current;
    if (phase === "play" && p && !p.over) {
      if (p.player) p.player.setOn(on);
      else if (on) p.player = playTune(p.tune, p.t0, true);
    }
    // Space is a tap, not a press of this
    e.currentTarget.blur();
  };

  const w = T.study.beat325;
  return (
    <div className="bt-game" data-phase={phase}>
      <div className="bt-progress" aria-hidden="true">
        <i ref={bar} />
      </div>
      <div className="bt-top">
        <span className="bt-tally">{fmt(w.hits, { n: hud.hits, m: total })}</span>
        <span className={`bt-tally${hud.strays ? " bt-strays" : ""}`}>{fmt(w.strays, { k: hud.strays })}</span>
        <button className="bt-sound" data-no-tap aria-pressed={sound} onClick={toggleSound}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
            {sound ? (
              <path d="M11 5.6a3.2 3.2 0 0 1 0 4.8M12.9 3.7a5.9 5.9 0 0 1 0 8.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            ) : (
              <path d="M11 6l3.6 4M14.6 6L11 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            )}
          </svg>
          {w.sound}
        </button>
      </div>
      <div className="bt-stage">
        <canvas ref={canvas} className="bt-canvas" role="img" aria-label={w.laneSr} />
        {phase === "ready" && (
          <div className="bt-card">
            <p className="bt-rule">{w.rule}</p>
            <button className="bt-start" onClick={(e) => start(onClock(e.timeStamp), tries)}>
              {w.start}
            </button>
            {sound && <p className="bt-quiet">{w.quiet}</p>}
          </div>
        )}
        {phase === "void" && (
          <div className="bt-card">
            <p className="bt-void">{w.void}</p>
            <button
              className="bt-start"
              onClick={(e) => {
                setTries(tries + 1);
                start(onClock(e.timeStamp), tries + 1);
              }}
            >
              {w.restart}
            </button>
          </div>
        )}
      </div>
      <p className="bt-hint">{phase === "play" ? (keys ? w.tapKeys : w.tap) : ""}</p>
    </div>
  );
}

/** The chart of a round: the game's seed, and after a void round another for each time it is begun again */
const chartFor = (seed: number, tries: number) => beatChart(mulberry32((seed + Math.imul(tries, 0x9e3779b9)) >>> 0));

function soundKept(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

function keepSound(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // kept for this game only
  }
}

function roundOf(r: BeatResult): Round {
  const w = T.study.beat325;
  const v = { n: r.hits, m: r.total, k: r.strays };
  return {
    won: r.won,
    result: fmt(r.strayNamed ? w.resultStrays : w.result, v),
    verdict: fmt(r.won ? (r.strayNamed ? w.passStrays : w.pass) : r.strayNamed ? w.missStrays : w.miss, v),
  };
}

/** Where the lane is on a canvas w by h, the line across it, and how long a note is in sight above the line (ms) */
function laneOf(w: number, h: number) {
  const width = Math.min(w - 16, 200);
  const line = Math.round(h - Math.max(40, h * 0.17));
  return { x: (w - width) / 2, width, line, lead: Math.min(2400, Math.max(1400, line * 7.5)) };
}

/** The lane at t on the tune's clock (now on performance.now()'s): its beats, its notes not hit yet, the line, what was said */
function draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, p: Play | null, t: number, now: number, calm: boolean) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const L = laneOf(w, h);
  const cx = w / 2;
  const speed = L.line / L.lead;
  const eighth = p ? p.chart.beat / 2 : 260;
  // a note: as wide as most of the lane, as tall as leaves a gap between two an eighth apart
  const nh = Math.max(14, Math.min(26, eighth * speed - 8));
  const nw = Math.min(L.width - 44, 112);
  const yOf = (at: number) => L.line - (at - t) * speed;
  ctx.fillStyle = "#f3f4f6";
  roundRect(ctx, L.x, 0, L.width, h, 16);
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (p) {
    // a faint line on each beat, a darker one where a bar starts
    const c = p.chart;
    const last = Math.min(Math.ceil(c.end / c.beat), Math.ceil((t + L.lead) / c.beat));
    for (let b = Math.max(0, Math.floor((t - (h - L.line) / speed) / c.beat)); b <= last; b++) {
      const y = Math.round(yOf(b * c.beat)) + 0.5;
      ctx.strokeStyle = b % 4 ? "#e3e6ea" : "#d0d4da";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.x, y);
      ctx.lineTo(L.x + L.width, y);
      ctx.stroke();
    }
  }
  // where a note is to be when it is tapped
  ctx.strokeStyle = "#c3c8cf";
  ctx.lineWidth = 2;
  roundRect(ctx, cx - nw / 2, L.line - nh / 2, nw, nh, nh / 2);
  ctx.stroke();
  if (p) {
    const c = p.chart;
    ctx.font = `800 ${Math.round(nh * 0.68)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < c.notes.length; i++) {
      if (p.tally.got[i]) continue;
      const n = c.notes[i];
      const y = yOf(n.at);
      if (y < -nh) break;
      if (y > h + nh) continue;
      const gone = missed(c, p.tally, i, t);
      roundRect(ctx, cx - nw / 2, y - nh / 2, nw, nh, nh / 2);
      ctx.fillStyle = gone ? "#e4e7eb" : FILL[n.digit];
      ctx.fill();
      ctx.strokeStyle = gone ? "#b7bdc6" : INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = gone ? "#9aa1ab" : INK;
      ctx.fillText(String(n.digit), cx, y + nh * 0.04);
    }
    // a note just hit: a ring of its colour spreading from the line, unless motion is turned down
    p.rings = p.rings.filter((r) => now - r.at < RING_MS);
    if (!calm)
      for (const r of p.rings) {
        const k = Math.max(0, now - r.at) / RING_MS;
        const grow = 1 + 0.35 * k;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = FILL[c.notes[r.i].digit];
        ctx.lineWidth = 4;
        roundRect(ctx, cx - (nw * grow) / 2, L.line - (nh * grow) / 2, nw * grow, nh * grow, (nh * grow) / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
  }
  ctx.restore();
  // the line, a little wider than the lane
  ctx.fillStyle = INK;
  ctx.fillRect(L.x - 8, L.line - 1.5, L.width + 16, 3);
  // under it: 正好, 打中, 早了, 晚了 or 乱敲 for a moment after a tap; 预备 until the tune begins
  const w2 = T.study.beat325;
  const said = p?.said && now - p.said.at < SAID_MS ? p.said.did : null;
  const word = said ? w2[said] : p && !p.over && t < 0 ? w2.ready : "";
  if (word) {
    // on a light pill, so a note going by under the line does not get in the way of reading it
    ctx.font = `800 ${said === "exact" ? 17 : 15}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const y = Math.min(h - 13, L.line + nh / 2 + 16);
    const tw = ctx.measureText(word).width;
    ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
    roundRect(ctx, cx - tw / 2 - 11, y - 12, tw + 22, 24, 12);
    ctx.fill();
    ctx.fillStyle = said === "stray" ? "#c0392b" : said === "exact" || said === "hit" ? "#1f9d55" : said ? "#5b616b" : "#9aa1ab";
    ctx.fillText(word, cx, y + 1);
  }
}
