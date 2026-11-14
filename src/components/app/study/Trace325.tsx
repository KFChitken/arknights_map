"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { clamp, touches } from "@/lib/study/field";
import { dayRandom } from "@/lib/study/rules";
import {
  FLIGHT,
  flyerAt,
  type Pt,
  type Stroke,
  STROKES,
  touched,
  TRACE,
  TRACE_BOTTOM,
  TRACE_DIGITS,
  TRACE_FLYER_R,
  TRACE_ROACH_R,
  TRACE_SIDE,
  TRACE_STUN_MS,
  TRACE_TOP,
  traceFlyers,
  write,
  type Writing,
  WRITING_START,
} from "@/lib/study/trace325";
import { calmNow, drawObstacle, roundRect, useCanvasSize, useDrag, useFrames, useRoachArt } from "./arena";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

/** How long a character just written stays whole on the square before the next comes (ms); the roach writes nothing meanwhile */
const CHAR_PAUSE_MS = 600;
/** How long what happened is said over the field (ms) */
const SAID_MS = 1100;
/** How big the roach is drawn (copybook units across), and where it waits before it is first moved: under the square */
const ROACH_BOX = 0.17;
const REST: Pt = { x: 0.5, y: 1 + TRACE_BOTTOM / 2 };
/** The field, the square and the room round it: copybook units across and down */
const FIELD_W = 1 + 2 * TRACE_SIDE;
const FIELD_H = TRACE_TOP + 1 + TRACE_BOTTOM;
/** Before the round, the rule, the start button and how to move are said over the square in this much room (CSS px); with less, without how to move, and with less than RULE_ROOM without the rule too (the list showed it) */
const READY_ROOM = 150;
const RULE_ROOM = 110;
/** The square's frame and cross, the dashed lines to write along and where each stroke starts, the ink */
const GRID = "#e8a29a";
const GUIDE = "#e0675b";
const INK = "#1b1d22";

/** Where the field is in a canvas of w by h CSS pixels, along its top: u is a copybook unit in pixels, x and y the square's top left */
function layout(w: number, h: number) {
  const u = Math.max(0, Math.min(w / FIELD_W, h / FIELD_H));
  const left = (w - FIELD_W * u) / 2;
  return { u, left, fw: FIELD_W * u, fh: FIELD_H * u, x: left + TRACE_SIDE * u, y: TRACE_TOP * u };
}

type Said = { did: "done" | "hit"; k: number };

/** The round as it goes, for the frames and the finger */
function fresh(calm = false) {
  return {
    /** Its clock (ms) */
    t: 0,
    /** Where the roach is (copybook units), where it was at the last move while held (null: just put down), and where the finger would have it */
    pen: REST,
    last: null as Pt | null,
    finger: null as Pt | null,
    writing: WRITING_START as Writing,
    /** Until when it lies belly up, and until when the character just written stays whole (ms) */
    stunTill: -1,
    pauseTill: -1,
    /** The character just written, shown whole until the next comes (-1: none) */
    shown: -1,
    /** The flyers that touched the roach, gone */
    gone: new Set<number>(),
    calm,
    over: false,
    secs: TRACE.ms / 1000,
    k: 0,
  };
}

/**
 * 描红 325 (src/lib/study/trace325.ts): 3, 2 and 5 in turn on a copybook square drawn on a canvas (arena.ts), each as
 * dashed lines with a dot where each stroke starts. The player drags their own roach along them, the roach a little
 * above a finger (on a mouse pointer), and the ink goes on along the stroke while the roach keeps near it. The day's
 * bombs, paper planes and slugs fly across from the sides; one that touches the roach leaves it belly up a moment and
 * rubs out the character being written (TRACE.erase). Three slots over the square show how far it has got. The
 * round's clock stands still while the page is put away. Nothing flashes.
 */
export default function Trace325({ day, look, onRound }: GameProps) {
  const flyers = useMemo(() => traceFlyers(dayRandom("trace325", day)), [day]);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const keys = useKeys();
  const [phase, setPhase] = useState<"ready" | "run" | "over">("ready");
  /** How far it has got, for the slots: the character being written, and how many rewrites */
  const [hud, setHud] = useState({ char: 0, rewrites: 0 });
  const [left, setLeft] = useState(TRACE.ms / 1000);
  const [said, setSaid] = useState<Said | null>(null);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const g = useRef(fresh());
  const box = useRef(size);
  box.current = size;
  const at = layout(size.w, size.h);
  const art = useRoachArt(look, Math.ceil((ROACH_BOX * at.u * size.dpr) / 8) * 8);
  const artRef = useRef(art);
  artRef.current = art;
  // the room for the rule and the start button: the square and the strip over it
  const room = Math.round((TRACE_TOP + 1) * at.u);

  const draw = () => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (!ctx || !w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const L = layout(w, h);
    const u = L.u;
    if (!u) return;
    ctx.fillStyle = "#f3f4f6";
    roundRect(ctx, L.left, 0, L.fw, L.fh, 14);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const s = g.current;
    // before the round the rule is said where the square will be
    if (phase !== "ready") {
      copybook(ctx, L.x, L.y, u);
      const char = s.shown >= 0 ? s.shown : s.writing.char;
      if (char < TRACE_DIGITS.length) {
        const strokes = STROKES[TRACE_DIGITS[char]];
        strokes.forEach((k, j) => {
          const ink = s.shown >= 0 || j < s.writing.stroke ? k.length : j === s.writing.stroke ? s.writing.ink : 0;
          // the rest dashed (fainter for a stroke after the one being written), the ink over it
          if (ink < k.length) guide(ctx, k, ink, L.x, L.y, u, j === s.writing.stroke ? 1 : 0.45);
          if (ink > 0) along(ctx, k, 0, ink, L.x, L.y, u, INK, 0.05);
        });
        // where each stroke not yet begun starts, the one to write now on top
        if (s.shown < 0)
          for (let j = strokes.length - 1; j >= s.writing.stroke; j--)
            if (j > s.writing.stroke || s.writing.ink === 0) dot(ctx, strokes[j].pts[0], L.x, L.y, u, j === s.writing.stroke ? 1 : 0.45);
      }
    }
    flyers.forEach((f, i) => {
      if (s.gone.has(i)) return;
      const p = flyerAt(f, s.t, s.calm);
      if (!p.flying) return;
      drawObstacle(ctx, f.what, L.x + p.x * u, L.y + p.y * u, TRACE_FLYER_R * u * 1.1, Math.atan2(f.y1 - f.y0, -f.side * FLIGHT));
    });
    const img = s.t < s.stunTill ? artRef.current.belly : artRef.current.stand;
    const b = ROACH_BOX * u;
    const rx = L.x + s.pen.x * u;
    const ry = L.y + s.pen.y * u;
    if (img) ctx.drawImage(img, rx - b / 2, ry - b / 2, b, b);
    else {
      ctx.fillStyle = "#3a3d44";
      ctx.beginPath();
      ctx.ellipse(rx, ry, b * 0.3, b * 0.36, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  // the square before the round, and again whenever its size or the roach's picture changes
  useEffect(draw);

  const end = (won: boolean) => {
    const s = g.current;
    if (s.over) return;
    s.over = true;
    setPhase("over");
    if (!won) setLeft(0);
    const w = T.study.trace325;
    const text = won ? fmt(w.pass, { n: s.writing.rewrites }) : fmt(w.out, { d: TRACE_DIGITS[Math.min(s.writing.char, TRACE_DIGITS.length - 1)] });
    roundRef.current({ won, result: text, verdict: text } satisfies Round);
  };

  const say = (did: Said["did"]) => setSaid({ did, k: ++g.current.k });

  useFrames(phase === "run", (dt) => {
    const s = g.current;
    if (s.over) return;
    s.t += dt;
    if (s.shown >= 0 && s.t >= s.pauseTill) s.shown = -1;
    // up again: the roach goes back under the finger, and writes on from there
    if (s.stunTill >= 0 && s.t >= s.stunTill) {
      s.stunTill = -1;
      if (s.finger) s.pen = s.finger;
      s.last = null;
    }
    if (s.stunTill < 0)
      for (let i = 0; i < flyers.length; i++) {
        if (s.gone.has(i)) continue;
        const p = flyerAt(flyers[i], s.t, s.calm);
        if (!p.flying || !touches(p.x, p.y, TRACE_FLYER_R, s.pen.x, s.pen.y, TRACE_ROACH_R)) continue;
        s.gone.add(i);
        s.writing = touched(s.writing);
        s.stunTill = s.t + TRACE_STUN_MS;
        s.shown = -1;
        s.last = null;
        setHud({ char: s.writing.char, rewrites: s.writing.rewrites });
        say("hit");
        break;
      }
    draw();
    if (s.t >= TRACE.ms) return end(false);
    const secs = Math.ceil((TRACE.ms - s.t) / 1000);
    if (secs !== s.secs) {
      s.secs = secs;
      setLeft(secs);
    }
  });

  useDrag(stage, phase === "run", (x, y, down, kind) => {
    const s = g.current;
    const L = layout(box.current.w, box.current.h);
    if (s.over || !L.u) return;
    // a finger would hide the roach and the line: the roach is a little above it
    const lift = kind === "touch" ? TRACE.above : 0;
    const p = {
      x: clamp((x - L.x) / L.u, -TRACE_SIDE, 1 + TRACE_SIDE),
      y: clamp((y - lift - L.y) / L.u, -TRACE_TOP, 1 + TRACE_BOTTOM),
    };
    s.finger = down ? p : null;
    if (!down) {
      s.last = null;
      return;
    }
    // belly up, it stays where it is
    if (s.t < s.stunTill) return;
    s.pen = p;
    // a character just written: nothing more yet
    if (s.t < s.pauseTill) {
      s.last = null;
      return;
    }
    const r = write(s.writing, s.last, p);
    s.last = p;
    s.writing = r.writing;
    if (r.did === "char" || r.did === "pass") {
      s.shown = r.writing.char - 1;
      s.pauseTill = s.t + CHAR_PAUSE_MS;
      s.last = null;
      setHud({ char: r.writing.char, rewrites: r.writing.rewrites });
      if (r.did === "pass") {
        draw();
        return end(true);
      }
      say("done");
    }
  });

  // what happened is said for a moment
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid((s) => (s?.k === said.k ? null : s)), SAID_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  const start = () => {
    g.current = fresh(calmNow());
    setPhase("run");
  };

  const w = T.study.trace325;
  const all = TRACE.erase === "all";
  const saying = said ? (said.did === "hit" ? (all ? w.hitAll : w.hit) : w.done) : "";
  return (
    <div className="tr-game" data-phase={phase} style={size.w ? ({ "--arena-fw": `${Math.round(at.fw)}px` } as CSSProperties) : undefined}>
      <div className="tr-top">
        <span className="tr-slots" role="img" aria-label={fmt(w.slotsSr, { n: hud.char })}>
          {TRACE_DIGITS.map((d, i) => (
            <b key={d} className={i < hud.char ? "tr-got" : i === hud.char && phase === "run" ? "tr-next" : undefined}>
              {d}
            </b>
          ))}
        </span>
        <span className="tr-again">{fmt(w.rewrites, { n: hud.rewrites })}</span>
        <span className="tr-time" role="timer" aria-label={fmt(w.leftSr, { s: left })}>
          {fmt(w.left, { s: left })}
        </span>
      </div>
      <div ref={stage} className="tr-stage">
        <canvas ref={canvas} className="tr-canvas" role="img" aria-label={w.fieldSr} />
        {phase === "ready" && size.h > 0 && (
          <div className={`tr-ready${room < READY_ROOM ? " tr-tight" : ""}`} style={{ height: room }}>
            {room >= RULE_ROOM && (
              <p className="tr-hint">
                {fmt(all ? w.ruleAll : w.rule, { s: TRACE.ms / 1000 })
                  .split("\n")
                  .map((line) => (
                    <span key={line}>{line}</span>
                  ))}
              </p>
            )}
            <button className="tr-start" onClick={start}>
              {w.start}
            </button>
            {room >= READY_ROOM && <p className="tr-hint">{keys ? w.dragMouse : w.drag}</p>}
          </div>
        )}
        {said && (
          <p key={said.k} className={`tr-said tr-${said.did}`}>
            <span>{saying}</span>
          </p>
        )}
      </div>
      <p className="st-sr" aria-live="polite">
        {saying}
      </p>
    </div>
  );
}

/** The copybook square: white, a red frame, and a dashed cross through it */
function copybook(ctx: CanvasRenderingContext2D, x: number, y: number, u: number) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, u, u);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, u, u);
  ctx.lineWidth = 1;
  ctx.setLineDash([u * 0.025, u * 0.025]);
  ctx.beginPath();
  ctx.moveTo(x + u / 2, y);
  ctx.lineTo(x + u / 2, y + u);
  ctx.moveTo(x, y + u / 2);
  ctx.lineTo(x + u, y + u / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** A stretch of a stroke, from `from` to `to` along it, drawn as a line `width` copybook units thick */
function along(
  ctx: CanvasRenderingContext2D,
  k: Stroke,
  from: number,
  to: number,
  x: number,
  y: number,
  u: number,
  color: string,
  width: number,
  cap: CanvasLineCap = "round",
) {
  ctx.beginPath();
  let first = true;
  for (let i = 0; i < k.pts.length; i++) {
    if (k.at[i] < from - 1e-9 || k.at[i] > to + 1e-9) continue;
    const p = k.pts[i];
    if (first) ctx.moveTo(x + p.x * u, y + p.y * u);
    else ctx.lineTo(x + p.x * u, y + p.y * u);
    first = false;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width * u;
  ctx.lineCap = cap;
  ctx.lineJoin = "round";
  ctx.stroke();
}

/** What is left of a stroke to write, from `from` on, dashed */
function guide(ctx: CanvasRenderingContext2D, k: Stroke, from: number, x: number, y: number, u: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setLineDash([u * 0.04, u * 0.03]);
  along(ctx, k, from, k.length, x, y, u, GUIDE, 0.02, "butt");
  ctx.restore();
}

/** Where a stroke starts: a red dot, ringed in white */
function dot(ctx: CanvasRenderingContext2D, p: Pt, x: number, y: number, u: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = GUIDE;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, u * 0.008);
  ctx.beginPath();
  ctx.arc(x + p.x * u, y + p.y * u, u * 0.028, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
