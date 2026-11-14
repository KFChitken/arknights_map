import { describe, expect, it } from "vitest";
import {
  answered,
  MENTAL_COUNT,
  MENTAL_FORMS,
  MENTAL_NEAR,
  MENTAL_SHUFFLED,
  MENTAL_STREAK,
  MENTAL_WRONGS,
  mentalMs,
  mentalSums,
  sumKey,
  type Tally,
  TALLY_START,
  valueOf,
} from "./mental325";
import { dayRandom } from "./rules";

/** Nearly three years of site days from the first one the course could be played */
const DAYS = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2026, 10, 14 + i)).toISOString().slice(0, 10));
const sumsOf = (day: string) => mentalSums(dayRandom("mental325", day));

/** Answers one after another from the start of a round: the tally after each, and how the last one left the round */
function play(answers: boolean[]) {
  let tally: Tally = TALLY_START;
  let end: "pass" | "out" | null = null;
  for (const right of answers) ({ tally, end } = answered(tally, right));
  return { tally, end };
}

describe("心算快打", () => {
  it("works a sum out as it is written, × and ÷ before + and −", () => {
    expect(valueOf("13 × 25")).toBe(325);
    expect(valueOf("18² + 1")).toBe(325);
    expect(valueOf("10² + 15²")).toBe(325);
    expect(valueOf("975 ÷ 3")).toBe(325);
    expect(valueOf("7 × 46 + 3")).toBe(325);
    expect(valueOf("6 × 55 − 5")).toBe(325);
    expect(valueOf("999 − 674")).toBe(325);
    expect(valueOf("300 + 52")).toBe(352);
    expect(valueOf("2 + 3 × 4")).toBe(14);
    expect(valueOf("20 − 12 ÷ 4")).toBe(17);
    // dividing unevenly, or anything not written the day's way, makes nothing
    expect(valueOf("10 ÷ 3")).toBeNaN();
    expect(valueOf("13 x 25")).toBeNaN();
    expect(valueOf("13 × ")).toBeNaN();
    expect(valueOf("13 25")).toBeNaN();
    expect(valueOf("")).toBeNaN();
  });

  it("tells a sum from another as it is, not the way round it is written", () => {
    expect(sumKey({ text: "25 × 13", form: "mul" })).toBe(sumKey({ text: "13 × 25", form: "mul" }));
    expect(sumKey({ text: "17² + 6²", form: "sqSq" })).toBe(sumKey({ text: "6² + 17²", form: "sqSq" }));
    expect(sumKey({ text: "217 + 108", form: "add" })).toBe(sumKey({ text: "108 + 217", form: "add" }));
    expect(sumKey({ text: "975 ÷ 3", form: "div" })).not.toBe(sumKey({ text: "3 ÷ 975", form: "div" }));
  });

  it("is the same sums for everyone that day, and others the next", () => {
    expect(sumsOf("2026-11-21")).toEqual(sumsOf("2026-11-21"));
    expect(new Set(DAYS.slice(0, 100).map((d) => sumsOf(d).map((s) => s.text).join())).size).toBe(100);
  });

  it("over a thousand days: half of each day 325, worked out from what shows, every one whole and small", () => {
    const others = new Set<number>([...MENTAL_NEAR, ...MENTAL_SHUFFLED]);
    const forms = new Map<string, number>();
    for (const day of DAYS) {
      const sums = sumsOf(day);
      expect(sums).toHaveLength(MENTAL_COUNT);
      // what each makes, worked out from what it shows, is what it was put there to make
      const values = sums.map((s) => valueOf(s.text));
      sums.forEach((s, i) => expect([s.text, values[i] === 325]).toEqual([s.text, s.is325]));
      const yes = values.filter((v) => v === 325).length / sums.length;
      expect(yes).toBeGreaterThanOrEqual(0.4);
      expect(yes).toBeLessThanOrEqual(0.6);
      // and every ten of a round is half and half
      for (let i = 0; i < sums.length; i += 10) expect(sums.slice(i, i + 10).filter((s) => s.is325)).toHaveLength(5);
      for (const [i, s] of sums.entries()) {
        const v = values[i];
        expect(Number.isInteger(v) && v > 0).toBe(true);
        // whole numbers of at most four digits, no number under nothing, dividing evenly
        const parts = s.text.split(" ");
        const numbers = parts.filter((_, k) => k % 2 === 0).map((p) => Number(p.replace("²", "")));
        expect(numbers.every((x) => Number.isInteger(x) && x >= 1 && x <= 9999)).toBe(true);
        if (parts[1] === "÷") {
          expect(numbers[0] % numbers[1]).toBe(0);
          expect(numbers[1]).toBeGreaterThanOrEqual(2);
          expect(numbers[1]).toBeLessThanOrEqual(9);
        }
        if (parts[1] === "−") expect(numbers[0]).toBeLessThanOrEqual(999);
        if (s.form === "mul") expect(Math.min(...numbers)).toBeGreaterThanOrEqual(2);
        if (s.form === "sqAdd") expect(numbers[0] >= 10 && numbers[0] <= 18).toBe(true);
        if (s.form === "mulMix") expect(numbers[0] >= 2 && numbers[0] <= 9).toBe(true);
        // two squares make 325 only three ways; the others are one of those with a number one off
        if (s.form === "sqSq") {
          const [a, b] = [...numbers].sort((x, y) => x - y);
          const near = [
            [1, 18],
            [6, 17],
            [10, 15],
          ].some(([p, q]) => Math.abs(a - p) + Math.abs(b - q) === (s.is325 ? 0 : 1));
          expect([s.text, near]).toEqual([s.text, true]);
        } else if (!s.is325) expect([s.text, others.has(v)]).toEqual([s.text, true]);
        forms.set(s.form, (forms.get(s.form) ?? 0) + 1);
      }
      // never the same sum twice in a day, not even the other way round, nor a way of writing them three times running
      expect(new Set(sums.map((s) => s.text)).size).toBe(sums.length);
      expect(new Set(sums.map(sumKey)).size).toBe(sums.length);
      for (let i = 2; i < sums.length; i++) expect(sums[i].form === sums[i - 1].form && sums[i].form === sums[i - 2].form).toBe(false);
    }
    // each way of writing them comes up
    for (const f of MENTAL_FORMS) expect((forms.get(f) ?? 0) / (DAYS.length * MENTAL_COUNT)).toBeGreaterThan(0.08);
  });

  it("gives a little less time for each sum, never under three seconds", () => {
    expect(mentalMs(1)).toBe(6000);
    expect(mentalMs(2)).toBe(5800);
    expect(mentalMs(16)).toBe(3000);
    expect(mentalMs(30)).toBe(3000);
  });

  it("passes at ten right in a row, starts the row again at a wrong one, and ends at three wrong", () => {
    const ten = Array<boolean>(MENTAL_STREAK).fill(true);
    expect(play(ten)).toEqual({ tally: { streak: 10, best: 10, wrongs: 0 }, end: "pass" });
    expect(play(ten.slice(1)).end).toBeNull();
    // nine right, one wrong: the row starts again
    expect(play([...ten.slice(1), false])).toEqual({ tally: { streak: 0, best: 9, wrongs: 1 }, end: null });
    expect(play([...ten.slice(1), false, ...ten]).end).toBe("pass");
    // three wrong, wherever they come
    const out = play([true, false, true, true, false, true, false]);
    expect(out).toEqual({ tally: { streak: 0, best: 2, wrongs: MENTAL_WRONGS }, end: "out" });
    expect(play([false, false]).end).toBeNull();
  });
});
