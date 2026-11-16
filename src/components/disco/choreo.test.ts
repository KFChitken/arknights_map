import { describe, expect, it } from "vitest";
import type { DanceBeats } from "@/lib/dance";
import { BANG, BOB, danceTraits, FREE, freeAmp, JUMP, liteMove, nextBar, planOf, SPIN, stepAt, SWAY, WAVE, WILD, wildMove } from "./choreo";
import { pose, posed } from "./pose";

/** A table of even beats: phrases of 16 at these loudnesses (0–9) */
function table(levels: number[], opts: { waltz?: boolean; bar?: number } = {}): DanceBeats {
  const per = opts.waltz ? 12 : 16;
  const bar = opts.bar ?? 0;
  const n = bar + levels.length * per;
  const energy = new Uint8Array(n);
  levels.forEach((l, k) => energy.fill(l, bar + k * per, bar + (k + 1) * per));
  return { bpm: 120, bar, waltz: Boolean(opts.waltz), beats: Float64Array.from({ length: n }, (_, i) => 1 + i * 0.5), energy, liteS: 0 };
}

describe("planOf", () => {
  it("sways when quiet, bobs and sways by turns when louder, and gives each climax the next of the big four", () => {
    const plan = planOf(table([2, 5, 5, 6, 8, 8, 9, 8, 8, 3]));
    expect(plan.phrases.map((p) => p.move)).toEqual([SWAY, BOB, SWAY, BOB, JUMP, WAVE, SPIN, WILD, JUMP, SWAY]);
    expect(plan.phrases.map((p) => p.climax)).toEqual([false, false, false, false, true, true, true, true, true, false]);
  });

  it("puts the thresholds where the design has them", () => {
    expect(planOf(table([4])).phrases[0].move).toBe(SWAY);
    expect(planOf(table([5])).phrases[0].move).toBe(BOB);
    expect(planOf(table([6, 7])).phrases[1].climax).toBe(true);
  });

  it("bangs heads in the last bar before a climax, and the climax starts with a drop", () => {
    const plan = planOf(table([5, 8, 8]));
    expect(plan.phrases[0].bang).toBe(12);
    expect(plan.phrases[1].drop).toBe(true);
    expect(plan.phrases[2].drop).toBe(false);
    expect(plan.phrases[1].bang).toBe(-1);
  });

  it("only sways and bobs in threes, four bars of three to a phrase", () => {
    const plan = planOf(table([3, 6, 9, 9], { waltz: true }));
    expect(plan.bar).toBe(3);
    expect(plan.per).toBe(12);
    expect(plan.phrases.map((p) => p.move)).toEqual([SWAY, BOB, BOB, BOB]);
    expect(plan.phrases.every((p) => p.bang === -1)).toBe(true);
  });

  it("makes louder phrases bigger", () => {
    const plan = planOf(table([0, 9]));
    expect(plan.phrases[0].amp).toBeCloseTo(0.45);
    expect(plan.phrases[1].amp).toBeCloseTo(1);
  });

  it("counts from the first downbeat", () => {
    const plan = planOf(table([5, 8], { bar: 2 }));
    expect(plan.first).toBe(2);
    expect(plan.end).toBe(31);
  });
});

describe("stepAt", () => {
  const plan = planOf(table([5, 8, 8]));

  it("is the same at the same beat, every time", () => {
    for (const b of [0, 3.3, 12.5, 16.2, 40]) expect(stepAt(planOf(table([5, 8, 8])), b)).toEqual(stepAt(plan, b));
  });

  it("brings each move in over a beat", () => {
    expect(stepAt(plan, 0.5)).toMatchObject({ a: FREE, b: BOB, mix: 0.5 });
    expect(stepAt(plan, 5)).toMatchObject({ a: FREE, b: BOB, mix: 1 });
    // the bar of banging before the climax
    expect(stepAt(plan, 12.25)).toMatchObject({ a: BOB, b: BANG, mix: 0.25 });
    expect(stepAt(plan, 16.5)).toMatchObject({ a: BANG, b: JUMP, mix: 0.5, climax: true, drop: true });
    expect(stepAt(plan, 17.5).drop).toBe(false);
    expect(stepAt(plan, 32.5)).toMatchObject({ a: JUMP, b: WAVE, drop: false });
  });

  it("sways freely before the first downbeat and after the last beat", () => {
    expect(stepAt(plan, -0.5)).toMatchObject({ a: FREE, b: FREE });
    expect(stepAt(plan, Number.NaN)).toMatchObject({ a: FREE, b: FREE });
    expect(stepAt(plan, 47.5)).toMatchObject({ a: JUMP, b: WAVE, mix: 1 });
    expect(stepAt(plan, 48.5)).toMatchObject({ a: WAVE, b: FREE, mix: 0.5 });
    expect(stepAt(plan, 60)).toMatchObject({ a: WAVE, b: FREE, mix: 1 });
  });

  it("starts dancing on a downbeat at least most of a beat away", () => {
    expect(nextBar(plan, 0.1)).toBe(4);
    expect(nextBar(plan, 3.3)).toBe(8);
    expect(nextBar(plan, -3)).toBe(0);
    expect(nextBar(planOf(table([5], { waltz: true })), 1)).toBe(3);
  });
});

describe("the moves", () => {
  it("leave 省电版 bobbing and swaying only", () => {
    expect([SWAY, BOB, JUMP, WAVE, SPIN, BANG, WILD, FREE].map(liteMove)).toEqual([SWAY, BOB, BOB, BOB, BOB, BOB, BOB, FREE]);
  });

  it("pick each roach's 群魔乱舞 from its seed alone, one of the first six, anew each four bars", () => {
    const t = danceTraits(0xdeadbeef);
    expect(danceTraits(0xdeadbeef)).toEqual(t);
    const picks = Array.from({ length: 12 }, (_, i) => wildMove(t, i * 16 + 3));
    expect(picks.every((m) => Number.isInteger(m) && m >= 0 && m <= 5)).toBe(true);
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(wildMove(t, 5)).toBe(wildMove(t, 15.9));
    // different roaches, different picks
    const many = new Set(Array.from({ length: 50 }, (_, i) => wildMove(danceTraits(i * 7919 + 13), 0)));
    expect(many.size).toBe(6);
  });

  it("jump high on beats 1 and 3, and land standing on each beat", () => {
    expect(pose(JUMP, 0.3, 0)[1]).toBeCloseTo((-9 / 64) * 3.4);
    expect(pose(JUMP, 1.3, 0)[1]).toBeCloseTo(-9 / 64);
    for (const m of [SWAY, BOB, JUMP, WAVE, SPIN, BANG]) expect(pose(m, 4, 0)[1]).toBeCloseTo(0);
  });

  it("turn right round in two beats of every eight", () => {
    expect(pose(SPIN, 1, 0)[5]).toBeCloseTo(180);
    expect(pose(SPIN, 3, 0)[5]).toBe(0);
    // halfway round, the picture shows mirrored
    expect(posed(pose(SPIN, 1, 0), pose(SPIN, 1, 0), 1, 1, 1)[3]).toBeLessThan(0);
  });

  it("stand as ever with the dance off", () => {
    expect(posed(pose(JUMP, 0.3, 0), pose(JUMP, 0.3, 0), 1, 1, 0).map((v) => v + 0)).toEqual([0, 0, 0, 1, 1]);
  });

  it("sway the free sway bigger where a song with no beats is louder", () => {
    const secs = Uint8Array.from([0, 0, 9, 9]);
    expect(freeAmp(secs, 0.5)).toBeCloseTo(0.35);
    expect(freeAmp(secs, 2.5)).toBeCloseTo(0.8);
    expect(freeAmp(null, 3)).toBeCloseTo(0.55);
  });
});
