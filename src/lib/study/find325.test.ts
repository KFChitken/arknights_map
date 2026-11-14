import { describe, expect, it } from "vitest";
import { dragTo, FIND_COUNT, FIND_SIDE, FIND_WAYS, findPuzzle, readings, type Word, wordAt, wordEnd } from "./find325";
import { dayRandom } from "./rules";

/** About three years of site days from the first one the course could be played */
const DAYS = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2026, 10, 14 + i)).toISOString().slice(0, 10));
const puzzleOf = (day: string) => findPuzzle(dayRandom("find325", day));
const key = (w: Word) => `${w.r},${w.c},${w.dr},${w.dc}`;

/** How many times a run of digits comes up in a grid, read any of the eight ways */
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

describe("找 325", () => {
  it("is the same grid for everyone on a day, and another the next day", () => {
    expect(puzzleOf("2026-11-21")).toEqual(puzzleOf("2026-11-21"));
    expect(new Set(DAYS.slice(0, 100).map((d) => JSON.stringify(puzzleOf(d).grid))).size).toBe(100);
  });

  it("hides exactly five 325s every day, across, down and slanting, and no other read any of the eight ways", () => {
    for (const day of DAYS) {
      const { grid, words } = puzzleOf(day);
      expect(grid).toHaveLength(FIND_SIDE);
      for (const row of grid) {
        expect(row).toHaveLength(FIND_SIDE);
        expect(row.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)).toBe(true);
      }
      expect(words).toHaveLength(FIND_COUNT);
      // every 325 the grid has, read any way, is one of the five, and each of the five reads 325 left to right or down
      expect(readings(grid).map(key).sort()).toEqual(words.map(key).sort());
      for (const w of words) {
        expect(FIND_WAYS.some(([dr, dc]) => dr === w.dr && dc === w.dc)).toBe(true);
        expect([0, 1, 2].map((k) => grid[w.r + k * w.dr][w.c + k * w.dc])).toEqual([3, 2, 5]);
      }
      // each way at least once
      for (const [dr, dc] of FIND_WAYS) expect(words.some((w) => w.dr === dr && w.dc === dc)).toBe(true);
      // no two share a cell
      const cells = words.flatMap((w) => [0, 1, 2].map((k) => `${w.r + k * w.dr},${w.c + k * w.dc}`));
      expect(new Set(cells).size).toBe(3 * FIND_COUNT);
    }
  });

  it("has 32s and 25s that are not 325s, and a 352, every day", () => {
    for (const day of DAYS) {
      const { grid } = puzzleOf(day);
      // a 3 and a 2 not followed by 5, and a 2 and 5 not after a 3: more of them than the five
      expect(count(grid, [3, 2]) - FIND_COUNT).toBeGreaterThanOrEqual(2);
      expect(count(grid, [2, 5]) - FIND_COUNT).toBeGreaterThanOrEqual(2);
      expect(count(grid, [3, 5, 2])).toBeGreaterThanOrEqual(1);
    }
  });

  it("takes a drag from a 3 to its 5, or from the 5 to the 3, as that 325", () => {
    const words: Word[] = [
      { r: 0, c: 0, dr: 0, dc: 1 },
      { r: 9, c: 2, dr: -1, dc: 1 },
    ];
    expect(wordEnd(words[1])).toEqual({ r: 7, c: 4 });
    expect(wordAt(words, { r: 0, c: 0 }, { r: 0, c: 2 })).toBe(0);
    expect(wordAt(words, { r: 0, c: 2 }, { r: 0, c: 0 })).toBe(0);
    expect(wordAt(words, { r: 7, c: 4 }, { r: 9, c: 2 })).toBe(1);
    // to the 2 only, one past the 5, or not from either end
    expect(wordAt(words, { r: 0, c: 0 }, { r: 0, c: 1 })).toBe(-1);
    expect(wordAt(words, { r: 0, c: 0 }, { r: 0, c: 3 })).toBe(-1);
    expect(wordAt(words, { r: 0, c: 1 }, { r: 0, c: 2 })).toBe(-1);
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
});
