"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { mulberry32 } from "@/lib/prng";
import { GLOW } from "@/lib/roachSvg";
import { advance, type Crumb, type Dir, type End, SNAKE, SNAKE_GOAL, snakeStart, stepMsOf, turn } from "@/lib/study/snake325";
import { calmNow, roundRect, useCanvasSize, useFrames, useRoachArt } from "./arena";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

/**
 * 贪吃小强 (src/lib/study/snake325.ts): a sheet of squared paper on a desk, drawn on a canvas (arena.ts), the player's
 * own roach crawling on it with a train of small roaches of its colour behind, and the four crumbs, each its number on
 * it. A swipe anywhere on the screen turns it (a finger, a pen or the mouse; the page does not scroll under it), and
 * so do the arrow keys and W A S D; two quick swipes turn it twice. Each of them is drawn on its way from one square to
 * the next, or with motion turned down, from square to square. A crumb eaten rises off the paper as its number a
 * moment; eaten past 325 the roach bursts, crumbs flying from it, and lies belly up, as it does run into the edge or
 * the train, or out of time. The round's clock stands still while the page is put away. Nothing flashes, and nothing
 * shakes.
 */

/**
 * How far a finger goes before it is a swipe (CSS px), each time on in one press; and how many times as far one way as
 * the other it must have gone (a swipe askew turns it only once it is plainly one way)
 */
const SWIPE_PX = 16;
const PLAIN = 1.4;
/** The desk round the paper (CSS px) */
const DESK = 8;
/** The roach's head and the small roaches behind it, in squares across */
const HEAD = 1.2;
const SMALL = 0.84;
/** A crumb of each number, as wide as so many squares at most, the bigger the number the bigger the crumb */
const CRUMB: Readonly<Record<number, number>> = { 5: 0.7, 20: 0.8, 50: 0.88, 100: 0.98 };
/**
 * Its number, so many squares high (smaller the more figures it has), and no smaller than so many CSS px: on a small
 * paper the crumb is then as big as it takes round the number
 */
const FIGURES = [0, 0.6, 0.54, 0.46];
const FIGURE_PX = 9;
/** How long a crumb eaten rises as its number, and crumbs fly from a roach that burst (ms) */
const POP_MS = 650;
const BURST_MS = 800;
/** How long what happened is said over the paper (ms) */
const SAID_MS = 1000;
/** The rule and 开始 over the paper, in a smaller hand on a paper not as wide as this (CSS px) */
const READY_ROOM = 230;

const INK = "#1b1d22";
const KEY_DIRS: Readonly<Record<string, Dir>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};
const ANGLE: Readonly<Record<Dir, number>> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

/** The paper in a canvas of w by h CSS px: as big a square as fits with the desk round it, in the middle */
function paperIn(w: number, h: number) {
  const side = Math.max(0, Math.min(w, h) - 2 * DESK);
  return { left: (w - side) / 2, top: (h - side) / 2, side, sq: side / SNAKE.size };
}

/**
 * A crumb eaten: drawn on till the roach, a step behind on its way, is over it, then rising as its number; crumbs flying
 * from a roach that burst: where (squares) and when (round ms)
 */
type Pop = Crumb & { at: number };
type Burst = { x: number; y: number; at: number };
/** The bits a burst throws: which way (radians), how fast (squares a second), how big (squares) */
const BITS = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 + (i % 3) * 0.17, v: 2.4 + ((i * 7) % 5) * 0.45, r: 0.07 + ((i * 5) % 3) * 0.025 }));

export default function Snake325({ seed, look, onRound }: GameProps) {
  const first = useMemo(() => {
    const random = mulberry32(seed);
    return { random, s: snakeStart(random) };
  }, [seed]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const keys = useKeys();
  const [phase, setPhase] = useState<"ready" | "run" | "over">("ready");
  const [eaten, setEaten] = useState(0);
  const [left, setLeft] = useState(SNAKE.seconds);
  /** What just happened, said over the paper a moment (a crumb eaten), or how the round ended, which stays */
  const [said, setSaid] = useState<{ text: string; kind: "ate" | "good" | "bad"; k: number } | null>(null);
  /** Frames on a moment after the round is over, for a burst's crumbs to land */
  const [after, setAfter] = useState(false);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const g = useRef({ s: first.s, random: first.random, calm: false, over: false, secs: SNAKE.seconds, pops: [] as Pop[], burst: null as Burst | null, t: 0, k: 0 });
  const box = useRef(size);
  box.current = size;
  const paper = paperIn(size.w, size.h);
  const art = useRoachArt(look, Math.max(8, Math.ceil((HEAD * paper.sq * size.dpr) / 8) * 8));
  const artRef = useRef(art);
  artRef.current = art;
  const color = GLOW[look.color];
  /** The desk and the paper, drawn once for each size */
  const back = useRef<{ key: string; c: HTMLCanvasElement } | null>(null);

  const draw = () => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (!ctx || !w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = paperIn(w, h);
    const key = `${w}x${h}@${dpr}`;
    if (back.current?.key !== key) back.current = { key, c: desk(w, h, dpr, p) };
    ctx.drawImage(back.current.c, 0, 0, w, h);
    const s = g.current.s;
    const sq = p.sq;
    const X = (x: number) => p.left + (x + 0.5) * sq;
    const Y = (y: number) => p.top + (y + 0.5) * sq;
    const now = g.current.t;
    for (const c of s.crumbs) crumb(ctx, X(c.x), Y(c.y), sq, c.n);
    for (const pop of g.current.pops) if (now < pop.at) crumb(ctx, X(pop.x), Y(pop.y), sq, pop.n);
    // each roach on its way from the square it was on to the one it is on, unless motion is turned down or it is over
    const k = g.current.calm || s.end ? 1 : Math.min(1, s.since / stepMsOf(s.eaten));
    const spot = (i: number) => {
      const a = s.was[i] ?? s.body[i];
      const b = s.body[i];
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };
    const facing = (i: number): number => {
      const a = s.was[i] ?? s.body[i];
      const b = s.body[i];
      if (a.x !== b.x || a.y !== b.y) return Math.atan2(b.x - a.x, a.y - b.y);
      const ahead = s.body[i - 1];
      return ahead ? Math.atan2(ahead.x - b.x, b.y - ahead.y) : ANGLE[s.dir];
    };
    for (let i = s.body.length - 1; i >= 1; i--) {
      const at = spot(i);
      small(ctx, X(at.x), Y(at.y), SMALL * sq, facing(i), color);
    }
    // the player's roach facing the way it goes, or belly up the right way up once the round is lost
    const head = spot(0);
    const lost = s.end !== null && s.end !== "won";
    const img = lost ? artRef.current.belly : artRef.current.stand;
    const hb = HEAD * sq;
    ctx.save();
    ctx.translate(X(head.x), Y(head.y));
    if (!lost) ctx.rotate(ANGLE[s.dir]);
    if (img) ctx.drawImage(img, -hb / 2, -hb / 2, hb, hb);
    else small(ctx, 0, 0, hb, 0, color);
    ctx.restore();
    // a crumb eaten, rising as its number
    for (const pop of g.current.pops) {
      const e = (now - pop.at) / POP_MS;
      if (e < 0 || e >= 1) continue;
      ctx.globalAlpha = 1 - e * e;
      label(ctx, `+${pop.n}`, X(pop.x), Y(pop.y) - e * 0.8 * sq, Math.max(FIGURE_PX + 1, sq * 0.56));
      ctx.globalAlpha = 1;
    }
    // a roach that burst: crumbs flying from it and falling, or with motion turned down lying round it
    const burst = g.current.burst;
    if (burst) {
      const e = g.current.calm ? 0.35 : Math.min(1, (now - burst.at) / BURST_MS);
      const secs = (e * BURST_MS) / 1000;
      ctx.globalAlpha = g.current.calm ? 1 : Math.min(1, (1 - e) * 3);
      BITS.forEach((b, i) => {
        const bx = X(burst.x) + Math.sin(b.a) * b.v * secs * sq;
        const by = Y(burst.y) - Math.cos(b.a) * b.v * secs * sq + (g.current.calm ? 0 : 3.2 * secs * secs * sq);
        ctx.fillStyle = i % 2 ? "#e3a85c" : "#f7dcaa";
        ctx.strokeStyle = "#9a5f22";
        ctx.lineWidth = Math.max(0.8, sq * 0.03);
        ctx.beginPath();
        ctx.arc(bx, by, b.r * sq, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
  };

  // the paper before the round, and again whenever its size or the roach's picture changes
  useEffect(draw);

  const finish = (end: End) => {
    const st = g.current;
    if (st.over) return;
    st.over = true;
    setPhase("over");
    const w = T.study.snake325;
    const n = st.s.eaten;
    const won = end === "won";
    if (end === "burst") st.burst = { x: st.s.body[0].x, y: st.s.body[0].y, at: st.t };
    // the crumb that ended it is gone at once, the roach on it
    st.pops = [];
    const text = won ? w.full : n > SNAKE_GOAL ? fmt(w.more, { d: n - SNAKE_GOAL }) : fmt(w.less, { d: SNAKE_GOAL - n });
    setSaid({ text, kind: won ? "good" : "bad", k: ++st.k });
    if (!st.calm && end === "burst") {
      setAfter(true);
      window.setTimeout(() => setAfter(false), BURST_MS + 100);
    }
    const r: Round = { won, result: fmt(w.result, { n }), verdict: fmt(w.verdicts[end], { n }) };
    roundRef.current(r);
  };

  useFrames(phase === "run" || after, (dt) => {
    const st = g.current;
    st.t += dt;
    if (!st.over) {
      const s = advance(st.s, dt, st.random);
      st.s = s;
      if (s.ate) {
        setEaten(s.eaten);
        // the roach is drawn a step behind on its way: the crumb stays till it is half way there, then rises
        if (!st.calm) st.pops = [...st.pops.filter((p) => st.t - p.at < POP_MS), { ...s.ate, at: st.t + stepMsOf(s.eaten) / 2 }];
        if (!s.end) setSaid({ text: fmt(T.study.snake325.ate, { n: s.ate.n, d: SNAKE_GOAL - s.eaten }), kind: "ate", k: ++st.k });
      }
      const secs = Math.ceil((SNAKE.seconds * 1000 - s.ms) / 1000);
      if (secs !== st.secs) {
        st.secs = secs;
        setLeft(secs);
      }
      if (s.end) finish(s.end);
    }
    draw();
  });

  // what a crumb did is said a moment; how the round ended stays
  useEffect(() => {
    if (!said || said.kind !== "ate") return;
    const t = window.setTimeout(() => setSaid((x) => (x?.k === said.k ? null : x)), SAID_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  // turns: a swipe anywhere on the screen but 不玩了, an arrow key, W A S D
  useEffect(() => {
    if (phase !== "run") return;
    const ask = (d: Dir) => {
      g.current.s = turn(g.current.s, d);
    };
    let held: number | null = null;
    let from = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      if (e.button > 0 || (e.target instanceof Element && e.target.closest("[data-quit], [data-no-tap]"))) return;
      held = e.pointerId;
      from = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      const across = Math.abs(dx);
      const down = Math.abs(dy);
      if (Math.max(across, down) < SWIPE_PX || Math.max(across, down) < PLAIN * Math.min(across, down)) return;
      ask(across > down ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
      // on from here: the same press bent another way turns it again
      from = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === held) held = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const d = KEY_DIRS[e.key] ?? KEY_DIRS[e.code];
      if (!d) return;
      e.preventDefault();
      ask(d);
    };
    // a swipe does not scroll the page, nor pull it down to load again
    const still = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchmove", still, { passive: false });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchmove", still);
    };
  }, [phase]);

  const start = () => {
    g.current = { ...g.current, calm: calmNow(), over: false, t: 0, pops: [], burst: null };
    setPhase("run");
  };

  const w = T.study.snake325;
  const tight = paper.side < READY_ROOM;
  const full = eaten > SNAKE_GOAL ? " sn-over" : eaten === SNAKE_GOAL ? " sn-full" : "";
  return (
    <div className="sn-game" data-phase={phase} style={{ "--sn-paper": `${Math.round(paper.side)}px` } as CSSProperties}>
      <div className="sn-side">
        <div className="sn-top">
          <span className={`sn-count${full}`} role="img" aria-label={fmt(w.eatenSr, { n: eaten, goal: SNAKE_GOAL })}>
            <small>{w.eaten}</small>
            <b>{eaten}</b>
            <span>/ {SNAKE_GOAL}</span>
          </span>
          <span className="sn-time" role="timer" aria-label={fmt(w.leftSr, { s: left })}>
            {fmt(w.left, { s: left })}
          </span>
        </div>
        <p className={`sn-said${said ? ` sn-${said.kind}` : ""}`} role="status">
          {said?.text ?? ""}
        </p>
      </div>
      <div className="sn-stage">
        <canvas ref={canvas} className="sn-canvas" role="img" aria-label={fmt(w.fieldSr, { size: SNAKE.size })} />
        {phase === "ready" && size.h > 0 && (
          <div className={`sn-ready${tight ? " sn-tight" : ""}`}>
            <div className="sn-card">
              <p className="sn-rule">
                {fmt(w.rule, { s: SNAKE.seconds })
                  .split("\n")
                  .map((line) => (
                    <span key={line}>{line}</span>
                  ))}
              </p>
              <button className="sn-start" onClick={start}>
                {w.start}
              </button>
              <p className="sn-hint">{keys ? w.swipeKeys : w.swipe}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The desk, and the squared paper on it, for a canvas of w by h CSS px (its pixels at dpr) */
function desk(w: number, h: number, dpr: number, p: ReturnType<typeof paperIn>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // the desk round the paper: wood, its grain running across
  const left = p.left - DESK;
  const top = p.top - DESK;
  const side = p.side + 2 * DESK;
  ctx.fillStyle = "#c99560";
  roundRect(ctx, left, top, side, side, 14);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = "rgba(122, 76, 34, 0.22)";
  ctx.lineWidth = 1.2;
  for (let y = top + 4, i = 0; y < top + side; y += 11 + (i % 3) * 4, i++) {
    ctx.beginPath();
    ctx.moveTo(left, y);
    for (let x = left; x <= left + side + 24; x += 24) ctx.lineTo(x, y + Math.sin(x / 37 + i * 1.7) * 1.6);
    ctx.stroke();
  }
  ctx.restore();
  // the paper, a little shadow under it, its squares in a pale blue-green and its edge a shade darker
  ctx.save();
  ctx.shadowColor = "rgba(60, 36, 12, 0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#fcf8ee";
  ctx.fillRect(p.left, p.top, p.side, p.side);
  ctx.restore();
  ctx.strokeStyle = "#cfe0dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < SNAKE.size; i++) {
    const at = Math.round(p.left + i * p.sq) + 0.5;
    ctx.moveTo(at, p.top);
    ctx.lineTo(at, p.top + p.side);
    const down = Math.round(p.top + i * p.sq) + 0.5;
    ctx.moveTo(p.left, down);
    ctx.lineTo(p.left + p.side, down);
  }
  ctx.stroke();
  ctx.strokeStyle = "#b9cfc9";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(p.left + 0.75, p.top + 0.75, p.side - 1.5, p.side - 1.5);
  return c;
}

/** A crumb of bread, its number on it, on a square sq wide with its middle at x, y */
function crumb(ctx: CanvasRenderingContext2D, x: number, y: number, sq: number, n: number) {
  const text = String(n);
  const px = Math.round(Math.max(FIGURE_PX, sq * FIGURES[Math.min(3, text.length)]));
  ctx.font = `800 ${px}px system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  const r = Math.max(((CRUMB[n] ?? 0.7) * sq) / 2, ctx.measureText(text).width / 2 + px * 0.15);
  ctx.fillStyle = "#e3a85c";
  ctx.strokeStyle = "#9a5f22";
  ctx.lineWidth = Math.max(1, sq * 0.05);
  ctx.lineJoin = "round";
  ctx.beginPath();
  // a lumpy round, wider than tall
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const k = 1 + (i % 2 ? -0.06 : 0.04) + (i % 5 === 0 ? 0.04 : 0);
    ctx.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k * 0.88);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f7dcaa";
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.66, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5a3412";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + sq * 0.03);
}

/** A small roach from above, size across, facing angle (0 up), its back in color */
function small(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, color: string) {
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, s * 0.06);
  ctx.beginPath();
  for (const ly of [-0.1, 0.06, 0.22]) {
    ctx.moveTo(-0.18 * s, ly * s);
    ctx.lineTo(-0.36 * s, (ly + 0.07) * s);
    ctx.moveTo(0.18 * s, ly * s);
    ctx.lineTo(0.36 * s, (ly + 0.07) * s);
  }
  // feelers
  ctx.moveTo(-0.05 * s, -0.32 * s);
  ctx.quadraticCurveTo(-0.1 * s, -0.46 * s, -0.22 * s, -0.5 * s);
  ctx.moveTo(0.05 * s, -0.32 * s);
  ctx.quadraticCurveTo(0.1 * s, -0.46 * s, 0.22 * s, -0.5 * s);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0.06 * s, 0.22 * s, 0.3 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, -0.27 * s, 0.13 * s, 0.1 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(27, 29, 34, 0.45)";
  ctx.lineWidth = Math.max(0.8, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, -0.15 * s);
  ctx.lineTo(0, 0.32 * s);
  ctx.stroke();
  ctx.restore();
}

/** A number in the dark brown of the crumbs, a white edge round it, its middle at x, y */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
  ctx.font = `800 ${Math.round(px)}px system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, px * 0.18);
  ctx.strokeStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#5a3412";
  ctx.fillText(text, x, y);
}
