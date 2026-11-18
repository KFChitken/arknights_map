import { describe, expect, it } from "vitest";
import { mulberry32 } from "../prng";
import {
  averageOf,
  before,
  BOARD,
  isScore,
  markSheet,
  rankAmong,
  rankPapers,
  readSheet,
  scoreOf,
  SHEET,
  simplified,
  strokesOf,
  tidySheet,
  type Counted,
  type Sheet,
} from "./board";
import { DIGITS, markPaper, type Pt, type Stroke, WRITE_DIGITS } from "./write325";

/** A number from about −1 to 1, most near 0 */
const wobble = (r: () => number) => (r() + r() + r() - 1.5) / 1.5;

/** A way of writing a digit as a finger would: walked every 0.003 of a square, shaking a little, as the page sends points */
function byFinger(strokes: readonly Stroke[], r: () => number): Stroke[] {
  return strokes.map((s) => {
    const fine: Pt[] = [s[0]];
    for (let i = 1; i < s.length; i++) {
      const k = Math.max(1, Math.ceil(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) / 0.003));
      for (let j = 1; j <= k; j++) fine.push({ x: s[i - 1].x + ((s[i].x - s[i - 1].x) * j) / k, y: s[i - 1].y + ((s[i].y - s[i - 1].y) * j) / k });
    }
    return fine.map((q) => ({ x: q.x + wobble(r) * 0.002, y: q.y + wobble(r) * 0.002 }));
  });
}

/** 3, 2 and 5 as a finger writes them, each the first way of writing it */
const written = (seed: number) => {
  const r = mulberry32(seed);
  return WRITE_DIGITS.map((d) => byFinger(DIGITS[d][0], r));
};

/** How far a point is from the segment a–b */
function offSegment(p: [number, number], a: [number, number], b: [number, number]) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const pairs = (s: readonly number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < s.length; i += 2) out.push([s[i], s[i + 1]]);
  return out;
};

describe("手写榜: a paper as it is sent", () => {
  it("is each point in thousandths of a square, none further off than SHEET.off, none within SHEET.near of the one kept before", () => {
    const sheet = tidySheet([
      [
        [
          { x: 0.1234, y: 0.5 },
          { x: 0.1251, y: 0.5016 },
          { x: 0.1274, y: 0.5 },
          { x: 2.4, y: -1 },
        ],
        [{ x: 0.5, y: 0.5 }],
      ],
      [],
      [[{ x: 0.0004, y: 0.9996 }]],
    ]);
    // 0.1251 is 2.3 thousandths from the point kept before it, 0.1274 is 4: the one dropped, the other kept
    expect(sheet).toEqual([[[123, 500, 127, 500, 1500, -500], [500, 500]], [], [[0, 1000]]]);
    expect(readSheet(sheet)).toBe(sheet);
  });

  it("is marked by the page as the server marks it again: the same, from the same JSON", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sent = tidySheet(written(seed));
      const here = markPaper(strokesOf(sent));
      const there = markSheet(JSON.parse(JSON.stringify(sent)) as Sheet);
      expect(there).toEqual({ mark: here.mark, passed: here.word !== "ghost" });
      expect(there.passed).toBe(true);
    }
    // a scribble fails
    const r = mulberry32(7);
    const scribble = WRITE_DIGITS.map(() => [Array.from({ length: 60 }, () => ({ x: r(), y: r() }))]);
    expect(markSheet(tidySheet(scribble)).passed).toBe(false);
    expect(markSheet([[], [], []])).toEqual({ mark: 0, passed: false });
  });

  it("is refused when it is none: not squares of strokes of whole numbers, too far off, or a stroke of no point or half of one", () => {
    for (const bad of [
      null,
      "x",
      {},
      [1],
      [[1]],
      [[[]]],
      [[[1]]],
      [[[1, 2, 3]]],
      [[[1.5, 2]]],
      [[["1", 2]]],
      [[[-501, 0]]],
      [[[0, 1501]]],
      [[[NaN, 0]]],
    ])
      expect(readSheet(bad)).toBeNull();
    expect(readSheet([])).toEqual([]);
    expect(readSheet([[[-500, 1500]]])).toEqual([[[-500, 1500]]]);
  });

  it("is too big past SHEET's squares, strokes in a square and points in all", () => {
    expect(readSheet([[], [], [], []])).toBe("big");
    const dot = [500, 500];
    expect(readSheet([Array.from({ length: SHEET.strokes }, () => dot)])).not.toBe("big");
    expect(readSheet([Array.from({ length: SHEET.strokes + 1 }, () => dot)])).toBe("big");
    const long = (n: number) => Array.from({ length: n }, (_, i) => [i % 1000, 500]).flat();
    expect(readSheet([[long(SHEET.points / 2)], [long(SHEET.points / 2)]])).not.toBe("big");
    expect(readSheet([[long(SHEET.points / 2)], [long(SHEET.points / 2 + 1)]])).toBe("big");
  });
});

describe("手写榜: a paper as the board keeps it", () => {
  it("is each stroke simplified to within SHEET.simple: its ends kept, every point dropped near the line kept", () => {
    const sent = tidySheet(written(3));
    const kept = simplified(sent);
    sent.forEach((square, i) =>
      square.forEach((s, j) => {
        const k = kept[i][j];
        expect(k.slice(0, 2)).toEqual(s.slice(0, 2));
        expect(k.slice(-2)).toEqual(s.slice(-2));
        expect(k.length).toBeLessThan(s.length);
        // each point of the stroke as sent lies within SHEET.simple of the line through those kept
        const line = pairs(k);
        for (const p of pairs(s)) expect(Math.min(...line.slice(1).map((b, n) => offSegment(p, line[n], b)))).toBeLessThanOrEqual(SHEET.simple + 1e-9);
      }),
    );
    // a dot and a line of two points stay as they are
    expect(simplified([[[1, 2], [1, 2, 3, 4]]])).toEqual([[[1, 2], [1, 2, 3, 4]]]);
    // and it still reads as it did
    expect(markSheet(kept).passed).toBe(true);
  });

  it("is about a kilobyte for three squares, where as sent it is many", () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
      const sent = tidySheet(written(seed));
      return { sent: JSON.stringify(sent).length, kept: JSON.stringify(simplified(sent)).length };
    });
    for (const s of sizes) {
      expect(s.kept).toBeLessThan(1300);
      expect(s.sent).toBeGreaterThan(4 * s.kept);
      expect(s.sent).toBeLessThan(SHEET.bytes);
    }
  });
});

describe("手写榜: ratings and the board", () => {
  it("takes a rating as a whole number from 0 to BOARD.max", () => {
    for (const v of [0, 1, 400, 799, 800]) expect(isScore(v)).toBe(true);
    for (const v of [-1, 801, 1.5, "800", null, NaN, Infinity]) expect(isScore(v)).toBe(false);
  });

  it("pulls a paper's average toward the site's as if BOARD.prior more had rated it that", () => {
    expect(averageOf(0, 0)).toBe(BOARD.start);
    expect(averageOf(1500, 2)).toBe(750);
    expect(scoreOf(0, 0, 790)).toBe(790);
    // (5 × 790 + 800) / 6
    expect(scoreOf(800, 1, 790)).toBe(792);
    expect(scoreOf(30 * 790, 30, 790)).toBe(790);
    expect(scoreOf(10 * 799, 10, 700)).toBe(Math.round((5 * 700 + 7990) / 15));
  });

  it("ranks only papers rated by BOARD.minRaters or more: the higher score, then more raters, then the one put up first", () => {
    const c = (id: string, n: number, sum: number, at: number, n799 = 0): Counted => ({ id, n, sum, n799, at });
    const ranked = rankPapers([c("few", 4, 3200, 1), c("a", 5, 4000, 5), c("b", 9, 7200, 6), c("c", 9, 7200, 2), c("d", 6, 4806, 3, 6)], 800);
    // a, b and c all score 800; d (801 a rating) a little above
    expect(ranked.map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
    expect(ranked[0]).toEqual({ id: "d", score: 801, n: 6, n799: 6, at: 3 });
    expect(rankAmong(ranked, { id: "x", score: 800, n: 9, n799: 0, at: 4 })).toBe(3);
    expect(rankAmong(ranked, { id: "d", score: 801, n: 6, n799: 6, at: 3 })).toBe(1);
    expect(rankAmong([], { id: "x", score: 1, n: 0, n799: 0, at: 0 })).toBe(1);
    // equal in all but id: the smaller id first, so that the order never changes between asks
    expect(before({ id: "a", score: 1, n: 1, n799: 0, at: 1 }, { id: "b", score: 1, n: 1, n799: 0, at: 1 })).toBeLessThan(0);
  });

  it("never lets one or two ratings of 800 beat thirty of 790", () => {
    const thirty: Counted = { id: "thirty", n: 30, sum: 30 * 790, n799: 0, at: 9 };
    const lone: Counted = { id: "lone", n: 1, sum: 800, n799: 0, at: 0 };
    const pair: Counted = { id: "pair", n: 2, sum: 1600, n799: 0, at: 0 };
    // rated by too few to be on the board at all, whatever the site's average
    for (const average of [400, 700, 790])
      expect(rankPapers([lone, pair, thirty], average).map((r) => r.id)).toEqual(["thirty"]);
    // and pulled toward the site's average: with some rating low, even five ratings of 800 stay under thirty of 790
    const five: Counted = { id: "five", n: 5, sum: 5 * 800, n799: 0, at: 0 };
    expect(rankPapers([five, thirty], 700).map((r) => [r.id, r.score])).toEqual([
      ["thirty", 777],
      ["five", 750],
    ]);
  });
});
