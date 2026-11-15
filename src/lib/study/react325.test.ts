import { describe, expect, it } from "vitest";
import {
  digitMs,
  judgeTap,
  REACT_CODE,
  REACT_FIRST_MS,
  REACT_GRACE_MS,
  REACT_LAST_MS,
  REACT_MAX,
  REACT_SLIPS,
  REACT_WANT_GAP,
  reactDealer,
  reactTimes,
  type Tap,
} from "./react325";
import { mulberry32 } from "../prng";

/** So many rounds' seeds, as the page deals them (rules.ts newSeed): whole numbers from 0 up to 2³² */
const SEEDS = ((r) => Array.from({ length: 1100 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));

/**
 * A round played by a hand that taps the digit wanted each time it comes up, and taps a wrong one now and then (slipAt:
 * the digits it slips at): the digits dealt, where each place was filled, and how it ended
 */
function play(seed: number, slipAt: (i: number) => boolean = () => false) {
  const deal = reactDealer(mulberry32(seed));
  const digits: number[] = [];
  const shown: number[] = [];
  const used = new Set<number>();
  const filled: number[] = [];
  let slips = 0;
  for (let i = 0; i < REACT_MAX; i++) {
    const want = REACT_CODE[filled.length];
    digits.push(deal(want));
    shown.push(i * 400);
    const tap = (at: number): Tap => {
      const r = judgeTap(digits, shown, used, at, REACT_CODE[filled.length]);
      if (r && "fill" in r) {
        used.add(r.fill);
        filled.push(r.fill);
      } else if (r) {
        used.add(r.slip);
        slips++;
      }
      return r;
    };
    if (digits[i] === want) tap(i * 400 + 200);
    else if (slipAt(i)) tap(i * 400 + 200);
    if (filled.length === REACT_CODE.length) return { digits, filled, slips, end: "pass" as const };
    if (slips >= REACT_SLIPS) return { digits, filled, slips, end: "slips" as const };
  }
  return { digits, filled, slips, end: "out" as const };
}

/** The digits a hand that never taps sees, with the same digit wanted all along */
function untouched(seed: number, want: number) {
  const deal = reactDealer(mulberry32(seed));
  return Array.from({ length: REACT_MAX }, () => deal(want));
}

describe("3、2、5 反应", () => {
  it("is tapped out 3、2、5、7、9、9, one place after another, a slip ending it at three", () => {
    expect(REACT_CODE).toEqual([3, 2, 5, 7, 9, 9]);
    expect(REACT_SLIPS).toBe(3);
    for (const seed of SEEDS.slice(0, 300)) {
      const r = play(seed);
      expect(r.end).toBe("pass");
      expect(r.slips).toBe(0);
      // each place filled at a digit that is it, in order, the two 9s at two different 9s
      expect(r.filled.map((i) => r.digits[i])).toEqual([...REACT_CODE]);
      for (let k = 1; k < r.filled.length; k++) expect(r.filled[k]).toBeGreaterThan(r.filled[k - 1]);
    }
    // a hand slipping at every digit it does not want: three slips end it
    const r = play(SEEDS[0], () => true);
    expect(r.end).toBe("slips");
    expect(r.slips).toBe(REACT_SLIPS);
  });

  it("takes a tap while the digit wanted shows, any other as a slip, and one tap a digit shown", () => {
    //              0  1  2  3  4  5  6  7
    const digits = [1, 3, 9, 2, 7, 5, 9, 4];
    // each digit came up 400 ms after the one before, from 1000
    const shown = digits.map((_, i) => 1000 + 400 * i);
    const none = new Set<number>();
    // before the first digit came up: nothing
    expect(judgeTap(digits, shown, none, 999, 3)).toBeNull();
    expect(judgeTap(digits, shown, none, 1000, 3)).toEqual({ slip: 0 });
    // 3 wanted: its digit, from the moment it came up until the next did
    expect(judgeTap(digits, shown, none, 1400, 3)).toEqual({ fill: 1 });
    expect(judgeTap(digits, shown, none, 1799, 3)).toEqual({ fill: 1 });
    // a second tap at the same 3: nothing, not a slip
    expect(judgeTap(digits, shown, new Set([1]), 1700, 3)).toBeNull();
    // 2 wanted: a 9 is a slip, once; a second tap at it is nothing, and so is one a hair after the 3 that took a tap
    expect(judgeTap(digits, shown, new Set([1]), 2000, 2)).toEqual({ slip: 2 });
    expect(judgeTap(digits, shown, new Set([1]), 1900, 2)).toBeNull();
    expect(judgeTap(digits, shown, new Set([1, 2]), 2100, 2)).toBeNull();
    // 9 wanted, twice: one 9 fills one place; the next place wants the next 9
    expect(judgeTap(digits, shown, none, 1900, 9)).toEqual({ fill: 2 });
    expect(judgeTap(digits, shown, new Set([2]), 2000, 9)).toBeNull();
    expect(judgeTap(digits, shown, new Set([2]), 3500, 9)).toEqual({ fill: 6 });
    // only what has come up so far counts
    expect(judgeTap(digits, shown.slice(0, 3), none, 9999, 9)).toEqual({ fill: 2 });
  });

  it("still takes the digit wanted for a moment after it gave way, as eyes and screens are a little late", () => {
    const digits = [1, 3, 8, 2];
    const shown = digits.map((_, i) => 1000 + 400 * i);
    expect(judgeTap(digits, shown, new Set(), 1800, 3)).toEqual({ fill: 1 });
    expect(judgeTap(digits, shown, new Set(), 1800 + REACT_GRACE_MS - 1, 3)).toEqual({ fill: 1 });
    expect(judgeTap(digits, shown, new Set(), 1800 + REACT_GRACE_MS, 3)).toEqual({ slip: 2 });
    // the digit before took its tap already: a second one a hair late is nothing
    expect(judgeTap(digits, shown, new Set([1]), 1800 + REACT_GRACE_MS - 1, 2)).toBeNull();
    // the next digit is the one wanted now: it is taken, early as the tap is
    expect(judgeTap(digits, shown, new Set([1, 2]), 2200 + 10, 2)).toEqual({ fill: 3 });
  });

  it("deals the digit wanted every few digits, never more than six others apart, and no digit twice in a row", () => {
    const gaps: number[] = [];
    for (const seed of SEEDS) {
      for (const want of [3, 2, 5, 7, 9]) {
        const s = untouched(seed, want);
        expect(s.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)).toBe(true);
        for (let i = 1; i < s.length; i++) expect(s[i]).not.toBe(s[i - 1]);
        // from the start, and between one and the next
        let last = -1;
        s.forEach((d, i) => {
          if (d !== want) return;
          gaps.push(i - last - 1);
          last = i;
        });
        expect(s.length - last - 1).toBeLessThanOrEqual(REACT_WANT_GAP);
      }
    }
    expect(Math.max(...gaps)).toBe(REACT_WANT_GAP);
    // about every three to five digits
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean + 1).toBeGreaterThan(3);
    expect(mean + 1).toBeLessThan(4.5);
  });

  it("counts again from when a place is filled, and a round is the same from the same seed, another from another", () => {
    const played = SEEDS.slice(0, 300).map((seed) => play(seed));
    for (const r of played) {
      // the digit wanted after each place filled comes up within six others of it
      r.filled.forEach((at, k) => k > 0 && expect(at - r.filled[k - 1] - 1).toBeLessThanOrEqual(REACT_WANT_GAP));
      for (let i = 1; i < r.digits.length; i++) expect(r.digits[i]).not.toBe(r.digits[i - 1]);
    }
    expect(play(SEEDS[7]).digits).toEqual(play(SEEDS[7]).digits);
    expect(new Set(played.slice(0, 100).map((r) => r.digits.join(""))).size).toBe(100);
  });

  it("shows each digit a little shorter than the one before, from 480 ms to 320 and never shorter", () => {
    expect(digitMs(0)).toBe(REACT_FIRST_MS);
    expect(REACT_FIRST_MS).toBe(480);
    expect(REACT_LAST_MS).toBe(320);
    expect(digitMs(REACT_MAX - 1)).toBe(REACT_LAST_MS);
    expect(digitMs(REACT_MAX + 20)).toBe(REACT_LAST_MS);
    for (let i = 1; i < REACT_MAX; i++) {
      expect(digitMs(i)).toBeLessThanOrEqual(digitMs(i - 1));
      expect(digitMs(i)).toBeGreaterThanOrEqual(REACT_LAST_MS);
    }
    const t = reactTimes();
    expect(t).toHaveLength(REACT_MAX + 1);
    expect(t[0]).toBe(0);
    expect(t[1] - t[0]).toBe(REACT_FIRST_MS);
    expect(t[REACT_MAX] - t[REACT_MAX - 1]).toBe(REACT_LAST_MS);
    // all sixty digits: under half a minute
    expect(t[REACT_MAX]).toBeGreaterThan(20_000);
    expect(t[REACT_MAX]).toBeLessThan(30_000);
  });
});
