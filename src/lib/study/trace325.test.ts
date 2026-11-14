import { describe, expect, it } from "vitest";
import { isObstacle } from "./field";
import { dayRandom } from "./rules";
import {
  FLIGHT,
  flightMs,
  type Flyer,
  flyerAt,
  inkAfter,
  nearUnits,
  type Pt,
  STROKES,
  type Stroke,
  strokeOf,
  touched,
  TRACE,
  TRACE_CALM,
  TRACE_DIGITS,
  TRACE_FIRST_MS,
  TRACE_HIGH,
  TRACE_SIDE,
  traceFlyers,
  write,
  type Writing,
  WRITING_START,
} from "./trace325";

/** Nearly three years of site days */
const DAYS = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2026, 10, 14 + i)).toISOString().slice(0, 10));
const flyersOf = (day: string) => traceFlyers(dayRandom("trace325", day));

/** The roach going along a stroke's middle line from one place to another, `off` to one side of it, in moves of `step` */
function along(s: Stroke, from: number, to: number, off = 0, step = 0.02): Pt[] {
  const out: Pt[] = [];
  for (let d = from; d <= to + 1e-9; d += step) {
    const i = Math.min(s.pts.length - 1, Math.round(d / 0.005));
    const p = s.pts[i];
    const q = s.pts[Math.min(s.pts.length - 1, i + 1)];
    const r = s.pts[Math.max(0, i - 1)];
    // off to the left of the way it goes
    const dx = q.x - r.x;
    const dy = q.y - r.y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x: p.x + (dy / len) * off, y: p.y - (dx / len) * off });
  }
  return out;
}

/** The round after the roach is put down at the first place and moved through the rest */
function drag(w: Writing, way: Pt[]) {
  let from: Pt | null = null;
  const did: string[] = [];
  for (const p of way) {
    const r = write(w, from, p);
    w = r.writing;
    if (r.did !== "none" && r.did !== "ink") did.push(r.did);
    from = p;
  }
  return { w, did };
}

/** Each stroke of every character written along its middle line, in order */
const allStrokes = () => TRACE_DIGITS.flatMap((d) => STROKES[d].map((s) => along(s, 0, s.length)));

describe("描红 325", () => {
  it("has 3 and 2 in one stroke each and 5 in two, the upright and bowl before the bar, all inside the square", () => {
    expect(TRACE_DIGITS).toEqual([3, 2, 5]);
    expect(STROKES[3]).toHaveLength(1);
    expect(STROKES[2]).toHaveLength(1);
    expect(STROKES[5]).toHaveLength(2);
    const [upright, bar] = STROKES[5];
    // the upright starts at the top left and goes down; the bar goes along the top, left to right
    expect(upright.pts[0].y).toBeLessThan(0.2);
    expect(upright.pts[40].y).toBeGreaterThan(upright.pts[0].y + 0.15);
    expect(Math.abs(bar.pts.at(-1)!.y - bar.pts[0].y)).toBeLessThan(0.01);
    expect(bar.pts.at(-1)!.x).toBeGreaterThan(bar.pts[0].x + 0.3);
    // 3 and 2 start at the top left; 3 ends at the bottom left, 2 at the bottom right
    for (const d of [3, 2] as const) expect(STROKES[d][0].pts[0]).toMatchObject({ x: expect.closeTo(0.32, 1), y: expect.closeTo(0.25, 1) });
    expect(STROKES[3][0].pts.at(-1)!.y).toBeGreaterThan(0.7);
    expect(STROKES[2][0].pts.at(-1)!).toMatchObject({ x: expect.closeTo(0.73, 2), y: expect.closeTo(0.87, 2) });
    for (const d of TRACE_DIGITS)
      for (const s of STROKES[d]) {
        expect(s.pts.length).toBe(s.at.length);
        expect(s.at.at(-1)).toBe(s.length);
        for (let i = 1; i < s.pts.length; i++) {
          expect(s.at[i] - s.at[i - 1]).toBeLessThanOrEqual(0.005 + 1e-9);
          expect(Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y)).toBeLessThanOrEqual(0.005 + 1e-9);
        }
        for (const p of s.pts) {
          expect(p.x).toBeGreaterThan(0.2);
          expect(p.x).toBeLessThan(0.8);
          expect(p.y).toBeGreaterThan(0.08);
          expect(p.y).toBeLessThan(0.92);
        }
      }
    expect(TRACE_HIGH).toBeGreaterThan(0.7);
    expect(nearUnits()).toBeCloseTo(TRACE.near * TRACE_HIGH);
  });

  it("writes on along the line, and not off it", () => {
    const s = STROKES[2][0];
    const near = nearUnits();
    // along the middle line, and a little to one side of it: all the way
    expect(along(s, 0, s.length).reduce<{ ink: number; from: Pt | null }>((a, p) => ({ ink: inkAfter(s, a.ink, a.from, p), from: p }), { ink: 0, from: null }).ink).toBe(s.length);
    expect(along(s, 0, s.length, near * 0.8).reduce<{ ink: number; from: Pt | null }>((a, p) => ({ ink: inkAfter(s, a.ink, a.from, p), from: p }), { ink: 0, from: null }).ink).toBe(s.length);
    // too far to one side: none of it
    expect(along(s, 0, s.length, near * 1.3).reduce<{ ink: number; from: Pt | null }>((a, p) => ({ ink: inkAfter(s, a.ink, a.from, p), from: p }), { ink: 0, from: null }).ink).toBe(0);
    // one quick move along a straight stretch writes as many small ones do
    const flat = STROKES[5][1];
    expect(inkAfter(flat, 0, flat.pts[0], flat.pts.at(-1)!)).toBe(flat.length);
    // put down away from the ink: nothing; on it: nothing yet; a little past it: on to there, and no further
    expect(inkAfter(s, s.at[100], null, s.pts[0])).toBe(s.at[100]);
    expect(inkAfter(s, s.at[100], null, s.pts[100])).toBe(s.at[100]);
    expect(inkAfter(s, s.at[100], null, s.pts[110])).toBe(s.at[110]);
    // held still there: no further
    expect(inkAfter(s, s.at[110], s.pts[110], s.pts[110])).toBe(s.at[110]);
    // a little short of the end finishes it
    expect(inkAfter(s, s.length - 0.05, null, s.pts[s.pts.length - 5])).toBe(s.length);
  });

  it("does not skip a stretch, or go back", () => {
    const s = STROKES[3][0];
    // put down halfway along, with no ink yet: nothing
    expect(inkAfter(s, 0, null, s.pts[Math.floor(s.pts.length / 2)])).toBe(0);
    // 2 from the top of its slant straight down to the end of its bottom, cutting the slant off: not past the top of it
    const two = STROKES[2][0];
    const slant = two.pts.findIndex((p) => p.x === 0.665 && p.y === 0.4);
    const top = two.pts.reduce((a, p, i) => (Math.hypot(p.x - 0.665, p.y - 0.4) < Math.hypot(two.pts[a].x - 0.665, two.pts[a].y - 0.4) ? i : a), 0);
    expect(slant === -1 || slant === top).toBe(true);
    const cut = inkAfter(two, two.at[top], two.pts[top], two.pts.at(-1)!);
    expect(cut).toBeLessThan(two.at[top] + 0.15);
    // along the line backwards: the ink stays where it was
    const back = along(s, 0.2, 0.6).reverse();
    expect(back.reduce<{ ink: number; from: Pt | null }>((a, p) => ({ ink: inkAfter(s, a.ink, a.from, p), from: p }), { ink: 0.6, from: null }).ink).toBeCloseTo(0.6, 5);
    // and the jump across 3's waist, from its top bowl to its bottom one, does not count
    expect(inkAfter(s, 0.3, s.pts[Math.round(0.3 / 0.005)], s.pts[Math.round(1.6 / 0.005)])).toBeLessThan(0.5);
  });

  it("goes stroke by stroke and character by character, 5's bar after its upright", () => {
    const strokes = allStrokes();
    let w = WRITING_START;
    const did: string[] = [];
    for (const way of strokes) {
      const r = drag(w, way);
      w = r.w;
      did.push(...r.did);
    }
    expect(did).toEqual(["char", "char", "stroke", "pass"]);
    expect(w).toEqual({ char: 3, stroke: 0, ink: 0, rewrites: 0 });
    expect(strokeOf(w)).toBeNull();
    // 5's bar first: nothing, its upright is not written yet
    const at5: Writing = { char: 2, stroke: 0, ink: 0, rewrites: 0 };
    expect(drag(at5, along(STROKES[5][1], 0, STROKES[5][1].length)).w).toEqual(at5);
    // nothing more to write once all three are
    expect(write(w, null, { x: 0.5, y: 0.5 })).toEqual({ writing: w, did: "none" });
  });

  it("rubs out the character being written at a touch, not the ones written; or all of them, if set so", () => {
    const strokes = allStrokes();
    // 3 written, 2 halfway
    let w = drag(WRITING_START, strokes[0]).w;
    w = drag(w, along(STROKES[2][0], 0, 0.8)).w;
    expect(w.char).toBe(1);
    expect(w.ink).toBeGreaterThan(0.7);
    expect(touched(w)).toEqual({ char: 1, stroke: 0, ink: 0, rewrites: 1 });
    expect(touched(w, "all")).toEqual({ char: 0, stroke: 0, ink: 0, rewrites: 1 });
    expect(TRACE.erase).toBe("char");
    // 5 with its upright written: back to the upright
    const five: Writing = { char: 2, stroke: 1, ink: 0.1, rewrites: 2 };
    expect(touched(five)).toEqual({ char: 2, stroke: 0, ink: 0, rewrites: 3 });
    // once all are written, nothing
    const done: Writing = { char: 3, stroke: 0, ink: 0, rewrites: 1 };
    expect(touched(done)).toBe(done);
  });

  it("flies a flyer across from its side, slower with motion turned down", () => {
    const f: Flyer = { at: 1000, what: "bomb", side: -1, y0: 0.2, y1: 0.6, speed: 0.25 };
    const ms = flightMs(f);
    expect(ms).toBeCloseTo((FLIGHT / 0.25) * 1000);
    expect(flyerAt(f, 500).flying).toBe(false);
    expect(flyerAt(f, 1000)).toMatchObject({ x: expect.closeTo(-TRACE_SIDE - 0.055, 5), y: 0.2, flying: true });
    expect(flyerAt(f, 1000 + ms / 2)).toMatchObject({ x: expect.closeTo(0.5, 5), y: expect.closeTo(0.4, 5) });
    expect(flyerAt(f, 1000 + ms).flying).toBe(false);
    const right = { ...f, side: 1 as const };
    expect(flyerAt(right, 1000).x).toBeCloseTo(1 + TRACE_SIDE + 0.055, 5);
    expect(flyerAt(right, 1000 + ms / 4).x).toBeGreaterThan(0.5);
    // motion turned down: the same way, at 70% of the speed
    expect(TRACE_CALM).toBe(0.7);
    expect(flyerAt(f, (1000 + ms / 2) / TRACE_CALM, true).x).toBeCloseTo(0.5, 5);
  });

  it("is the same flyers for everyone that day and others the next; never too many at once; 90 s to write in", () => {
    expect(TRACE.ms).toBe(90_000);
    expect(flyersOf("2026-11-21")).toEqual(flyersOf("2026-11-21"));
    expect(new Set(DAYS.slice(0, 100).map((d) => JSON.stringify(flyersOf(d)))).size).toBe(100);
    let count = 0;
    for (const day of DAYS) {
      const fs = flyersOf(day);
      count += fs.length;
      expect(fs[0].at).toBe(TRACE_FIRST_MS);
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        expect(isObstacle(f.what)).toBe(true);
        expect(f.at).toBeLessThan(TRACE.ms);
        if (i) expect(f.at).toBeGreaterThan(fs[i - 1].at);
        expect(f.speed).toBeGreaterThanOrEqual(TRACE.speed[0]);
        expect(f.speed).toBeLessThanOrEqual(TRACE.speed[1]);
        for (const y of [f.y0, f.y1]) {
          expect(y).toBeGreaterThanOrEqual(0.1);
          expect(y).toBeLessThanOrEqual(0.9);
        }
        // when it sets off, fewer than TRACE.atOnce of the others are flying
        expect(fs.filter((g) => g !== f && g.at <= f.at && g.at + flightMs(g) > f.at).length).toBeLessThan(TRACE.atOnce);
      }
    }
    // about TRACE.perMinute a minute from the first on
    expect(count / DAYS.length).toBeGreaterThan(((TRACE.ms - TRACE_FIRST_MS) / 60_000) * TRACE.perMinute * 0.75);
    expect(count / DAYS.length).toBeLessThan(((TRACE.ms - TRACE_FIRST_MS) / 60_000) * TRACE.perMinute * 1.05);
  });
});
