"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { strokesOf, tidySheet } from "@/lib/study/board";
import { canHandIn, markPaper, type Reading, type Stroke, WRITE, WRITE_DIGITS, written } from "@/lib/study/write325";
import { calmNow, useCanvasSize } from "./arena";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

/** The squares' frame and cross, the ink, and the teacher's red pen */
const GRID = "#e8a29a";
const INK = "#1b1d22";
const RED = "#d8372a";
/**
 * The brush, in copybook units: the ink is w wide, slow times that where the brush goes slowly and fast times it at
 * quick a second or more, easing from one to the other as it goes; a stroke swells in over its first `into`, and
 * lifted on the move it thins out to `tip` times over its last `out`
 */
const BRUSH = { w: 0.066, slow: 1.4, fast: 0.5, quick: 2.2, ease: 0.3, into: 0.04, out: 0.08, tip: 0.2 };
/** The gap between the squares, the most a square is across, and the room over a square and under it (CSS px) */
const GAP = 8;
const MOST = 210;
const OVER = 22;
const UNDER = 40;
/** How long a square's red marks take to go on, the squares one after another (ms) */
const MARK_MS = 420;

/** A point of a stroke as the pen went: where (copybook units) and when (ms) */
type InkPt = { x: number; y: number; t: number };
/** A stroke, and whether the pen has been lifted at its end */
type Ink = { pts: InkPt[]; done: boolean };

/**
 * 徒手写 325 (src/lib/study/write325.ts): three copybook squares in a row, 3, 2 and 5 over them and no dashed lines to
 * go along. The player writes each in its square with a finger or the mouse, the ink a brush's, thick where it goes
 * slowly and thin where quickly; 擦掉 under a square wipes it. 交卷, once all three are written in, reads them on the
 * device and marks them in red one after another: a ring round a square of 90 or more, a tick on one under that, a
 * cross on one read as another digit or as none (scribbled), or under 60, and its mark under it. Then the round's
 * verdict: the word for the average, and the average. With less motion the marks are all on at once, and the verdict
 * with them. Nothing flashes. What is marked is the paper as it would be sent (board.ts tidySheet), so that the server,
 * marking it again for the 手写榜, finds what the page found; the round hands it on, and only a paper passed, by a
 * player, ever leaves the page (Study.tsx).
 */
export default function Write325({ onRound }: GameProps) {
  const keys = useKeys();
  /** Each square's strokes, those the pen has been lifted from */
  const [papers, setPapers] = useState<Stroke[][]>(() => WRITE_DIGITS.map(() => []));
  const [marked, setMarked] = useState<ReturnType<typeof markPaper> | null>(null);
  /** How many squares' marks have begun going on */
  const [shown, setShown] = useState(0);
  const [calm, setCalm] = useState(false);
  const roomRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const fit = () => {
      const box = el.getBoundingClientRect();
      const w = Math.floor(box.width);
      const h = Math.floor(box.height);
      setRoom((r) => (r.w === w && r.h === h ? r : { w, h }));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // the squares as big as the room lets them, all three across with their digit over them and 擦掉 under
  const side = Math.max(0, Math.floor(Math.min(MOST, (room.w - 2 * GAP) / 3, room.h - OVER - UNDER)));

  const onInk = useCallback((i: number, strokes: Stroke[]) => setPapers((p) => p.map((s, j) => (j === i ? strokes : s))), []);

  const ready = canHandIn(papers);
  const handIn = () => {
    if (marked || !ready) return;
    const paper = tidySheet(papers);
    const m = markPaper(strokesOf(paper));
    const still = calmNow();
    setMarked(m);
    setCalm(still);
    setShown(still ? WRITE_DIGITS.length : 1);
    if (!still) for (let i = 2; i <= WRITE_DIGITS.length; i++) timers.current.push(window.setTimeout(() => setShown(i), (i - 1) * MARK_MS));
    const w = T.study.write325;
    const text = fmt(w.result, { word: w.words[m.word], n: m.mark });
    // the verdict once the red marks are on
    const done = () => roundRef.current({ won: m.word !== "ghost", result: text, verdict: text, paper } satisfies Round);
    if (still) done();
    else timers.current.push(window.setTimeout(done, WRITE_DIGITS.length * MARK_MS));
  };

  const w = T.study.write325;
  return (
    <div className="wr-game" data-phase={marked ? "marked" : "write"}>
      <p className="wr-rule">
        <span>{w.rule}</span>
        <span>{keys ? w.howMouse : w.how}</span>
      </p>
      <div ref={roomRef} className="wr-room">
        <div className="wr-row">
          {WRITE_DIGITS.map((d, i) => (
            <Cell
              key={d}
              index={i}
              digit={d}
              side={side}
              strokes={papers[i]}
              onInk={onInk}
              locked={marked !== null}
              reading={marked && i < shown ? marked.readings[i] : undefined}
              calm={calm}
            />
          ))}
        </div>
      </div>
      <div className="wr-under">
        <button className="st-go wr-hand" disabled={!ready || marked !== null} onClick={handIn}>
          {w.handIn}
        </button>
        <p className="wr-note">{ready || marked ? "" : w.notYet}</p>
      </div>
      <p className="st-sr" aria-live="polite">
        {marked && shown >= WRITE_DIGITS.length ? marked.readings.map((r, i) => markSr(WRITE_DIGITS[i], r)).join(w.markSep) : ""}
      </p>
    </div>
  );
}

/** A square's mark as read out */
function markSr(d: number, r: Reading | null) {
  const w = T.study.write325;
  if (!r) return fmt(w.unreadSr, { d });
  return r.ok ? fmt(w.markSr, { d, n: r.mark }) : fmt(w.asSr, { d, e: r.nearest });
}

/**
 * A square and what goes with it: the digit to write over it, and under it 擦掉, or once marked its mark. The pen
 * writes in it while it is not locked (a stroke begun in it goes on in it off its edge, cut off where it is drawn);
 * strokes are told up as the pen is lifted. Its red marks go on over the moments after its reading comes.
 */
function Cell({
  index,
  digit,
  side,
  strokes,
  onInk,
  locked,
  reading,
  calm,
}: {
  index: number;
  digit: number;
  side: number;
  strokes: Stroke[];
  onInk: (i: number, strokes: Stroke[]) => void;
  locked: boolean;
  /** Its reading once its marks go on (null: no digit could be read in it); undefined before */
  reading: Reading | null | undefined;
  calm: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const ink = useRef<Ink[]>([]);
  /** When its marks began going on (performance.now()) */
  const markedAt = useRef(0);
  const frame = useRef(0);

  const draw = () => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = size;
    if (!ctx || !w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    copybook(ctx, w);
    for (const k of ink.current) drawInk(ctx, k, w);
    if (reading !== undefined) redPen(ctx, w, reading, calm ? 1 : Math.min(1, (performance.now() - markedAt.current) / MARK_MS));
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  /** Drawn again at the next screen refresh */
  const redraw = useCallback(() => {
    if (!frame.current)
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        drawRef.current();
      });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // drawn whenever its size or what is on it changes
  useEffect(() => drawRef.current());

  // its red marks going on: drawn every frame until they are on
  const marking = reading !== undefined;
  useEffect(() => {
    if (!marking) return;
    markedAt.current = performance.now();
    if (calm) return drawRef.current();
    let raf = 0;
    const step = () => {
      drawRef.current();
      if (performance.now() - markedAt.current < MARK_MS) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [marking, calm]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || locked) return;
    let held: number | null = null;
    const at = (e: PointerEvent): InkPt => {
      const box = el.getBoundingClientRect();
      return { x: (e.clientX - box.left) / (box.width || 1), y: (e.clientY - box.top) / (box.height || 1), t: e.timeStamp };
    };
    const tell = () => onInk(index, ink.current.filter((k) => k.done).map((k) => k.pts.map(({ x, y }) => ({ x, y }))));
    const onDown = (e: PointerEvent) => {
      if (held !== null || e.button > 0) return;
      held = e.pointerId;
      try {
        // kept on the square off its edge; a pointer already gone cannot be
        el.setPointerCapture(e.pointerId);
      } catch {}
      e.preventDefault();
      ink.current.push({ pts: [at(e)], done: false });
      redraw();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      const k = ink.current[ink.current.length - 1];
      // every point the pointer went through since the last move, where the browser keeps them
      const all = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const c of all.length ? all : [e]) {
        const q = at(c);
        const last = k.pts[k.pts.length - 1];
        if (Math.hypot(q.x - last.x, q.y - last.y) >= 0.002) k.pts.push(q);
      }
      redraw();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      held = null;
      ink.current[ink.current.length - 1].done = true;
      tell();
      redraw();
    };
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", stop);
    el.addEventListener("gesturestart", stop);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("contextmenu", stop);
      el.removeEventListener("gesturestart", stop);
    };
  }, [locked, index, onInk, redraw]);

  const erase = () => {
    if (locked) return;
    ink.current = [];
    onInk(index, []);
    redraw();
  };

  const w = T.study.write325;
  const has = strokes.length > 0;
  return (
    <div className="wr-cell">
      <span className="wr-label" aria-hidden="true">
        {digit}
      </span>
      <div className="wr-square" style={{ width: side, height: side }}>
        <canvas
          ref={canvas}
          className="wr-canvas"
          role="img"
          aria-label={fmt(w.squareSr, { n: index + 1, d: digit, state: written(strokes) ? w.written : w.empty })}
        />
      </div>
      {reading !== undefined ? (
        <p className={`wr-mark${reading && reading.ok && reading.mark >= WRITE.pass ? "" : " wr-off"}`} aria-hidden="true">
          {!reading ? w.unread : reading.ok ? fmt(w.mark, { n: reading.mark }) : fmt(w.as, { e: reading.nearest })}
        </p>
      ) : (
        <button className="wr-erase" onClick={erase} disabled={locked || !has} aria-label={fmt(w.eraseSr, { n: index + 1 })}>
          {w.erase}
        </button>
      )}
    </div>
  );
}

/** A copybook square s px across: white, a red frame, and a dashed cross through it */
function copybook(ctx: CanvasRenderingContext2D, s: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, s - 1.5, s - 1.5);
  ctx.lineWidth = 1;
  ctx.setLineDash([s * 0.035, s * 0.03]);
  ctx.beginPath();
  ctx.moveTo(s / 2, 0);
  ctx.lineTo(s / 2, s);
  ctx.moveTo(0, s / 2);
  ctx.lineTo(s, s / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Each point's ink width (copybook units), by how fast the pen went there; BRUSH says how */
function widthsOf(pts: readonly InkPt[], done: boolean): number[] {
  const n = pts.length;
  const along = [0];
  for (let i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const out: number[] = [];
  let w = BRUSH.w * BRUSH.slow;
  for (let i = 0; i < n; i++) {
    const v = i ? ((along[i] - along[i - 1]) / Math.max(4, pts[i].t - pts[i - 1].t)) * 1000 : 0;
    const k = Math.min(1, v / BRUSH.quick);
    w += (BRUSH.w * (BRUSH.slow + (BRUSH.fast - BRUSH.slow) * k) - w) * BRUSH.ease;
    out.push(w);
  }
  // how fast it was going as it was lifted: over its last few points
  const j = Math.max(0, n - 4);
  const lift = n > 1 ? ((along[n - 1] - along[j]) / Math.max(4, pts[n - 1].t - pts[j].t)) * 1000 : 0;
  const total = along[n - 1];
  for (let i = 0; i < n; i++) {
    if (along[i] < BRUSH.into) out[i] *= 0.7 + (0.3 * along[i]) / BRUSH.into;
    const left = total - along[i];
    if (done && lift > BRUSH.quick / 2 && left < BRUSH.out) out[i] *= BRUSH.tip + ((1 - BRUSH.tip) * left) / BRUSH.out;
  }
  return out;
}

/** Catmull-Rom: the point t of the way from b to c on a smooth curve through a, b, c and d */
const smooth = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

/** A stroke in ink on a square s px across: along a smooth curve through its points, as wide as the brush was there */
function drawInk(ctx: CanvasRenderingContext2D, k: Ink, s: number) {
  const pts = k.pts;
  const ws = widthsOf(pts, k.done);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x * s, pts[0].y * s, (ws[0] * s) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 2)];
    const b = pts[i - 1];
    const c = pts[i];
    const d = pts[Math.min(pts.length - 1, i + 1)];
    const steps = Math.max(1, Math.min(6, Math.ceil(Math.hypot(c.x - b.x, c.y - b.y) / 0.012)));
    let x0 = b.x;
    let y0 = b.y;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const x = smooth(a.x, b.x, c.x, d.x, t);
      const y = smooth(a.y, b.y, c.y, d.y, t);
      ctx.lineWidth = (ws[i - 1] + (ws[i] - ws[i - 1]) * t) * s;
      ctx.beginPath();
      ctx.moveTo(x0 * s, y0 * s);
      ctx.lineTo(x * s, y * s);
      ctx.stroke();
      x0 = x;
      y0 = y;
    }
  }
}

/** A line through points (square units), drawn k of its length on (0 to 1) */
function partly(ctx: CanvasRenderingContext2D, s: number, pts: readonly [number, number][], k: number) {
  if (k <= 0) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * Math.min(1, k);
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * s, pts[0][1] * s);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const f = Math.min(1, left / d);
    ctx.lineTo((x0 + (x1 - x0) * f) * s, (y0 + (y1 - y0) * f) * s);
    left -= d;
  }
  ctx.stroke();
}

/**
 * The teacher's red marks on a square s px across, k of the way on (0 to 1): a ring round it at WRITE.neat or more, a
 * tick at the corner on one read right at WRITE.pass or more, a cross there on one read as another digit, too far off,
 * or not read at all
 */
function redPen(ctx: CanvasRenderingContext2D, s: number, r: Reading | null, k: number) {
  if (k <= 0) return;
  ctx.save();
  ctx.strokeStyle = RED;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, s * 0.03);
  const good = r !== null && r.ok && r.mark >= WRITE.pass;
  if (good && r.mark >= WRITE.neat) {
    // round from the top left, a little wider where it ends, not quite closed
    ctx.globalAlpha = 0.9;
    const turn = 2 * Math.PI * 0.95 * Math.min(1, k);
    const n = 60;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = -2.3 + (turn * i) / n;
      const grow = 1 + (0.05 * i) / n;
      const x = s * (0.5 + 0.41 * grow * Math.cos(a));
      const y = s * (0.5 + 0.4 * grow * Math.sin(a));
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  } else if (good)
    partly(
      ctx,
      s,
      [
        [0.64, 0.8],
        [0.73, 0.9],
        [0.93, 0.63],
      ],
      k,
    );
  else {
    partly(
      ctx,
      s,
      [
        [0.68, 0.68],
        [0.92, 0.92],
      ],
      k * 2,
    );
    partly(
      ctx,
      s,
      [
        [0.92, 0.68],
        [0.68, 0.92],
      ],
      k * 2 - 1,
    );
  }
  ctx.restore();
}
