/**
 * 火柴棒 325 (src/components/app/study/Match325.tsx): an equation laid in matches, X + Y = Z or X − Y = Z, its digits
 * as a digital clock shows them, that does not hold. One match moved makes it hold, as X ± Y = 325, and no other one
 * match moved does. A match may be taken from any place of a digit, or the plus's upright (which leaves a minus), and
 * put in any empty place of a digit, or on the minus as its upright (which makes a plus); the equals and the signs' bar
 * stay where they are, and so does how many digits each number has. No clock: after MATCH.hintMs 提示 shows where the
 * match is taken from, and after MATCH.answerMs 看答案 shows the move, which ends the round unsolved.
 *
 * A round's equation is dealt from its random: a true X ± Y = 325 (X and Y one to three digits, neither starting with
 * 0), one match of it moved at random into an equation that does not hold, every place of which is a digit and none of
 * whose numbers of two digits or more starts with 0; kept only if, of every equation one match from it, the true one is
 * the only one that holds, as numbers, a leading 0 and all. Of the 34,817 such moves from the 998 true equations, 25,417
 * keep (73%): a round mostly deals one on its first or second go, and after MATCH.tries the spare one, SPARE.
 *
 * Everything here is pure.
 */

/** How it plays, all in one place: after Breeze has played it, only these change */
export const MATCH = {
  /** How long the page is in sight before 提示 is offered, and 看答案 (ms) */
  hintMs: 60_000,
  answerMs: 120_000,
  /** How long a move that does not make it hold stays before its match goes back (ms) */
  backMs: 800,
  /** Equations dealt at most before the spare one */
  tries: 200,
};

/** What the true equation always comes to */
export const MATCH_GOAL = 325;

/**
 * A digit's places, in order: top, top right, bottom right, bottom, bottom left, top left, middle. Each digit is the
 * places lit, a bit for each (bit k for place k), as a digital clock shows it: 0 six, 1 two (at the right), 2, 3 and 5
 * five, 4 four, 6 six (with the top), 7 three, 8 seven, 9 six (with the bottom)
 */
export const PLACES = 7;
export const DIGITS: readonly number[] = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];
const DIGIT_OF = new Map(DIGITS.map((m, d) => [m, d]));

/** The numbers of an equation, by where they stand: X ± Y = Z */
export type Part = "x" | "y" | "z";
export const PARTS: readonly Part[] = ["x", "y", "z"];

/** An equation of matches: each number's digits, each as the places lit (DIGITS), and whether its sign is a plus */
export type Matches = { x: readonly number[]; plus: boolean; y: readonly number[]; z: readonly number[] };

/** A place a match can be in: one of a digit's (which number, which of its digits from the left, which place), or the sign's upright */
export type Spot = { of: Part; i: number; place: number } | { of: "sign" };

/** A match moved: where it is taken from, where it is put */
export type Move = { from: Spot; to: Spot };

/** A number's digits, as matches */
export const digitsOf = (n: number): number[] => String(n).split("").map((c) => DIGITS[+c]);

/** An equation of matches, as numbers */
export const matches = (x: number, plus: boolean, y: number, z: number): Matches => ({ x: digitsOf(x), plus, y: digitsOf(y), z: digitsOf(z) });

/** The digit some places make, or null where they are not one */
export const digitOf = (lit: number): number | null => DIGIT_OF.get(lit) ?? null;

/** What digits make as a number, or null where one of them is not a digit */
function numberOf(digits: readonly number[]): number | null {
  let n = 0;
  for (const lit of digits) {
    const d = digitOf(lit);
    if (d === null) return null;
    n = n * 10 + d;
  }
  return n;
}

const leadingZero = (digits: readonly number[]) => digits.length > 1 && digits[0] === DIGITS[0];

/** Whether an equation reads as one: every place a digit, and no number of two digits or more starting with 0 */
export function readable(m: Matches): boolean {
  return PARTS.every((p) => numberOf(m[p]) !== null && !leadingZero(m[p]));
}

/** Whether an equation's numbers make it true, a leading 0 or not */
function trueAsNumbers(m: Matches): boolean {
  const [x, y, z] = PARTS.map((p) => numberOf(m[p]));
  return x !== null && y !== null && z !== null && (m.plus ? x + y : x - y) === z;
}

/** Whether an equation holds: it reads as one, and is true */
export const holds = (m: Matches): boolean => readable(m) && trueAsNumbers(m);

/** Every place a match can be in, from the left: each digit's, and the sign's upright between X and Y */
export function spotsOf(m: Matches): Spot[] {
  const out: Spot[] = [];
  const digits = (of: Part) => m[of].forEach((_, i) => { for (let place = 0; place < PLACES; place++) out.push({ of, i, place }); });
  digits("x");
  out.push({ of: "sign" });
  digits("y");
  digits("z");
  return out;
}

/** Whether a match is in a place */
export const lit = (m: Matches, s: Spot): boolean => (s.of === "sign" ? m.plus : (m[s.of][s.i] & (1 << s.place)) !== 0);

export const sameSpot = (a: Spot, b: Spot): boolean => a.of === b.of && (a.of === "sign" || (b.of !== "sign" && a.i === b.i && a.place === b.place));

/** A place's match taken away, or one put there */
function flip(m: Matches, s: Spot): Matches {
  if (s.of === "sign") return { ...m, plus: !m.plus };
  const digits = m[s.of].slice();
  digits[s.i] ^= 1 << s.place;
  return { ...m, [s.of]: digits };
}

/** An equation after a match is moved; the same one when the move is not one (from an empty place, or to a lit one) */
export const moved = (m: Matches, mv: Move): Matches =>
  lit(m, mv.from) && !lit(m, mv.to) && !sameSpot(mv.from, mv.to) ? flip(flip(m, mv.from), mv.to) : m;

/** Every move of one match an equation has: from each lit place to each empty one */
export function movesOf(m: Matches): Move[] {
  const spots = spotsOf(m);
  const out: Move[] = [];
  for (const from of spots) if (lit(m, from)) for (const to of spots) if (!lit(m, to)) out.push({ from, to });
  return out;
}

/** The moves of one match after which an equation is true, as numbers: a leading 0 or not */
export const fixesOf = (m: Matches): Move[] => movesOf(m).filter((mv) => trueAsNumbers(moved(m, mv)));

/** A round's equation: as shown, the move that makes it hold, and what it is then */
export type Puzzle = { shown: Matches; answer: Move; right: Matches };

/** The spare equation, 308 − 25 = 325: the 8's middle on the minus, 300 + 25 = 325, and nothing else */
export const SPARE: Puzzle = {
  shown: matches(308, false, 25, 325),
  answer: { from: { of: "x", i: 2, place: 6 }, to: { of: "sign" } },
  right: matches(300, true, 25, 325),
};

/** A true X + Y = 325 or X − Y = 325, from a random: X and Y whole numbers above nought, of three digits at most */
function trueEquation(random: () => number): Matches {
  const pick = (lo: number, hi: number) => lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
  if (random() < 0.5) {
    const x = pick(1, MATCH_GOAL - 1);
    return matches(x, true, MATCH_GOAL - x, MATCH_GOAL);
  }
  const y = pick(1, 999 - MATCH_GOAL);
  return matches(MATCH_GOAL + y, false, y, MATCH_GOAL);
}

/** A round's equation, from its random (mulberry32 of its seed), as the top of this file says */
export function matchPuzzle(random: () => number): Puzzle {
  for (let k = 0; k < MATCH.tries; k++) {
    const right = trueEquation(random);
    const wrong = movesOf(right).filter((mv) => {
      const after = moved(right, mv);
      return readable(after) && !trueAsNumbers(after);
    });
    const mv = wrong[Math.min(wrong.length - 1, Math.floor(random() * wrong.length))];
    if (!mv) continue;
    const shown = moved(right, mv);
    const fixes = fixesOf(shown);
    // the only one is the move back
    if (fixes.length === 1) return { shown, answer: fixes[0], right };
  }
  return SPARE;
}

/** Which digit, or the sign, a place is part of: 提示 shows it */
export const cellOf = (s: Spot): { of: Part; i: number } | { of: "sign" } => (s.of === "sign" ? s : { of: s.of, i: s.i });

/** An equation as it is written, a place that is no digit as ?: 300 + 25 = 325 */
export function writtenOf(m: Matches): string {
  const n = (digits: readonly number[]) => digits.map((lit) => digitOf(lit) ?? "?").join("");
  return `${n(m.x)} ${m.plus ? "+" : "−"} ${n(m.y)} = ${n(m.z)}`;
}
