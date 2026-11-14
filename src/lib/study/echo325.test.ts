import { describe, expect, it } from "vitest";
import {
  type Bell,
  type Echo,
  ECHO_BELLS,
  ECHO_FIRST,
  ECHO_OFF_MS,
  ECHO_ON_MS,
  ECHO_PAUSE_MS,
  ECHO_START,
  ECHO_STEPS,
  echoBells,
  isBell,
  remembered,
  ring,
} from "./echo325";
import { mulberry32 } from "../prng";

/** So many rounds' seeds, as the page deals them (rules.ts newSeed): whole numbers from 0 up to 2³² */
const SEEDS = ((r) => Array.from({ length: 1100 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));
const bellsOf = (seed: number) => echoBells(mulberry32(seed));

/** Rings bells one after another from the start of a round: what each did, and where the round was left */
function play(bells: readonly Bell[], rings: readonly Bell[]) {
  let echo: Echo = ECHO_START;
  const did = rings.map((b) => {
    const r = ring(bells, echo, b);
    echo = r.echo;
    return r.did;
  });
  return { did, echo };
}

/** Every turn rung back right, from the first to the one of n bells */
const turnsUpTo = (bells: readonly Bell[], n: number) =>
  Array.from({ length: n - ECHO_FIRST + 1 }, (_, t) => bells.slice(0, ECHO_FIRST + t)).flat();

describe("复读 325", () => {
  it("is 3、2、5 and then the round's own bells, the same from the same seed", () => {
    expect(bellsOf(SEEDS[0])).toEqual(bellsOf(SEEDS[0]));
    expect(new Set(SEEDS.slice(0, 100).map((d) => bellsOf(d).join(""))).size).toBeGreaterThanOrEqual(90);
    const seen = { 3: 0, 2: 0, 5: 0 };
    for (const seed of SEEDS) {
      const s = bellsOf(seed);
      expect(s).toHaveLength(ECHO_STEPS);
      expect(s.slice(0, 3)).toEqual([3, 2, 5]);
      expect(s.every((b) => isBell(b))).toBe(true);
      // never a bell three times running
      for (let i = 2; i < s.length; i++) expect(s[i] === s[i - 1] && s[i] === s[i - 2]).toBe(false);
      for (const b of s.slice(3)) seen[b]++;
    }
    // the three come up about as often as each other
    for (const b of ECHO_BELLS) expect(seen[b] / (SEEDS.length * (ECHO_STEPS - 3))).toBeGreaterThan(0.28);
  });

  it("takes the bells back in order, a turn at a time, each one bell longer than the last", () => {
    const bells: Bell[] = [3, 2, 5, 5, 3, 2, 2, 5, 3, 3];
    expect(play(bells, [3, 2])).toEqual({ did: ["right", "right"], echo: { turn: 3, rung: 2 } });
    expect(play(bells, [3, 2, 5])).toEqual({ did: ["right", "right", "turn"], echo: { turn: 4, rung: 0 } });
    expect(play(bells, [3, 2, 5, 3, 2, 5, 5]).did.at(-1)).toBe("turn");
    // all ten rung back: seven turns and then the last
    const all = play(bells, turnsUpTo(bells, ECHO_STEPS));
    expect(all.did.filter((d) => d === "turn")).toHaveLength(ECHO_STEPS - ECHO_FIRST);
    expect(all.did.at(-1)).toBe("pass");
    expect(all.did.slice(0, -1).every((d) => d !== "pass" && d !== "wrong")).toBe(true);
    expect(remembered(all.echo)).toBe(ECHO_STEPS);
  });

  it("ends at the first wrong bell, and says which was wanted and how many were rung back in a row", () => {
    const bells: Bell[] = [3, 2, 5, 5, 3, 2, 2, 5, 3, 3];
    expect(ring(bells, ECHO_START, 2)).toEqual({ echo: ECHO_START, did: "wrong", want: 3 });
    expect(remembered(ECHO_START)).toBe(0);
    // two right in the first turn, then wrong
    expect(ring(bells, { turn: 3, rung: 2 }, 3)).toEqual({ echo: { turn: 3, rung: 2 }, did: "wrong", want: 5 });
    expect(remembered({ turn: 3, rung: 2 })).toBe(2);
    // the turn of six, wrong at its third: five were rung back in the turn before
    const r = play(bells, [...turnsUpTo(bells, 5), 3, 2, 3]);
    expect(r.did.at(-1)).toBe("wrong");
    expect(r.echo).toEqual({ turn: 6, rung: 2 });
    expect(remembered(r.echo)).toBe(5);
  });

  it("lights fewer than two bells a second, 1.2 times as fast as at first, and a round of every turn takes about a minute", () => {
    expect(1000 / (ECHO_ON_MS + ECHO_OFF_MS)).toBeLessThan(2);
    // the first ones: lit 480, dark 240, 900 before a turn
    expect((480 + 240) / (ECHO_ON_MS + ECHO_OFF_MS)).toBeCloseTo(1.2);
    expect(480 / ECHO_ON_MS).toBeCloseTo(1.2);
    expect(900 / ECHO_PAUSE_MS).toBeCloseTo(1.2);
    // each turn: the pause, its bells shown, then rung back at about one every half second
    let ms = 0;
    for (let n = ECHO_FIRST; n <= ECHO_STEPS; n++) ms += ECHO_PAUSE_MS + n * (ECHO_ON_MS + ECHO_OFF_MS) + n * 500;
    expect(ms).toBeGreaterThan(30_000);
    expect(ms).toBeLessThan(120_000);
  });
});
