import { describe, expect, it } from "vitest";
import {
  type Cell,
  dragOn,
  dragTo,
  FIND_COUNT,
  FIND_MS,
  FIND_SIDE,
  FIND_TURNING,
  FIND_TURNS,
  FIND_WAYS,
  findPuzzle,
  readings,
  strays,
  turns,
  type Word,
  wordAt,
  wordEnd,
  wordMid,
} from "./find325";
import { mulberry32 } from "../prng";

/** So many rounds' seeds, as the page deals them (rules.ts newSeed): whole numbers from 0 up to 2³² */
const SEEDS = ((r) => Array.from({ length: 1000 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));
const puzzleOf = (seed: number) => findPuzzle(mulberry32(seed));
const key = (w: Word) => `${w.r},${w.c},${w.dr},${w.dc},${w.tr},${w.tc}`;
const cellsOf = (w: Word) => [w, wordMid(w), wordEnd(w)].map((c) => `${c.r},${c.c}`);

/** How many times a run of digits comes up in a grid, in a line read any of the eight ways */
function count(grid: number[][], run: number[]): number {
  let n = 0;
  for (let r = 0; r < FIND_SIDE; r++)
    for (let c = 0; c < FIND_SIDE; c++)
      for (const [dr, dc] of [...FIND_WAYS, ...FIND_WAYS.map(([a, b]) => [-a, -b])]) {
        const end = { r: r + (run.length - 1) * dr, c: c + (run.length - 1) * dc };
        if (end.r < 0 || end.r >= FIND_SIDE || end.c < 0 || end.c >= FIND_SIDE) continue;
        if (run.every((d, k) => grid[r + k * dr][c + k * dc] === d)) n++;
      }
  return n;
}

/** A grid of 0s with digits put in it, at cells r, c */
function gridWith(...put: [number, number, number][]): number[][] {
  const grid = Array.from({ length: FIND_SIDE }, () => Array<number>(FIND_SIDE).fill(0));
  for (const [r, c, d] of put) grid[r][c] = d;
  return grid;
}

describe("找 325", () => {
  it("is the same grid from the same seed, and another from another", () => {
    expect(puzzleOf(SEEDS[0])).toEqual(puzzleOf(SEEDS[0]));
    expect(new Set(SEEDS.slice(0, 100).map((d) => JSON.stringify(puzzleOf(d).grid))).size).toBe(100);
  });

  it("reads a 325 that turns a corner any of the eight ways round, but not a V or any other bend", () => {
    expect(FIND_TURNS).toHaveLength(8);
    expect(new Set(FIND_TURNS.map((t) => t.join())).size).toBe(8);
    // every L round the middle: a step across or down to the 2, a quarter turn, a step to the 5
    for (const [dr, dc, tr, tc] of FIND_TURNS) {
      expect(Math.abs(dr) + Math.abs(dc)).toBe(1);
      expect(Math.abs(tr) + Math.abs(tc)).toBe(1);
      expect(dr * tr + dc * tc === 0).toBe(true);
      const grid = gridWith([5, 5, 3], [5 + dr, 5 + dc, 2], [5 + dr + tr, 5 + dc + tc, 5]);
      expect(readings(grid)).toEqual([{ r: 5, c: 5, dr, dc, tr, tc }]);
      expect(strays(grid)).toBe(0);
    }
    // in a line, any of the eight ways (back ones too: a grid never has them)
    expect(readings(gridWith([4, 4, 3], [4, 5, 2], [4, 6, 5]))).toEqual([{ r: 4, c: 4, dr: 0, dc: 1, tr: 0, tc: 1 }]);
    expect(readings(gridWith([4, 4, 3], [3, 3, 2], [2, 2, 5]))).toEqual([{ r: 4, c: 4, dr: -1, dc: -1, tr: -1, tc: -1 }]);
    // a V: corner to corner, then a quarter turn corner to corner
    const v = gridWith([4, 4, 3], [5, 5, 2], [4, 6, 5]);
    expect(readings(v)).toEqual([]);
    expect(strays(v)).toBe(1);
    // bends of an eighth of a turn, and back sharply
    for (const g of [
      gridWith([4, 4, 3], [4, 5, 2], [5, 6, 5]),
      gridWith([4, 4, 3], [5, 5, 2], [5, 6, 5]),
      gridWith([4, 4, 3], [4, 5, 2], [5, 4, 5]),
    ]) {
      expect(readings(g)).toEqual([]);
      expect(strays(g)).toBe(1);
    }
    // a 2 beside the 3 and a 5 not touching it: nothing at all
    expect(strays(gridWith([4, 4, 3], [4, 5, 2], [4, 7, 5]))).toBe(0);
  });

  it("hides exactly five 325s every round, three in a line and two turning a corner, and nothing else that bends like one", () => {
    // to find in 75 seconds
    expect(FIND_MS).toBe(75_000);
    for (const seed of SEEDS) {
      const { grid, words } = puzzleOf(seed);
      expect(grid).toHaveLength(FIND_SIDE);
      for (const row of grid) {
        expect(row).toHaveLength(FIND_SIDE);
        expect(row.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)).toBe(true);
      }
      expect(words).toHaveLength(FIND_COUNT);
      // every 325 the grid has, read any way, is one of the five, and nothing else runs 3, 2, 5 through cells that touch
      expect(readings(grid).map(key).sort()).toEqual(words.map(key).sort());
      expect(strays(grid)).toBe(0);
      for (const w of words) expect([w, wordMid(w), wordEnd(w)].map(({ r, c }) => grid[r][c])).toEqual([3, 2, 5]);
      // three in a line, each a different way, read left to right or down
      const lines = words.filter((w) => !turns(w));
      expect(lines).toHaveLength(FIND_COUNT - FIND_TURNING);
      for (const w of lines) expect(FIND_WAYS.some(([dr, dc]) => dr === w.dr && dc === w.dc)).toBe(true);
      expect(new Set(lines.map((w) => `${w.dr},${w.dc}`)).size).toBe(lines.length);
      // two turning a corner, each its own way round; the other cell beside both ends is never a 2
      const corners = words.filter(turns);
      expect(corners).toHaveLength(FIND_TURNING);
      expect(new Set(corners.map((w) => `${w.dr},${w.dc},${w.tr},${w.tc}`)).size).toBe(FIND_TURNING);
      for (const w of corners) {
        expect(FIND_TURNS.some((t) => t.join() === [w.dr, w.dc, w.tr, w.tc].join())).toBe(true);
        expect(grid[w.r + w.tr][w.c + w.tc]).not.toBe(2);
      }
      // no two share a cell
      expect(new Set(words.flatMap(cellsOf)).size).toBe(3 * FIND_COUNT);
    }
  });

  it("has 32s and 25s that are not 325s, and a 352, every round", () => {
    for (const seed of SEEDS) {
      const { grid } = puzzleOf(seed);
      // a 3 and a 2 not followed by 5, and a 2 and 5 not after a 3: more of them than the five
      expect(count(grid, [3, 2]) - FIND_COUNT).toBeGreaterThanOrEqual(2);
      expect(count(grid, [2, 5]) - FIND_COUNT).toBeGreaterThanOrEqual(2);
      expect(count(grid, [3, 5, 2])).toBeGreaterThanOrEqual(1);
    }
  });

  it("takes a drag from a 3 to its 5, or from the 5 to the 3, as that 325, round its corner however the finger went", () => {
    const words: Word[] = [
      { r: 0, c: 0, dr: 0, dc: 1, tr: 0, tc: 1 },
      { r: 9, c: 2, dr: -1, dc: 1, tr: -1, tc: 1 },
      // 3 at 5, 5; its 2 above; its 5 up and to the left
      { r: 5, c: 5, dr: -1, dc: 0, tr: 0, tc: -1 },
    ];
    expect(wordEnd(words[1])).toEqual({ r: 7, c: 4 });
    expect(wordMid(words[2])).toEqual({ r: 4, c: 5 });
    expect(wordEnd(words[2])).toEqual({ r: 4, c: 4 });
    expect(wordAt(words, { r: 0, c: 0 }, { r: 0, c: 2 })).toBe(0);
    expect(wordAt(words, { r: 0, c: 2 }, { r: 0, c: 0 })).toBe(0);
    expect(wordAt(words, { r: 7, c: 4 }, { r: 9, c: 2 })).toBe(1);
    expect(wordAt(words, { r: 5, c: 5 }, { r: 4, c: 4 })).toBe(2);
    expect(wordAt(words, { r: 4, c: 4 }, { r: 5, c: 5 })).toBe(2);
    // to the 2 only, one past the 5, or not from either end
    expect(wordAt(words, { r: 0, c: 0 }, { r: 0, c: 1 })).toBe(-1);
    expect(wordAt(words, { r: 0, c: 0 }, { r: 0, c: 3 })).toBe(-1);
    expect(wordAt(words, { r: 0, c: 1 }, { r: 0, c: 2 })).toBe(-1);
    expect(wordAt(words, { r: 5, c: 5 }, { r: 4, c: 5 })).toBe(-1);
    expect(wordAt(words, { r: 5, c: 5 }, { r: 4, c: 6 })).toBe(-1);
  });

  it("follows a finger along the nearest straight line, as far as it went, inside the grid", () => {
    const from = { r: 4, c: 4 };
    // the middle of the cell two to the right, and a little off it
    expect(dragTo(from, 6.5, 4.5)).toEqual({ r: 4, c: 6 });
    expect(dragTo(from, 6.6, 4.9)).toEqual({ r: 4, c: 6 });
    // slanting down to the right, a hand not quite at 45°
    expect(dragTo(from, 6.3, 6.8)).toEqual({ r: 6, c: 6 });
    // up to the right, and straight up
    expect(dragTo(from, 6.5, 2.5)).toEqual({ r: 2, c: 6 });
    expect(dragTo(from, 4.6, 1.4)).toEqual({ r: 1, c: 4 });
    // not moved off the cell
    expect(dragTo(from, 4.7, 4.3)).toEqual(from);
    // past the edge: stops at it
    expect(dragTo({ r: 0, c: 8 }, 12, 0.5)).toEqual({ r: 0, c: 9 });
    expect(dragTo({ r: 1, c: 1 }, -2, -2)).toEqual({ r: 0, c: 0 });
  });

  it("shows a drag turning the corner once the finger, past a cell beside the first, goes on to one beside that", () => {
    const from = { r: 4, c: 4 };
    /** A finger's way, cell middles in turn: where the drag is shown at the end, and the corner it turned */
    const drag = (...way: Cell[]) => {
      let passed: Cell | null = null;
      let shown = { to: from, corner: null as Cell | null };
      for (const { r, c } of way) {
        const on = dragOn(from, passed, c + 0.5, r + 0.5);
        passed = on.passed;
        shown = { to: on.to, corner: on.corner };
      }
      return shown;
    };
    // right, then down: round the corner at the cell to the right
    expect(drag({ r: 4, c: 5 })).toEqual({ to: { r: 4, c: 5 }, corner: null });
    expect(drag({ r: 4, c: 5 }, { r: 5, c: 5 })).toEqual({ to: { r: 5, c: 5 }, corner: { r: 4, c: 5 } });
    // up, then left
    expect(drag({ r: 3, c: 4 }, { r: 3, c: 3 })).toEqual({ to: { r: 3, c: 3 }, corner: { r: 3, c: 4 } });
    // straight to the cell corner to corner: a slant, no corner
    expect(drag({ r: 5, c: 5 })).toEqual({ to: { r: 5, c: 5 }, corner: null });
    // on along the line past the cell beside: straight
    expect(drag({ r: 4, c: 5 }, { r: 4, c: 6 })).toEqual({ to: { r: 4, c: 6 }, corner: null });
    // back to the first cell forgets the one passed
    expect(drag({ r: 4, c: 5 }, { r: 4, c: 4 }, { r: 5, c: 5 })).toEqual({ to: { r: 5, c: 5 }, corner: null });
    // round the corner and then too far: back to a straight line
    expect(drag({ r: 4, c: 5 }, { r: 5, c: 5 }, { r: 6, c: 5 }).corner).toBeNull();
  });
});
