/**
 * 心算快打 (src/components/app/study/Mental325.tsx): sums come one at a time, and for each the player says whether it
 * makes 325 or not, against a clock that gives a little less time for each. Ten right in a row pass; three wrong end the
 * round, a sum left until its time ran out counting as wrong. The day's sums are the same for everyone who plays it that
 * day (rules.ts dayRandom): half of them make 325, written as a product, a sum, a difference, a quotient, a square and a
 * bit more, two squares, or a product and a bit more or less; the other half are written the same ways but make a
 * number near 325, or 325's digits in another order. Whether a sum makes 325 is worked out from what it shows.
 */

/** Right answers in a row that pass */
export const MENTAL_STREAK = 10;
/** Wrong answers that end the round */
export const MENTAL_WRONGS = 3;
/** The day's sums: more than a round can ask (at most 30: 9 right and one wrong, three times) */
export const MENTAL_COUNT = 60;

/** How long the nth sum of a round may be answered in (ms, n from 1): 6 seconds, 0.2 less for each, never under 3 */
export const mentalMs = (n: number) => Math.max(3000, 6000 - 200 * (n - 1));

/** The ways a sum is written: a × b, a + b, a − b, a ÷ b, a² + b, a² + b², a × b + c or a × b − c */
export const MENTAL_FORMS = ["mul", "add", "sub", "div", "sqAdd", "sqSq", "mulMix"] as const;
export type MentalForm = (typeof MENTAL_FORMS)[number];

/** What the sums that do not make 325 make: a little off, or the same digits in another order */
export const MENTAL_NEAR = [324, 326, 315, 335, 225, 425] as const;
export const MENTAL_SHUFFLED = [235, 253, 352, 523, 532] as const;
/** 325 as two squares, every way there is */
export const MENTAL_SQUARES = [
  [1, 18],
  [6, 17],
  [10, 15],
] as const;
/** The most a − b starts from */
const MAX_MINUEND = 999;

/** A sum as it shows (13 × 25, 18² + 1), how it is written, and whether it was put there to make 325 */
export type Sum = { text: string; form: MentalForm; is325: boolean };

type Int = (lo: number, hi: number) => number;

/**
 * What a sum shows comes to, with × and ÷ before + and −: NaN for one that is not written as the day's are written, or
 * that divides unevenly
 */
export function valueOf(text: string): number {
  const parts = text.split(" ");
  if (parts.length % 2 === 0) return NaN;
  let total = 0;
  let sign = 1;
  let term = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const m = /^(\d{1,4})(²?)$/.exec(parts[i]);
    if (!m) return NaN;
    const x = m[2] ? Number(m[1]) ** 2 : Number(m[1]);
    const op = i === 0 ? "+" : parts[i - 1];
    if (op === "×") term *= x;
    else if (op === "÷") {
      if (x === 0 || term % x !== 0) return NaN;
      term /= x;
    } else if (op === "+" || op === "−") {
      total += sign * term;
      sign = op === "+" ? 1 : -1;
      term = x;
    } else return NaN;
  }
  return total + sign * term;
}

/** A sum of a form that makes t, or null for a form that cannot (a prime as a product) */
function write(form: Exclude<MentalForm, "sqSq">, t: number, int: Int): string | null {
  switch (form) {
    case "mul": {
      const pairs: [number, number][] = [];
      for (let a = 2; a * a <= t; a++) if (t % a === 0) pairs.push([a, t / a]);
      if (!pairs.length) return null;
      const [a, b] = pairs[int(0, pairs.length - 1)];
      return int(0, 1) ? `${a} × ${b}` : `${b} × ${a}`;
    }
    case "add": {
      const a = int(Math.ceil(t * 0.15), Math.floor(t * 0.85));
      return `${a} + ${t - a}`;
    }
    case "sub": {
      const b = int(11, MAX_MINUEND - t);
      return `${t + b} − ${b}`;
    }
    case "div": {
      const b = int(2, 9);
      return `${t * b} ÷ ${b}`;
    }
    case "sqAdd": {
      const top = Math.min(18, Math.floor(Math.sqrt(t - 1)));
      if (top < 10) return null;
      const a = int(10, top);
      return `${a}² + ${t - a * a}`;
    }
    case "mulMix": {
      // a little under t from a × b, the rest added; or a little over, the rest taken away
      const a = int(2, 9);
      const q = Math.floor(t / a);
      if (int(0, 1)) {
        const b = int(Math.max(2, q - 9), t % a ? q : q - 1);
        return `${a} × ${b} + ${t - a * b}`;
      }
      const b = int(q + 1, q + 9);
      return `${a} × ${b} − ${a * b - t}`;
    }
  }
}

/** Two squares: one of 325's three, or one of them with a number one off (10² + 14²) */
function squares(is325: boolean, int: Int): string {
  let [a, b]: number[] = [...MENTAL_SQUARES[int(0, MENTAL_SQUARES.length - 1)]];
  if (!is325) {
    const i = int(0, 1);
    const off = [a, b][i] === 1 ? 1 : int(0, 1) ? 1 : -1;
    if (i) b += off;
    else a += off;
  }
  return int(0, 1) ? `${a}² + ${b}²` : `${b}² + ${a}²`;
}

/** A sum as far as telling it from another goes: 25 × 13 is 13 × 25 again, and 6² + 17² is 17² + 6² */
export function sumKey(s: Pick<Sum, "text" | "form">): string {
  if (s.form !== "mul" && s.form !== "add" && s.form !== "sqSq") return s.text;
  const parts = s.text.split(" ");
  return [parts[0], parts[2]].sort().join(` ${parts[1]} `);
}

/**
 * The day's sums, from its random (rules.ts dayRandom): in each ten, five make 325. No sum comes twice in a day, not
 * even the other way round, and no way of writing them three times running.
 */
export function mentalSums(random: () => number): Sum[] {
  const int: Int = (lo, hi) => lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
  const others = [...MENTAL_NEAR, ...MENTAL_SHUFFLED];
  const meant: boolean[] = [];
  while (meant.length < MENTAL_COUNT) {
    const ten = [...Array(10)].map((_, i) => i < 5);
    for (let i = ten.length - 1; i > 0; i--) {
      const j = int(0, i);
      [ten[i], ten[j]] = [ten[j], ten[i]];
    }
    meant.push(...ten);
  }
  const out: Sum[] = [];
  const seen = new Set<string>();
  for (const is325 of meant) {
    const n = out.length;
    const tired = n >= 2 && out[n - 1].form === out[n - 2].form ? out[n - 1].form : null;
    const forms = MENTAL_FORMS.filter((f) => f !== tired);
    let sum: Sum | null = null;
    // a fresh one; in the end (never so far) any but the last
    for (let tries = 0; !sum; tries++) {
      const form = forms[int(0, forms.length - 1)];
      const text = form === "sqSq" ? squares(is325, int) : write(form, is325 ? 325 : others[int(0, others.length - 1)], int);
      if (text && (tries < 200 ? !seen.has(sumKey({ text, form })) : text !== out[n - 1]?.text)) sum = { text, form, is325 };
    }
    seen.add(sumKey(sum));
    out.push(sum);
  }
  return out;
}

/** Where a round is: right answers in a row now, the most in a row so far, and wrong answers */
export type Tally = { streak: number; best: number; wrongs: number };
export const TALLY_START: Tally = { streak: 0, best: 0, wrongs: 0 };

/** A sum answered, right or wrong: the tally after it, and whether that passed (pass) or ended (out) the round */
export function answered(t: Tally, right: boolean): { tally: Tally; end: "pass" | "out" | null } {
  if (right) {
    const streak = t.streak + 1;
    return { tally: { streak, best: Math.max(t.best, streak), wrongs: t.wrongs }, end: streak >= MENTAL_STREAK ? "pass" : null };
  }
  const wrongs = t.wrongs + 1;
  return { tally: { streak: 0, best: t.best, wrongs }, end: wrongs >= MENTAL_WRONGS ? "out" : null };
}
