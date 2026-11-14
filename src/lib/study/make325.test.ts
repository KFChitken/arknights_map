import { describe, expect, it } from "vitest";
import {
  combine,
  fair,
  reaches,
  lastCard,
  MAKE_FALLBACK,
  MAKE_GOAL,
  MAKE_POOL,
  makePuzzle,
  put,
  restart,
  type Table,
  table,
  undo,
  waysTo,
} from "./make325";
import { dayRandom } from "./rules";

/** Nearly three years of site days from the first one the course could be played */
const DAYS = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2026, 10, 14 + i)).toISOString().slice(0, 10));
const puzzleOf = (day: string) => makePuzzle(dayRandom("make325", day));

/** What a way to 325 as written comes to, worked out as written, and the numbers in it */
function readWay(text: string): { value: number; nums: number[] } {
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  // the same signs as the game's, written for JavaScript; every step must stay whole
  const js = text.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
  const value = Function(`"use strict"; return (${js});`)() as number;
  return { value, nums };
}

describe("凑 325", () => {
  it("puts two numbers together only into a whole number above nought", () => {
    expect(combine(13, "×", 25)).toBe(325);
    expect(combine(300, "+", 25)).toBe(325);
    expect(combine(350, "−", 25)).toBe(325);
    expect(combine(975, "÷", 3)).toBe(325);
    expect(combine(10, "÷", 3)).toBe("uneven");
    expect(combine(9, "−", 9)).toBe("notPositive");
    expect(combine(9, "−", 10)).toBe("notPositive");
  });

  it("finds each way once, whichever side of + and × a number is on and whichever of two steps comes first", () => {
    const ways = waysTo([9, 10, 25, 40], MAKE_GOAL);
    expect(ways[0].text).toBe("9 × 40 − (10 + 25)");
    expect(ways.map((w) => w.text)).toContain("25 × (9 + 40 ÷ 10)");
    expect(new Set(ways.map((w) => w.key)).size).toBe(ways.length);
    // (9 × 40) and (10 + 25) taken in either order are one way
    expect(ways.filter((w) => w.text === "9 × 40 − (10 + 25)")).toHaveLength(1);
    expect(waysTo([13, 25], MAKE_GOAL)).toHaveLength(1);
    expect(waysTo([6, 9, 25, 50], MAKE_GOAL)).toHaveLength(1);
    // only the first few, the first the same
    expect(waysTo([9, 10, 25, 40], MAKE_GOAL, 2)).toEqual(ways.slice(0, 2));
    // the quick yes or no agrees with the ways, for a few hundred sets of four
    for (let i = 0; i < 300; i++) {
      const nums = [2 + (i % 23), 3 + ((i * 7) % 22), 5 + ((i * 11) % 20), [25, 30, 40, 50, 60, 75, 100][i % 7]];
      expect([nums, reaches(nums, MAKE_GOAL)]).toEqual([nums, waysTo(nums, MAKE_GOAL).length > 0]);
    }
    // 6 × 50 + 25 makes 325 with a number left over
    expect(fair([6, 9, 25, 50])).toBe(false);
    expect(fair([9, 10, 25, 40])).toBe(true);
    expect(fair([7, 11, 13, 21])).toBe(true);
    expect(fair([6, 8, 11, 25])).toBe(true);
  });

  it("is the same four for everyone that day, others the next, and over a thousand days always a fair one", () => {
    expect(puzzleOf("2026-11-21")).toEqual(puzzleOf("2026-11-21"));
    expect(new Set(DAYS.slice(0, 100).map((d) => puzzleOf(d).nums.join())).size).toBeGreaterThanOrEqual(90);
    for (const day of DAYS) {
      const p = puzzleOf(day);
      // never the set four it falls back on
      expect(p.fallback).toBe(false);
      expect(p.nums).toHaveLength(4);
      expect(new Set(p.nums).size).toBe(4);
      expect(p.nums.every((n) => MAKE_POOL.includes(n))).toBe(true);
      expect([...p.nums].sort((a, b) => a - b)).toEqual(p.nums);
      // 325 at least two ways, and no two or three of them make it alone
      expect(fair(p.nums)).toBe(true);
      expect(waysTo(p.nums, MAKE_GOAL).length).toBeGreaterThanOrEqual(2);
      for (const [a, b, c] of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]])
        expect(waysTo([p.nums[a], p.nums[b], p.nums[c]], MAKE_GOAL)).toHaveLength(0);
      // 看答案 comes to 325, with each of the four once
      const way = readWay(p.answer);
      expect([p.answer, way.value]).toEqual([p.answer, MAKE_GOAL]);
      expect([...way.nums].sort((a, b) => a - b)).toEqual(p.nums);
    }
    expect(fair(MAKE_FALLBACK)).toBe(true);
  }, 30_000);

  it("puts cards together, refuses what is uneven or not above nought, and goes back a step or to the start", () => {
    let t: Table = table([9, 10, 25, 40]);
    const refused = put(t, 1, "÷", 3);
    expect(refused).toBe("uneven");
    expect(put(t, 0, "−", 1)).toBe("notPositive");
    const step = (from: number, op: "+" | "−" | "×" | "÷", to: number) => {
      const r = put(t, from, op, to);
      if (typeof r === "string") throw new Error(r);
      t = r;
    };
    step(3, "÷", 1);
    expect(t.cards).toEqual([9, 4, 25, null]);
    step(0, "+", 1);
    expect(t.cards).toEqual([null, 13, 25, null]);
    expect(lastCard(t)).toBeNull();
    step(1, "×", 2);
    expect(t.cards).toEqual([null, null, 325, null]);
    expect(lastCard(t)).toBe(325);
    t = undo(t);
    expect(t.cards).toEqual([null, 13, 25, null]);
    t = restart(t);
    expect(t).toEqual(table([9, 10, 25, 40]));
    expect(undo(t)).toEqual(t);
    // a card put together with itself, or with a place already empty, changes nothing
    expect(put(t, 2, "+", 2)).toEqual(t);
    step(0, "+", 1);
    expect(put(t, 0, "+", 2)).toEqual(t);
  });
});
