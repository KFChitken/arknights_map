/**
 * 325 节拍 (src/components/app/study/Beat325.tsx): a lit ring steps along a row of slots in time, and the player taps
 * (anywhere, or Space) as it lands on each dot: three, a rest, two, a rest, five, two rests, a bar of fourteen slots,
 * each bar a little faster than the last. A bar is right with each of its ten beats tapped once, in time, and no other
 * tap in it. Eight bars right pass; three wrong end the round. Every slot's time is worked out when the round starts and
 * each tap is judged by when it was made, so a slow screen moves nothing. Nothing in it needs sound.
 */

/** A bar's slots, in order: 1 for a beat, 0 for a rest. Three, two and five beats */
export const BEAT_SLOTS = [1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0] as const;
/** The beats in a bar */
export const BEAT_BEATS = BEAT_SLOTS.filter((s) => s === 1).length;
/** Bars right that pass, and bars wrong that end the round: so a round has a result in ten bars at most */
export const BEAT_PASS = 8;
export const BEAT_FAILS = 3;
/** Counted in before the first bar, a slot each, at its speed: 3、2、5, not 3、2、1 */
export const BEAT_COUNT = [3, 2, 5] as const;
/** How long 预备 shows before the count (ms) */
export const BEAT_READY_MS = 800;

/** How long a slot of the nth bar is (ms, n from 0): 330, 10 less each bar, never under 230 */
export const slotMs = (n: number) => Math.max(230, 330 - 10 * n);
/** How far from its beat a tap may be and still hit it (ms) */
export const windowMs = (n: number) => Math.min(150, 0.45 * slotMs(n));

/** A bar as played: which of the round's it is (its speed), when it starts on performance.now()'s clock, its slot */
export type Bar = { n: number; start: number; slot: number };

/** When a bar's kth slot comes */
export const slotAt = (b: Bar, k: number) => b.start + k * b.slot;
/** When no tap can be a bar's any more: half a slot after its last */
export const barShut = (b: Bar) => b.start + (BEAT_SLOTS.length - 0.5) * b.slot;

/**
 * The count and the bars after it, from the nth bar on, started at a time: when each count shows, and each bar (as many
 * as could be needed)
 */
export function beatPlan(from: number, at: number): { count: number[]; bars: Bar[] } {
  const first = slotMs(from);
  const count = BEAT_COUNT.map((_, k) => at + k * first);
  const bars: Bar[] = [];
  let start = at + BEAT_COUNT.length * first;
  for (let n = from; n < from + BEAT_PASS + BEAT_FAILS; n++) {
    const slot = slotMs(n);
    bars.push({ n, start, slot });
    start += BEAT_SLOTS.length * slot;
  }
  return { count, bars };
}

/**
 * Where a tap falls: the bar and slot it is nearest to, and whether it hits that slot's beat; null for a tap before the
 * first bar (in the count) or after the last
 */
export function placeTap(bars: readonly Bar[], t: number): { i: number; k: number; hit: boolean } | null {
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const near = Math.round((t - b.start) / b.slot);
    if (near < 0 && i === 0) return null;
    // a few ms between one bar's last half slot and the next one's first, as they are not the same length
    const k = Math.max(0, near);
    if (k >= BEAT_SLOTS.length) continue;
    return { i, k, hit: BEAT_SLOTS[k] === 1 && Math.abs(t - slotAt(b, k)) <= windowMs(b.n) };
  }
  return null;
}

/** The taps a bar was given, slot by slot: those that hit its beat, and the others */
export type BarTaps = { hits: number[]; strays: number[] };
export const noTaps = (): BarTaps => ({ hits: BEAT_SLOTS.map(() => 0), strays: BEAT_SLOTS.map(() => 0) });

/** A bar with one more tap at its kth slot */
export function tapped(b: BarTaps, k: number, hit: boolean): BarTaps {
  const add = (xs: number[]) => xs.map((x, j) => (j === k ? x + 1 : x));
  return hit ? { hits: add(b.hits), strays: b.strays } : { hits: b.hits, strays: add(b.strays) };
}

/** Each beat hit once, and no other tap */
export const barRight = (b: BarTaps) => BEAT_SLOTS.every((s, k) => (s ? b.hits[k] === 1 : true)) && b.strays.every((n) => n === 0);

/** Bars right and wrong so far */
export type Score = { right: number; wrong: number };
export const SCORE_START: Score = { right: 0, wrong: 0 };

/** A bar over: the score after it, and whether that passed (pass) or ended (out) the round */
export function scored(s: Score, right: boolean): { score: Score; end: "pass" | "out" | null } {
  const score = right ? { right: s.right + 1, wrong: s.wrong } : { right: s.right, wrong: s.wrong + 1 };
  return { score, end: score.right >= BEAT_PASS ? "pass" : score.wrong >= BEAT_FAILS ? "out" : null };
}
