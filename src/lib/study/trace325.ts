/**
 * 描红 325, a course of 325大学习 (src/components/app/study/Trace325.tsx draws it): the player drags their roach along
 * the dashed middle lines of 3, 2 and 5 in a copybook square, a character at a time and stroke by stroke, and the ink
 * goes on along the line as long as the roach keeps near it. Two of the site's looks fly across the square from either
 * side, 咕咕嘎嘎 sliding on its belly and 绝对主角 after her paper plane, and one that touches the roach rubs out the
 * character being written.
 *
 * Everything here is pure: the strokes, how far the ink goes for a move of the roach, what a touch rubs out, and a
 * round's flyers. Places are in copybook units: the square is 0 to 1 across, and 0 to 1 down.
 */
import { touches } from "./field";

/**
 * How hard it is, all in one place: after Breeze has played it, only these change. near is a share of the characters'
 * height (TRACE_HIGH); above is in CSS pixels; speed in copybook widths a second; ms the time for all three.
 */
export const TRACE = {
  /** How far from a stroke's middle line the roach may be and still write */
  near: 0.12,
  /** How far above a finger the roach is, so the finger does not hide it; with a mouse or a pen it is on the pointer */
  above: 48,
  /** About how many fly across in a minute */
  perMinute: 24,
  /** How fast they fly: the slowest and the fastest */
  speed: [0.22, 0.34],
  /** At most how many fly at once */
  atOnce: 3,
  /** The first sets off this long after the start (ms) */
  first: 2000,
  /** The time to write 3, 2 and 5 in (ms) */
  ms: 45_000,
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
/** The roach's and a flyer's size for touching: radii in copybook units. Only a flyer's body touches, round its middle */
export const TRACE_ROACH_R = 0.05;
export const TRACE_FLYER_R = 0.055;

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

/** Who flies across the square: 咕咕嘎嘎 (the look gugu) sliding straight across on its belly, and 绝对主角 (imp) slanting after her paper plane */
export const TRACE_FLYERS = ["gugu", "imp"] as const;
export type TraceFlyer = (typeof TRACE_FLYERS)[number];

/** Something flying across the square: when it sets off (ms), who it is, the side it comes from (−1 left, 1 right), its height there and at the other side (copybook units), and how fast it goes (copybook widths a second) */
export type Flyer = { at: number; what: TraceFlyer; side: -1 | 1; y0: number; y1: number; speed: number };

/** How big a flyer is drawn (copybook units across): a little smaller than the player's roach */
export const TRACE_FLYER_BOX = 0.15;
/** How far 绝对主角 drifts up and down as she flies (copybook units), and how long once up and down takes (ms) */
export const TRACE_BOB = 0.025;
export const TRACE_BOB_MS = 1200;
/** Where her paper plane is from her middle: this far ahead along her way, and this far higher (copybook units) */
export const TRACE_PLANE_LEAD = 0.12;
export const TRACE_PLANE_LIFT = 0.045;
/** How far a flyer's picture reaches from its middle, ahead or behind: her plane before her, its speed lines after it (copybook units) */
export const TRACE_FLYER_REACH = 0.16;

/** How far a flyer goes, from out of sight on one side to out of sight on the other (copybook units) */
export const FLIGHT = 1 + 2 * (TRACE_SIDE + TRACE_FLYER_REACH);
/** How long a flyer is flying (ms, at full speed) */
export const flightMs = (f: Flyer) => (FLIGHT / f.speed) * 1000;
/** How steep a flyer's way is: the angle from going straight across, down positive (radians), as drawn going to the right */
export const flyerSlope = (f: Flyer) => Math.atan2(f.y1 - f.y0, FLIGHT);

/**
 * Where a flyer's body is at round time t (ms): across and down (copybook units), with 绝对主角's drifting up and down
 * in it (bob), and whether it is flying then; slower with motion turned down, the drifting too
 */
export function flyerAt(f: Flyer, t: number, calm = false): { x: number; y: number; bob: number; flying: boolean } {
  const ms = (calm ? t * TRACE_CALM : t) - f.at;
  const gone = ms / flightMs(f);
  const k = Math.min(1, Math.max(0, gone));
  const from = -TRACE_SIDE - TRACE_FLYER_REACH;
  const x = f.side < 0 ? from + k * FLIGHT : from + FLIGHT - k * FLIGHT;
  const bob = f.what === "imp" ? TRACE_BOB * Math.sin((2 * Math.PI * Math.max(0, ms)) / TRACE_BOB_MS) : 0;
  return { x, y: f.y0 + (f.y1 - f.y0) * k + bob, bob, flying: gone >= 0 && gone < 1 };
}

/** Where 绝对主角's paper plane is at round time t: ahead of her along her way and a little higher, gliding on as she drifts */
export function planeAt(f: Flyer, t: number, calm = false): Pt {
  const p = flyerAt(f, t, calm);
  const a = flyerSlope(f);
  return { x: p.x - f.side * Math.cos(a) * TRACE_PLANE_LEAD, y: p.y - p.bob + Math.sin(a) * TRACE_PLANE_LEAD - TRACE_PLANE_LIFT };
}

/** Whether a flyer touches the roach at pen, at round time t: its body only, not 咕咕嘎嘎's speed lines or 绝对主角's plane */
export function flyerTouches(f: Flyer, t: number, pen: Pt, calm = false): boolean {
  const p = flyerAt(f, t, calm);
  return p.flying && touches(p.x, p.y, TRACE_FLYER_R, pen.x, pen.y, TRACE_ROACH_R);
}

/**
 * A round's flyers, from its random (mulberry32 of its seed): about TRACE.perMinute a minute from TRACE.first on,
 * through the round, about as many of each, never more than TRACE.atOnce flying at once (one that would be waits
 * until one is gone).
 */
export function traceFlyers(random: () => number): Flyer[] {
  const out: Flyer[] = [];
  const mean = 60_000 / TRACE.perMinute;
  const [slow, fast] = TRACE.speed;
  let at = TRACE.first;
  while (at < TRACE.ms) {
    const ends = out.map((f) => f.at + flightMs(f)).filter((end) => end > at).sort((a, b) => a - b);
    if (ends.length >= TRACE.atOnce) at = Math.ceil(ends[ends.length - TRACE.atOnce]);
    if (at >= TRACE.ms) break;
    const what = TRACE_FLYERS[Math.min(TRACE_FLYERS.length - 1, Math.floor(random() * TRACE_FLYERS.length))];
    const y0 = 0.1 + random() * 0.8;
    out.push({
      at,
      what,
      side: random() < 0.5 ? -1 : 1,
      y0: round3(y0),
      y1: round3(what === "imp" ? slant(y0, random) : y0),
      speed: round3(slow + random() * (fast - slow)),
    });
    at += Math.round(mean * (0.6 + random() * 0.8));
  }
  return out;
}

/** Where 绝对主角 gets to at the other side: a quarter to a half of the square higher or lower than she set off, inside 0.1 to 0.9 */
function slant(y0: number, random: () => number): number {
  const d = 0.25 + random() * 0.25;
  const room = { down: 0.9 - y0, up: y0 - 0.1 };
  let down = random() < 0.5;
  // not that far to go that way: the other way, if there is more room there
  const here = down ? room.down : room.up;
  if (here < d && (down ? room.up : room.down) > here) down = !down;
  return down ? y0 + Math.min(d, room.down) : y0 - Math.min(d, room.up);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
