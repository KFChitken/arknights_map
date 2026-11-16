import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askHint,
  combine,
  fair,
  reaches,
  lastCard,
  MAKE_BANK,
  MAKE_GOAL,
  MAKE_HINTS,
  MAKE_POOL,
  MAKE_RECENT,
  makePuzzle,
  nextStep,
  type Op,
  OPS,
  put,
  restart,
  type Step,
  stepsBack,
  type Table,
  table,
  type Told,
  undo,
  waysTo,
} from "./make325";
import { mulberry32 } from "../prng";

/** So many rounds' seeds, as the page deals them (rules.ts newSeed): whole numbers from 0 up to 2³² */
const SEEDS = ((r) => Array.from({ length: 1000 }, () => Math.floor(r() * 2 ** 32)))(mulberry32(325));
const puzzleOf = (seed: number, recent: readonly number[] = []) => makePuzzle(mulberry32(seed), recent);

/** What a way to 325 as written comes to, worked out as written, and the numbers in it */
function readWay(text: string): { value: number; nums: number[] } {
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  // the same signs as the game's, written for JavaScript; every step must stay whole
  const js = text.replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-");
  const value = Function(`"use strict"; return (${js});`)() as number;
  return { value, nums };
}

describe("凑 325", () => {
  it("puts two numbers together only into a whole number above nought", () => {
    expect(combine(13, "×", 25)).toBe(325);
    expect(combine(300, "+", 25)).toBe(325);
    expect(combine(350, "−", 25)).toBe(325);
    expect(combine(975, "÷", 3)).toBe(325);
    expect(combine(10, "÷", 3)).toBe("uneven");
    expect(combine(9, "−", 9)).toBe("notPositive");
    expect(combine(9, "−", 10)).toBe("notPositive");
  });

  it("finds each way once, whichever side of + and × a number is on and whichever of two steps comes first", () => {
    const ways = waysTo([9, 10, 25, 40], MAKE_GOAL);
    expect(ways[0].text).toBe("9 × 40 − (10 + 25)");
    expect(ways.map((w) => w.text)).toContain("25 × (9 + 40 ÷ 10)");
    expect(new Set(ways.map((w) => w.key)).size).toBe(ways.length);
    // (9 × 40) and (10 + 25) taken in either order are one way
    expect(ways.filter((w) => w.text === "9 × 40 − (10 + 25)")).toHaveLength(1);
    expect(waysTo([13, 25], MAKE_GOAL)).toHaveLength(1);
    expect(waysTo([6, 9, 25, 50], MAKE_GOAL)).toHaveLength(1);
    // only the first few, the first the same
    expect(waysTo([9, 10, 25, 40], MAKE_GOAL, 2)).toEqual(ways.slice(0, 2));
    // the quick yes or no agrees with the ways, for a few hundred sets of four
    for (let i = 0; i < 300; i++) {
      const nums = [2 + (i % 23), 3 + ((i * 7) % 22), 5 + ((i * 11) % 20), [25, 30, 40, 50, 60, 75, 100][i % 7]];
      expect([nums, reaches(nums, MAKE_GOAL)]).toEqual([nums, waysTo(nums, MAKE_GOAL).length > 0]);
    }
    // 6 × 50 + 25 makes 325 with a number left over
    expect(fair([6, 9, 25, 50])).toBe(false);
    expect(fair([9, 10, 25, 40])).toBe(true);
    expect(fair([7, 11, 13, 21])).toBe(true);
    expect(fair([6, 8, 11, 25])).toBe(true);
  });

  it("keeps a bank of every fair four of the pool, smallest first, each once, as a count made afresh finds them", () => {
    const pool = [...MAKE_POOL].sort((a, b) => a - b);
    const afresh: string[] = [];
    for (let a = 0; a < pool.length; a++)
      for (let b = a + 1; b < pool.length; b++)
        for (let c = b + 1; c < pool.length; c++)
          for (let d = c + 1; d < pool.length; d++) {
            const nums = [pool[a], pool[b], pool[c], pool[d]];
            if (fair(nums)) afresh.push(nums.join());
          }
    // as the design counted them: 1,468 of the 27,405 fours of the thirty numbers
    expect(pool).toHaveLength(30);
    expect(afresh).toHaveLength(1468);
    expect(MAKE_BANK.map((p) => p.join())).toEqual(afresh);
    expect(new Set(MAKE_BANK.map((p) => p.join())).size).toBe(MAKE_BANK.length);
    for (const p of MAKE_BANK) {
      expect(p).toHaveLength(4);
      expect(new Set(p).size).toBe(4);
      expect(p.every((n) => MAKE_POOL.includes(n))).toBe(true);
      expect([...p].sort((a, b) => a - b)).toEqual(p);
      // 325 at least two ways, and no two or three of them make it alone
      expect(waysTo(p, MAKE_GOAL, 2)).toHaveLength(2);
      for (const [a, b, c] of [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]]) expect(reaches([p[a], p[b], p[c]], MAKE_GOAL)).toBe(false);
    }
  }, 60_000);

  it("deals one of the bank, its cards in an order of their own, the same from the same seed, with 看答案 coming to 325", () => {
    expect(puzzleOf(SEEDS[0])).toEqual(puzzleOf(SEEDS[0]));
    expect(new Set(SEEDS.slice(0, 100).map((d) => puzzleOf(d).k)).size).toBeGreaterThanOrEqual(90);
    let shuffled = 0;
    for (const seed of SEEDS) {
      const p = puzzleOf(seed);
      expect([...p.nums].sort((a, b) => a - b)).toEqual(MAKE_BANK[p.k]);
      if (p.nums.join() !== MAKE_BANK[p.k].join()) shuffled++;
      const way = readWay(p.answer);
      expect([p.answer, way.value]).toEqual([p.answer, MAKE_GOAL]);
      expect([...way.nums].sort((a, b) => a - b)).toEqual(MAKE_BANK[p.k]);
    }
    // in the order they were found one time in 24
    expect(shuffled).toBeGreaterThan(SEEDS.length * 0.9);
  });

  it("never deals one of the last two hundred this device dealt, until all but those were", () => {
    const recent: number[] = [];
    const seen = new Map<number, number>();
    const random = mulberry32(7);
    for (let round = 0; round < 1000; round++) {
      const p = makePuzzle(random, recent);
      expect(recent).not.toContain(p.k);
      // dealt again only after two hundred others
      if (seen.has(p.k)) expect(round - seen.get(p.k)!).toBeGreaterThan(MAKE_RECENT);
      seen.set(p.k, round);
      recent.push(p.k);
      if (recent.length > MAKE_RECENT) recent.shift();
    }
    // a bank with all but one recent deals that one
    const all = MAKE_BANK.map((_, k) => k).filter((k) => k !== 42);
    expect(makePuzzle(mulberry32(1), all).k).toBe(42);
  });
});

/** A browser's storage, or one that keeps nothing (a private window) */
function storage(keeps: boolean) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (keeps ? (m.get(k) ?? null) : null),
    setItem: (k: string, v: string) => {
      if (!keeps) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    raw: m,
  };
}

// the module keeps what it dealt last for a browser that keeps nothing: a fresh copy for each test
async function load() {
  vi.resetModules();
  return import("./make325");
}

afterEach(() => vi.unstubAllGlobals());

describe("凑 325's puzzles dealt lately, kept on this device", () => {
  it("keeps the last two hundred dealt, the latest last, in the browser", async () => {
    const store = storage(true);
    vi.stubGlobal("localStorage", store);
    const { dealtPuzzle, recentPuzzles } = await load();
    expect(recentPuzzles()).toEqual([]);
    for (let k = 0; k < 250; k++) dealtPuzzle(k);
    expect(recentPuzzles()).toEqual(Array.from({ length: MAKE_RECENT }, (_, i) => 50 + i));
    // one dealt again goes last, once
    dealtPuzzle(60);
    expect(recentPuzzles().at(-1)).toBe(60);
    expect(recentPuzzles().filter((k) => k === 60)).toHaveLength(1);
    // a fresh page reads them back; what is not a place in the bank is let go
    expect((await load()).recentPuzzles()).toHaveLength(MAKE_RECENT);
    store.raw.set("zhoup.study.make325", JSON.stringify([3, -1, 2.5, "7", 99999, 5]));
    expect((await load()).recentPuzzles()).toEqual([3, 5]);
    store.raw.set("zhoup.study.make325", "{not json");
    expect((await load()).recentPuzzles()).toEqual([]);
  });

  it("keeps them while the page is open where the browser keeps nothing, and where there is no storage at all", async () => {
    vi.stubGlobal("localStorage", storage(false));
    const { dealtPuzzle, recentPuzzles } = await load();
    dealtPuzzle(4);
    dealtPuzzle(8);
    expect(recentPuzzles()).toEqual([4, 8]);
    expect((await load()).recentPuzzles()).toEqual([]);
    vi.stubGlobal("localStorage", undefined);
    const none = await load();
    none.dealtPuzzle(9);
    expect(none.recentPuzzles()).toEqual([9]);
  });
});

describe("凑 325's cards", () => {
  it("puts cards together, refuses what is uneven or not above nought, and goes back a step or to the start", () => {
    let t: Table = table([9, 10, 25, 40]);
    const refused = put(t, 1, "÷", 3);
    expect(refused).toBe("uneven");
    expect(put(t, 0, "−", 1)).toBe("notPositive");
    const step = (from: number, op: "+" | "−" | "×" | "÷", to: number) => {
      const r = put(t, from, op, to);
      if (typeof r === "string") throw new Error(r);
      t = r;
    };
    step(3, "÷", 1);
    expect(t.cards).toEqual([9, 4, 25, null]);
    step(0, "+", 1);
    expect(t.cards).toEqual([null, 13, 25, null]);
    expect(lastCard(t)).toBeNull();
    step(1, "×", 2);
    expect(t.cards).toEqual([null, null, 325, null]);
    expect(lastCard(t)).toBe(325);
    t = undo(t);
    expect(t.cards).toEqual([null, 13, 25, null]);
    t = restart(t);
    expect(t).toEqual(table([9, 10, 25, 40]));
    expect(undo(t)).toEqual(t);
    // a card put together with itself, or with a place already empty, changes nothing
    expect(put(t, 2, "+", 2)).toEqual(t);
    step(0, "+", 1);
    expect(put(t, 0, "+", 2)).toEqual(t);
  });
});

describe("凑 325's 提示", () => {
  /** Steps taken from the four, as put takes them (each must be allowed) */
  const walk = (nums: readonly number[], ...steps: [number, Op, number][]) =>
    steps.reduce<Table>((t, [from, op, to]) => {
      const r = put(t, from, op, to);
      if (typeof r === "string") throw new Error(r);
      return r;
    }, table(nums));
  /** A step as 提示 says it: 先算 a op b */
  const said = (cards: readonly (number | null)[], s: Step | null) => (s ? `${cards[s.from]} ${s.op} ${cards[s.to]}` : null);
  /** The steps 提示 tells one after another from the four, each taken as told, and the largest number made on the way */
  const told = (nums: readonly number[]) => {
    let t = table(nums);
    const steps: (string | null)[] = [];
    let most = 0;
    for (let s = nextStep(t.cards); s; s = nextStep(t.cards)) {
      steps.push(said(t.cards, s));
      t = put(t, s.from, s.op, s.to) as Table;
      if (lastCard(t) === null) most = Math.max(most, t.cards[s.to]!);
    }
    return { steps, most, last: lastCard(t) };
  };

  it("tells the steps of the way whose numbers stay smallest, one at a time, every puzzle to 325", () => {
    expect(told([9, 10, 25, 40]).steps).toEqual(["40 ÷ 10", "4 + 9", "13 × 25"]);
    expect(told([75, 8, 13, 24]).steps).toEqual(["24 ÷ 8", "75 ÷ 3", "13 × 25"]);
    expect(told([7, 11, 13, 21]).steps).toEqual(["11 − 7", "4 + 21", "13 × 25"]);
    for (const p of MAKE_BANK) {
      const way = told(p);
      expect([p, way.steps.length, way.last]).toEqual([p, 3, MAKE_GOAL]);
      // the same steps told for the cards in another order: the numbers, not where they lie
      expect([p, told([...p].reverse()).steps]).toEqual([p, way.steps]);
    }
  });

  it("tells no way with a larger number on it than the way that has the smallest, worked out every way afresh", () => {
    /** The smallest of the largest numbers made on the way, of every way to 325 from these cards */
    const least = (t: Table): number => {
      const left = t.cards.filter((c) => c !== null).length;
      if (left === 1) return lastCard(t) === MAKE_GOAL ? 0 : Infinity;
      let best = Infinity;
      for (let i = 0; i < t.cards.length; i++)
        for (let j = 0; j < t.cards.length; j++)
          for (const op of OPS) {
            const r = put(t, i, op, j);
            if (typeof r === "string" || r === t) continue;
            best = Math.min(best, Math.max(left === 2 ? 0 : r.cards[j]!, least(r)));
          }
      return best;
    };
    for (const p of [[9, 10, 25, 40], [75, 8, 13, 24], ...SEEDS.slice(0, 40).map((d) => puzzleOf(d).nums)])
      expect([p, told(p).most]).toEqual([p, least(table(p))]);
  });

  it("tells a step wherever 325 can still be made, and only there", () => {
    const after = (t: Table) =>
      t.cards.flatMap((_, i) =>
        t.cards.flatMap((__, j) =>
          OPS.flatMap((op) => {
            const r = put(t, i, op, j);
            return typeof r === "string" || r === t ? [] : [r];
          }),
        ),
      );
    let tables = [table([9, 10, 25, 40]), table([7, 11, 13, 21]), ...SEEDS.slice(0, 12).map((d) => table(puzzleOf(d).nums))];
    let seen = 0;
    for (let depth = 0; depth < 3; depth++) {
      for (const t of tables) {
        const left = t.cards.filter((c): c is number => c !== null);
        const s = nextStep(t.cards);
        expect([t.cards, s !== null]).toEqual([t.cards, reaches(left, MAKE_GOAL)]);
        if (s) {
          const r = put(t, s.from, s.op, s.to) as Table;
          expect(reaches(r.cards.filter((c): c is number => c !== null), MAKE_GOAL)).toBe(true);
        }
        seen++;
      }
      tables = tables.flatMap(after);
    }
    expect(seen).toBeGreaterThan(1000);
  });

  it("says how many steps back 325 can be made again", () => {
    const nums = [9, 10, 25, 40];
    expect(stepsBack(table(nums))).toBe(0);
    expect(stepsBack(walk(nums, [0, "×", 3]))).toBe(0);
    // 9 + 10: one step back
    expect(stepsBack(walk(nums, [0, "+", 1]))).toBe(1);
    // 9 × 40, 10 × 25: one; 9 + 10, 19 + 25: two, all there were (重来)
    expect(stepsBack(walk(nums, [0, "×", 3], [1, "×", 2]))).toBe(1);
    expect(stepsBack(walk(nums, [0, "+", 1], [1, "+", 2]))).toBe(2);
    // one card left: 9 × 40, 10 × 25, 250 + 360 = 610 two back; 9 + 10, 19 + 25, 44 + 40 = 84 all three
    expect(stepsBack(walk(nums, [0, "×", 3], [1, "×", 2], [2, "+", 3]))).toBe(2);
    expect(stepsBack(walk(nums, [0, "+", 1], [1, "+", 2], [2, "+", 3]))).toBe(3);
  });

  it("tells MAKE_HINTS steps a round, cards told already again for nothing, and how far back for nothing too", () => {
    expect(MAKE_HINTS).toBe(2);
    const nums = [9, 10, 25, 40];
    const first = askHint([], table(nums));
    const by10: Step = { from: 3, op: "÷", to: 1 };
    expect(first).toEqual({ step: by10, told: [{ cards: "9,10,25,40", step: by10 }] });
    let hints: Told = (first as { told: Told }).told;
    // asked again for the same cards: the same, nothing more told
    expect(askHint(hints, table(nums))).toEqual({ step: by10, told: hints });
    // where 325 cannot be made any more: how far back, nothing told
    expect(askHint(hints, walk(nums, [0, "+", 1]))).toEqual({ back: 1 });
    // the step told taken, the next is told
    let t = walk(nums, [3, "÷", 1]);
    const second = askHint(hints, t) as { step: Step; told: Told };
    expect(said(t.cards, second.step)).toBe("4 + 9");
    expect(second.told).toHaveLength(2);
    hints = second.told;
    // a third is not, but cards told already still are, and how far back still is
    t = put(t, second.step.from, second.step.op, second.step.to) as Table;
    expect(askHint(hints, t)).toBeNull();
    expect(askHint(hints, restart(t))).toEqual({ step: by10, told: hints });
    expect(askHint(hints, walk(nums, [0, "+", 1], [1, "+", 2]))).toEqual({ back: 2 });
  });
});
