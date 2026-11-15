/**
 * 叠罗汉 (src/components/app/study/Stack325.tsx): rows of roaches stacked one on another, each row one fewer than the
 * one under it. The bottom row of STACK.rows is laid; the one over it crawls left and right, half a roach a step, out
 * to STACK.reach roaches past either end of the row under it, and drops at a tap. Of a row dropped, a roach whose middle
 * is over the row under stays; the others, a roach whose middle is over the very end of the row under among them, fall
 * off. The next row has as many as it plans (24, 23, … 1), or as stayed in the row under if fewer, so one that lost
 * roaches makes the rows over it shorter, and harder to keep whole. A row of which none stays ends the round; the top
 * row (one roach) stayed passes it, with as many roaches as stayed in all: 325 with none fallen (命运的 325).
 *
 * Places are in half roach widths from the bottom row's left end. Everything here is pure.
 */

/** How it plays, all in one place: after Breeze has played it, only these change */
export const STACK = {
  /** Rows in all, the bottom one laid; it has as many roaches as there are rows, each row over it one fewer */
  rows: 25,
  /** How far a row crawls out past either end of the row under it (roach widths) */
  reach: 3,
  /** Steps a second (a step is half a roach width): the second row's, and the top one's; those between in proportion */
  stepsPerSec: [6, 16] as const,
  /** How long the next row waits at its end before it crawls, after a drop (ms) */
  settleMs: 350,
};

/** All the roaches a whole stack has: 1 + 2 + … + 25 */
export const STACK_GOAL = 325;

/** A row: where its left end is (half roach widths from the bottom row's left end) and how many roaches are in it */
export type Row = { left: number; n: number };

/** The bottom row, laid before the round */
export const BOTTOM: Row = { left: 0, n: STACK.rows };

/** How many roaches the row k (0 the bottom one) plans: 25, 24, … 1 */
export const planned = (k: number) => STACK.rows - k;

/** How many roaches the row k has, over a row under it: as many as it plans, or as are in the row under if fewer */
export const countOf = (k: number, under: Row) => Math.min(planned(k), under.n);

/** Steps a second of the row k (1 the second row, STACK.rows − 1 the top one) */
export const speedOf = (k: number) => {
  const [first, last] = STACK.stepsPerSec;
  return first + ((last - first) * (k - 1)) / (STACK.rows - 2);
};

/** The left ends a row of n crawls between over a row under it: out to STACK.reach roaches past either end of it */
export const rangeOf = (under: Row, n: number) => ({ from: under.left - 2 * STACK.reach, to: under.left + 2 * under.n + 2 * STACK.reach - 2 * n });

/** Where a row's left end is after so many steps from an end of its range, heading in: there and back, and again */
export function crawl(range: { from: number; to: number }, fromRight: boolean, steps: number): number {
  const span = range.to - range.from;
  if (span <= 0) return range.from;
  const m = Math.floor(steps) % (2 * span);
  const off = m <= span ? m : 2 * span - m;
  return fromRight ? range.to - off : range.from + off;
}

/**
 * A row dropped with its left end at left over a row under it: the roaches whose middles are over the row under stay
 * (a middle over its very end is not), the rest fall. Gives the row as it stays (n 0 when none does) and which fell
 * (by their place in the row, from the left)
 */
export function dropRow(under: Row, row: Row): { stays: Row; fell: number[] } {
  const stay: number[] = [];
  const fell: number[] = [];
  for (let i = 0; i < row.n; i++) {
    const middle = row.left + 2 * i + 1;
    (middle > under.left && middle < under.left + 2 * under.n ? stay : fell).push(i);
  }
  return { stays: { left: stay.length ? row.left + 2 * stay[0] : row.left, n: stay.length }, fell };
}

/** A round: the rows that stayed, the bottom one first; how many roaches stayed in all; and how it ended, if it has */
export type Stack = { rows: Row[]; kept: number; end: "won" | "lost" | null };

export const stackStart = (): Stack => ({ rows: [BOTTOM], kept: BOTTOM.n, end: null });

/** The row crawling now: which it is (from 0 at the bottom), how many roaches it has, and the range it crawls in */
export function crawling(s: Stack): { k: number; n: number; range: { from: number; to: number } } {
  const under = s.rows[s.rows.length - 1];
  const k = s.rows.length;
  const n = countOf(k, under);
  return { k, n, range: rangeOf(under, n) };
}

/** Where the crawling row's left end is, ms after it set off from its end (the right one or not) */
export function crawlingAt(s: Stack, fromRight: boolean, ms: number): number {
  const { k, range } = crawling(s);
  return crawl(range, fromRight, (Math.max(0, ms) * speedOf(k)) / 1000);
}

/** The crawling row dropped with its left end at left: the round after, and which of its roaches fell */
export function placed(s: Stack, left: number): { stack: Stack; fell: number[]; row: Row } {
  if (s.end) return { stack: s, fell: [], row: { left, n: 0 } };
  const { k, n } = crawling(s);
  const row = { left, n };
  const { stays, fell } = dropRow(s.rows[s.rows.length - 1], row);
  if (!stays.n) return { stack: { ...s, end: "lost" }, fell, row };
  const rows = [...s.rows, stays];
  return { stack: { rows, kept: s.kept + stays.n, end: k === STACK.rows - 1 ? "won" : null }, fell, row };
}

/** Whether a round came to 命运的 325: passed with none fallen */
export const fate = (s: Stack) => s.end === "won" && s.kept === STACK_GOAL;

/** Which end each row over the bottom one sets off from, dealt from a round's random (mulberry32 of its seed): the right or not */
export const startsOf = (random: () => number): boolean[] => Array.from({ length: STACK.rows }, () => random() < 0.5);
