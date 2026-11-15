import { describe, expect, it } from "vitest";
import {
  type Building,
  countsOf,
  dealBuilding,
  type Door,
  endOf,
  enter,
  keeps,
  passes,
  ROGUE,
  ROGUE_GOAL,
  rogueBuilding,
  scoreOf,
  SPARE,
  toGoal,
  waysOf,
} from "./rogue325";
import { mulberry32 } from "../prng";

const SEEDS = ((r) => Array.from({ length: 1000 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));
const plus = (n: number): Door => ({ kind: "plus", n });
const minus = (n: number): Door => ({ kind: "minus", n });
const double: Door = { kind: "double" };
const slug: Door = { kind: "slug" };
/** A door as chalked on it, to compare floors by */
const chalk = (d: Door) => (d.kind === "plus" ? `+${d.n}` : d.kind === "minus" ? `−${d.n}` : d.kind === "double" ? "×2" : "−40");

describe("控分肉鸽's doors", () => {
  it("do as chalked on them: +N, −N, ×2, and the 源石虫's −40", () => {
    expect(enter(0, plus(45))).toBe(45);
    expect(enter(45, double)).toBe(90);
    expect(enter(90, minus(20))).toBe(70);
    expect(enter(70, slug)).toBe(30);
    expect(ROGUE.slug).toBe(40);
  });

  it("never take the score below 0", () => {
    expect(enter(30, slug)).toBe(0);
    expect(enter(0, minus(60))).toBe(0);
    expect(enter(15, minus(20))).toBe(0);
    expect(enter(0, double)).toBe(0);
    // and from 0 the next door counts from 0, not from below it
    const b: Building = [[minus(60), plus(25), plus(30)], [plus(45), double, slug], [plus(25), double, plus(30)], [plus(25), double, plus(30)], [plus(25), double, plus(30)]];
    expect(scoreOf(b, [0])).toBe(0);
    expect(scoreOf(b, [0, 0])).toBe(45);
    expect(scoreOf(b, [0, 2])).toBe(0);
    // 0, 45, 90, 180, 205
    expect(scoreOf(b, [0, 0, 1, 1, 0])).toBe(205);
  });

  it("give a way up its score floor by floor, and every one of the 243 ways up its own", () => {
    // +110, the 源石虫, +35, ×2, +115
    expect([1, 2, 3, 4, 5].map((k) => scoreOf(SPARE, [1, 1, 1, 0, 2].slice(0, k)))).toEqual([110, 70, 105, 210, 325]);
    const ways = waysOf(SPARE);
    expect(ways).toHaveLength(243);
    expect(new Set(ways.map((w) => w.way.join(""))).size).toBe(243);
    for (const w of ways) expect(w.score).toBe(scoreOf(SPARE, w.way));
  });

  it("end a round passed from 300 to 350, and at exactly 325 命运的 325", () => {
    expect(endOf(325)).toEqual({ won: true, fate: true });
    for (const n of [300, 310, 320, 330, 345, 350]) expect(endOf(n)).toEqual({ won: true, fate: false });
    for (const n of [0, 295, 299, 351, 355, 640]) expect(endOf(n)).toEqual({ won: false, fate: false });
    expect(passes(ROGUE_GOAL)).toBe(true);
    expect(ROGUE_GOAL).toBe(325);
  });
});

describe("控分肉鸽's buildings", () => {
  it("deal the same building for the same seed and others for others", () => {
    expect(rogueBuilding(mulberry32(7))).toEqual(rogueBuilding(mulberry32(7)));
    const seen = new Set(SEEDS.slice(0, 100).map((s) => JSON.stringify(rogueBuilding(mulberry32(s)))));
    expect(seen.size).toBe(100);
  });

  it("are, for a thousand seeds and no spare, 5 floors of 3 doors, none the same on a floor, ×2 not on the first", () => {
    const kinds = { plus: 0, minus: 0, double: 0, slug: 0 };
    for (const seed of SEEDS) {
      const b = rogueBuilding(mulberry32(seed));
      expect(b).not.toBe(SPARE);
      expect(b).toHaveLength(5);
      b.forEach((floor, f) => {
        expect(floor).toHaveLength(3);
        // the 源石虫 does as −40 does, so not both on a floor
        expect(new Set(floor.map(chalk)).size).toBe(3);
        for (const d of floor) {
          kinds[d.kind]++;
          if (d.kind === "double") expect(f).toBeGreaterThan(0);
          if (d.kind === "plus") expect(d.n % 5 === 0 && d.n >= 25 && d.n <= 120).toBe(true);
          if (d.kind === "minus") expect(d.n % 5 === 0 && d.n >= 10 && d.n <= 60).toBe(true);
        }
      });
    }
    // every kind of door, about as often as ROGUE.odds deals them, the buildings kept leaning to the plus
    const doors = 15 * SEEDS.length;
    expect(kinds.plus / doors).toBeGreaterThan(0.55);
    expect(kinds.plus / doors).toBeLessThan(0.7);
    for (const k of ["minus", "double", "slug"] as const) expect(kinds[k] / doors).toBeGreaterThan(0.05);
  });

  it("each have from 1 to 6 ways up to exactly 325 and from 8% to 35% of the 243 passing, for a thousand seeds", () => {
    const exact: number[] = [];
    const pass: number[] = [];
    for (const seed of SEEDS) {
      const c = countsOf(rogueBuilding(mulberry32(seed)));
      expect(c.ways).toBe(243);
      expect(c.exact).toBeGreaterThanOrEqual(1);
      expect(c.exact).toBeLessThanOrEqual(6);
      expect(c.pass).toBeGreaterThanOrEqual(Math.ceil(0.08 * 243));
      expect(c.pass).toBeLessThanOrEqual(Math.floor(0.35 * 243));
      exact.push(c.exact);
      pass.push(c.pass);
    }
    // as the design reckoned: about 3 ways to 325 and 33 passing in the middle of them
    const middle = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    expect(middle(exact)).toBe(3);
    expect(middle(pass)).toBeGreaterThanOrEqual(30);
    expect(middle(pass)).toBeLessThanOrEqual(36);
  });

  it("keep about two in three of those dealt, none dealt again so often as to come near ROGUE.tries", () => {
    const r = mulberry32(1);
    let kept = 0;
    for (let k = 0; k < 2000; k++) if (keeps(dealBuilding(r))) kept++;
    expect(kept / 2000).toBeGreaterThan(0.55);
    expect(kept / 2000).toBeLessThan(0.8);
    expect(ROGUE.tries).toBe(200);
  });

  it("fall back on the spare, which keeps: 3 ways to exactly 325 and 33 passing", () => {
    expect(countsOf(SPARE)).toEqual({ ways: 243, pass: 33, exact: 3 });
    expect(keeps(SPARE)).toBe(true);
    const tries = ROGUE.tries;
    ROGUE.tries = 0;
    try {
      expect(rogueBuilding(mulberry32(1))).toBe(SPARE);
    } finally {
      ROGUE.tries = tries;
    }
    expect(rogueBuilding(mulberry32(1))).not.toBe(SPARE);
  });

  it("show a way up to exactly 325 when the round is over, keeping as many of the floors of the way taken as can be", () => {
    // SPARE's three: +110 源石虫 +35 ×2 +115, +110 +75 +35 +45 +60, +100 +110 +30 −30 +115
    expect(toGoal(SPARE)).toEqual([1, 1, 1, 0, 2]);
    expect(toGoal(SPARE, [1, 2, 0, 0, 0])).toEqual([1, 2, 1, 2, 0]);
    expect(toGoal(SPARE, [2, 1, 1, 1, 1])).toEqual([2, 0, 0, 1, 2]);
    expect(toGoal(SPARE, [0, 0, 0, 0, 0])).toEqual([1, 1, 1, 0, 2]);
    // none to 325: 175 at most
    expect(toGoal(Array.from({ length: 5 }, () => [plus(25), plus(30), plus(35)]))).toBe(null);
    for (const seed of SEEDS.slice(0, 200)) {
      const b = rogueBuilding(mulberry32(seed));
      const taken = [0, 1, 2, 1, 0].map((d, f) => (d + seed + f) % 3);
      const way = toGoal(b, taken)!;
      expect(scoreOf(b, way)).toBe(325);
      // none to 325 keeps more of the way taken
      const keptOf = (w: number[]) => w.findIndex((d, f) => d !== taken[f]);
      for (const w of waysOf(b)) if (w.score === 325) expect(keptOf(w.way) === -1 || keptOf(way) === -1 || keptOf(w.way) <= keptOf(way)).toBe(true);
    }
  });
});
