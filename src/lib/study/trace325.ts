/**
 * 描红 325, a course of 325大学习 (src/components/app/study/Trace325.tsx draws it): the player drags their roach along
 * the dashed middle lines of 3, 2 and 5 in a copybook square, a character at a time and stroke by stroke, and the ink
 * goes on along the line as long as the roach keeps near it. Things fly across the square from either side, and one
 * that touches the roach rubs out the character being written.
 *
 * Everything here is pure: the strokes, how far the ink goes for a move of the roach, what a touch rubs out, and the
 * day's flyers. Places are in copybook units: the square is 0 to 1 across, and 0 to 1 down.
 */
import { OBSTACLES, type Obstacle } from "./field";

/**
 * How hard it is, all in one place: after Breeze has played it, only these change. near is a share of the characters'
 * height (TRACE_HIGH); above is in CSS pixels; speed in copybook widths a second; ms the time for all three.
 */
export const TRACE = {
  /** How far from a stroke's middle line the roach may be and still write */
  near: 0.12,
  /** How far above a finger the roach is, so the finger does not hide it; with a mouse or a pen it is on the pointer */
  above: 48,
  /** About how many things fly across in a minute */
  perMinute: 14,
  /** How fast they fly: the slowest and the fastest */
  speed: [0.22, 0.34],
  /** At most how many fly at once */
  atOnce: 2,
  /** The time to write 3, 2 and 5 in (ms) */
  ms: 90_000,
  /** What a touch rubs out: the character being written ("char"), or all of 3, 2 and 5 written so far ("all") */
  erase: "char" as "char" | "all",
};

/** The characters, in the order they are written */
export const TRACE_DIGITS = [3, 2, 5] as const;
export type TraceDigit = (typeof TRACE_DIGITS)[number];
/** How long the roach lies belly up after a touch (ms); nothing touches it again meanwhile */
export const TRACE_STUN_MS = 600;
/** With motion turned down the flyers' time goes this much as fast: they fly 30% slower, and come as much less often */
export const TRACE_CALM = 0.7;
/** How far the field goes on either side of the square, and above and below it (copybook units) */
export const TRACE_SIDE = 0.2;
export const TRACE_TOP = 0.08;
export const TRACE_BOTTOM = 0.2;
/** The roach's and a flyer's size for touching: radii in copybook units */
export const TRACE_ROACH_R = 0.05;
export const TRACE_FLYER_R = 0.055;
/** The first flyer comes this long after the start (ms) */
export const TRACE_FIRST_MS = 3000;

export type Pt = { x: number; y: number };
/** A stroke: its middle line as points STEP apart (the last one where it ends), how far along it each is, and its length */
export type Stroke = { pts: readonly Pt[]; at: readonly number[]; length: number };

/** How far apart the points of a stroke are (copybook units) */
const STEP = 0.005;

/** Points along an ellipse round cx, cy from angle a0 to a1 (degrees; 0 to the right, 90 down), raw */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 3));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

/** A stroke through the raw points, in order, as points STEP apart */
function stroke(...parts: Pt[][]): Stroke {
  const raw = parts.flat();
  const pts: Pt[] = [raw[0]];
  const at = [0];
  let walked = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1];
    const b = raw[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    for (let next = at.length * STEP; next <= walked + d; next = at.length * STEP) {
      const k = (next - walked) / d;
      pts.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      at.push(next);
    }
    walked += d;
  }
  const end = raw.at(-1)!;
  if (walked - at.at(-1)! > STEP / 10) {
    pts.push(end);
    at.push(walked);
  }
  return { pts, at, length: at.at(-1)! };
}

const line = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

/**
 * The strokes of each character, in the order they are written (as taught in primary school): 3 in one, from the top
 * left over both bowls; 2 in one, over the top, down the slant and along the bottom; 5 in two, the left upright on round
 * the bowl first, then the bar along the top.
 */
export const STROKES: Readonly<Record<TraceDigit, readonly Stroke[]>> = {
  3: [stroke(arc(0.5, 0.3, 0.19, 0.18, 200, 470), arc(0.5, 0.68, 0.21, 0.21, 250, 510))],
  2: [stroke(arc(0.5, 0.31, 0.19, 0.18, 195, 390), line(0.665, 0.4, 0.29, 0.87), line(0.29, 0.87, 0.73, 0.87))],
  5: [stroke(line(0.36, 0.13, 0.352, 0.513), arc(0.5, 0.665, 0.209, 0.215, 225, 510)), stroke(line(0.36, 0.13, 0.7, 0.13))],
};

/** How tall the characters are, top to bottom (copybook units): near is a share of it */
export const TRACE_HIGH = (() => {
  const ys = Object.values(STROKES).flatMap((s) => s.flatMap((k) => k.pts.map((p) => p.y)));
  return Math.max(...ys) - Math.min(...ys);
})();

/** How near the roach must be to a stroke's middle line to write (copybook units) */
export const nearUnits = (near = TRACE.near) => near * TRACE_HIGH;

/** The roach's way is walked in steps no longer than this, so a quick move along the line writes as a slow one does */
const PEN_STEP = 0.01;
/** At each step the ink goes on at most this far: the roach cannot skip a stretch of a stroke */
const REACH = 0.08;
/** Ink this near a stroke's end has finished it */
const END_SLACK = 0.03;

/**
 * How far along a stroke the ink is once the roach has moved from `from` to `to` (or been put down at `to`, from null):
 * at each step of the way, on to the point of the stroke nearest the roach, of those a little past the ink, if the roach
 * is near enough to it. Never back, never past a stretch the roach did not go along.
 */
export function inkAfter(s: Stroke, ink: number, from: Pt | null, to: Pt, near = nearUnits()): number {
  const n = from ? Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / PEN_STEP)) : 1;
  for (let k = 1; k <= n && ink < s.length; k++) {
    const p = from ? { x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n } : to;
    const limit = ink + REACH;
    let best = ink;
    let bestD = Infinity;
    for (let i = Math.floor(ink / STEP + 1e-9); i < s.pts.length && s.at[i] <= limit; i++) {
      const d = Math.hypot(s.pts[i].x - p.x, s.pts[i].y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = s.at[i];
      }
    }
    if (bestD <= near && best > ink) ink = best >= s.length - END_SLACK ? s.length : best;
  }
  return ink;
}

/** How far the round has got: the character being written (3 when all are), its stroke, and the ink along it; and how many touches there were */
export type Writing = { char: number; stroke: number; ink: number; rewrites: number };
export const WRITING_START: Writing = { char: 0, stroke: 0, ink: 0, rewrites: 0 };
/** What a move did: nothing, wrote on, finished a stroke, a character, or all three */
export type Wrote = "none" | "ink" | "stroke" | "char" | "pass";

/** The stroke being written, if there is one */
export const strokeOf = (w: Writing): Stroke | null => (w.char < TRACE_DIGITS.length ? STROKES[TRACE_DIGITS[w.char]][w.stroke] : null);

/** The round after the roach moved from `from` to `to` (or was put down at `to`), and what that did */
export function write(w: Writing, from: Pt | null, to: Pt, near = nearUnits()): { writing: Writing; did: Wrote } {
  const s = strokeOf(w);
  if (!s) return { writing: w, did: "none" };
  const ink = inkAfter(s, w.ink, from, to, near);
  if (ink < s.length) return { writing: ink > w.ink ? { ...w, ink } : w, did: ink > w.ink ? "ink" : "none" };
  if (w.stroke + 1 < STROKES[TRACE_DIGITS[w.char]].length) return { writing: { ...w, stroke: w.stroke + 1, ink: 0 }, did: "stroke" };
  const char = w.char + 1;
  return { writing: { ...w, char, stroke: 0, ink: 0 }, did: char < TRACE_DIGITS.length ? "char" : "pass" };
}

/** The round after something touched the roach: the character being written rubbed out (or all of them), one more rewrite */
export function touched(w: Writing, erase = TRACE.erase): Writing {
  if (w.char >= TRACE_DIGITS.length) return w;
  return { char: erase === "all" ? 0 : w.char, stroke: 0, ink: 0, rewrites: w.rewrites + 1 };
}

/** Something flying across the square: when it sets off (ms), what it is, the side it comes from (−1 left, 1 right), its height there and at the other side (copybook units), and how fast it goes (copybook widths a second) */
export type Flyer = { at: number; what: Obstacle; side: -1 | 1; y0: number; y1: number; speed: number };

/** How far a flyer goes, from out of sight on one side to out of sight on the other (copybook units) */
export const FLIGHT = 1 + 2 * (TRACE_SIDE + TRACE_FLYER_R);
/** How long a flyer is flying (ms, at full speed) */
export const flightMs = (f: Flyer) => (FLIGHT / f.speed) * 1000;

/** Where a flyer is at round time t (ms): across and down (copybook units), and whether it is flying then; slower with motion turned down */
export function flyerAt(f: Flyer, t: number, calm = false): { x: number; y: number; flying: boolean } {
  const gone = ((calm ? t * TRACE_CALM : t) - f.at) / flightMs(f);
  const k = Math.min(1, Math.max(0, gone));
  const from = -TRACE_SIDE - TRACE_FLYER_R;
  const x = f.side < 0 ? from + k * FLIGHT : from + FLIGHT - k * FLIGHT;
  return { x, y: f.y0 + (f.y1 - f.y0) * k, flying: gone >= 0 && gone < 1 };
}

/**
 * The day's flyers, from a random source (rules.ts dayRandom): about TRACE.perMinute a minute from TRACE_FIRST_MS on,
 * through the round, never more than TRACE.atOnce flying at once (one that would be waits until one is gone).
 */
export function traceFlyers(random: () => number): Flyer[] {
  const out: Flyer[] = [];
  const mean = 60_000 / TRACE.perMinute;
  const [slow, fast] = TRACE.speed;
  let at = TRACE_FIRST_MS;
  while (at < TRACE.ms) {
    const ends = out.map((f) => f.at + flightMs(f)).filter((end) => end > at).sort((a, b) => a - b);
    if (ends.length >= TRACE.atOnce) at = Math.ceil(ends[ends.length - TRACE.atOnce]);
    if (at >= TRACE.ms) break;
    const y0 = 0.1 + random() * 0.8;
    const y1 = Math.min(0.9, Math.max(0.1, y0 + (random() - 0.5) * 0.6));
    out.push({
      at,
      what: OBSTACLES[Math.floor(random() * OBSTACLES.length)],
      side: random() < 0.5 ? -1 : 1,
      y0: round3(y0),
      y1: round3(y1),
      speed: round3(slow + random() * (fast - slow)),
    });
    at += Math.round(mean * (0.6 + random() * 0.8));
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
