/**
 * 3、2、5 反应 (src/components/app/study/React325.tsx): digits from 0 to 9 come up one at a time in a box, a little
 * faster as they go. When 3, 2 and 5 come up in a row, a tap while that 5 shows is a hit; a tap at any other digit is a
 * slip. Five hits pass; three slips end the round, and so does the stream running out. The stream is the day's, the same
 * for everyone who plays it that day (rules.ts dayRandom), with digits in it meant to fool the hand: 3、2、4, 3、5, 2、5.
 */

/** Hits that pass */
export const REACT_HITS = 5;
/** Slips that end the round */
export const REACT_SLIPS = 3;
/** The 3、2、5s in a stream */
export const REACT_TARGETS = 8;
/** How long the first digit shows, and the last, in ms: each one a little shorter than the one before */
export const REACT_FIRST_MS = 600;
export const REACT_LAST_MS = 400;
/** The countdown before the stream: 3, 2, 5, each this long (ms); a tap in it counts for nothing */
export const REACT_COUNTDOWN = [3, 2, 5] as const;
export const REACT_COUNT_MS = 700;
/**
 * A tap this soon after a 5 of 3、2、5 gave way to the next digit still hits it (ms): the screen shows each change a
 * little after it is made, and a hand that saw the 5 takes a moment to land
 */
export const REACT_GRACE_MS = 120;

/** What comes up to fool the hand: 3 and 2 not followed by 5, a 5 after only one of them, or the three backwards */
export const REACT_DECOYS = [
  [3, 2, 4],
  [3, 2, 6],
  [3, 5],
  [2, 5],
  [5, 2, 3],
] as const;

/** Whether the digit at i is the 5 of a 3、2、5 */
export const isTarget = (s: readonly number[], i: number) => i >= 2 && s[i] === 5 && s[i - 1] === 2 && s[i - 2] === 3;

/** How many 3、2、5s a stream has */
export const countTargets = (s: readonly number[]) => s.reduce((n, _, i) => n + (isTarget(s, i) ? 1 : 0), 0);

/**
 * The stream of the day, from its random (rules.ts dayRandom): a few digits to warm up, then 3、2、5s with a digit or
 * two between, most of them with something meant to fool the hand before them. No digit comes twice in a row (the box
 * would show no change), and no 3、2、5 comes up but those put there.
 */
export function reactStream(random: () => number): number[] {
  return fill(plan(random), random);
}

type Slot = number | null;

/** The digits put there on purpose, with null for each digit to choose around them */
function plan(random: () => number): Slot[] {
  const int = (n: number) => Math.floor(random() * n);
  const out: Slot[] = [];
  const free = (n: number) => {
    for (let i = 0; i < n; i++) out.push(null);
  };
  // which of the gaps before a 3、2、5 have a decoy in them (all but two), and which, every kind once before any twice
  const gaps = shuffle([...Array(REACT_TARGETS).keys()], random).slice(0, REACT_TARGETS - 2);
  const kinds = shuffle([...REACT_DECOYS.keys()], random);
  let k = 0;
  free(4 + int(2));
  for (let t = 0; t < REACT_TARGETS; t++) {
    free(1 + int(2));
    if (gaps.includes(t)) {
      out.push(...REACT_DECOYS[kinds[k++ % kinds.length]]);
      free(1 + int(2));
    }
    out.push(3, 2, 5);
  }
  free(2 + int(2));
  return out;
}

/** The digits chosen between those put there: no 3 or 5, so that every 3 and 5 is one put there on purpose */
const FILLERS = [0, 1, 2, 4, 6, 7, 8, 9];

/**
 * Each digit to choose: none like the one before or after it (the box would show no change), and none that makes a
 * 3、2、5 not put there. That rules out three of the eight at most, so there is always one.
 */
function fill(slots: Slot[], random: () => number): number[] {
  const s = [...slots];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== null) continue;
    const ok = FILLERS.filter((d) => {
      if (d === s[i - 1] || d === s[i + 1]) return false;
      const at = (j: number) => (j === i ? d : s[j]);
      // every run of three this digit would be part of
      for (let j = i - 2; j <= i; j++) if (j >= 0 && at(j) === 3 && at(j + 1) === 2 && at(j + 2) === 5) return false;
      return true;
    });
    s[i] = ok[Math.min(ok.length - 1, Math.floor(random() * ok.length))];
  }
  return s as number[];
}

function shuffle<T>(a: T[], random: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** When each digit is due to come up, in ms from the first, and at the end when the last one goes */
export function reactTimes(length: number): number[] {
  const at = [0];
  for (let i = 0; i < length; i++) at.push(at[i] + Math.round(REACT_FIRST_MS - ((REACT_FIRST_MS - REACT_LAST_MS) * i) / Math.max(1, length - 1)));
  return at;
}

/** What a tap did: hit the 5 of a 3、2、5 (which one), slipped, or nothing (before the first digit, or the 5 hit again) */
export type Tap = { hit: number } | "slip" | null;

/**
 * A tap at a moment (ms, on the clock shown is on): shown holds when each digit came up, as far as it has, and hits the
 * 5s already hit
 */
export function judgeTap(s: readonly number[], shown: readonly number[], hits: ReadonlySet<number>, at: number): Tap {
  let i = shown.length - 1;
  while (i >= 0 && shown[i] > at) i--;
  if (i < 0) return null;
  if (isTarget(s, i)) return hits.has(i) ? null : { hit: i };
  // just after a 5 gave way
  if (i > 0 && isTarget(s, i - 1) && at - shown[i] < REACT_GRACE_MS) return hits.has(i - 1) ? null : { hit: i - 1 };
  return "slip";
}
