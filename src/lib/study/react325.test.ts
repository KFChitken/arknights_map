import { describe, expect, it } from "vitest";
import {
  countTargets,
  isTarget,
  judgeTap,
  REACT_DECOYS,
  REACT_FIRST_MS,
  REACT_GRACE_MS,
  REACT_HITS,
  REACT_LAST_MS,
  REACT_SLIPS,
  REACT_TARGETS,
  reactStream,
  reactTimes,
} from "./react325";
import { dayRandom } from "./rules";

/** Three years of site days from the first one the course could be played */
const DAYS = Array.from({ length: 1100 }, (_, i) => new Date(Date.UTC(2026, 10, 14 + i)).toISOString().slice(0, 10));
const streamOf = (day: string) => reactStream(dayRandom("react325", day));

/** Where a run of digits comes up in a stream */
const at = (s: readonly number[], run: readonly number[]) =>
  s.map((_, i) => i).filter((i) => run.every((d, k) => s[i + k] === d));

describe("3、2、5 反应", () => {
  it("is the same stream for everyone on a day, and another the next day", () => {
    expect(streamOf("2026-11-21")).toEqual(streamOf("2026-11-21"));
    expect(streamOf("2026-11-22")).not.toEqual(streamOf("2026-11-21"));
    expect(new Set(DAYS.slice(0, 100).map((d) => streamOf(d).join(""))).size).toBe(100);
  });

  it("has 3、2、5 eight times every day, only where it was put, after a few digits to warm up, and no digit twice in a row", () => {
    expect(REACT_TARGETS).toBeGreaterThanOrEqual(7);
    expect(REACT_TARGETS).toBeGreaterThan(REACT_HITS);
    for (const day of DAYS) {
      const s = streamOf(day);
      expect(s.every((d) => Number.isInteger(d) && d >= 0 && d <= 9)).toBe(true);
      expect(countTargets(s)).toBe(REACT_TARGETS);
      expect(at(s, [3, 2, 5])).toHaveLength(REACT_TARGETS);
      expect(s.findIndex((_, i) => isTarget(s, i))).toBeGreaterThanOrEqual(6);
      for (let i = 1; i < s.length; i++) expect(s[i]).not.toBe(s[i - 1]);
      // half a minute or so: 600 ms a digit at first, 400 at the end
      expect(s.length).toBeGreaterThanOrEqual(55);
      expect(s.length).toBeLessThanOrEqual(80);
      // every 3 and 5 is one put there: in a 3、2、5 or something meant to fool the hand
      const put = new Set([...at(s, [3, 2, 5]).flatMap((i) => [i, i + 1, i + 2])]);
      for (const d of REACT_DECOYS) for (const i of at(s, d)) d.forEach((_, k) => put.add(i + k));
      s.forEach((d, i) => (d === 3 || d === 5) && expect(put.has(i)).toBe(true));
    }
  });

  it("puts in things meant to fool the hand: 3、2、4, 3、5, 2、5 and the like, six a day, each kind every day", () => {
    for (const day of DAYS) {
      const s = streamOf(day);
      // 3 and 2 not followed by 5, a 5 after only one of them, the three backwards
      const near = REACT_DECOYS.map((d) => at(s, d).filter((i) => d[0] !== 2 || s[i - 1] !== 3).length);
      expect(near.every((n) => n >= 1)).toBe(true);
      expect(near.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(REACT_TARGETS - 2);
    }
  });

  it("shows each digit a little shorter than the one before, from 600 ms to 400", () => {
    const t = reactTimes(70);
    expect(t).toHaveLength(71);
    expect(t[0]).toBe(0);
    expect(t[1] - t[0]).toBe(REACT_FIRST_MS);
    expect(t[70] - t[69]).toBe(REACT_LAST_MS);
    for (let i = 1; i < 70; i++) expect(t[i + 1] - t[i]).toBeLessThanOrEqual(t[i] - t[i - 1]);
    expect(t[70]).toBeGreaterThan(30_000);
    expect(t[70]).toBeLessThan(40_000);
  });

  it("takes a tap while the 5 of a 3、2、5 shows as a hit, once, and any other as a slip", () => {
    //           0  1  2  3  4  5  6  7  8  9
    const s = [7, 3, 2, 5, 1, 2, 5, 3, 5, 0];
    // each digit came up 500 ms after the one before, from 1000
    const shown = s.map((_, i) => 1000 + 500 * i);
    const none = new Set<number>();
    expect(REACT_HITS).toBe(5);
    expect(REACT_SLIPS).toBe(3);
    // before the first digit came up: nothing
    expect(judgeTap(s, shown, none, 999)).toBeNull();
    // the 5 of 3、2、5, from the moment it came up to the moment the next did
    expect(judgeTap(s, shown, none, 2500)).toEqual({ hit: 3 });
    expect(judgeTap(s, shown, none, 2999)).toEqual({ hit: 3 });
    // the same 5 again: nothing, not a slip
    expect(judgeTap(s, shown, new Set([3]), 2700)).toBeNull();
    // its 3 and its 2, too early
    expect(judgeTap(s, shown, none, 1500)).toBe("slip");
    expect(judgeTap(s, shown, none, 2200)).toBe("slip");
    // a 5 after 2 alone, a 5 after 3 alone, any other digit
    expect(judgeTap(s, shown, none, 4100)).toBe("slip");
    expect(judgeTap(s, shown, none, 5200)).toBe("slip");
    expect(judgeTap(s, shown, none, 1200)).toBe("slip");
    // only what has come up so far counts
    expect(judgeTap(s, shown.slice(0, 4), none, 9999)).toEqual({ hit: 3 });
  });

  it("still takes the 5 for a moment after it gave way, as eyes and screens are a little late", () => {
    const s = [7, 3, 2, 5, 1, 0];
    const shown = s.map((_, i) => 1000 + 500 * i);
    expect(judgeTap(s, shown, new Set(), 3000)).toEqual({ hit: 3 });
    expect(judgeTap(s, shown, new Set(), 3000 + REACT_GRACE_MS - 1)).toEqual({ hit: 3 });
    expect(judgeTap(s, shown, new Set([3]), 3000 + REACT_GRACE_MS - 1)).toBeNull();
    expect(judgeTap(s, shown, new Set(), 3000 + REACT_GRACE_MS)).toBe("slip");
  });
});
