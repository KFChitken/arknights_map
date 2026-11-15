import { describe, expect, it } from "vitest";
import {
  BOTTOM,
  countOf,
  crawl,
  crawling,
  crawlingAt,
  dropRow,
  fate,
  placed,
  planned,
  rangeOf,
  type Row,
  speedOf,
  STACK,
  type Stack,
  STACK_GOAL,
  stackStart,
  startsOf,
} from "./stack325";
import { mulberry32 } from "../prng";

/** The left ends in a range, every one a row crawling in it stops at */
const lefts = (r: { from: number; to: number }) => Array.from({ length: r.to - r.from + 1 }, (_, i) => r.from + i);
/** A row's left end dropped over the row under it so it sits in the middle of it */
const middleOf = (under: Row, n: number) => under.left + under.n - n;

describe("叠罗汉's rows", () => {
  it("are 25, 24, … 1, or as many as stayed in the row under when fewer: 325 roaches in all", () => {
    expect(STACK.rows).toBe(25);
    expect(BOTTOM).toEqual({ left: 0, n: 25 });
    expect(Array.from({ length: STACK.rows }, (_, k) => planned(k))).toEqual(Array.from({ length: 25 }, (_, k) => 25 - k));
    expect(Array.from({ length: STACK.rows }, (_, k) => planned(k)).reduce((a, b) => a + b, 0)).toBe(STACK_GOAL);
    expect(STACK_GOAL).toBe(325);
    expect(countOf(1, BOTTOM)).toBe(24);
    // the row under lost some: as many as stayed
    expect(countOf(3, { left: 4, n: 20 })).toBe(20);
    expect(countOf(3, { left: 4, n: 22 })).toBe(22);
    expect(countOf(3, { left: 4, n: 23 })).toBe(22);
    expect(countOf(24, { left: 20, n: 5 })).toBe(1);
  });

  it("keep a roach whose middle is over the row under, and drop one whose middle is past it or over its very end", () => {
    // 24 on 25: three places keep them all, the middle one the middle of it
    const range = rangeOf(BOTTOM, 24);
    expect(range).toEqual({ from: -6, to: 8 });
    const whole = lefts(range).filter((left) => dropRow(BOTTOM, { left, n: 24 }).fell.length === 0);
    expect(whole).toEqual([0, 1, 2]);
    expect(middleOf(BOTTOM, 24)).toBe(1);
    // one too far left: the first roach's middle over nothing
    expect(dropRow(BOTTOM, { left: -2, n: 24 })).toEqual({ stays: { left: 0, n: 23 }, fell: [0] });
    // one too far right: the last roach's middle over the very end
    expect(dropRow(BOTTOM, { left: 3, n: 24 })).toEqual({ stays: { left: 3, n: 23 }, fell: [23] });
    // a roach alone: kept with its middle half a roach in from either end, not on it
    expect(dropRow(BOTTOM, { left: -1, n: 1 }).stays.n).toBe(0);
    expect(dropRow(BOTTOM, { left: 0, n: 1 }).stays.n).toBe(1);
    expect(dropRow(BOTTOM, { left: 48, n: 1 }).stays.n).toBe(1);
    expect(dropRow(BOTTOM, { left: 49, n: 1 }).stays.n).toBe(0);
    // as many as the row under: one place only keeps them all
    const even = { left: 7, n: 9 };
    expect(lefts(rangeOf(even, 9)).filter((left) => dropRow(even, { left, n: 9 }).fell.length === 0)).toEqual([7]);
    // and a row whose middles are all off it: none stays
    expect(dropRow({ left: 10, n: 3 }, { left: 4, n: 3 })).toEqual({ stays: { left: 4, n: 0 }, fell: [0, 1, 2] });
  });

  it("can be lost whole only once they are STACK.reach roaches or fewer: the ones at the top", () => {
    for (let m = 1; m <= STACK.rows; m++) {
      for (let n = 1; n <= m; n++) {
        const under = { left: 2 * (STACK.rows - m), n: m };
        const canFall = lefts(rangeOf(under, n)).some((left) => dropRow(under, { left, n }).stays.n === 0);
        expect(canFall).toBe(n <= STACK.reach);
      }
    }
  });

  it("stay inside the row under them", () => {
    for (const left of lefts(rangeOf(BOTTOM, 24))) {
      const { stays } = dropRow(BOTTOM, { left, n: 24 });
      expect(stays.left).toBeGreaterThanOrEqual(BOTTOM.left);
      expect(stays.left + 2 * stays.n).toBeLessThanOrEqual(BOTTOM.left + 2 * BOTTOM.n);
    }
  });
});

describe("叠罗汉's crawling", () => {
  it("goes half a roach a step, there and back, out to STACK.reach roaches past either end of the row under", () => {
    expect(STACK.reach).toBe(3);
    const range = rangeOf(BOTTOM, 24);
    // three roaches past the left end, and the right
    expect(range.from).toBe(BOTTOM.left - 2 * 3);
    expect(range.to + 2 * 24).toBe(BOTTOM.left + 2 * 25 + 2 * 3);
    expect([0, 1, 2, 13, 14, 15, 27, 28, 29].map((s) => crawl(range, false, s))).toEqual([-6, -5, -4, 7, 8, 7, -5, -6, -5]);
    expect([0, 1, 14, 15, 28].map((s) => crawl(range, true, s))).toEqual([8, 7, -6, -5, 8]);
    // a step is whole: until the next one it stays where it is
    expect(crawl(range, false, 1.99)).toBe(-5);
    expect(crawl({ from: 3, to: 3 }, true, 7)).toBe(3);
  });

  it("goes faster the higher the row: the second 6 steps a second, the top one 16", () => {
    expect(STACK.stepsPerSec).toEqual([6, 16]);
    expect(speedOf(1)).toBe(6);
    expect(speedOf(STACK.rows - 1)).toBe(16);
    for (let k = 2; k < STACK.rows; k++) expect(speedOf(k)).toBeGreaterThan(speedOf(k - 1));
    // the second row a second after it sets off from the left: six steps in, from three roaches past the left end
    expect(crawlingAt(stackStart(), false, 1000)).toBe(0);
    expect(crawlingAt(stackStart(), false, 999)).toBe(-1);
    expect(crawlingAt(stackStart(), true, 0)).toBe(8);
    // the top one 16 steps a second
    let s = stackStart();
    for (let k = 1; k < STACK.rows - 1; k++) s = placed(s, middleOf(s.rows[k - 1], crawling(s).n)).stack;
    expect(crawling(s)).toMatchObject({ k: 24, n: 1 });
    const top = crawling(s).range;
    expect(crawlingAt(s, false, 1000)).toBe(crawl(top, false, 16));
    expect(crawlingAt(s, false, 1000 / 16 - 1)).toBe(top.from);
    expect(STACK.settleMs).toBe(350);
  });

  it("sets each row off from an end dealt from the round's seed", () => {
    expect(startsOf(mulberry32(5))).toEqual(startsOf(mulberry32(5)));
    expect(startsOf(mulberry32(5))).toHaveLength(STACK.rows);
    const rights = Array.from({ length: 200 }, (_, i) => startsOf(mulberry32(i))).flat().filter(Boolean).length;
    expect(rights / (200 * STACK.rows)).toBeGreaterThan(0.45);
    expect(rights / (200 * STACK.rows)).toBeLessThan(0.55);
  });
});

describe("叠罗汉's rounds", () => {
  it("pass at the top row with 325 roaches when none fell: 命运的 325", () => {
    let s: Stack = stackStart();
    expect(s).toEqual({ rows: [BOTTOM], kept: 25, end: null });
    for (let k = 1; k < STACK.rows; k++) {
      const { n } = crawling(s);
      expect(n).toBe(25 - k);
      const r = placed(s, middleOf(s.rows[k - 1], n));
      expect(r.fell).toEqual([]);
      s = r.stack;
      expect(s.end).toBe(k === STACK.rows - 1 ? "won" : null);
    }
    expect(s.rows).toHaveLength(25);
    expect(s.kept).toBe(325);
    expect(fate(s)).toBe(true);
    // over: nothing more drops
    expect(placed(s, 0).stack).toBe(s);
  });

  it("pass with fewer when some fell, the rows over them shorter, and are lost on a row of which none stays", () => {
    let s = stackStart();
    // two off at the left end of the second row: 22 stay, and the row over it is 22, not 23
    let r = placed(s, -4);
    expect(r.fell).toEqual([0, 1]);
    s = r.stack;
    expect(s.rows[1]).toEqual({ left: 0, n: 22 });
    expect(s.kept).toBe(47);
    expect(crawling(s)).toMatchObject({ k: 2, n: 22 });
    for (let k = 2; k < STACK.rows; k++) s = placed(s, middleOf(s.rows[k - 1], crawling(s).n)).stack;
    expect(s.end).toBe("won");
    // 25 + 22 + 22, and from the fourth row on as planned: 22 + 21 + … + 1
    expect(s.rows.map((row) => row.n).slice(0, 5)).toEqual([25, 22, 22, 22, 21]);
    expect(s.kept).toBe(325 - 2 - 1);
    expect(fate(s)).toBe(false);

    // the top roach dropped past the end of the one under it: lost
    s = stackStart();
    for (let k = 1; k < STACK.rows - 1; k++) s = placed(s, middleOf(s.rows[k - 1], crawling(s).n)).stack;
    const under = s.rows[s.rows.length - 1];
    r = placed(s, crawling(s).range.from);
    expect(r.fell).toEqual([0]);
    expect(r.stack.end).toBe("lost");
    expect(r.stack.rows).toHaveLength(24);
    expect(r.stack.kept).toBe(324);
    expect(fate(r.stack)).toBe(false);
    expect(under.n).toBe(2);
  });
});
