import type { RoachStyle } from "./types";

/**
 * Swarm rendering: every roach is always drawn (no cluster bubbles). Icons shrink
 * as the map zooms out, and a dark heatmap underneath makes dense cities look
 * covered in roaches.
 */

/** [MapLibre zoom, icon edge in px] stops, interpolated linearly. */
export const ICON_STOPS: [number, number][] = [
  [1, 10],
  [4, 14],
  [8, 24],
  [12, 36],
];

export function iconPx(zoom: number) {
  const s = ICON_STOPS;
  if (zoom <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    const [z1, p1] = s[i];
    if (zoom <= z1) {
      const [z0, p0] = s[i - 1];
      return p0 + ((p1 - p0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return s[s.length - 1][1];
}

/** Heatmap fades out by this MapLibre zoom, where individual roaches take over. */
export const SWARM_FADE_ZOOM = 10;

/** Dark, slightly warm ramp: sparse areas stay clear, crowded ones go near-black. */
export const SWARM_GRADIENT: Record<number, string> = {
  0: "rgba(20,16,12,0)",
  0.2: "rgba(40,30,22,0.25)",
  0.5: "rgba(30,22,16,0.5)",
  0.8: "rgba(18,14,10,0.7)",
  1: "rgba(8,6,4,0.82)",
};

/** Symbol layers on the MapLibre map; each one is nudged as a whole with a cheap paint update. */
export const LAYER_GROUPS = 16;
/** MassMarks batches on the Amap map, redrawn in turn; there every roach moves on its own. */
export const MASS_GROUPS = 6;
/** Poses in the realistic roach's walk cycle. */
export const LEG_FRAMES = 4;
/** Out-of-step copies of the walk cycle, so a crowd's legs do not all move together. */
export const LEG_PHASES = 3;
/** One walk cycle while the legs keep going on the spot. */
const LEG_CYCLE_MS = 300;

/** A repeatable number in [0, 1) for (seed, n). */
function rand(seed: number, n: number) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 0x632be59b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth random wander in [-1, 1]: a fresh random value every `every` ms, eased between. */
function noise(seed: number, lane: number, t: number, every: number) {
  const n = t / every;
  const i = Math.floor(n);
  const f = n - i;
  const a = rand(seed, lane + i) * 2 - 1;
  const b = rand(seed, lane + i + 1) * 2 - 1;
  return a + (b - a) * f * f * (3 - 2 * f);
}

export type Crawl = {
  /** Screen offset in px */
  dx: number;
  dy: number;
  /** Walk-cycle pose for the realistic roach */
  frame: number;
};

/**
 * Where a roach is at time t (ms) in its own little life; the seed picks its
 * rhythm. Cartoon roaches wobble smoothly. Real ones keep up a restless
 * jiggle while they dart a few px, freeze, and dart somewhere else, legs
 * racing while they run and shuffling while they wait. scale follows the
 * icon size.
 */
export function crawl(seed: number, t: number, look: RoachStyle, scale = 1): Crawl {
  const r = (n: number) => rand(seed, n);
  if (look === "cartoon") {
    const p = r(1) * Math.PI * 2;
    const speed = 0.7 + r(2) * 0.8;
    const slow = (t * speed) / 1400 + p;
    const fast = (t * speed) / (130 + r(3) * 80) + p * 3;
    const reach = 0.6 + r(4) * 0.8;
    return {
      dx: (Math.cos(slow) * 2.2 * reach + Math.sin(fast) * 0.5) * scale,
      dy: (Math.sin(slow * (1.1 + r(5) * 0.5)) * 1.6 * reach + Math.cos(fast * 1.1) * 0.5) * scale,
      frame: 0,
    };
  }

  const period = 450 + r(1) * 1100; // one dart-and-freeze, in ms
  const dash = 0.15 + r(2) * 0.25; // share of it spent running
  const reach = (3 + r(3) * 4.5) * scale;
  const time = t + r(4) * period * 64;
  const k = Math.floor(time / period);
  const u = time / period - k;
  // about a third of the time it just stays put
  const runs = (j: number) => rand(seed, 1000 + j) > 0.35;
  const lastRun = (j: number) => {
    for (let i = 0; i < 8 && !runs(j); i++) j--;
    return j;
  };
  const spot = (j: number): [number, number] => {
    const a = rand(seed, 2000 + j) * Math.PI * 2;
    const m = Math.sqrt(rand(seed, 3000 + j)) * reach;
    return [Math.cos(a) * m, Math.sin(a) * m];
  };
  let [x, y] = spot(lastRun(k - 1));
  let running = false;
  if (runs(k)) {
    const to = spot(k);
    const v = Math.min(u / dash, 1);
    const e = 1 - (1 - v) ** 3;
    x += (to[0] - x) * e;
    y += (to[1] - y) * e;
    running = v < 1;
  }
  // The restless jiggle underneath, never still even while frozen in place:
  // a wobble of unrelated rhythms plus nervous random twitches, sometimes
  // calm and sometimes frantic, so no two roaches shake alike
  const wobble = (lane: number) => {
    let v = 0;
    for (let i = 0; i < 3; i++) {
      const perMs = ((0.5 + r(lane + i) * 2.5) * (i + 1)) / 900;
      v += Math.sin(t * perMs * 2 * Math.PI + r(lane + 5 + i) * 2 * Math.PI) / (i + 1);
    }
    return v;
  };
  const mood = 0.7 + 0.7 * noise(seed, 4_000_000, t, 1200 + r(9) * 1800);
  const nerves = 45 + r(10) * 45;
  x += (wobble(40) * 1.2 + noise(seed, 5_000_000, t, nerves) * 1.8 * mood) * scale;
  y += (wobble(60) * 1.0 + noise(seed, 6_000_000, t, nerves) * 1.8 * mood) * scale;
  const legs = (t / (running ? LEG_CYCLE_MS / 2.5 : LEG_CYCLE_MS * 2) + r(5)) % 1;
  return { dx: x, dy: y, frame: Math.floor(legs * LEG_FRAMES) };
}

/** Walk-cycle pose for one of the LEG_PHASES copies whose legs keep moving on the spot. */
export function legFrame(phase: number, t: number) {
  const cycle = (t / LEG_CYCLE_MS + phase / LEG_PHASES) % 1;
  return Math.floor(cycle * LEG_FRAMES);
}

/** Headings the realistic roach is pre-rendered at for maps without icon rotation. */
export const HEADINGS = Array.from({ length: 8 }, (_, i) => i * 45);

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
