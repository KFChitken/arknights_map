import { describe, expect, it } from "vitest";
import {
  type Bar,
  BEAT_BEATS,
  BEAT_COUNT,
  BEAT_FAILS,
  BEAT_PASS,
  BEAT_SLOTS,
  type BarTaps,
  barRight,
  barShut,
  beatPlan,
  noTaps,
  placeTap,
  SCORE_START,
  type Score,
  scored,
  slotAt,
  slotMs,
  tapped,
  windowMs,
} from "./beat325";

/** The slots of a bar that are beats */
const BEATS = BEAT_SLOTS.flatMap((s, k) => (s ? [k] : []));

/** Taps at these times on a plan's bars, as the game takes them: the taps each bar was given */
function tapAll(bars: readonly Bar[], times: number[]): BarTaps[] {
  const taps = bars.map(noTaps);
  for (const t of times) {
    const p = placeTap(bars, t);
    if (p) taps[p.i] = tapped(taps[p.i], p.k, p.hit);
  }
  return taps;
}

/** Each beat of a bar tapped this far off it (ms) */
const onBeats = (b: Bar, off = 0) => BEATS.map((k) => slotAt(b, k) + off);

/** Bars one after another from the start of a round: how the last one left it */
function play(bars: boolean[]) {
  let score: Score = SCORE_START;
  let end: "pass" | "out" | null = null;
  for (const right of bars) ({ score, end } = scored(score, right));
  return { score, end };
}

describe("325 节拍", () => {
  it("is three beats, a rest, two, a rest, five and two rests a bar, each bar faster, never under 230 ms a slot", () => {
    expect(BEAT_SLOTS).toHaveLength(14);
    expect(BEAT_BEATS).toBe(10);
    expect(BEAT_SLOTS.join("")).toBe("11101101111100");
    expect(slotMs(0)).toBe(330);
    expect(slotMs(1)).toBe(320);
    for (let n = 1; n < 30; n++) expect(slotMs(n)).toBeLessThanOrEqual(slotMs(n - 1));
    expect(slotMs(9)).toBe(240);
    expect(slotMs(10)).toBe(230);
    expect(slotMs(29)).toBe(230);
    expect(windowMs(0)).toBe(148.5);
    expect(windowMs(10)).toBeCloseTo(103.5);
  });

  it("counts 3、2、5 a slot apart at the first bar's speed, and the bars follow on without a gap", () => {
    const { count, bars } = beatPlan(0, 1000);
    expect(BEAT_COUNT).toEqual([3, 2, 5]);
    expect(count).toEqual([1000, 1330, 1660]);
    expect(bars[0]).toEqual({ n: 0, start: 1990, slot: 330 });
    expect(bars[1]).toEqual({ n: 1, start: 1990 + 14 * 330, slot: 320 });
    // enough bars for any round
    expect(bars.length).toBeGreaterThanOrEqual(BEAT_PASS + BEAT_FAILS - 1);
    for (let i = 1; i < bars.length; i++) expect(bars[i].start).toBe(bars[i - 1].start + 14 * bars[i - 1].slot);
    // back from a page put away: the count again, at the speed of the bar it goes on from
    const back = beatPlan(4, 0);
    expect(back.count).toEqual([0, 290, 580]);
    expect(back.bars[0]).toEqual({ n: 4, start: 870, slot: 290 });
  });

  it("hits a beat up to its window off, either way, and not a millisecond more", () => {
    const { bars } = beatPlan(0, 0);
    const b = bars[0];
    const at = slotAt(b, 4);
    const w = windowMs(0);
    expect(placeTap(bars, at)).toEqual({ i: 0, k: 4, hit: true });
    expect(placeTap(bars, at - w)).toEqual({ i: 0, k: 4, hit: true });
    expect(placeTap(bars, at + w)).toEqual({ i: 0, k: 4, hit: true });
    expect(placeTap(bars, at + w + 1)).toEqual({ i: 0, k: 4, hit: false });
    expect(placeTap(bars, at - w - 1)).toEqual({ i: 0, k: 4, hit: false });
    // a rest is never hit
    expect(placeTap(bars, slotAt(b, 3))).toEqual({ i: 0, k: 3, hit: false });
    // a tap in the count counts for nothing; one just before the first beat is early, and hits it
    expect(placeTap(bars, b.start - 200)).toBeNull();
    expect(placeTap(bars, b.start - 100)).toEqual({ i: 0, k: 0, hit: true });
    // the last rests are the bar's; the next bar's first beat may be hit a little early
    expect(placeTap(bars, slotAt(b, 13) + 100)).toEqual({ i: 0, k: 13, hit: false });
    expect(placeTap(bars, bars[1].start - 100)).toEqual({ i: 1, k: 0, hit: true });
    expect(barShut(b)).toBe(slotAt(b, 13.5));
  });

  it("takes a bar as right only with each of its ten beats hit once and no other tap", () => {
    const { bars } = beatPlan(0, 0);
    const [b, next] = bars;
    expect(barRight(tapAll(bars, onBeats(b))[0])).toBe(true);
    // a little early or late is still right
    expect(barRight(tapAll(bars, onBeats(b, -120))[0])).toBe(true);
    expect(barRight(tapAll(bars, onBeats(b, 140))[0])).toBe(true);
    // one let go by
    expect(barRight(tapAll(bars, onBeats(b).slice(1))[0])).toBe(false);
    expect(barRight(tapAll(bars, onBeats(b).slice(0, -1))[0])).toBe(false);
    // one beat hit twice
    expect(barRight(tapAll(bars, [...onBeats(b), slotAt(b, 5) + 60])[0])).toBe(false);
    // a tap in a rest, between the groups or at the end
    expect(barRight(tapAll(bars, [...onBeats(b), slotAt(b, 3)])[0])).toBe(false);
    expect(barRight(tapAll(bars, [...onBeats(b), slotAt(b, 12) + 20])[0])).toBe(false);
    // too late for its beat: that beat is let go by, and the tap is one too many
    const late = tapAll(bars, onBeats(b).map((t, j) => (j === 6 ? t + 160 : t)))[0];
    expect(late.hits.filter((h) => h === 1)).toHaveLength(9);
    expect(barRight(late)).toBe(false);
    // and none of it is the next bar's
    expect(barRight(tapAll(bars, [...onBeats(b), ...onBeats(next)])[1])).toBe(true);
    expect(noTaps().hits).toHaveLength(14);
  });

  it("passes at eight bars right and ends at three wrong, so a round has its result in ten bars", () => {
    expect(play(Array(BEAT_PASS).fill(true))).toEqual({ score: { right: 8, wrong: 0 }, end: "pass" });
    expect(play(Array(BEAT_PASS - 1).fill(true)).end).toBeNull();
    expect(play([false, true, false, true, true]).end).toBeNull();
    expect(play([false, true, false, true, false])).toEqual({ score: { right: 2, wrong: 3 }, end: "out" });
    // the longest: seven right and two wrong, then the tenth decides
    const nine = [true, false, true, true, true, false, true, true, true];
    expect(play(nine).end).toBeNull();
    expect(play([...nine, true]).end).toBe("pass");
    expect(play([...nine, false]).end).toBe("out");
  });
});
