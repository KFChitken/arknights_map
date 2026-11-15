"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { fmt, T } from "@/i18n";
import { mulberry32 } from "@/lib/prng";
import { advance, distanceAt, isDown, press, release, RUN, RUN_GOAL, type Run, runStart, speedAt, type Thing, thingAt } from "@/lib/study/run325";
import { calmNow, roundRect, useCanvasSize, useFrames, useRoachArt } from "./arena";
import type { GameProps, Round } from "./games";
import { useKeys } from "./taps";

/**
 * 325 米跑酷 (src/lib/study/run325.ts): a classroom seen from the side, drawn on a canvas (arena.ts): the wall with its
 * windows and blackboards going by slower behind, a row of desks the player's roach runs along by itself, and on them
 * piles of textbooks, blackboard erasers and slippers, and pieces of chalk flying in. A press anywhere on the screen
 * (a finger, a pen, the mouse, or the space bar, ↑ or W) jumps it, higher held longer. Every 100 m a flag stands on the
 * desks, and at 325 m the line and the bell. A thing run into is knocked off the desks, the roach lies belly up a
 * moment, and then shows through a while, when it can not be hit. With motion turned down it does not bob or lean as
 * it runs, what it runs into stays where it was, and the bell does not swing. The round's clock stands still while the
 * page is put away. Nothing flashes, and nothing shakes.
 */

/**
 * What is seen of the course (m): behind the roach's nose, and ahead of it, the same on every screen: at 13 m/s a thing
 * coming is seen 0.8 s before it is there
 */
const BEHIND = 1.8;
const AHEAD = 10.5;
/** And over the desks and under them, at the least (m): over, a jump held all 0.25 s, the roach's feeler tips on top */
const OVER = 2.9;
const UNDER = 0.9;
/** The scene no taller than so many times as wide (the stage is as high, where there is room): more wall, no bigger */
const TALL = 0.62;
/** The wall goes by at so much of the desks' speed; the ceiling starts so high (m) */
const FAR = 0.3;
const CEILING = 4.2;
/** A desk's length, the gap between two, how thick its top, how deep its front (m) */
const DESK = 1.6;
const GAP = 0.04;
const TOP = 0.06;
const FRONT = 0.32;
/**
 * The roach's picture (m across): its body is 0.72 of it, as long and as tall as the roach (RUN.len, RUN.tall), its feet
 * FEET of it over its bottom. It bobs so high (m) a step of so long (m) as it runs
 */
const PICTURE = 1.25;
const FEET = 5 / 64;
const BOB = 0.06;
const STRIDE = 0.45;
/** How long what happened is said (ms), and the bell swings once the round is passed (ms) */
const SAID_MS = 1000;
const BELL_MS = 1400;
/**
 * A thing run into is knocked on ahead of the roach (so many m/s faster than it was running), up (m/s) and over (rad/s),
 * falls (m/s²) off the desks and is gone after so long (ms); with motion turned down it stays where it was
 */
const KNOCK = { ahead: 2.5, up: 3.2, fall: 22, turn: 7, ms: 900 };
/** Text drawn on the canvas no smaller than this (CSS px) */
const MIN_PX = 10;
/** The rule and 开始 over the scene, in a smaller hand on a scene not as tall as this, and smaller yet (CSS px) */
const READY_ROOM = 230;
const TINY_ROOM = 150;

const FONT = 'system-ui, -apple-system, "PingFang SC", "Helvetica Neue", sans-serif';
const BOOKS = ["#d9534f", "#3f7fbf", "#4caf7a", "#e8b730", "#8e6cc6"];
const SLIPPERS = ["#ef7aa1", "#5b8def", "#4fb8a8"];
const CHALKS = ["#ff7eb0", "#ffcf3d", "#5fb8f5"];

/** The scene in a canvas of w by h CSS px: px a metre, where it is, the desks' top and the roach's nose (px) */
function sceneIn(w: number, h: number) {
  const s = Math.max(0, Math.min(w / (BEHIND + AHEAD), h / (OVER + UNDER)));
  const fw = (BEHIND + AHEAD) * s;
  const fh = Math.min(h, Math.max((OVER + UNDER) * s, fw * TALL));
  const left = (w - fw) / 2;
  const top = (h - fh) / 2;
  const desk = top + fh - UNDER * s - (fh - (OVER + UNDER) * s) * 0.25;
  return { s, left, top, fw, fh, desk, nose: left + BEHIND * s };
}
type Scene = ReturnType<typeof sceneIn>;

export default function Run325({ seed, look, onRound }: GameProps) {
  const first = useMemo(() => runStart(mulberry32(seed)), [seed]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useCanvasSize(canvas);
  const keys = useKeys();
  const [phase, setPhase] = useState<"ready" | "run" | "over">("ready");
  const [meters, setMeters] = useState(0);
  const [hits, setHits] = useState(0);
  /** What just happened, said a moment (a hit, a flag passed), or how the round ended, which stays */
  const [said, setSaid] = useState<{ text: string; kind: "flag" | "good" | "bad"; k: number } | null>(null);
  /** Frames on a moment after the round is over, for the bell to swing or the last thing run into to fall */
  const [after, setAfter] = useState(false);
  const roundRef = useRef(onRound);
  roundRef.current = onRound;
  const g = useRef({
    r: first,
    calm: false,
    over: false,
    m: 0,
    /** ms of frames since the round started, on after it is over; when it was over */
    t: 0,
    endAt: 0,
    k: 0,
    /** The things run into, knocked off the desks; the last, where it was then (m along), how fast the roach ran and when */
    gone: new Set<Thing>(),
    knock: null as { o: Thing; x: number; v: number; at: number } | null,
  });
  const box = useRef(size);
  box.current = size;
  const scene = sceneIn(size.w, size.h);
  const art = useRoachArt(look, Math.max(8, Math.ceil((PICTURE * scene.s * size.dpr) / 8) * 8));
  const artRef = useRef(art);
  artRef.current = art;

  const draw = () => {
    const ctx = canvas.current?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (!ctx || !w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sc = sceneIn(w, h);
    const st = g.current;
    const r = st.r;
    const t = r.ms / 1000;
    ctx.save();
    roundRect(ctx, sc.left, sc.top, sc.fw, sc.fh, 14);
    ctx.clip();
    room(ctx, sc, r.d);
    desks(ctx, sc, r.d);
    for (const m of [100, 200, 300]) flag(ctx, sc, r.d, m);
    goalLine(ctx, sc, r.d, st.over && r.end === "won" && !st.calm ? st.t - st.endAt : null);
    const X = (x: number) => sc.nose + (x - r.d) * sc.s;
    for (const o of r.course) {
      const x = thingAt(o, t);
      if (st.gone.has(o) || X(x + o.w) < sc.left - 4 || X(x) > sc.left + sc.fw + 4) continue;
      thing(ctx, sc, o, X(x), { lines: !st.calm, shadow: true });
    }
    // the last thing run into, knocked off: turning about its middle
    const kn = st.knock;
    const since = kn ? (st.t - kn.at) / 1000 : 0;
    if (kn && since < KNOCK.ms / 1000) {
      const y = kn.o.y + KNOCK.up * since - (KNOCK.fall * since * since) / 2;
      const x = X(kn.x + (kn.v + KNOCK.ahead) * since);
      const mx = x + (kn.o.w * sc.s) / 2;
      const my = sc.desk - (y + kn.o.h / 2) * sc.s;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(KNOCK.turn * since);
      ctx.translate(-mx, -my);
      thing(ctx, sc, { ...kn.o, y }, x, { lines: false, shadow: false });
      ctx.restore();
    }
    roach(ctx, sc, r, st.calm, artRef.current);
    ctx.restore();
  };

  // the scene before the round, and again whenever its size or the roach's picture changes
  useEffect(draw);

  const say = (text: string, kind: "flag" | "good" | "bad") => setSaid({ text, kind, k: ++g.current.k });

  const finish = (r: Run) => {
    const st = g.current;
    if (st.over) return;
    st.over = true;
    setPhase("over");
    const w = T.study.run325;
    const won = r.end === "won";
    const n = Math.floor(r.d);
    say(won ? w.done : fmt(w.short, { d: RUN_GOAL - n }), won ? "good" : "bad");
    if (!st.calm) {
      st.endAt = st.t;
      setAfter(true);
      window.setTimeout(() => setAfter(false), (won ? BELL_MS : KNOCK.ms) + 100);
    }
    const round: Round = { won, result: fmt(w.result, { n }), verdict: won ? w.pass : fmt(w.fail, { n, k: RUN.hits }) };
    roundRef.current(round);
  };

  useFrames(phase === "run" || after, (dt) => {
    const st = g.current;
    st.t += dt;
    if (!st.over) {
      const before = st.r;
      const r = advance(before, dt);
      st.r = r;
      const m = Math.floor(r.d);
      if (m !== st.m) {
        st.m = m;
        setMeters(m);
      }
      const w = T.study.run325;
      if (r.hits > before.hits && r.hit) {
        setHits(r.hits);
        if (!st.calm) {
          // run into within this frame, at hit ms of the round's clock
          const hit = r.downTill - RUN.downMs;
          st.gone.add(r.hit);
          st.knock = { o: r.hit, x: thingAt(r.hit, hit / 1000), v: speedAt(distanceAt(hit / 1000)), at: st.t - (r.ms - hit) };
        }
        if (!r.end) say(RUN.hits - r.hits > 1 ? fmt(w.hit, { n: RUN.hits - r.hits }) : w.hitLast, "bad");
      } else if (!r.end && Math.floor(r.d / 100) > Math.floor(before.d / 100)) say(fmt(w.flag, { m: Math.floor(r.d / 100) * 100 }), "flag");
      if (r.end) finish(r);
    }
    draw();
  });

  // what happened is said a moment; how the round ended stays
  useEffect(() => {
    if (!said || said.kind === "good" || (said.kind === "bad" && g.current.over)) return;
    const t = window.setTimeout(() => setSaid((x) => (x?.k === said.k ? null : x)), SAID_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  // a press: a finger, a pen or the mouse anywhere on the screen but 不玩了, the space bar, ↑ or W; let go, it is held no more
  useEffect(() => {
    if (phase !== "run") return;
    let held: number | null = null;
    const down = () => {
      g.current.r = press(g.current.r);
    };
    const up = () => {
      g.current.r = release(g.current.r);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button > 0 || (e.target instanceof Element && e.target.closest("[data-quit], [data-no-tap]"))) return;
      e.preventDefault();
      if (held !== null) return;
      held = e.pointerId;
      down();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== held) return;
      held = null;
      up();
    };
    const jumpKey = (e: KeyboardEvent) => !e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "Space" || e.key === " " || e.key === "ArrowUp" || e.code === "KeyW");
    const onKeyDown = (e: KeyboardEvent) => {
      if (!jumpKey(e)) return;
      e.preventDefault();
      if (!e.repeat) down();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!jumpKey(e)) return;
      e.preventDefault();
      up();
    };
    // a long press opens no menu, a finger moving does not scroll the page or pull it down to load again; the page put
    // away lets go
    const still = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const away = () => {
      held = null;
      up();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("contextmenu", still, true);
    window.addEventListener("touchmove", still, { passive: false });
    document.addEventListener("visibilitychange", away);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("contextmenu", still, true);
      window.removeEventListener("touchmove", still);
      document.removeEventListener("visibilitychange", away);
    };
  }, [phase]);

  const start = () => {
    g.current = { ...g.current, calm: calmNow(), over: false, t: 0, gone: new Set(), knock: null };
    setPhase("run");
  };

  const w = T.study.run325;
  const tight = scene.fh < TINY_ROOM ? " rn-tight rn-tiny" : scene.fh < READY_ROOM ? " rn-tight" : "";
  return (
    <div className="rn-game" data-phase={phase} style={{ "--rn-w": `${Math.round(scene.fw)}px` } as CSSProperties}>
      <div className="rn-side">
        <div className="rn-top">
          <span className="rn-way" role="img" aria-label={fmt(w.waySr, { n: meters, goal: RUN_GOAL })}>
            <small>{w.ran}</small>
            <b>{meters}</b>
            <span>{fmt(w.of, { goal: RUN_GOAL })}</span>
          </span>
          <span className="rn-hits" role="img" aria-label={fmt(w.hitsSr, { n: hits, of: RUN.hits })}>
            <small>{w.hits}</small>
            {Array.from({ length: RUN.hits }, (_, i) => (
              <i key={i} className={i < hits ? "rn-hit" : undefined} />
            ))}
          </span>
        </div>
        <div className="rn-bar" aria-hidden="true">
          <i style={{ width: `${(meters / RUN_GOAL) * 100}%` }} />
        </div>
        <p className={`rn-said${said ? ` rn-${said.kind}` : ""}`} role="status">
          {said?.text ?? ""}
        </p>
      </div>
      <div className="rn-stage">
        <canvas ref={canvas} className="rn-canvas" role="img" aria-label={w.fieldSr} />
        {phase === "ready" && size.h > 0 && (
          <div className={`rn-ready${tight}`}>
            <div className="rn-card">
              <p className="rn-rule">
                {fmt(w.rule, { k: RUN.hits, goal: RUN_GOAL })
                  .split("\n")
                  .map((line) => (
                    <span key={line}>{line}</span>
                  ))}
              </p>
              <button className="rn-start" onClick={start}>
                {w.start}
              </button>
              <p className="rn-hint">{keys ? w.tapKeys : w.tap}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The wall going by behind (windows and blackboards, slower than the desks), its wood below, the ceiling and the floor */
function room(ctx: CanvasRenderingContext2D, sc: Scene, d: number) {
  const { s, left, top, fw, fh, desk, nose } = sc;
  const Y = (y: number) => desk - y * s;
  ctx.fillStyle = "#f2ecdc";
  ctx.fillRect(left, top, fw, fh);
  // the ceiling, if there is room for it, its lamps going by with the wall
  if (Y(CEILING) > top) {
    ctx.fillStyle = "#fbf9f3";
    ctx.fillRect(left, top, fw, Y(CEILING) - top);
    ctx.fillStyle = "#e3dccb";
    ctx.fillRect(left, Y(CEILING) - 2, fw, 2);
  }
  const u0 = d * FAR;
  const U = (u: number) => nose + (u - u0) * s;
  for (let j = Math.floor((u0 - BEHIND - 4) / 4); j * 4 < u0 + AHEAD + 4; j++) {
    if (Y(CEILING) <= top) break;
    const x = U(j * 4 + 1);
    ctx.fillStyle = "#d9d4c6";
    ctx.fillRect(x - 0.02 * s, Y(CEILING), 0.04 * s, 0.25 * s);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#d4cdbb";
    ctx.lineWidth = 1;
    roundRect(ctx, x - 0.6 * s, Y(CEILING - 0.25), 1.2 * s, 0.12 * s, 0.05 * s);
    ctx.fill();
    ctx.stroke();
  }
  // windows and blackboards, one after the other along the wall
  const P = 6.5;
  for (let j = Math.floor((u0 - BEHIND - 4) / P); j * P < u0 + AHEAD + 4; j++) {
    const x = U(j * P);
    if (j % 2 === 0) {
      // a blackboard, its frame and tray, chalk on it
      const bw = 3.6 * s;
      ctx.fillStyle = "#8a6a45";
      roundRect(ctx, x - 0.08 * s, Y(2.8), bw + 0.16 * s, 1.68 * s, 0.05 * s);
      ctx.fill();
      ctx.fillStyle = "#2f5446";
      ctx.fillRect(x, Y(2.72), bw, 1.52 * s);
      ctx.fillStyle = "#7a5a38";
      ctx.fillRect(x - 0.12 * s, Y(1.2), bw + 0.24 * s, 0.07 * s);
      ctx.strokeStyle = "rgba(233, 239, 233, 0.8)";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1, 0.035 * s);
      if (j % 4 === 0) {
        ctx.fillStyle = "rgba(233, 239, 233, 0.88)";
        ctx.font = `700 ${Math.round(0.62 * s)}px "Chalkboard SE", "Comic Sans MS", ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("325", x + bw * 0.38, Y(2.0));
        ctx.beginPath();
        ctx.moveTo(x + bw * 0.62, Y(2.3));
        ctx.lineTo(x + bw * 0.86, Y(2.3));
        ctx.moveTo(x + bw * 0.62, Y(1.95));
        ctx.lineTo(x + bw * 0.8, Y(1.95));
        ctx.moveTo(x + bw * 0.62, Y(1.6));
        ctx.lineTo(x + bw * 0.84, Y(1.6));
        ctx.stroke();
      } else {
        for (let k = 0; k < 3; k++) {
          const y = Y(2.4 - k * 0.38);
          ctx.beginPath();
          ctx.moveTo(x + 0.3 * s, y);
          for (let q = 1; q <= 8; q++) ctx.lineTo(x + 0.3 * s + q * 0.33 * s * (k === 2 ? 0.7 : 1), y + Math.sin(q * 1.9 + k) * 0.06 * s);
          ctx.stroke();
        }
      }
    } else {
      // a window: its frame, the sky and a cloud
      const ww = 2.4 * s;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, Y(2.95), ww, 1.85 * s);
      ctx.fillStyle = "#d4ebf7";
      ctx.fillRect(x + 0.08 * s, Y(2.87), ww - 0.16 * s, 1.69 * s);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(x + 0.8 * s, Y(2.4), 0.36 * s, 0.13 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 1.05 * s, Y(2.47), 0.26 * s, 0.14 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + ww / 2 - 0.04 * s, Y(2.95), 0.08 * s, 1.85 * s);
      ctx.fillRect(x, Y(2.05), ww, 0.07 * s);
      ctx.strokeStyle = "#c8cdd4";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, Y(2.95) + 0.5, ww - 1, 1.85 * s - 1);
    }
  }
  // the wood along the bottom of the wall, and the floor
  ctx.fillStyle = "#dfc9a0";
  ctx.fillRect(left, Y(0.35), fw, (0.35 + UNDER) * s);
  ctx.fillStyle = "#c9ad7c";
  ctx.fillRect(left, Y(0.35), fw, Math.max(1.5, 0.03 * s));
  ctx.fillStyle = "#c5ccd6";
  ctx.fillRect(left, Y(-UNDER), fw, top + fh - Y(-UNDER));
  ctx.fillStyle = "#aab3bf";
  ctx.fillRect(left, Y(-UNDER), fw, Math.max(1.5, 0.03 * s));
}

/** The row of desks, end to end, going by as fast as the roach runs */
function desks(ctx: CanvasRenderingContext2D, sc: Scene, d: number) {
  const { s, desk, nose } = sc;
  const X = (x: number) => nose + (x - d) * s;
  for (let k = Math.floor((d - BEHIND - 2) / DESK); k * DESK < d + AHEAD + 2; k++) {
    const x = X(k * DESK);
    const len = (DESK - GAP) * s;
    // legs, then the front, then the top
    ctx.fillStyle = "#8f969f";
    for (const lx of [0.08, DESK - GAP - 0.16]) ctx.fillRect(x + lx * s, desk + FRONT * s, 0.08 * s, (UNDER - FRONT) * s);
    ctx.fillStyle = "#d9ac72";
    ctx.fillRect(x, desk + TOP * s, len, (FRONT - TOP) * s);
    ctx.fillStyle = "rgba(122, 76, 34, 0.18)";
    ctx.fillRect(x + 0.2 * s, desk + (TOP + 0.08) * s, len - 0.4 * s, 0.03 * s);
    ctx.fillStyle = "#ecc993";
    ctx.fillRect(x, desk, len, TOP * s);
    ctx.fillStyle = "#c99a5d";
    ctx.fillRect(x, desk + TOP * s - Math.max(1, 0.012 * s), len, Math.max(1, 0.012 * s));
  }
}

/** A flag on the desks every 100 m, and how far on the desk's front */
function flag(ctx: CanvasRenderingContext2D, sc: Scene, d: number, m: number) {
  const { s, desk, nose } = sc;
  const x = nose + (m - d) * s;
  if (x < sc.left - 2 * s || x > sc.left + sc.fw + 2 * s) return;
  ctx.fillStyle = "#6b6f76";
  ctx.fillRect(x - 0.025 * s, desk - 0.95 * s, 0.05 * s, 0.95 * s);
  ctx.fillStyle = "#ffd23f";
  ctx.strokeStyle = "#c79a14";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.025 * s, desk - 0.95 * s);
  ctx.lineTo(x + 0.55 * s, desk - 0.8 * s);
  ctx.lineTo(x + 0.025 * s, desk - 0.65 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const px = Math.max(MIN_PX, 0.2 * s);
  ctx.font = `800 ${Math.round(px)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#5a3412";
  ctx.fillText(fmt(T.study.run325.mark, { m }), x, desk + ((TOP + FRONT) / 2) * s);
}

/**
 * The line across the desks at 325 m, how far on their front, and a little on the bell on its stand, swinging (ms since
 * the round was passed) or still; rung, once it is passed
 */
function goalLine(ctx: CanvasRenderingContext2D, sc: Scene, d: number, swing: number | null) {
  const { s, desk, nose } = sc;
  const x = nose + (RUN_GOAL - d) * s;
  if (x < sc.left - 3 * s || x > sc.left + sc.fw + 2 * s) return;
  // the line: black and white squares on the desk's top and front
  const q = Math.max(3, 0.08 * s);
  for (let i = 0; i * q < (FRONT + 0.001) * s; i++)
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = (i + k) % 2 ? "#ffffff" : "#1b1d22";
      ctx.fillRect(x - q + k * q, desk + i * q, q, Math.min(q, FRONT * s - i * q));
    }
  ctx.font = `800 ${Math.round(Math.max(MIN_PX, 0.2 * s))}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#5a3412";
  ctx.fillText(fmt(T.study.run325.mark, { m: RUN_GOAL }), x + q + 0.1 * s, desk + ((TOP + FRONT) / 2) * s);
  // the stand, its foot on the desk and its arm out over the line, and the bell hanging from it
  const pole = x + 1.45 * s;
  const arm = desk - 2.15 * s;
  ctx.fillStyle = "#6b6f76";
  ctx.fillRect(pole - 0.03 * s, arm, 0.06 * s, desk - arm);
  ctx.fillRect(pole - 0.62 * s, arm, 0.65 * s, 0.06 * s);
  ctx.fillRect(pole - 0.22 * s, desk - 0.06 * s, 0.44 * s, 0.06 * s);
  const bx = pole - 0.48 * s;
  const a = swing === null ? 0 : Math.sin((swing / 1000) * Math.PI * 4) * 0.35 * Math.max(0, 1 - swing / BELL_MS);
  ctx.save();
  ctx.translate(bx, arm + 0.05 * s);
  ctx.rotate(a);
  ctx.fillStyle = "#e0ad2e";
  ctx.strokeStyle = "#9a7414";
  ctx.lineWidth = Math.max(1, 0.03 * s);
  ctx.beginPath();
  ctx.moveTo(-0.09 * s, 0.04 * s);
  ctx.quadraticCurveTo(-0.23 * s, 0.1 * s, -0.25 * s, 0.48 * s);
  ctx.lineTo(-0.31 * s, 0.56 * s);
  ctx.lineTo(0.31 * s, 0.56 * s);
  ctx.lineTo(0.25 * s, 0.48 * s);
  ctx.quadraticCurveTo(0.23 * s, 0.1 * s, 0.09 * s, 0.04 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillRect(-0.15 * s, 0.2 * s, 0.05 * s, 0.24 * s);
  ctx.fillStyle = "#9a7414";
  ctx.beginPath();
  ctx.arc(0, 0.61 * s, 0.065 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // rung: lines either side of the bell
  if (swing !== null || d >= RUN_GOAL) {
    ctx.strokeStyle = "#d39b12";
    ctx.lineWidth = Math.max(1.4, 0.035 * s);
    ctx.lineCap = "round";
    for (const side of [-1, 1])
      for (const k of [0.45, 0.62]) {
        ctx.beginPath();
        ctx.arc(bx, arm + 0.35 * s, k * s, side < 0 ? Math.PI * 0.8 : -Math.PI * 0.2, side < 0 ? Math.PI * 1.2 : Math.PI * 0.2);
        ctx.stroke();
      }
  }
}

/** A thing on the desks or flying in, its left at x (px); a piece of chalk with lines behind it, and its shadow under it */
function thing(ctx: CanvasRenderingContext2D, sc: Scene, o: Thing, x: number, { lines, shadow }: { lines: boolean; shadow: boolean }) {
  const { s, desk } = sc;
  const w = o.w * s;
  const bottom = desk - o.y * s;
  const h = o.h * s;
  const line = Math.max(1, 0.02 * s);
  ctx.lineWidth = line;
  ctx.strokeStyle = "rgba(27, 29, 34, 0.55)";
  if (o.kind === "books") {
    const n = o.books ?? 3;
    const bh = h / n;
    for (let i = 0; i < n; i++) {
      const shift = (((i * 7 + Math.round(o.x * 3)) % 5) - 2) * 0.025 * s;
      const by = bottom - (i + 1) * bh;
      ctx.fillStyle = BOOKS[(i + Math.round(o.x)) % BOOKS.length];
      roundRect(ctx, x + shift, by, w, bh, Math.min(2, bh / 4));
      ctx.fill();
      ctx.stroke();
      // the pages along its far side, and a band on its spine
      ctx.fillStyle = "#fbf7ec";
      ctx.fillRect(x + shift + w - 0.09 * s, by + bh * 0.2, 0.06 * s, bh * 0.6);
      ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
      ctx.fillRect(x + shift + 0.12 * s, by + bh * 0.25, 0.05 * s, bh * 0.5);
    }
  } else if (o.kind === "eraser") {
    ctx.fillStyle = "#3d4a5c";
    roundRect(ctx, x, bottom - h * 0.42, w, h * 0.42, Math.min(3, h * 0.1));
    ctx.fill();
    ctx.fillStyle = "#b98552";
    roundRect(ctx, x + 0.02 * s, bottom - h, w - 0.04 * s, h * 0.6, Math.min(4, h * 0.25));
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    for (const k of [0.2, 0.45, 0.7]) ctx.fillRect(x + k * w, bottom - h * 0.25, Math.max(1.5, 0.03 * s), Math.max(1.5, 0.03 * s));
  } else if (o.kind === "slipper") {
    // a slipper from the side, its toe to the left: the sole, and the strap over its front half
    ctx.fillStyle = "#f4efe6";
    roundRect(ctx, x, bottom - h * 0.32, w, h * 0.32, h * 0.16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = SLIPPERS[Math.round(o.x) % SLIPPERS.length];
    ctx.beginPath();
    ctx.moveTo(x + w * 0.05, bottom - h * 0.3);
    ctx.quadraticCurveTo(x + w * 0.06, bottom - h * 1.03, x + w * 0.33, bottom - h);
    ctx.quadraticCurveTo(x + w * 0.57, bottom - h * 0.98, x + w * 0.62, bottom - h * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // a piece of chalk flying left, its shadow on the desks under it and, unless motion is turned down, lines behind it
    if (shadow) {
      ctx.fillStyle = "rgba(60, 36, 12, 0.13)";
      ctx.beginPath();
      ctx.ellipse(x + w / 2, desk - 0.02 * s, w * 0.42, 0.04 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (lines) {
      ctx.strokeStyle = "rgba(108, 116, 128, 0.6)";
      ctx.lineCap = "round";
      for (const [k, len] of [
        [0.2, 0.45],
        [0.5, 0.7],
        [0.8, 0.4],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x + w + 0.12 * s, bottom - h * k);
        ctx.lineTo(x + w + (0.12 + len) * s, bottom - h * k);
        ctx.stroke();
      }
    }
    ctx.lineWidth = Math.max(1.2, 0.025 * s);
    ctx.strokeStyle = "rgba(27, 29, 34, 0.7)";
    ctx.fillStyle = CHALKS[Math.round(o.x) % CHALKS.length];
    roundRect(ctx, x, bottom - h, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    // its end worn white, at the front
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    roundRect(ctx, x + line, bottom - h + line, h * 0.7, h - 2 * line, (h - 2 * line) / 2);
    ctx.fill();
  }
}

/** The player's roach: running, bobbing and leaning unless motion is turned down; in the air its shadow under it */
function roach(ctx: CanvasRenderingContext2D, sc: Scene, r: Run, calm: boolean, art: { stand: HTMLCanvasElement | null; belly: HTMLCanvasElement | null }) {
  const { s, desk, nose } = sc;
  const down = isDown(r);
  const cx = nose - (RUN.len / 2) * s;
  const lost = r.end === "out";
  const run = !calm && !r.air && !down && !r.end;
  const bob = run ? Math.abs(Math.sin((r.d / STRIDE) * Math.PI)) * BOB : 0;
  const cy = desk - (r.y + (0.5 - FEET) * PICTURE + bob) * s;
  if (r.air) {
    ctx.fillStyle = "rgba(60, 36, 12, 0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, desk - 0.02 * s, (RUN.len / 2) * s * Math.max(0.4, 1 - r.y / 3), 0.05 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const belly = down || lost;
  const img = belly ? art.belly : art.stand;
  const size = PICTURE * s;
  ctx.save();
  ctx.translate(cx, cy);
  // leaning into the run, up as it rises and down as it falls
  if (!calm && !belly) ctx.rotate(r.air ? Math.max(-0.3, Math.min(0.3, 0.1 - r.vy * 0.05)) : 0.12);
  // after a hit, a while it can not be hit: it shows through
  if (!down && r.ms < r.safeTill) ctx.globalAlpha = 0.5;
  if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
  else {
    ctx.fillStyle = "#1b1d22";
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.3, size * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
