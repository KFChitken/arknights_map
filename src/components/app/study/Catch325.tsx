"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import {
  CATCH_MS,
  CATCH_ORDER,
  CATCH_PLATE_W,
  CATCH_RIM,
  CATCH_ROACH_BOX,
  CATCH_SETS,
  CATCH_STUN_MS,
  CATCH_THING_R,
  type Catch,
  catchDrops,
  caught,
  dropAt,
  onPlate,
  plateTop,
  type Tally,
  TALLY_START,
  thingY,
} from "@/lib/study/catch325";
import { clamp } from "@/lib/study/field";
import { mulberry32 } from "@/lib/prng";
import { calmNow, drawObstacle, roundRect, useArrows, useCanvasSize, useDrag, useFrames, useRoachArt } from "./arena";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

/** How quickly the roach goes after the finger (ms to close most of the gap), and with an arrow key held (field widths a second) */
const FOLLOW_MS = 70;
const KEY_SPEED = 1.25;
/** How long what was caught is said over the field (ms) */
const SAID_MS = 1100;
/** How far along the bottom the roach goes (field widths from the left) */
const ROACH_SIDE = 0.1;
/** The field in a canvas: at most this much wider than tall, and this much taller than wide; along the top */
const WIDEST = 1.25;
const TALLEST = 1.5;
/**
 * Before the round, the rule, the start button and how to move are said over the field, above the plate, in this much
 * room (CSS px). A field with less above the plate has them over all of it, the roach coming in as the round starts;
 * one lower than READY_ROOM altogether leaves out how to move, and one lower than RULE_ROOM the rule as well (the list
 * showed it).
 */
const ABOVE_ROOM = 180;
const READY_ROOM = 150;
const RULE_ROOM = 110;

/** Where the field is in a canvas of w by h CSS pixels: its left and top, and its width and height */
function fieldIn(w: number, h: number) {
  const fw = Math.min(w, h * WIDEST);
  const fh = Math.min(h, fw * TALLEST);
  return { left: (w - fw) / 2, top: 0, fw, fh };
}

/** How far down the roach's middle is in a field so high (field widths from the top) */
const roachY = (high: number) => high - CATCH_ROACH_BOX / 2 - 0.012;
/** How far up from the field's bottom the top of the plate's rim is (field widths) */
const PLATE_UP = -plateTop(roachY(0));
/** While the roach lies belly up its plate is on the ground beside it, leaning on it this much (radians) */
const PLATE_LEAN = 0.3;

/**
 * 接住 3、2、5 (src/lib/study/catch325.ts): a round's things fall down a field drawn on a canvas (arena.ts), and the
 * player's own roach, dragged left and right along the bottom (or moved with ← →), catches 3, 2 and 5 in that order
 * on the plate on its head. A thing is caught, or run into, as it touches the plate's rim (catch325.ts); the rest fall
 * on past, behind the roach. Three slots over the field fill as they are caught and empty at a wrong digit (they
 * shake, when motion is not turned down) or an obstacle (the roach lies belly up a moment, its plate tipped, and
 * nothing touches it meanwhile). The round's clock stands still while the page is put away. Nothing flashes.
 */
export default function Catch325({ seed, look, onRound }: GameProps) {
  const drops = useMemo(() => catchDrops(mulberry32(seed)), [seed]);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const keys = useKeys();
  const [phase, setPhase] = useState<"ready" | "run" | "over">("ready");
  const [tally, setTally] = useState<Tally>(TALLY_START);
  const [left, setLeft] = useState(CATCH_MS / 1000);
  /** What was just caught, said over the field; k tells one from the one before */
  const [said, setSaid] = useState<{ did: Exclude<Catch, "fill">; k: number } | null>(null);
  const arrows = useArrows(phase === "run");
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  // the round as it goes, for the frames: its clock (ms), the roach and where it is headed (field widths), until when
  // it lies belly up, the things gone (caught, run into or fallen past), whether things fall slower
  const g = useRef({ t: 0, x: 0.5, aim: 0.5, stunTill: -1, gone: new Set<number>(), tally: TALLY_START, calm: false, over: false, secs: CATCH_MS / 1000, k: 0 });
  const box = useRef(size);
  box.current = size;
  const field = fieldIn(size.w, size.h);
  const art = useRoachArt(look, Math.ceil((CATCH_ROACH_BOX * field.fw * size.dpr) / 8) * 8);
  const artRef = useRef(art);
  artRef.current = art;
  // the room for the rule and the start button: above the plate, or on a low field all of it
  const overPlate = field.fh - Math.round(PLATE_UP * field.fw);
  const tight = overPlate < ABOVE_ROOM;
  const room = Math.round(tight ? field.fh : overPlate);

  const draw = () => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (!ctx || !w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const f = fieldIn(w, h);
    const u = f.fw;
    ctx.fillStyle = "#f3f4f6";
    roundRect(ctx, f.left, f.top, f.fw, f.fh, 14);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const s = g.current;
    const ry = roachY(f.fh / u);
    const top = plateTop(ry);
    drops.forEach((d, i) => {
      if (s.gone.has(i) || d.at > s.t) return;
      const p = dropAt(d, s.t, s.calm);
      const x = f.left + p.x * u;
      const y = f.top + thingY(p.down, top) * u;
      if (typeof d.what === "number") digit(ctx, x, y, CATCH_THING_R * u, d.what);
      else drawObstacle(ctx, d.what, x, y, CATCH_THING_R * u * 1.05, Math.atan2(top, d.to - d.from));
    });
    const belly = s.t < s.stunTill;
    const img = belly ? artRef.current.belly : artRef.current.stand;
    const b = CATCH_ROACH_BOX * u;
    const rx = f.left + s.x * u;
    const rY = f.top + ry * u;
    // on a low field the rule is over all of it before the round, and the roach comes in as the round starts
    if (phase !== "ready" || !tight) {
      if (img) ctx.drawImage(img, rx - b / 2, rY - b / 2, b, b);
      else {
        ctx.fillStyle = "#3a3d44";
        ctx.beginPath();
        ctx.ellipse(rx, rY, b * 0.3, b * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      const pw = CATCH_PLATE_W * u;
      const rim = CATCH_RIM * u;
      if (!belly) plate(ctx, rx, f.top + top * u, pw, rim, 0);
      else {
        // knocked off: standing on the ground beside the roach, on the side towards the middle, leaning on it
        const side = s.x < 0.5 ? 1 : -1;
        plate(ctx, rx + side * (b * 0.34 + pw * 0.4), rY + b * (0.5 - 4 / 64) - rim * 2.05, pw, rim, -side * PLATE_LEAN);
      }
    }
    ctx.restore();
  };

  // the field before the round, and again whenever its size or the roach's picture changes
  useEffect(draw);

  const end = (won: boolean) => {
    const s = g.current;
    if (s.over) return;
    s.over = true;
    setPhase("over");
    if (!won) setLeft(0);
    const w = T.study.catch325;
    const n = s.tally.sets;
    roundRef.current({ won, result: fmt(w.result, { n }), verdict: won ? fmt(w.pass, { n }) : fmt(w.out, { n }) } satisfies Round);
  };

  useFrames(phase === "run", (dt) => {
    const s = g.current;
    if (s.over) return;
    s.t += dt;
    const { w, h } = box.current;
    const f = fieldIn(w, h);
    const high = f.fh / Math.max(1, f.fw);
    const top = plateTop(roachY(high));
    const stunned = s.t < s.stunTill;
    // where the plate was a frame before, so one moved fast does not jump past a thing
    const was = s.x;
    if (!stunned) {
      const dir = arrows.current;
      if (dir) s.x = s.aim = clamp(s.x + (dir * KEY_SPEED * dt) / 1000, ROACH_SIDE, 1 - ROACH_SIDE);
      else s.x += (s.aim - s.x) * (1 - Math.exp(-dt / FOLLOW_MS));
    }
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (d.at > s.t) break;
      if (s.gone.has(i)) continue;
      const p = dropAt(d, s.t, s.calm);
      const y = thingY(p.down, top);
      if (y - CATCH_THING_R > high) s.gone.add(i);
      else if (!stunned && onPlate(p.x, y, was, s.x, top)) {
        s.gone.add(i);
        const r = caught(s.tally, d.what);
        s.tally = r.tally;
        setTally(r.tally);
        if (r.did === "hit") s.stunTill = s.t + CATCH_STUN_MS;
        if (r.did !== "fill") setSaid({ did: r.did, k: ++s.k });
        if (r.end) {
          draw();
          return end(true);
        }
      }
    }
    draw();
    if (s.t >= CATCH_MS) return end(false);
    const secs = Math.ceil((CATCH_MS - s.t) / 1000);
    if (secs !== s.secs) {
      s.secs = secs;
      setLeft(secs);
    }
  });

  useDrag(stage, phase === "run", (x) => {
    const s = g.current;
    const f = fieldIn(box.current.w, box.current.h);
    if (f.fw > 0) s.aim = clamp((x - f.left) / f.fw, ROACH_SIDE, 1 - ROACH_SIDE);
  });

  // what was caught is said for a moment
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid((s) => (s?.k === said.k ? null : s)), SAID_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  const start = () => {
    g.current = { t: 0, x: 0.5, aim: 0.5, stunTill: -1, gone: new Set(), tally: TALLY_START, calm: calmNow(), over: false, secs: CATCH_MS / 1000, k: 0 };
    setPhase("run");
  };

  const w = T.study.catch325;
  const shake = said && said.did !== "set" ? ` ct-shake${said.k % 2}` : "";
  return (
    <div className="ct-game" data-phase={phase} style={size.w ? ({ "--arena-fw": `${Math.round(field.fw)}px` } as CSSProperties) : undefined}>
      <div className="ct-top">
        <span className={`ct-slots${shake}`} role="img" aria-label={fmt(w.slotsSr, { n: tally.filled })}>
          {CATCH_ORDER.map((n, i) => (
            <b key={n} className={i < tally.filled ? "ct-got" : i === tally.filled && phase === "run" ? "ct-next" : undefined}>
              {n}
            </b>
          ))}
        </span>
        <span className="ct-tally" role="img" aria-label={fmt(w.setsSr, { n: tally.sets, of: CATCH_SETS })}>
          <small>{w.sets}</small>
          {Array.from({ length: CATCH_SETS }, (_, i) => (
            <i key={i} className={i < tally.sets ? "ct-on" : undefined} />
          ))}
        </span>
        <span className="ct-time" role="timer" aria-label={fmt(w.leftSr, { s: left })}>
          {fmt(w.left, { s: left })}
        </span>
      </div>
      <div ref={stage} className="ct-stage">
        <canvas ref={canvas} className="ct-canvas" role="img" aria-label={w.fieldSr} />
        {phase === "ready" && size.h > 0 && (
          <div className={`ct-ready${tight ? " ct-tight" : ""}`} style={{ height: room }}>
            {room >= RULE_ROOM && (
              <p className="ct-hint">
                {fmt(w.rule, { sets: CATCH_SETS })
                  .split("\n")
                  .map((line) => (
                    <span key={line}>{line}</span>
                  ))}
              </p>
            )}
            <button className="ct-start" onClick={start}>
              {w.start}
            </button>
            {room >= READY_ROOM && <p className="ct-hint">{keys ? w.dragKeys : w.drag}</p>}
          </div>
        )}
        {said && (
          <p key={said.k} className={`ct-said ct-${said.did}`}>
            <span>{w[said.did]}</span>
          </p>
        )}
      </div>
      <p className="st-sr" aria-live="polite">
        {said ? w[said.did] : ""}
      </p>
    </div>
  );
}

/**
 * The plate on the roach's head, seen from the side: a cream dish, its rim's top at top and as wide as w, rim high
 * (CSS px), the middle of the rim at x; tipped by tip (radians) about it
 */
function plate(ctx: CanvasRenderingContext2D, x: number, top: number, w: number, rim: number, tip: number) {
  ctx.save();
  ctx.translate(x, top + rim / 2);
  ctx.rotate(tip);
  ctx.strokeStyle = "#1b1d22";
  ctx.lineWidth = Math.max(1.5, rim * 0.16);
  ctx.lineJoin = "round";
  // its foot, under the rim
  ctx.fillStyle = "#e6d9bd";
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, 0);
  ctx.lineTo(-w * 0.17, rim * 1.05);
  ctx.lineTo(w * 0.17, rim * 1.05);
  ctx.lineTo(w * 0.3, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // the rim, and the well inside it
  ctx.fillStyle = "#fff8ea";
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, rim / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#f1e4c8";
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.3, rim * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A falling digit: a white disc, the digit dark on it */
function digit(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number) {
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1b1d22";
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#1b1d22";
  ctx.font = `800 ${Math.round(r * 1.3)}px system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), x, y + r * 0.06);
}
