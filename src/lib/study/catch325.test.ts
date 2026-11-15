import { describe, expect, it } from "vitest";
import {
  arrives,
  CATCH_CALM,
  CATCH_CROWD_GAP,
  CATCH_CROWD_MS,
  CATCH_FALL_MS,
  CATCH_GAP_MS,
  CATCH_GLIDE,
  CATCH_MIN_EACH,
  CATCH_MS,
  CATCH_ORDER,
  CATCH_PAR_MS,
  CATCH_PLATE_LIFT,
  CATCH_PLATE_W,
  CATCH_RIM,
  CATCH_ROACH_BOX,
  CATCH_SETS,
  CATCH_SIDE,
  CATCH_THING_R,
  catchDrops,
  caught,
  crowded,
  type Drop,
  dropAt,
  fairDrops,
  fallMs,
  inTime,
  onPlate,
  parMs,
  plateTop,
  type Tally,
  TALLY_START,
  type Thing,
  thingY,
} from "./catch325";
import { isObstacle, OBSTACLES, touches } from "./field";
import { mulberry32 } from "../prng";

/** So many rounds' seeds, as the page deals them (rules.ts newSeed): whole numbers from 0 up to 2³² */
const SEEDS = ((r) => Array.from({ length: 1000 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));
const dropsOf = (seed: number) => catchDrops(mulberry32(seed));

/** Things caught one after another from the start of a round: how the last left it, and what each did */
function catchAll(things: Thing[]) {
  let tally: Tally = TALLY_START;
  const did: string[] = [];
  let end: "pass" | null = null;
  for (const what of things) {
    const r = caught(tally, what);
    ({ tally, end } = r);
    did.push(r.did);
  }
  return { tally, did, end };
}

describe("接住 3、2、5", () => {
  it("fills 3, 2, 5 in that order, and empties the set at a wrong digit or an obstacle; five sets pass", () => {
    expect(catchAll([3, 2])).toEqual({ tally: { filled: 2, sets: 0 }, did: ["fill", "fill"], end: null });
    expect(catchAll([3, 2, 5])).toEqual({ tally: { filled: 0, sets: 1 }, did: ["fill", "fill", "set"], end: null });
    // a wrong digit: one not wanted yet, or not 3, 2 or 5 at all, even with nothing caught
    expect(catchAll([3, 5]).tally).toEqual({ filled: 0, sets: 0 });
    expect(catchAll([3, 2, 7])).toMatchObject({ tally: { filled: 0, sets: 0 }, did: ["fill", "fill", "wrong"] });
    expect(catchAll([2]).did).toEqual(["wrong"]);
    // an obstacle, of each kind
    for (const o of OBSTACLES) expect(catchAll([3, 2, o])).toMatchObject({ tally: { filled: 0, sets: 0 }, did: ["fill", "fill", "hit"] });
    // a set once caught is kept
    expect(catchAll([3, 2, 5, 3, "bomb", 3]).tally).toEqual({ filled: 1, sets: 1 });
    const five = Array.from({ length: CATCH_SETS }, () => [...CATCH_ORDER]).flat();
    expect(catchAll(five.slice(0, -1)).end).toBeNull();
    expect(catchAll(five)).toMatchObject({ tally: { filled: 0, sets: 5 }, end: "pass" });
    expect(CATCH_MS).toBe(60_000);
  });

  it("falls from about 3 s at the start to 2.2 s at the end, and 30% slower with motion turned down; a plane glides", () => {
    expect(fallMs(0)).toBe(CATCH_FALL_MS[0]);
    expect(fallMs(CATCH_MS)).toBe(CATCH_FALL_MS[1]);
    expect(fallMs(CATCH_MS / 2)).toBe(2600);
    const d: Drop = { at: 1000, what: "plane", from: 0.2, to: 0.5, fall: 3000 };
    expect(arrives(d)).toBe(4000);
    expect(arrives(d, true)).toBeCloseTo(1000 + 3000 / CATCH_CALM);
    expect(CATCH_CALM).toBe(0.7);
    expect(dropAt(d, 1000)).toEqual({ down: 0, x: 0.2 });
    expect(dropAt(d, 2500).down).toBe(0.5);
    expect(dropAt(d, 2500).x).toBeCloseTo(0.35);
    expect(dropAt(d, 4000).down).toBe(1);
    expect(dropAt(d, 4000).x).toBeCloseTo(0.5);
    expect(dropAt(d, 4000, true).down).toBeCloseTo(CATCH_CALM);
    // not yet falling: where it will start
    expect(dropAt(d, 500).x).toBe(0.2);
  });

  it("catches what touches the plate's rim, the moment it comes down to it, and lets what falls past it fall on", () => {
    // a plate on the head of a roach whose middle is 1.3 field widths down
    const top = plateTop(1.3);
    expect(top).toBeCloseTo(1.3 - CATCH_ROACH_BOX / 2 - CATCH_PLATE_LIFT);
    // as wide as about 1.4 roaches: wider than the roach's picture
    expect(CATCH_PLATE_W).toBeGreaterThan(CATCH_ROACH_BOX);
    const d: Drop = { at: 0, what: 3, from: 0.5, to: 0.5, fall: 2000 };
    const yAt = (t: number, calm = false) => thingY(dropAt(d, t, calm).down, top);
    // just over the field as it starts, and on the rim as it comes down
    expect(yAt(0)).toBeCloseTo(-CATCH_THING_R);
    expect(yAt(2000) + CATCH_THING_R).toBeCloseTo(top);
    // straight down onto the plate's middle: it touches the rim as it comes down to it, and not before
    expect(onPlate(0.5, yAt(1990), 0.5, 0.5, top)).toBe(false);
    expect(onPlate(0.5, yAt(2001), 0.5, 0.5, top)).toBe(true);
    // with motion turned down, later
    expect(onPlate(0.5, yAt(2001, true), 0.5, 0.5, top)).toBe(false);
    expect(onPlate(0.5, yAt(2000 / CATCH_CALM + 1, true), 0.5, 0.5, top)).toBe(true);
    // off to one side: it touches the rim's end, or it falls past, at every height, onto the roach and away
    const reach = CATCH_PLATE_W / 2 + CATCH_THING_R;
    const level = top + CATCH_RIM / 2;
    expect(onPlate(0.5 + reach - 0.002, level, 0.5, 0.5, top)).toBe(true);
    expect(onPlate(0.5 - reach + 0.002, level, 0.5, 0.5, top)).toBe(true);
    for (let t = 0; t <= 4000; t += 10) {
      expect(onPlate(0.5 + reach + 0.002, yAt(t), 0.5, 0.5, top)).toBe(false);
      expect(onPlate(0.5 - reach - 0.002, yAt(t), 0.5, 0.5, top)).toBe(false);
    }
    // once under the rim, nothing touches the plate, even right under its middle
    expect(onPlate(0.5, top + CATCH_RIM + CATCH_THING_R + 0.002, 0.5, 0.5, top)).toBe(false);
    // a plate moved fast past a thing level with its rim touches it on the way, whichever way it goes
    expect(onPlate(0.5, level, 0.1, 0.9, top)).toBe(true);
    expect(onPlate(0.5, level, 0.9, 0.1, top)).toBe(true);
    expect(onPlate(0.5, level, 0.9, 0.5 + reach + 0.002, top)).toBe(false);
    // two things coming down together are further apart than a plate held still reaches over both
    expect(CATCH_CROWD_GAP).toBeGreaterThan(CATCH_PLATE_W + 2 * CATCH_THING_R);
  });

  it("touches within the two radii and not beyond", () => {
    expect(touches(0, 0, 0.05, 0.1, 0, 0.05)).toBe(true);
    expect(touches(0, 0, 0.05, 0.101, 0, 0.05)).toBe(false);
    expect(touches(0, 0, 0.05, 0.06, 0.079, 0.05)).toBe(true);
    expect(touches(0, 0, 0.05, 0.08, 0.08, 0.05)).toBe(false);
  });

  it("finds drops crowded when two come down within 450 ms of each other too near", () => {
    const at = (t: number, to: number): Drop => ({ at: t, what: 7, from: to, to, fall: 2000 });
    expect(crowded([at(0, 0.3), at(CATCH_CROWD_MS - 1, 0.3 + CATCH_CROWD_GAP - 0.01)])).toBe(true);
    expect(crowded([at(0, 0.3), at(CATCH_CROWD_MS - 1, 0.3 + CATCH_CROWD_GAP)])).toBe(false);
    expect(crowded([at(0, 0.3), at(CATCH_CROWD_MS, 0.3)])).toBe(false);
    // the third of three, near the first
    expect(crowded([at(0, 0.2), at(200, 0.8), at(400, 0.3)])).toBe(true);
  });

  it("is the same from the same seed and another from another, and over a thousand rounds always fair", () => {
    expect(dropsOf(SEEDS[0])).toEqual(dropsOf(SEEDS[0]));
    expect(new Set(SEEDS.slice(0, 100).map((d) => JSON.stringify(dropsOf(d)))).size).toBe(100);
    const share = { each: 0, other: 0, obstacle: 0, all: 0 };
    for (const seed of SEEDS) {
      const drops = dropsOf(seed);
      expect(fairDrops(drops)).toBe(true);
      expect(crowded(drops)).toBe(false);
      // about one every 0.55 s through the minute
      expect(drops[0].at).toBe(600);
      for (let i = 1; i < drops.length; i++) {
        const gap = drops[i].at - drops[i - 1].at;
        expect(gap).toBeGreaterThanOrEqual(CATCH_GAP_MS[0] - 1);
        expect(gap).toBeLessThanOrEqual(CATCH_GAP_MS[1] + 1);
      }
      expect(drops.at(-1)!.at).toBeLessThan(CATCH_MS);
      for (const d of drops) {
        expect(d.fall).toBe(Math.round(fallMs(d.at)));
        expect(d.to).toBeGreaterThanOrEqual(CATCH_SIDE);
        expect(d.to).toBeLessThanOrEqual(1 - CATCH_SIDE);
        expect(d.from).toBeGreaterThanOrEqual(CATCH_SIDE);
        expect(d.from).toBeLessThanOrEqual(1 - CATCH_SIDE);
        // only a paper plane glides, and from one side or the other
        const glide = Math.abs(d.to - d.from);
        if (d.what === "plane") {
          expect(glide).toBeGreaterThanOrEqual(CATCH_GLIDE[0] - 0.002);
          expect(glide).toBeLessThanOrEqual(CATCH_GLIDE[1] + 0.002);
        } else expect(glide).toBe(0);
        expect(typeof d.what === "number" ? Number.isInteger(d.what) && d.what >= 0 && d.what <= 9 : isObstacle(d.what)).toBe(true);
      }
      // at least 15 of each of 3, 2 and 5 come down inside the minute
      const near = inTime(drops);
      for (const n of CATCH_ORDER) expect(near.filter((d) => d.what === n).length).toBeGreaterThanOrEqual(CATCH_MIN_EACH);
      // caught as they came, five sets well inside the minute
      expect(parMs(drops)).toBeLessThanOrEqual(CATCH_PAR_MS);
      share.all += drops.length;
      share.each += drops.filter((d) => d.what === 3 || d.what === 2 || d.what === 5).length / 3;
      share.obstacle += drops.filter((d) => isObstacle(d.what)).length;
      share.other += drops.filter((d) => typeof d.what === "number" && ![3, 2, 5].includes(d.what)).length;
    }
    expect(share.each / share.all).toBeCloseTo(0.18, 2);
    expect(share.obstacle / share.all).toBeCloseTo(0.2, 2);
    expect(share.other / share.all).toBeCloseTo(0.26, 1);
  }, 30_000);
});
