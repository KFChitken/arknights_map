/**
 * 3、2、5 反应 (src/components/app/study/React325.tsx): digits from 0 to 9 come up one at a time in a box, a little
 * faster as they go, and the player taps them out in order: 3, 2, 5, 7, 9, 9. A tap while the digit wanted next shows
 * fills its place; a tap while another shows is a slip. Each digit shown takes one tap at most, so the two 9s want 9 to
 * come up twice. All six filled passes; three slips end the round, and so do the digits running out. The digits are
 * dealt as they come up, from the round's own seed (rules.ts newSeed): the one wanted next comes up now and then, never
 * more than a few apart.
 */

/** What is tapped out, in order */
export const REACT_CODE = [3, 2, 5, 7, 9, 9] as const;
/** Slips that end the round */
export const REACT_SLIPS = 3;
/** The most digits a round shows */
export const REACT_MAX = 60;
/** How long the first digit shows, and the last, in ms: each one a little shorter than the one before */
export const REACT_FIRST_MS = 480;
export const REACT_LAST_MS = 320;
/** How likely a digit is the one wanted next, when it may be */
export const REACT_WANT_CHANCE = 0.3;
/** The most other digits between two of the one wanted next: then it comes up */
export const REACT_WANT_GAP = 6;
/** The countdown before the digits: 3, 2, 5, each this long (ms); a tap in it counts for nothing */
export const REACT_COUNTDOWN = [3, 2, 5] as const;
export const REACT_COUNT_MS = 700;
/**
 * A tap this soon after the digit wanted gave way to the next still fills its place (ms): the screen shows each change a
 * little after it is made, and a hand that saw it takes a moment to land
 */
export const REACT_GRACE_MS = 120;

/** How long the digit at i shows (ms): from REACT_FIRST_MS to REACT_LAST_MS over the round, never shorter */
export const digitMs = (i: number) =>
  Math.max(REACT_LAST_MS, Math.round(REACT_FIRST_MS - ((REACT_FIRST_MS - REACT_LAST_MS) * i) / (REACT_MAX - 1)));

/** When each digit is due to come up, in ms from the first, and at the end when the last one goes */
export function reactTimes(length = REACT_MAX): number[] {
  const at = [0];
  for (let i = 0; i < length; i++) at.push(at[i] + digitMs(i));
  return at;
}

/**
 * A round's dealer, from its random (mulberry32 of its seed): asked for the next digit with the one wanted now, it deals
 * that one about one time in three, and surely once REACT_WANT_GAP others came up since it last did or since it was
 * wanted; otherwise any other. Never the same digit twice in a row (the box would show no change).
 */
export function reactDealer(random: () => number): (want: number) => number {
  let prev: number | null = null;
  let wanted: number | null = null;
  /** Digits other than the one wanted since it last came up, or since it was wanted */
  let others = 0;
  return (want) => {
    if (want !== wanted) {
      wanted = want;
      others = 0;
    }
    const d = prev !== want && (others >= REACT_WANT_GAP || random() < REACT_WANT_CHANCE) ? want : other(random, prev, want);
    others = d === want ? 0 : others + 1;
    prev = d;
    return d;
  };
}

/** Any digit but the one before and the one wanted */
function other(random: () => number, prev: number | null, want: number): number {
  const ok = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => d !== prev && d !== want);
  return ok[Math.min(ok.length - 1, Math.floor(random() * ok.length))];
}

/** What a tap did: filled the next place with the digit at i, slipped at the digit at i, or nothing */
export type Tap = { fill: number } | { slip: number } | null;

/**
 * A tap at a moment (at, ms, on the clock shown is on): digits are those dealt so far and shown when each came up;
 * used, the digits a tap already counted for (each takes one); want, the digit wanted next. A tap before the first digit, or a
 * second one at a digit, is nothing; so is one a hair after the digit before gave way, once that one took a tap.
 */
export function judgeTap(digits: readonly number[], shown: readonly number[], used: ReadonlySet<number>, at: number, want: number): Tap {
  let i = shown.length - 1;
  while (i >= 0 && shown[i] > at) i--;
  if (i < 0) return null;
  if (digits[i] === want && !used.has(i)) return { fill: i };
  // just after a digit gave way: the hand meant that one
  if (i > 0 && at - shown[i] < REACT_GRACE_MS) {
    if (used.has(i - 1)) return null;
    if (digits[i - 1] === want) return { fill: i - 1 };
  }
  return used.has(i) ? null : { slip: i };
}
