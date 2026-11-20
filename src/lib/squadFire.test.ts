import { describe, expect, it } from "vitest";
import {
  FIRE_DROP_MS,
  fireAdd,
  fireCamp,
  fireColor,
  fireEnd,
  fireGlow,
  fireNeed,
  fireNow,
  fireScale,
  fireStage,
  fireTotal,
  fireWarm,
  FIRE_STAGES,
} from "./squadFire";

const T0 = Date.parse("2026-11-20T08:00:00Z");

describe("篝火 with no top", () => {
  it("takes one stick a level to Lv.10, two to Lv.20, and so on: 550 to Lv.100, 2100 to Lv.200", () => {
    expect([1, 10, 11, 12, 20, 21, 100, 101].map(fireNeed)).toEqual([1, 1, 2, 2, 2, 3, 10, 11]);
    expect([0, 10, 25, 50, 100, 150, 200].map(fireTotal)).toEqual([0, 10, 45, 150, 550, 1200, 2100]);
    // fireTotal is the sum of fireNeed
    for (let l = 1; l <= 260; l++) expect(fireTotal(l)).toBe(fireTotal(l - 1) + fireNeed(l));
  });

  it("puts a stick towards the next level, up one once enough are on; lit from out with the first; never at a top", () => {
    expect(fireAdd(0, 0, null, T0)).toEqual({ level: 1, prog: 0, up: true });
    expect(fireAdd(9, 0, T0, T0)).toEqual({ level: 10, prog: 0, up: true });
    // Lv.11 takes two: the first is on towards it, the second puts it up
    expect(fireAdd(10, 0, T0, T0)).toEqual({ level: 10, prog: 1, up: false });
    expect(fireAdd(10, 1, T0, T0)).toEqual({ level: 11, prog: 0, up: true });
    // no top: on and on
    let f = { level: 0, prog: 0 };
    for (let i = 0; i < fireTotal(300); i++) f = fireAdd(f.level, f.prog, T0, T0);
    expect(f).toMatchObject({ level: 300, prog: 0 });
  });

  it("goes down a level each minute left alone, and once it went down the sticks towards the next burnt with it", () => {
    expect(fireNow(30, 2, T0, T0 + FIRE_DROP_MS - 1)).toEqual({ level: 30, prog: 2 });
    expect(fireNow(30, 2, T0, T0 + FIRE_DROP_MS)).toEqual({ level: 29, prog: 0 });
    expect(fireNow(30, 2, T0, T0 + 2 * FIRE_DROP_MS)).toEqual({ level: 28, prog: 0 });
    expect(fireNow(3, 0, T0, T0 + 10 * FIRE_DROP_MS)).toEqual({ level: 0, prog: 0 });
    expect(fireNow(5, 0, null, T0)).toEqual({ level: 0, prog: 0 });
    // a stick after a minute: from the level it went down to, prog from 0
    expect(fireAdd(30, 2, T0, T0 + FIRE_DROP_MS + 5_000)).toEqual({ level: 29, prog: 1, up: false });
    // out, and lit again: the first stick puts it at Lv.1
    expect(fireAdd(3, 0, T0, T0 + 10 * FIRE_DROP_MS)).toEqual({ level: 1, prog: 0, up: true });
  });

  it("carries its sticks towards the next into the next 局 at a round's end, unless it went down", () => {
    expect(fireEnd({ level: 30, prog: 2, at: T0, burn: 0 }, T0 + 20_000)).toMatchObject({ level: 30, prog: 2, at: T0 });
    expect(fireEnd({ level: 30, prog: 2, at: T0, burn: 0 }, T0 + 70_000)).toMatchObject({ level: 29, prog: 0, at: T0 + FIRE_DROP_MS });
    expect(fireEnd({ level: 1, prog: 0, at: T0, burn: 0 }, T0 + 5 * FIRE_DROP_MS)).toMatchObject({ level: 0, prog: 0 });
    expect(fireEnd({ level: 0, at: null, burn: 0 }, T0)).toMatchObject({ level: 0, prog: 0, at: null });
  });

  it("looks as its level has it: eight stages, its flame and glow growing to Lv.100, a colour each 20 levels from Lv.220", () => {
    expect([0, 1, 9, 10, 24, 25, 49, 50, 99, 100, 149, 150, 199, 200, 999].map((l) => FIRE_STAGES[fireStage(l)].key)).toEqual([
      "out",
      "small",
      "small",
      "slug",
      "slug",
      "pot",
      "pot",
      "guard",
      "guard",
      "map",
      "map",
      "storm",
      "storm",
      "ship",
      "ship",
    ]);
    expect(fireScale(0)).toEqual({ x: 0, y: 0 });
    expect(fireScale(1).x).toBeCloseTo(0.55 + 0.22 * Math.log10(2));
    // Lv.100 and up: its tallest (and soon after its widest)
    expect(fireScale(100).y).toBe(1.1);
    expect(fireScale(100).x).toBeCloseTo(0.99, 2);
    expect(fireScale(500)).toEqual({ x: 1, y: 1.1 });
    expect(fireGlow(1000)).toEqual({ a: 0.5, size: 640 });
    expect([0, 219, 220, 239, 240, 300, 319, 320, 340, 440].map(fireColor)).toEqual([
      { color: 0, stars: 0 },
      { color: 0, stars: 0 },
      { color: 1, stars: 0 },
      { color: 1, stars: 0 },
      { color: 2, stars: 0 },
      { color: 5, stars: 0 },
      { color: 5, stars: 0 },
      { color: 0, stars: 1 },
      { color: 1, stars: 1 },
      { color: 0, stars: 2 },
    ]);
  });

  it("warms the room as Lv.5 did at Lv.50, and draws 卫戍池塘's campfire 1–5 from Lv.1 to Lv.50", () => {
    expect(fireWarm(50)).toBeCloseTo(0.225);
    expect(fireWarm(500)).toBeCloseTo(0.225);
    expect([0, 1, 50, 200].map(fireCamp)).toEqual([0, 1, 5, 5]);
    expect(fireCamp(25)).toBeCloseTo(1 + (4 * 24) / 49);
  });
});
