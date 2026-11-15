import { describe, expect, it } from "vitest";
import {
  cellOf,
  DIGITS,
  digitOf,
  digitsOf,
  fixesOf,
  holds,
  lit,
  MATCH,
  MATCH_GOAL,
  matches,
  matchPuzzle,
  type Matches,
  moved,
  movesOf,
  PLACES,
  readable,
  sameSpot,
  SPARE,
  spotsOf,
  writtenOf,
} from "./match325";
import { mulberry32 } from "../prng";

/** So many rounds' seeds, as the page deals them (rules.ts newSeed): whole numbers from 0 up to 2³² */
const SEEDS = ((r) => Array.from({ length: 1000 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));

const count = (lit: number) => [...lit.toString(2)].filter((b) => b === "1").length;
/** The places lit, by name: top, top right, bottom right, bottom, bottom left, top left, middle */
const NAMES = ["top", "topRight", "bottomRight", "bottom", "bottomLeft", "topLeft", "middle"];
const placesOf = (lit: number) => NAMES.filter((_, k) => lit & (1 << k));
/** How many matches an equation has, the sign's bar and the equals left out */
const matchesIn = (m: Matches) => [...m.x, ...m.y, ...m.z].reduce((n, d) => n + count(d), 0) + (m.plus ? 1 : 0);

describe("火柴棒 325's digits", () => {
  it("are laid as a digital clock lays them", () => {
    expect(PLACES).toBe(7);
    expect(DIGITS.map(count)).toEqual([6, 2, 5, 5, 4, 5, 6, 3, 7, 6]);
    expect(placesOf(DIGITS[1])).toEqual(["topRight", "bottomRight"]);
    expect(placesOf(DIGITS[4])).toEqual(["topRight", "bottomRight", "topLeft", "middle"]);
    expect(placesOf(DIGITS[7])).toEqual(["top", "topRight", "bottomRight"]);
    // 6 with its top, 9 with its bottom
    expect(placesOf(DIGITS[6])).toContain("top");
    expect(placesOf(DIGITS[9])).toContain("bottom");
    expect(new Set(DIGITS).size).toBe(10);
    DIGITS.forEach((lit, d) => expect(digitOf(lit)).toBe(d));
    // 2, 3 and 5 are five each: 325 is 15
    expect(digitsOf(325).reduce((n, d) => n + count(d), 0)).toBe(15);
    // and without them, no digits
    expect(digitOf(DIGITS[6] & ~(1 << 0))).toBeNull();
    expect(digitOf(DIGITS[9] & ~(1 << 3))).toBeNull();
  });

  it("read as an equation only when every place is a digit and no number of two digits or more starts with 0", () => {
    expect(holds(matches(300, true, 25, 325))).toBe(true);
    expect(holds(matches(350, false, 25, 325))).toBe(true);
    expect(holds(matches(308, false, 25, 325))).toBe(false);
    expect(readable(matches(308, false, 25, 325))).toBe(true);
    const zero = { ...matches(300, true, 25, 325), y: [DIGITS[0], ...digitsOf(25)] };
    expect(readable(zero)).toBe(false);
    expect(holds(zero)).toBe(false);
    // a lone 0 is a number
    expect(readable(matches(0, true, 325, 325))).toBe(true);
    const blot = { ...matches(300, true, 25, 325), x: [DIGITS[3], DIGITS[0], 0b0000001] };
    expect(readable(blot)).toBe(false);
    expect(writtenOf(blot)).toBe("30? + 25 = 325");
    expect(writtenOf(matches(300, false, 25, 325))).toBe("300 − 25 = 325");
  });
});

describe("火柴棒 325's moves", () => {
  it("take a match from any place of a digit, or the plus's upright, and put it in an empty place or on the minus", () => {
    const m = matches(308, false, 25, 325);
    // only the digits' places and the sign's upright: the equals and the sign's bar are no places
    const spots = spotsOf(m);
    expect(spots).toHaveLength(PLACES * 8 + 1);
    expect(spots.filter((s) => s.of === "sign")).toHaveLength(1);
    const moves = movesOf(m);
    const inside = matchesIn(m);
    expect(moves).toHaveLength(inside * (spots.length - inside));
    for (const mv of moves) {
      const after = moved(m, mv);
      // one match moved: as many in all, as many digits, the sign a plus or a minus
      expect(matchesIn(after)).toBe(inside);
      expect([after.x.length, after.y.length, after.z.length]).toEqual([3, 2, 3]);
      expect(typeof after.plus).toBe("boolean");
      expect(lit(after, mv.from)).toBe(false);
      expect(lit(after, mv.to)).toBe(true);
    }
    // the 8's middle on the minus: a plus
    const plus = moved(m, SPARE.answer);
    expect(writtenOf(plus)).toBe("300 + 25 = 325");
    // and the plus's upright taken off again: a minus
    expect(writtenOf(moved(plus, { from: { of: "sign" }, to: { of: "x", i: 2, place: 6 } }))).toBe("308 − 25 = 325");
  });

  it("are no moves from an empty place, to a lit one, or to where the match is", () => {
    const m = matches(308, false, 25, 325);
    expect(moved(m, { from: { of: "sign" }, to: { of: "x", i: 1, place: 6 } })).toBe(m);
    expect(moved(m, { from: { of: "x", i: 0, place: 0 }, to: { of: "x", i: 2, place: 6 } })).toBe(m);
    expect(moved(m, { from: { of: "z", i: 0, place: 0 }, to: { of: "z", i: 0, place: 0 } })).toBe(m);
    expect(sameSpot({ of: "sign" }, { of: "sign" })).toBe(true);
    expect(sameSpot({ of: "x", i: 0, place: 3 }, { of: "y", i: 0, place: 3 })).toBe(false);
  });
});

describe("火柴棒 325's equations", () => {
  it("deal the same equation for the same seed and others for others", () => {
    expect(matchPuzzle(mulberry32(7))).toEqual(matchPuzzle(mulberry32(7)));
    const shown = new Set(SEEDS.slice(0, 100).map((s) => writtenOf(matchPuzzle(mulberry32(s)).shown)));
    expect(shown.size).toBeGreaterThan(95);
  });

  it("each have one move only that makes them hold, which makes X ± Y = 325, for a thousand seeds and no spare", () => {
    let plus = 0;
    let longest = 0;
    for (const seed of SEEDS) {
      const p = matchPuzzle(mulberry32(seed));
      expect(p).not.toBe(SPARE);
      // as shown: reads as an equation, does not hold
      expect(readable(p.shown)).toBe(true);
      expect(holds(p.shown)).toBe(false);
      // the one move, a leading 0 and all, is the answer
      const fixes = fixesOf(p.shown);
      expect(fixes).toEqual([p.answer]);
      const right = moved(p.shown, p.answer);
      expect(right).toEqual(p.right);
      expect(holds(right)).toBe(true);
      expect(writtenOf(right)).toMatch(/^[1-9]\d{0,2} [+−] [1-9]\d{0,2} = 325$/);
      if (right.plus) plus++;
      longest = Math.max(longest, right.x.length + right.y.length);
    }
    // both signs, and numbers up to three digits
    expect(plus).toBeGreaterThan(400);
    expect(plus).toBeLessThan(600);
    expect(longest).toBe(6);
    expect(MATCH_GOAL).toBe(325);
  });

  it("fall back on 308 − 25 = 325, which the 8's middle on the minus alone makes hold", () => {
    expect(writtenOf(SPARE.shown)).toBe("308 − 25 = 325");
    expect(fixesOf(SPARE.shown)).toEqual([SPARE.answer]);
    expect(writtenOf(SPARE.right)).toBe("300 + 25 = 325");
    expect(moved(SPARE.shown, SPARE.answer)).toEqual(SPARE.right);
    // dealt once MATCH.tries goes have not kept one: here, none
    const tries = MATCH.tries;
    MATCH.tries = 0;
    try {
      expect(matchPuzzle(mulberry32(1))).toBe(SPARE);
    } finally {
      MATCH.tries = tries;
    }
    expect(matchPuzzle(mulberry32(1))).not.toBe(SPARE);
    expect(MATCH.tries).toBe(200);
  });

  it("show for 提示 the digit or the sign the match is taken from", () => {
    expect(cellOf(SPARE.answer.from)).toEqual({ of: "x", i: 2 });
    expect(cellOf({ of: "sign" })).toEqual({ of: "sign" });
    expect(MATCH.hintMs).toBe(60_000);
    expect(MATCH.answerMs).toBe(120_000);
    expect(MATCH.backMs).toBe(800);
  });
});
