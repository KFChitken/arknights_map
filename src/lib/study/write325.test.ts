import { describe, expect, it } from "vitest";
import {
  canHandIn,
  cloudOf,
  DIGITS,
  judge,
  markOf,
  markPaper,
  type Pt,
  type Reading,
  readSquare,
  scribbled,
  type Stroke,
  WRITE,
  WRITE_DIGITS,
  wordOf,
  written,
} from "./write325";
import { mulberry32 } from "../prng";

/** A number from about −1 to 1, most near 0 */
const wobble = (r: () => number) => (r() + r() + r() - 1.5) / 1.5;

/**
 * A way of writing as a hand would: turned up to about 12°, stretched or squeezed up to about 20% either way, leant,
 * gently bent along it and shaking a little, and its ends a little short
 */
function byHand(strokes: readonly Stroke[], r: () => number): Stroke[] {
  const turn = wobble(r) * 0.21;
  const sx = 1 + wobble(r) * 0.2;
  const sy = 1 + wobble(r) * 0.2;
  const shear = wobble(r) * 0.24;
  const ph = [r() * 6, r() * 6, r() * 6, r() * 6];
  const bend = (q: Pt): Pt => {
    const x0 = (q.x - 0.5) * sx + (q.y - 0.5) * shear;
    const y0 = (q.y - 0.5) * sy;
    const x = x0 * Math.cos(turn) - y0 * Math.sin(turn) + 0.02 * (Math.sin(q.y * 9 + ph[0]) + Math.sin(q.x * 7 + ph[1]));
    const y = x0 * Math.sin(turn) + y0 * Math.cos(turn) + 0.02 * (Math.sin(q.x * 8 + ph[2]) + Math.sin(q.y * 6 + ph[3]));
    return { x: 0.5 + x + wobble(r) * 0.004, y: 0.5 + y + wobble(r) * 0.004 };
  };
  return strokes.map((s) => {
    // walked finely, so that what is cut off its ends is by length
    const fine: Pt[] = [s[0]];
    for (let i = 1; i < s.length; i++) {
      const k = Math.max(1, Math.ceil(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) / 0.005));
      for (let j = 1; j <= k; j++) fine.push({ x: s[i - 1].x + ((s[i].x - s[i - 1].x) * j) / k, y: s[i - 1].y + ((s[i].y - s[i - 1].y) * j) / k });
    }
    const cut = () => Math.floor(Math.abs(wobble(r)) * 0.1 * fine.length);
    const from = cut();
    return fine.slice(from, Math.max(from + 2, fine.length - cut())).map(bend);
  });
}

/** Strokes moved and sized: put at x, y and made k times as big */
const placed = (strokes: readonly Stroke[], x: number, y: number, k: number): Stroke[] =>
  strokes.map((s) => s.map((q) => ({ x: x + q.x * k, y: y + q.y * k })));

const line = (x0: number, y0: number, x1: number, y1: number): Stroke => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

const reading = (ok: boolean, mark: number): Reading => ({ ok, nearest: 3, d: 1, mark });

describe("徒手写 325: reading a square", () => {
  it("reads every way of writing every digit as that digit, nearest of all", () => {
    for (const [digit, ways] of Object.entries(DIGITS))
      for (const way of ways) {
        const r = readSquare(way, Number(digit))!;
        expect(r.nearest).toBe(Number(digit));
        expect(r.d).toBeLessThan(1e-6);
      }
  });

  it("marks the ways of writing 3, 2 and 5 100, written anywhere in the square at any size", () => {
    for (const digit of WRITE_DIGITS)
      for (const way of DIGITS[digit])
        for (const [x, y, k] of [
          [0, 0, 1],
          [0.3, 0.4, 0.5],
          [-0.1, 0.05, 1.2],
        ])
          expect(readSquare(placed(way, x, y, k), digit)).toMatchObject({ ok: true, nearest: digit, mark: 100 });
  });

  it("reads 3, 2 and 5 written by hand, a little off every way, as them, and marks them well", () => {
    const r = mulberry32(325);
    for (const digit of WRITE_DIGITS) {
      let ok = 0;
      let n = 0;
      const marks: number[] = [];
      for (const way of DIGITS[digit])
        for (let k = 0; k < 20; k++) {
          const got = readSquare(byHand(way, r), digit);
          n++;
          if (got?.ok) ok++;
          marks.push(got?.mark ?? 0);
        }
      // all but a few, and most marked 90 or more
      expect(ok / n).toBeGreaterThanOrEqual(0.95);
      marks.sort((a, b) => a - b);
      expect(marks[Math.floor(n / 2)]).toBeGreaterThanOrEqual(90);
    }
  }, 60_000);

  it("reads a 3 as a 3 no further than 1.15 times the nearest, and as the other digit further", () => {
    expect(WRITE.near).toBe(1.15);
    const near = [
      { digit: 8, d: 1 },
      { digit: 3, d: 1.15 },
      { digit: 5, d: 1.3 },
    ];
    expect(judge(near, 3)).toEqual({ ok: true, nearest: 8, d: 1.15, mark: markOf(1.15) });
    const far = [
      { digit: 8, d: 1 },
      { digit: 3, d: 1.16 },
    ];
    expect(judge(far, 3)).toEqual({ ok: false, nearest: 8, d: 1.16, mark: 0 });
    expect(judge([{ digit: 3, d: 2 }, { digit: 8, d: 2.1 }], 3)).toMatchObject({ ok: true, nearest: 3, mark: markOf(2) });
  });

  it("marks a square 100 at WRITE.full or nearer, 0 at WRITE.none or further, and the nearer the more between", () => {
    expect(markOf(0)).toBe(100);
    expect(markOf(WRITE.full)).toBe(100);
    expect(markOf((WRITE.full + WRITE.none) / 2)).toBe(50);
    expect(markOf(WRITE.none)).toBe(0);
    expect(markOf(WRITE.none + 3)).toBe(0);
    for (let d = WRITE.full; d < WRITE.none; d += 0.1) expect(markOf(d + 0.1)).toBeLessThanOrEqual(markOf(d));
  });

  it("leaves out dots, and reads nothing in a square with only dots or nothing in it", () => {
    const three = DIGITS[3][0];
    const dotted = [...three, line(0.8, 0.8, 0.805, 0.805), line(0.1, 0.9, 0.1, 0.91)];
    expect(readSquare(dotted, 3)!.d).toBeCloseTo(readSquare(three, 3)!.d, 6);
    expect(readSquare([], 3)).toBeNull();
    expect(readSquare([line(0.5, 0.5, 0.51, 0.5)], 3)).toBeNull();
    expect(cloudOf([[{ x: 0.5, y: 0.5 }]])).toBeNull();
  });

  it("does not read a line across or other digits as 3, 2 and 5", () => {
    expect(readSquare([line(0.2, 0.5, 0.8, 0.5)], 2)!.ok).toBe(false);
    // 1, 4 and 7 as they are written
    for (const other of [1, 4, 7]) for (const digit of WRITE_DIGITS) expect(readSquare(DIGITS[other][0], digit)!.ok).toBe(false);
  });

  it("reads no digit in a scribbled square: a zigzag, hatching, a spiral, or a digit gone over and over", () => {
    /** A zigzag across the square through n corners and ends, n − 2 of them sharp turns */
    const zigzag = (n: number): Stroke => Array.from({ length: n }, (_, i) => ({ x: i % 2 ? 0.8 : 0.2, y: 0.2 + (i * 0.6) / (n - 1) }));
    const hatching: Stroke = Array.from({ length: 14 }, (_, i) => ({ x: i % 2 ? 0.75 : 0.25, y: 0.2 + i * 0.045 }));
    const spiral: Stroke = Array.from({ length: 120 }, (_, i) => ({
      x: 0.5 + (0.02 + i * 0.0028) * Math.cos(i * 0.18),
      y: 0.5 + (0.02 + i * 0.0028) * Math.sin(i * 0.18),
    }));
    const three = DIGITS[3][0];
    for (const square of [[zigzag(6)], [zigzag(9)], [zigzag(6).map((q) => ({ x: q.y, y: q.x }))], [hatching], [spiral], [...three, ...three, ...three]]) {
      expect(scribbled(square)).toBe(true);
      for (const digit of WRITE_DIGITS) expect(readSquare(square, digit)).toBeNull();
    }
    // WRITE.sharp sharp turns are a scribble and one fewer is not; a digit gone over twice is not
    expect(WRITE.sharp).toBe(4);
    expect(scribbled([zigzag(5)])).toBe(false);
    expect(scribbled([...three, ...three])).toBe(false);
    expect(markPaper([[zigzag(6)], [spiral], [hatching]])).toMatchObject({ readings: [null, null, null], mark: 0, word: "ghost" });
  });

  it("does not take digits for scribbles: no way of writing any digit, nor 3, 2 and 5 written by hand or shaking", () => {
    for (const ways of Object.values(DIGITS)) for (const way of ways) expect(scribbled(way)).toBe(false);
    const r = mulberry32(5);
    for (const digit of WRITE_DIGITS) for (const way of DIGITS[digit]) for (let k = 0; k < 20; k++) expect(scribbled(byHand(way, r))).toBe(false);
    // written slowly on a shaking screen: a point every 0.002, each up to 0.012 off, full size and a third of it
    const shaking = (way: readonly Stroke[], k: number): Stroke[] =>
      way.map((s) => {
        const out: Pt[] = [];
        for (let i = 1; i < s.length; i++) {
          const n = Math.max(1, Math.round(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) / 0.002));
          for (let j = 0; j < n; j++)
            out.push({
              x: 0.5 + (s[i - 1].x + ((s[i].x - s[i - 1].x) * j) / n - 0.5) * k + wobble(r) * 0.012 * Math.min(1, k * 2),
              y: 0.5 + (s[i - 1].y + ((s[i].y - s[i - 1].y) * j) / n - 0.5) * k + wobble(r) * 0.012 * Math.min(1, k * 2),
            });
        }
        return out;
      });
    for (const digit of WRITE_DIGITS)
      for (const way of DIGITS[digit])
        for (const k of [1, 1 / 3]) for (let n = 0; n < 5; n++) expect(scribbled(shaking(way, k))).toBe(false);
  });
});

describe("徒手写 325: handing in and marking", () => {
  const paper = WRITE_DIGITS.map((digit) => DIGITS[digit][0]);

  it("hands in only when every square is written", () => {
    expect(canHandIn([[], [], []])).toBe(false);
    expect(canHandIn([paper[0], paper[1], []])).toBe(false);
    expect(canHandIn([paper[0], [], paper[2]])).toBe(false);
    // a dot or a tick is not written
    expect(canHandIn([paper[0], paper[1], [line(0.5, 0.5, 0.52, 0.52)]])).toBe(false);
    expect(written([line(0.2, 0.5, 0.2 + WRITE.ink - 0.01, 0.5)])).toBe(false);
    expect(written([line(0.2, 0.5, 0.2 + WRITE.ink, 0.5)])).toBe(true);
    expect(canHandIn(paper)).toBe(true);
    expect(canHandIn(paper.slice(0, 2))).toBe(false);
  });

  it("gives 字迹工整 from 90, 还挺像 from 75 and 医生体 from 60, all passed, and 鬼画符 under", () => {
    const at = (m: number) => wordOf([reading(true, m), reading(true, m), reading(true, m)], m);
    expect(at(100)).toBe("neat");
    expect(at(WRITE.neat)).toBe("neat");
    expect(at(WRITE.neat - 1)).toBe("like");
    expect(at(WRITE.like)).toBe("like");
    expect(at(WRITE.like - 1)).toBe("doctor");
    expect(at(WRITE.pass)).toBe("doctor");
    expect([WRITE.neat, WRITE.like, WRITE.pass]).toEqual([90, 75, 60]);
    // one square under 60 is 鬼画符 even with the others' marks
    expect(wordOf([reading(true, 100), reading(true, 100), reading(true, WRITE.pass - 1)], 86)).toBe("ghost");
    // one square read as another digit, or not read at all
    expect(wordOf([reading(true, 95), reading(false, 0), reading(true, 95)], 63)).toBe("ghost");
    expect(wordOf([reading(true, 95), null, reading(true, 95)], 63)).toBe("ghost");
  });

  it("marks a paper by the average of its squares", () => {
    expect(markPaper(paper)).toMatchObject({ mark: 100, word: "neat" });
    // 3, 2 and 5 swapped: each read as another digit
    const swapped = markPaper([paper[2], paper[0], paper[1]]);
    expect(swapped.readings.map((r) => r!.ok)).toEqual([false, false, false]);
    expect(swapped).toMatchObject({ mark: 0, word: "ghost" });
    // the 5 square left with nothing readable in it counts 0
    const blank = markPaper([paper[0], paper[1], []]);
    expect(blank.readings[2]).toBeNull();
    expect(blank).toMatchObject({ mark: 67, word: "ghost" });
    // written by hand: the average of the three marks, rounded
    const r = mulberry32(25);
    const hand = WRITE_DIGITS.map((digit) => byHand(DIGITS[digit][1], r));
    const got = markPaper(hand);
    const marks = got.readings.map((x) => x!.mark);
    expect(got.mark).toBe(Math.round((marks[0] + marks[1] + marks[2]) / 3));
    expect(got.word).toBe(wordOf(got.readings, got.mark));
  });
});
