import type { Fx } from "./gear";
import { PALETTE } from "./glsl";

/**
 * 听歌's disco's ball and lights, page elements over the map: the ball hanging a third of the way down (under the bar at
 * the top, clear of the buttons), three beams sweeping down from it, a field of coloured spots turning slowly, a glow
 * behind the ball; and, where the map cannot be darkened under its roaches by the GPU, a darkening over it, fainter.
 * Each frame writes only transforms and opacities, and only those that changed. None of it takes a tap.
 */

const STYLE_ID = "zhoup-disco-css";
const CSS = `
.dz-layer { position: absolute; inset: 0; z-index: 5; overflow: hidden; pointer-events: none; contain: strict;
  --dz-ball: clamp(60px, 21vw, 104px); --dz-glow: clamp(180px, 60vw, 340px); --dz-beam: clamp(110px, 34vw, 360px); }
.dz-layer > * { position: absolute; pointer-events: none; }
.dz-dim { inset: 0; opacity: 0; will-change: opacity;
  background: radial-gradient(120% 90% at 50% 30%, rgba(30, 12, 60, 0.62) 0%, rgba(14, 6, 34, 0.78) 70%, rgba(8, 4, 20, 0.86) 100%); }
.dz-wash { inset: 0; opacity: 0; transition: background-color 1.6s ease; will-change: opacity; }
.dz-spots { left: 50%; top: 30%; opacity: 0; transform-origin: 50% 50%; will-change: transform, opacity; }
.dz-spots canvas { display: block; width: 100%; height: 100%; }
.dz-beam { left: 50%; top: 30%; width: var(--dz-beam); height: 120%; margin-left: calc(var(--dz-beam) / -2); opacity: 0;
  transform-origin: 50% 0; will-change: transform, opacity; clip-path: polygon(46% 0, 54% 0, 100% 100%, 0 100%); }
.dz-beam.c0 { background: linear-gradient(#ff4fd8aa, #ff4fd822 70%, #ff4fd800); }
.dz-beam.c1 { background: linear-gradient(#3fd0ffaa, #3fd0ff22 70%, #3fd0ff00); }
.dz-beam.c2 { background: linear-gradient(#ffd23faa, #ffd23f22 70%, #ffd23f00); }
.dz-glow { left: 50%; top: 30%; width: var(--dz-glow); height: var(--dz-glow); margin: calc(var(--dz-glow) / -2) 0 0 calc(var(--dz-glow) / -2);
  border-radius: 50%; opacity: 0; background: radial-gradient(closest-side, #ffffffcc, #ffffff33 35%, #ffffff00); will-change: opacity; }
.dz-ball { left: 50%; top: calc(30% - var(--dz-ball) * 2.5625); width: var(--dz-ball); margin-left: calc(var(--dz-ball) / -2);
  transform: translateY(-120%); transform-origin: 50% 0; will-change: transform, opacity; }
.dz-ball svg { display: block; width: 100%; height: auto; overflow: visible; }
.dz-glint { position: absolute; width: 20%; aspect-ratio: 1; margin: -10% 0 0 -10%; opacity: 0; will-change: opacity, transform;
  background: radial-gradient(closest-side, #fff, #fff0) center / 40% 40% no-repeat, linear-gradient(90deg, #fff0, #fff 50%, #fff0) center / 100% 9% no-repeat,
    linear-gradient(#fff0, #fff 50%, #fff0) center / 9% 100% no-repeat; }
.dz-glint.g0 { left: 37%; top: 77%; }
.dz-glint.g1 { left: 62%; top: 90%; }
`;

/** The ball on its string (its middle 2.5625 of its width from the top: hung so it is at 30% down) */
const BALL_SVG = `<svg viewBox="-40 -205 80 245" aria-hidden="true">
<line x1="0" y1="-205" x2="0" y2="-26" stroke="#9aa1ad" stroke-width="2"/>
<defs>
<clipPath id="dz-clip"><circle r="26"/></clipPath>
<pattern id="dz-fac" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="5" height="5" rx="0.8" fill="#dfe4ec"/></pattern>
<radialGradient id="dz-shade" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#1b1d22" stop-opacity="0.55"/></radialGradient>
</defs>
<circle r="26.5" fill="#6d7482"/>
<g clip-path="url(#dz-clip)">
<rect x="-28" y="-28" width="56" height="56" fill="url(#dz-fac)"/>
<rect x="-13" y="-10" width="5" height="5" rx="0.8" fill="#ff4fd8"/><rect x="5" y="-16" width="5" height="5" rx="0.8" fill="#3fd0ff"/>
<rect x="9" y="6" width="5" height="5" rx="0.8" fill="#ffd23f"/><rect x="-6" y="12" width="5" height="5" rx="0.8" fill="#fff"/>
<circle r="27" fill="url(#dz-shade)"/>
<ellipse cx="-9" cy="-11" rx="8" ry="5" fill="#fff" opacity="0.6"/>
</g>
<circle r="26.5" fill="none" stroke="#0d0e10" stroke-width="2.2"/>
</svg>`;

/** The ball up out of sight (% of its own height) */
export const BALL_UP = -120;

/** What the lights show in a frame */
export type OverlayFrame = {
  /** How far the lights are on (0..1) */
  shown: number;
  /** The ball: how far up (% of its height, 0: hanging, BALL_UP: out of sight), how faded in, how far it swings (deg) */
  ballY: number;
  ballOpacity: number;
  swing: number;
  fx: Fx;
  /** A beat to go by (else the lights go round slowly, with no beat to them), and how far into it (0..1) */
  onBeat: boolean;
  phase: number;
  /** The beat the glints shine on (with no beat to go by, pace) */
  beat: number;
  /** The lights' own clock, in beats: on with the beats, slowly by itself without, never jumping */
  pace: number;
  /** How loud, 0..1 */
  level: number;
  /** The first beat of a climax: the glow flares */
  drop: boolean;
  /** The page element's darkening over the map (0: the GPU darkens it under the roaches) */
  dim: number;
};

export type Overlay = {
  draw: (f: OverlayFrame) => void;
  remove: () => void;
};

/** A number for 0..1, as written: two places */
const two = (v: number) => (v <= 0 ? "0" : v >= 1 ? "1" : v.toFixed(2));
const frac = (v: number) => v - Math.floor(v);

/** The spots' picture: drawn once small, made big and turned slowly (as the design's: little to draw, nothing each frame) */
function hash01(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function drawSpots(cv: HTMLCanvasElement) {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  for (let i = 0; i < 90; i++) {
    const a = hash01(i * 3 + 1) * Math.PI * 2;
    const r = 12 + Math.sqrt(hash01(i * 3 + 2)) * 88;
    const x = 100 + Math.cos(a) * r;
    const y = 100 + Math.sin(a) * r;
    const s = 1.2 + hash01(i * 3 + 3) * 1.8;
    const col = PALETTE[i % PALETTE.length];
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.6);
    g.addColorStop(0, i % 4 === 0 ? "#ffffffee" : `${col}ee`);
    g.addColorStop(0.5, `${col}88`);
    g.addColorStop(1, `${col}00`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, s * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A glint on the ball over two beats: up fast on its beat, fading out by the middle of it */
export const glint = (ph: number) => (ph < 0.12 ? ph / 0.12 : ph < 0.5 ? (0.5 - ph) / 0.38 : 0);

/** The ball and lights, in host (over the map, as big as it) */
export function overlay(host: HTMLElement): Overlay {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const root = document.createElement("div");
  root.className = "dz-layer";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `<div class="dz-dim"></div><div class="dz-wash"></div><div class="dz-spots"><canvas width="200" height="200"></canvas></div>
<div class="dz-beam c0"></div><div class="dz-beam c1"></div><div class="dz-beam c2"></div><div class="dz-glow"></div>
<div class="dz-ball">${BALL_SVG}<i class="dz-glint g0"></i><i class="dz-glint g1"></i></div>`;
  host.append(root);
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  const dim = $(".dz-dim");
  const wash = $(".dz-wash");
  const spots = $(".dz-spots");
  const glow = $(".dz-glow");
  const ball = $(".dz-ball");
  const beams = [...root.querySelectorAll<HTMLElement>(".dz-beam")];
  const glints = [...root.querySelectorAll<HTMLElement>(".dz-glint")];
  drawSpots(root.querySelector("canvas")!);

  // written only when the value changes, so the browser has nothing to do for what stays
  const was = new WeakMap<HTMLElement, Record<string, string>>();
  const css = (el: HTMLElement, prop: "opacity" | "transform" | "backgroundColor" | "width" | "height" | "margin", v: string) => {
    let c = was.get(el);
    if (!c) was.set(el, (c = {}));
    if (c[prop] === v) return;
    c[prop] = v;
    el.style[prop] = v;
  };

  // the spots reach every corner from the ball as they turn
  const size = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const reach = Math.hypot(w / 2, h * 0.7);
    const s = Math.ceil(reach * 2.05);
    css(spots, "width", `${s}px`);
    css(spots, "height", `${s}px`);
    css(spots, "margin", `${-s / 2}px 0 0 ${-s / 2}px`);
  };
  size();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(root);
  if (!ro) window.addEventListener("resize", size);

  const off = (...els: HTMLElement[]) => els.forEach((el) => css(el, "opacity", "0"));

  return {
    draw(f) {
      const { shown, fx } = f;
      css(dim, "opacity", two(f.dim));
      css(ball, "transform", `translateY(${f.ballY.toFixed(1)}%) rotate(${f.swing.toFixed(2)}deg)`);
      css(ball, "opacity", two(f.ballOpacity));
      // two glints on the ball, by turns: none with less motion, nor with the lights alone
      const glinting = fx === "full" || fx === "lite";
      glints.forEach((g, i) => {
        const v = glinting ? glint(frac((f.beat + i) / 2)) * shown : 0;
        css(g, "opacity", two(v));
        css(g, "transform", `scale(${(0.3 + 0.7 * v).toFixed(2)})`);
      });
      if (fx === "still" || fx === "calm") {
        // a wash of one colour after another, every 16 beats, slowly; the ball and its glow, and nothing sweeping
        off(spots, ...beams);
        css(glow, "opacity", two(shown * 0.35));
        css(wash, "opacity", two(shown * 0.18));
        css(wash, "backgroundColor", PALETTE[((Math.floor(f.pace / 16) % PALETTE.length) + PALETTE.length) % PALETTE.length]);
        return;
      }
      css(wash, "opacity", "0");
      if (shown <= 0) return off(spots, glow, ...beams);
      const lit = shown * (0.55 + 0.45 * f.level);
      const p = f.phase;
      // brightest on the beat; with no beat, as bright all the while
      const pulse = f.onBeat ? 0.6 + 0.4 * (1 - p) * (1 - p) : 0.8;
      if (fx === "lite") off(spots, ...beams);
      else {
        css(spots, "opacity", two(lit * pulse * 0.85));
        css(spots, "transform", `rotate(${(((f.pace * 360) / 32) % 360).toFixed(1)}deg)`);
        beams.forEach((b, i) => {
          const a = Math.sin((f.pace / 8 + i / 3) * Math.PI * 2) * (28 + i * 8) + (i - 1) * 22;
          css(b, "transform", `rotate(${a.toFixed(1)}deg)`);
          css(b, "opacity", two(lit * (f.onBeat ? 0.55 + 0.25 * (1 - p) : 0.65)));
        });
      }
      css(glow, "opacity", two(shown * (f.onBeat ? 0.35 + 0.4 * (1 - p) * (1 - p) : 0.45) * (f.drop ? 1.4 : 1)));
    },
    remove() {
      ro?.disconnect();
      if (!ro) window.removeEventListener("resize", size);
      root.remove();
    },
  };
}
