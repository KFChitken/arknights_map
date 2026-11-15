import { describe, expect, it } from "vitest";
import {
  advance,
  distanceAt,
  isDown,
  jumpOf,
  layCourse,
  press,
  release,
  RUN,
  RUN_GOAL,
  type Run,
  runStart,
  SIZES,
  speedAt,
  type Thing,
  thingAt,
  timeAt,
} from "./run325";
import { mulberry32 } from "../prng";

const SEEDS = ((r) => Array.from({ length: 1000 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(24));
/** A round as it starts with nothing on the course but what is given */
const bare = (course: Thing[] = []): Run => ({ ...runStart(mulberry32(1)), course });
/** A round played on so many ms */
const on = (r: Run, ms: number) => advance(r, ms);
/** A jump from the desks held h ms (released before a step is taken, 0): how high the feet went and how long it was in the air */
const played = (h: number) => {
  let r = press(bare());
  if (h <= 0) r = release(r);
  let top = 0;
  while (true) {
    r = advance(r, RUN.tickMs);
    if (r.pressed && r.ms >= h) r = release(r);
    top = Math.max(top, r.y);
    if (!r.air) return { top, air: r.ms / 1000 };
  }
};
/** A pile of books, an eraser, a slipper standing at x */
const thing = (kind: "books" | "eraser" | "slipper", x: number, books = 3): Thing =>
  kind === "books" ? { kind, x, w: SIZES.books.w, y: 0, h: SIZES.books.h[books], books } : { kind, x, w: SIZES[kind].w, y: 0, h: SIZES[kind].h };
/** A piece of chalk over the roach's middle when the roach's middle is at x + w / 2 */
const chalk = (x: number): Thing => ({ kind: "chalk", x, w: SIZES.chalk.w, y: RUN.chalkY, h: SIZES.chalk.h, at: timeAt(x + SIZES.chalk.w / 2 + RUN.len / 2) });

/** A player who jumps at every thing on the desks with the press held all of RUN.holdMs, the top of the jump over its middle, and runs under the chalk */
function ideal(r: Run): Run {
  const up = jumpOf(RUN.holdMs).up;
  const when = r.course.filter((o) => o.kind !== "chalk").map((o) => timeAt(o.x + o.w / 2 + RUN.len / 2) - up);
  let k = 0;
  while (!r.end) {
    if (k < when.length && r.ms / 1000 >= when[k]) {
      r = press(r);
      k++;
    }
    if (r.pressed && (r.heldMs >= RUN.holdMs || !r.air)) r = release(r);
    r = advance(r, RUN.tickMs);
  }
  return r;
}

describe("325 米跑酷's jumps", () => {
  it("go higher the longer the press is held, up to 0.25 s", () => {
    const heights = [0, 50, 100, 150, 200, 250].map((h) => played(h).top);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1] + 0.1);
    // held on past 0.25 s it goes no higher
    expect(played(400).top).toBeCloseTo(heights[5], 1);
    expect(played(2000).top).toBeCloseTo(heights[5], 1);
    expect(RUN.holdMs).toBe(250);
    // as worked out: a tap 0.70 m high and 0.43 s in the air, held all of it 1.71 m and 0.74 s
    for (const h of [0, 100, 250]) {
      expect(Math.abs(played(h).top - jumpOf(h).top)).toBeLessThan(0.04);
      expect(Math.abs(played(h).air - jumpOf(h).air)).toBeLessThan(0.02);
    }
    expect(jumpOf(0).top).toBeCloseTo(0.704, 2);
    expect(jumpOf(250).top).toBeCloseTo(1.71, 2);
    expect(jumpOf(250).air).toBeCloseTo(0.74, 2);
  });

  it("are only from the desks, a press just before landing jumping it as it lands", () => {
    let r = on(press(bare()), 100);
    r = release(r);
    expect(r.air).toBe(true);
    const vy = r.vy;
    // pressed again in the air long before it lands: nothing, then or on landing
    r = on(press(r), RUN.tickMs);
    expect(r.vy).toBeLessThan(vy);
    r = release(r);
    while (r.air) r = on(r, RUN.tickMs);
    r = on(r, 100);
    expect(r.air).toBe(false);
    // pressed 80 ms before it lands: up again as it lands
    let s = release(press(bare()));
    const lands = jumpOf(0).air * 1000;
    s = on(s, lands - 80);
    expect(s.air).toBe(true);
    s = press(s);
    s = on(s, 120);
    expect(s.air).toBe(true);
    expect(s.vy).toBeGreaterThan(0);
  });

  it("clear the highest pile of books only held long enough", () => {
    expect(jumpOf(0).top).toBeLessThan(SIZES.books.h[4]);
    expect(jumpOf(RUN.holdMs).top).toBeGreaterThan(SIZES.books.h[4] + 0.5);
    for (const kind of ["eraser", "slipper"] as const) expect(jumpOf(0).top).toBeGreaterThan(SIZES[kind].h + 0.3);
  });
});

describe("325 米跑酷's run", () => {
  it("goes faster the further it has run: 8 m/s at first, 13 at 325 m, the whole way in about 31.6 s", () => {
    expect(speedAt(0)).toBe(8);
    expect(speedAt(RUN_GOAL)).toBe(13);
    expect(speedAt(162.5)).toBe(10.5);
    for (const d of [0, 50, 100, 200, 325]) expect(distanceAt(timeAt(d))).toBeCloseTo(d, 6);
    // how fast it goes is what the way run says
    const t = timeAt(100);
    expect((distanceAt(t + 0.001) - distanceAt(t - 0.001)) / 0.002).toBeCloseTo(speedAt(100), 3);
    expect(timeAt(RUN_GOAL)).toBeCloseTo(31.56, 2);
  });

  it("is passed at 325 m, and then nothing more happens", () => {
    let r = bare();
    while (!r.end) r = on(r, 50);
    expect(r.end).toBe("won");
    expect(r.d).toBe(RUN_GOAL);
    expect(Math.abs(r.ms / 1000 - timeAt(RUN_GOAL))).toBeLessThan(0.01);
    expect(on(r, 500)).toBe(r);
    expect(press(r)).toBe(r);
  });

  it("is hit by a thing run into: belly up 0.6 s, then not hit for 1 s more; three times and out", () => {
    // piles of books close after another, nothing jumped
    let r = bare([thing("books", 3), thing("books", 4.5), thing("books", 30), thing("books", 60)]);
    while (!r.hits) r = on(r, RUN.tickMs);
    const at = r.ms;
    expect(r.hit?.x).toBe(3);
    expect(isDown(r)).toBe(true);
    // belly up it does not jump
    r = on(press(r), RUN.tickMs);
    expect(r.air).toBe(false);
    r = release(r);
    r = on(r, RUN.downMs - 2 * RUN.tickMs);
    expect(isDown(r)).toBe(true);
    r = on(r, 2 * RUN.tickMs);
    expect(isDown(r)).toBe(false);
    // the second pile, 1.5 m on, went by while it could not be hit
    expect(r.hits).toBe(1);
    expect(r.safeTill).toBe(at + RUN.downMs + RUN.safeMs);
    // the third and the fourth: out
    while (!r.end) r = on(r, RUN.tickMs);
    expect(r.end).toBe("out");
    expect(r.hits).toBe(RUN.hits);
    expect(r.hit?.x).toBe(60);
    expect(on(r, 500)).toBe(r);
  });

  it("runs under a piece of chalk, but not jumped into it", () => {
    const c = chalk(20);
    // it flies in: further on before, behind after
    expect(thingAt(c, (c.at ?? 0) - 1)).toBeCloseTo(20 + RUN.chalkV, 6);
    expect(thingAt(c, c.at ?? 0)).toBe(20);
    let r = bare([c]);
    while (r.d < 30) r = on(r, 20);
    expect(r.hits).toBe(0);
    // a tap a moment before it is over the roach, the roach going up into it
    let s = bare([c]);
    while (s.ms / 1000 < (c.at ?? 0) - 0.12) s = on(s, RUN.tickMs);
    s = release(press(s));
    while (s.d < 30 && !s.hits) s = on(s, RUN.tickMs);
    expect(s.hits).toBe(1);
    expect(s.hit).toBe(c);
  });

  it("clears an eraser, a slipper and books jumped in time, and not jumped too soon", () => {
    for (const kind of ["eraser", "slipper", "books"] as const) {
      const o = thing(kind, 40, 4);
      const r = ideal(bare([o]));
      expect(r.hits).toBe(0);
      // a tap a whole second too soon comes down on it
      let s = bare([o]);
      while (s.ms / 1000 < timeAt(o.x) - 1) s = on(s, RUN.tickMs);
      s = release(press(s));
      while (s.d < 45) s = on(s, RUN.tickMs);
      expect(s.hits).toBe(1);
    }
  });
});

describe("325 米跑酷's courses", () => {
  it("are laid the same for the same seed, things one at a time from 30 m to 313 m with room after each", () => {
    expect(layCourse(mulberry32(5))).toEqual(layCourse(mulberry32(5)));
    const counts: Record<string, number> = { books: 0, eraser: 0, slipper: 0, chalk: 0 };
    let things = 0;
    const seen = new Set<string>();
    const full = jumpOf(RUN.holdMs).air;
    for (const seed of SEEDS) {
      const course = layCourse(mulberry32(seed));
      seen.add(JSON.stringify(course));
      expect(course[0].x).toBe(RUN.first);
      expect(course[course.length - 1].x).toBeLessThan(RUN_GOAL - RUN.last);
      course.forEach((o, i) => {
        counts[o.kind]++;
        things++;
        if (o.kind === "books") expect(o.h).toBe(SIZES.books.h[o.books ?? 0]);
        if (o.kind === "chalk") expect(o.y).toBe(RUN.chalkY);
        else expect(o.y).toBe(0);
        const next = course[i + 1];
        if (next) expect(next.x - (o.x + o.w)).toBeGreaterThanOrEqual(speedAt(o.x + o.w) * (full + RUN.react) - 1e-9);
      });
    }
    expect(seen.size).toBe(SEEDS.length);
    // about 18 things a round, each kind about as often as RUN.odds says
    expect(things / SEEDS.length).toBeGreaterThan(15);
    expect(things / SEEDS.length).toBeLessThan(22);
    for (const k of Object.keys(counts)) expect(Math.abs(counts[k] / things - RUN.odds[k as keyof typeof RUN.odds])).toBeLessThan(0.03);
  });

  it("can all be run through without a hit, for a thousand seeds: each jumped over held all 0.25 s, the chalk run under", () => {
    for (const seed of SEEDS) {
      const r = ideal(runStart(mulberry32(seed)));
      expect(r.end).toBe("won");
      expect(r.hits).toBe(0);
    }
    // and not jumped at all, a round is out well before 325 m
    for (const seed of SEEDS.slice(0, 100)) {
      let r = runStart(mulberry32(seed));
      while (!r.end) r = advance(r, 50);
      expect(r.end).toBe("out");
      expect(r.d).toBeLessThan(200);
    }
  });
});
