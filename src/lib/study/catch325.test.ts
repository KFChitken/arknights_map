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
  CATCH_SETS,
  CATCH_SIDE,
  catchDrops,
  caught,
  comesDown,
  crowded,
  type Drop,
  dropAt,
  fairDrops,
  fallMs,
  inReach,
  inTime,
  parMs,
  type Tally,
  TALLY_START,
  type Thing,
} from "./catch325";
import { isObstacle, OBSTACLES, touches } from "./field";
import { dayRandom } from "./rules";

/** Nearly three years of site days from the first one the course could be played */
const DAYS = Array.from({ length: 1000 }, (_, i) => new Date(Date.UTC(2026, 10, 14 + i)).toISOString().slice(0, 10));
const dropsOf = (day: string) => catchDrops(dayRandom("catch325", day));

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

  it("catches a thing the moment it comes down to the roach, if it is within reach then", () => {
    const d: Drop = { at: 0, what: 3, from: 0.5, to: 0.5, fall: 2000 };
    expect(comesDown(d, 1990, 2000)).toBe(true);
    expect(comesDown(d, 1980, 1990)).toBe(false);
    expect(comesDown(d, 2000, 2010)).toBe(false);
    // with motion turned down, later
    expect(comesDown(d, 1990, 2000, true)).toBe(false);
    expect(comesDown(d, 2000 / CATCH_CALM - 5, 2000 / CATCH_CALM + 5, true)).toBe(true);
    expect(inReach(0.5, 0.6)).toBe(true);
    expect(inReach(0.5, 0.4)).toBe(true);
    expect(inReach(0.5, 0.61)).toBe(false);
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

  it("is the same for everyone that day and another the next, and over a thousand days always fair", () => {
    expect(dropsOf("2026-11-21")).toEqual(dropsOf("2026-11-21"));
    expect(new Set(DAYS.slice(0, 100).map((d) => JSON.stringify(dropsOf(d)))).size).toBe(100);
    const share = { each: 0, other: 0, obstacle: 0, all: 0 };
    for (const day of DAYS) {
      const drops = dropsOf(day);
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
