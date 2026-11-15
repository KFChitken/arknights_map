"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { mulberry32 } from "@/lib/prng";
import { GLOW } from "@/lib/roachSvg";
import { crawling, crawlingAt, fate, placed, type Row, speedOf, STACK, type Stack, stackStart, startsOf } from "@/lib/study/stack325";
import { calmNow, roundRect, useCanvasSize, useFrames } from "./arena";
import type { GameProps, Round } from "./games";
import { listenTaps, useKeys } from "./taps";

/*
 * The field is measured in roach widths: x from its left edge, STACK.reach roaches left of the bottom row's left end,
 * y up from the ground the bottom row stands on, a roach's place being where the middle of its feet is.
 */
/** As wide as the bottom row and the room to crawl either side of it */
const FIELD_W = STACK.rows + 2 * STACK.reach;
/** How far up a row stands on the heads of the one under it, and how far over where it lands one crawls */
const PITCH = 0.64;
const HOVER = 0.4;
/** The ground under the bottom row, and the room over the top row crawling, for its feelers and the flag on it */
const GROUND = 0.7;
const HEADROOM = 1.4;
const FIELD_H = GROUND + (STACK.rows - 1) * PITCH + HOVER + HEADROOM;
/** How long a row dropped takes to land (ms); what falls off goes on falling as fast, faster all the time */
const DROP_MS = 90;
const LAND_V = (2 * HOVER) / (DROP_MS / 1000);
const FALL = LAND_V / (DROP_MS / 1000);
/** How fast a roach falling drifts away from the row it fell off (roach widths a second), and turns belly up (ms) */
const DRIFT = 1.4;
const FLIP_MS = 280;
/** A roach that fell lies belly up on the ground (with motion turned down, where it was) so long, then is gone (ms) */
const LIE_MS = 450;
const FADE_MS = 300;
/** Where a roach belly up on the ground is: the top of its head on it */
const REST_Y = -0.08;
/** How high a roach's body's middle is, which one turning belly up turns about */
const BODY_Y = 0.4;
/** How long what a drop did is said (ms) */
const SAID_MS = 1000;
/** Room enough over the field for the card before the round, and for how many stayed once it is passed (CSS px) */
const CARD_ROOM = 160;
const SUM_ROOM = 72;

const SKY = "#eef2f6";
const SOIL = "#e4d6b8";
const SOIL_EDGE = "#bfa77d";
const INK = "#1b1d22";
const DARK = "#2b2e35";
const VISOR = "#1d1f24";

/** A roach fallen off: where it is, how fast it goes, which side it fell off, ms since, and when it came to rest */
type Falling = { x: number; y: number; vx: number; vy: number; side: 1 | -1; t: number; rest: number | null };

/** A row dropped, landing: where it was dropped, which row it is, ms since, which fell, the row under, whether any stayed */
type Landing = { row: Row; k: number; t: number; fell: number[]; under: Row; kept: boolean };

type Run = {
  stack: Stack;
  /** The row crawling: ms it waits at its end yet before it sets off, and ms since it did */
  wait: number;
  ms: number;
  landing: Landing | null;
  falling: Falling[];
  /** Roaches fallen so far */
  fell: number;
  calm: boolean;
  over: boolean;
  /** Tells one thing said from the one before */
  k: number;
};

const fresh = (calm: boolean): Run => ({ stack: stackStart(), wait: STACK.settleMs, ms: 0, landing: null, falling: [], fell: 0, calm, over: false, k: 0 });

type Said = { text: string; good: boolean; k: number; row: number; stays: boolean };

/** A roach of a row's place along the field */
const xOf = (row: Row, i: number) => STACK.reach + (row.left + 2 * i + 1) / 2;

/** The field in a canvas of w by h CSS pixels: a roach's width in it (CSS px) */
const unitOf = (w: number, h: number) => Math.max(1, Math.min(w / FIELD_W, h / FIELD_H));

/**
 * 叠罗汉 (src/lib/study/stack325.ts): the bottom row of roaches stands on the ground, and the rows over it are dropped
 * on it one by one: each crawls left and right over the one under it, a step at a time, and drops where it is at a tap
 * anywhere on the screen (Space on a keyboard, taps.ts). It lands on the heads under it, and the roaches not on the row
 * under it turn belly up and fall to the ground (with motion turned down, they lie belly up where they were), and lie
 * there a moment. The roaches are drawn simply, from the front and in the player's own colour: a row of them is some
 * ten pixels a roach on a phone. Passed, the stack stands whole with a flag on top, and how many stayed is said over it.
 * The crawling stands still while the page is put away. Nothing flashes, and nothing shakes.
 */
export default function Stack325({ seed, look, onRound }: GameProps) {
  const starts = useMemo(() => startsOf(mulberry32(seed)), [seed]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const keys = useKeys();
  const [phase, setPhase] = useState<"ready" | "run" | "over">("ready");
  /** Frames are drawn while the round goes on, and after it until what fell is gone */
  const [live, setLive] = useState(false);
  /**
   * The counts over the field: the row crawling, or dropped last once over (from 1 at the bottom), the rows laid, the
   * roaches stayed and fallen; how it ended, and whether at 命运的 325
   */
  const [view, setView] = useState({ row: 2, laid: 1, kept: STACK.rows, fell: 0, end: null as Stack["end"], fate: false });
  const [said, setSaid] = useState<Said | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const g = useRef<Run>(fresh(false));
  const box = useRef(size);
  box.current = size;
  const color = GLOW[look.color];
  const art = useRef<{ key: string; sprites: HTMLCanvasElement[] } | null>(null);

  const draw = () => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (!ctx || !w || !h) return;
    const u = unitOf(w, h);
    const key = `${u.toFixed(3)}|${dpr}|${color}`;
    if (art.current?.key !== key) art.current = { key, sprites: spritesOf(u, dpr, color) };
    const sprites = art.current.sprites;
    const s = g.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = SKY;
    roundRect(ctx, 0, 0, w, h, 14);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const x0 = (w - FIELD_W * u) / 2;
    const y0 = h - GROUND * u;
    const put = (pose: Pose, x: number, y: number) => ctx.drawImage(sprites[pose], x0 + (x - BOX_L) * u, y0 - (y + BOX_T) * u, BOX_W * u, BOX_H * u);
    // the rows laid, but the one still landing
    const laid = s.stack.rows.length - (s.landing?.kept ? 1 : 0);
    for (let k = 0; k < laid; k++) {
      const row = s.stack.rows[k];
      for (let i = 0; i < row.n; i++) put(0, xOf(row, i), k * PITCH);
    }
    if (s.landing) {
      const l = s.landing;
      const f = Math.min(1, l.t / DROP_MS);
      for (let i = 0; i < l.row.n; i++) put(0, xOf(l.row, i), l.k * PITCH + HOVER * (1 - f * f));
    } else if (!s.over) {
      // the row crawling: a step at a time, a foot up and then the other each step; waiting at its end, both down
      const c = crawling(s.stack);
      const left = crawlingAt(s.stack, starts[c.k], s.ms);
      const pose = (s.wait > 0 ? 0 : 1 + (Math.floor((s.ms * speedOf(c.k)) / 1000) % 2)) as Pose;
      for (let i = 0; i < c.n; i++) put(pose, xOf({ left, n: c.n }, i), c.k * PITCH + HOVER);
    }
    for (const f of s.falling) {
      const turn = f.side * Math.PI * (s.calm ? 1 : Math.min(1, f.t / FLIP_MS));
      const lying = f.rest === null ? 0 : f.t - f.rest - LIE_MS;
      ctx.save();
      ctx.globalAlpha = lying > 0 ? Math.max(0, 1 - lying / FADE_MS) : 1;
      ctx.translate(x0 + f.x * u, y0 - (f.y + BODY_Y) * u);
      ctx.rotate(turn);
      ctx.drawImage(sprites[0], -BOX_L * u, (BODY_Y - BOX_T) * u, BOX_W * u, BOX_H * u);
      ctx.restore();
    }
    // the ground, with a line along its top
    ctx.fillStyle = SOIL;
    ctx.fillRect(0, y0, w, h - y0);
    ctx.fillStyle = SOIL_EDGE;
    ctx.fillRect(0, y0, w, Math.max(1, u * 0.12));
    // passed: a flag on the top roach, gold when none fell
    if (s.stack.end === "won" && !s.landing) {
      const top = s.stack.rows[s.stack.rows.length - 1];
      flag(ctx, x0 + xOf(top, 0) * u, y0 - (s.stack.rows.length - 1) * PITCH * u, u, fate(s.stack));
    }
    ctx.restore();
  };

  // the field before the round, and again whenever its size changes, and as it is once over
  useEffect(draw);

  useFrames(live, (dt) => {
    const s = g.current;
    if (!s.over) {
      let d = dt;
      if (s.wait > 0) {
        const w = Math.min(s.wait, d);
        s.wait -= w;
        d -= w;
      }
      if (!s.landing) s.ms += d;
    }
    if (s.landing) {
      s.landing.t += dt;
      if (s.landing.t >= DROP_MS) {
        s.falling.push(...fallers(s.landing, false));
        s.landing = null;
      }
    }
    if (s.falling.length) s.falling = s.falling.filter((f) => fallOn(f, dt, s.calm));
    draw();
    if (s.over && !s.landing && !s.falling.length) setLive(false);
  });

  // a tap anywhere drops the row crawling where it is drawn; while one waits at its end, or lands, taps do nothing
  useEffect(() => {
    if (phase !== "run") return;
    return listenTaps(() => {
      const s = g.current;
      if (s.over || s.wait > 0 || s.landing) return;
      const c = crawling(s.stack);
      const left = crawlingAt(s.stack, starts[c.k], s.ms);
      const under = s.stack.rows[s.stack.rows.length - 1];
      const r = placed(s.stack, left);
      s.stack = r.stack;
      s.fell += r.fell.length;
      s.wait = STACK.settleMs;
      s.ms = 0;
      // drawn as it lands from the next frame on, which come until it has and what fell is gone
      const landing: Landing = { row: r.row, k: c.k, t: 0, fell: r.fell, under, kept: r.fell.length < r.row.n };
      if (s.calm) s.falling.push(...fallers(landing, true));
      else s.landing = landing;
      const end = r.stack.end;
      setView({ row: end ? c.k + 1 : c.k + 2, laid: r.stack.rows.length, kept: r.stack.kept, fell: s.fell, end, fate: fate(r.stack) });
      const w = T.study.stack325;
      const middle = left === under.left + under.n - c.n;
      const text =
        end === "won" ? w.top : end === "lost" ? w.gone : r.fell.length ? fmt(w.dropped, { n: r.fell.length }) : middle ? w.middle : w.whole;
      setSaid({ text, good: end === "won" || (!end && !r.fell.length), k: ++s.k, row: c.k + 1, stays: Boolean(end) });
      if (end) {
        s.over = true;
        setPhase("over");
        roundRef.current(roundOf(r.stack, c.k));
      }
    });
  }, [phase, starts]);

  // what a drop did is said a moment; how the round ended stays
  useEffect(() => {
    if (!said || said.stays) return;
    const t = window.setTimeout(() => setSaid((now) => (now?.k === said.k ? null : now)), SAID_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  const start = () => {
    g.current = fresh(calmNow());
    setLive(true);
    setPhase("run");
  };

  const w = T.study.stack325;
  const u = unitOf(size.w, size.h);
  const sky = Math.max(0, Math.floor(size.h - FIELD_H * u));
  const hint = keys ? w.tapKeys : w.tap;
  return (
    <div className="sk-game" data-phase={phase}>
      <div className="sk-side">
        <div className="sk-top">
          <span className="sk-count">{fmt(w.row, { k: view.row, of: STACK.rows })}</span>
          <span className="sk-count">{fmt(w.kept, { n: view.kept })}</span>
          <span className={`sk-count${view.fell ? " sk-fell" : ""}`}>{fmt(w.fell, { n: view.fell })}</span>
        </div>
        <p className={`sk-said${said ? (said.good ? " sk-good" : " sk-bad") : ""}`}>{said ? said.text : phase === "run" ? hint : ""}</p>
      </div>
      <div className="sk-stage">
        <canvas ref={canvas} className="sk-canvas" role="img" aria-label={fmt(w.fieldSr, { k: view.laid, n: view.kept })} />
        {phase === "ready" && size.h > 0 && (
          <div className="sk-ready" style={{ height: sky >= CARD_ROOM ? sky : size.h }}>
            <div className="sk-card">
              <p className="sk-rule">
                {w.rule.split("\n").map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
              <button className="sk-start" onClick={start}>
                {w.start}
              </button>
              <p className="sk-hint">{hint}</p>
            </div>
          </div>
        )}
        {view.end === "won" && sky >= SUM_ROOM && (
          <p className={`sk-sum${view.fate ? " sk-fate" : ""}`} style={{ height: sky }}>
            {fmt(w.sum, { n: view.kept })}
          </p>
        )}
      </div>
      <p className="st-sr" aria-live="polite">
        {said ? fmt(w.droppedSr, { k: said.row, said: said.text }) : ""}
      </p>
    </div>
  );
}

/** The roaches of a row landed that fell off it: off the end of the row under they were past, turning belly up as they go */
function fallers(l: Landing, calm: boolean): Falling[] {
  return l.fell.map((i) => {
    const side = l.row.left + 2 * i + 1 <= l.under.left ? -1 : 1;
    return { x: xOf(l.row, i), y: l.k * PITCH, vx: side * DRIFT, vy: calm ? 0 : -LAND_V, side, t: 0, rest: calm ? 0 : null };
  });
}

/** A roach fallen off, dt ms on: it falls until it is on the ground, and lies there; whether it is still to be drawn */
function fallOn(f: Falling, dt: number, calm: boolean): boolean {
  f.t += dt;
  if (f.rest === null && !calm) {
    f.vy -= (FALL * dt) / 1000;
    f.x += (f.vx * dt) / 1000;
    f.y += (f.vy * dt) / 1000;
    if (f.y <= REST_Y) {
      f.y = REST_Y;
      f.rest = f.t;
    }
  }
  return f.rest === null || f.t - f.rest < LIE_MS + FADE_MS;
}

function roundOf(s: Stack, k: number): Round {
  const w = T.study.stack325;
  const n = s.kept;
  const result = fmt(w.result, { n });
  if (s.end !== "won") return { won: false, result, verdict: fmt(w.out, { k: k + 1, n }) };
  return fate(s) ? { won: true, fate: true, result, verdict: w.fate } : { won: true, result, verdict: fmt(w.pass, { n }) };
}

/** What a roach is drawn in, about the middle of its feet: so far either side of it and up from it, and so high (roach widths) */
const BOX_L = 0.5;
const BOX_T = 1.02;
const BOX_W = 2 * BOX_L;
const BOX_H = 1.08;

/** How a roach's feet are: both down, the left one up, the right one up */
type Pose = 0 | 1 | 2;

/** A roach u CSS px wide drawn once at the screen's pixel ratio, its feet each way (Pose) */
function spritesOf(u: number, dpr: number, color: string): HTMLCanvasElement[] {
  return ([0, 1, 2] as const).map((pose) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(BOX_W * u * dpr));
    c.height = Math.max(1, Math.round(BOX_H * u * dpr));
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, BOX_L * u * dpr, BOX_T * u * dpr);
      roach(ctx, u, color, pose);
    }
    return c;
  });
}

/**
 * A roach seen from the front, u CSS px wide, the middle of its feet at 0, 0: a round body in its colour with a dark
 * visor across it as the map's roaches have, two feelers and two feet
 */
function roach(ctx: CanvasRenderingContext2D, u: number, color: string, pose: Pose) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = DARK;
  ctx.lineWidth = Math.max(0.9, u * 0.07);
  ctx.beginPath();
  ctx.moveTo(-0.15 * u, -0.14 * u);
  ctx.lineTo(-0.22 * u, pose === 1 ? -0.06 * u : 0);
  ctx.moveTo(0.15 * u, -0.14 * u);
  ctx.lineTo(0.22 * u, pose === 2 ? -0.06 * u : 0);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, u * 0.045);
  ctx.beginPath();
  ctx.moveTo(-0.1 * u, -0.66 * u);
  ctx.quadraticCurveTo(-0.14 * u, -0.92 * u, -0.38 * u, -0.96 * u);
  ctx.moveTo(0.1 * u, -0.66 * u);
  ctx.quadraticCurveTo(0.14 * u, -0.92 * u, 0.38 * u, -0.96 * u);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, u * 0.06);
  ctx.beginPath();
  ctx.ellipse(0, -0.4 * u, 0.4 * u, 0.32 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = VISOR;
  roundRect(ctx, -0.25 * u, -0.53 * u, 0.5 * u, 0.16 * u, 0.08 * u);
  ctx.fill();
}

/** A flag stuck up between the top roach's feelers, its feet's middle at x, y (CSS px): gold when none fell, else red */
function flag(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, gold: boolean) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, u * 0.07);
  ctx.beginPath();
  ctx.moveTo(x, y - 0.7 * u);
  ctx.lineTo(x, y - 1.62 * u);
  ctx.stroke();
  ctx.fillStyle = gold ? "#ffd23f" : "#ff5d5d";
  ctx.lineWidth = Math.max(1, u * 0.05);
  ctx.beginPath();
  ctx.moveTo(x, y - 1.62 * u);
  ctx.lineTo(x + 0.74 * u, y - 1.41 * u);
  ctx.lineTo(x, y - 1.2 * u);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
