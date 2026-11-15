import bank from "@/data/make325-bank.json";

/**
 * 凑 325 (src/components/app/study/Make325.tsx): four numbers to make 325 with + − × ÷, each used once, two at a time
 * put together into one until one is left. Every step must come out a whole number above nought: nothing divided
 * unevenly, nothing taken away down to nought or below. A round's four are one of the bank's (MAKE_BANK), every four of
 * MAKE_POOL that make 325 while no two or three of them alone do (else 325 could be made with a number left over, or
 * × 7 ÷ 7 given away), and at least two ways (else it is likely a knot only one way undoes). Each round deals one
 * afresh (rules.ts newSeed), never one of those this device dealt last, its cards in an order of their own.
 */

/** What a round's four are drawn from */
export const MAKE_POOL: readonly number[] = [...Array.from({ length: 24 }, (_, i) => i + 2), 30, 40, 50, 60, 75, 100];
export const MAKE_GOAL = 325;
/** How long before 看答案 is offered (ms) */
export const MAKE_HELP_MS = 60_000;
/**
 * Every fair four of MAKE_POOL, smallest first (fair below): src/data/make325-bank.json, written by
 * scripts/build-make325-bank.mts, so that no phone searches for one
 */
export const MAKE_BANK: readonly (readonly number[])[] = bank.puzzles;
/** How many of the puzzles this device dealt last are not dealt again */
export const MAKE_RECENT = 200;

export const OPS = ["+", "−", "×", "÷"] as const;
export type Op = (typeof OPS)[number];

/** Why two numbers could not be put together */
export type Refusal = "uneven" | "notPositive";

/** Two numbers put together, or why not */
export function combine(a: number, op: Op, b: number): number | Refusal {
  switch (op) {
    case "+":
      return a + b;
    case "×":
      return a * b;
    case "−":
      return a > b ? a - b : "notPositive";
    case "÷":
      return a % b === 0 ? a / b : "uneven";
  }
}

/**
 * A way to a number: one of the four, or two ways put together. key tells ways apart as the game does: 13 × 25 and
 * 25 × 13 are one way, and so are two steps that do not touch each other taken in either order. text is the way as it
 * is written, with brackets only where they are needed.
 */
type Way = { n: number; key: string; text: string; tier: 1 | 2 | 3 };

const leaf = (n: number): Way => ({ n, key: `${n}`, text: `${n}`, tier: 3 });

function join(a: Way, op: Op, b: Way, n: number): Way {
  const swaps = op === "+" || op === "×";
  const key = swaps && b.key < a.key ? `(${b.key}${op}${a.key})` : `(${a.key}${op}${b.key})`;
  const tier = op === "+" || op === "−" ? 1 : 2;
  const left = a.tier < tier ? `(${a.text})` : a.text;
  const right = b.tier < tier || (b.tier === tier && !swaps) ? `(${b.text})` : b.text;
  return { n, key, text: `${left} ${op} ${right}`, tier };
}

/**
 * Every different way some numbers, all of them, make a goal, in the order the game would come on them; or only the
 * first few, when that is enough
 */
export function waysTo(nums: readonly number[], goal: number, enough = Infinity): { key: string; text: string }[] {
  const found = new Map<string, string>();
  const go = (ways: Way[]) => {
    if (found.size >= enough) return;
    if (ways.length === 1) {
      if (ways[0].n === goal && !found.has(ways[0].key)) found.set(ways[0].key, ways[0].text);
      return;
    }
    for (let i = 0; i < ways.length; i++)
      for (let j = i + 1; j < ways.length; j++) {
        const rest = ways.filter((_, k) => k !== i && k !== j);
        for (const op of OPS)
          for (const [a, b] of op === "+" || op === "×" ? [[ways[i], ways[j]]] : [[ways[i], ways[j]], [ways[j], ways[i]]]) {
            const n = combine(a.n, op, b.n);
            if (typeof n === "number") go([...rest, join(a, op, b, n)]);
          }
      }
  };
  go(nums.map(leaf));
  return [...found].map(([key, text]) => ({ key, text }));
}

/** Whether some numbers, all of them, can make a goal: as waysTo, but yes or no only, and quicker */
export function reaches(nums: readonly number[], goal: number): boolean {
  if (nums.length === 1) return nums[0] === goal;
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++) {
      const a = nums[i];
      const b = nums[j];
      const rest = nums.filter((_, k) => k !== i && k !== j);
      // what the two can be put together into: nought for what is refused (nothing above nought is)
      for (const n of [a + b, a * b, Math.abs(a - b), a % b === 0 ? a / b : 0, b % a === 0 ? b / a : 0])
        if (n > 0 && reaches([...rest, n], goal)) return true;
    }
  return false;
}

/** The sets of two and of three of some numbers */
function smaller(nums: readonly number[]): number[][] {
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << nums.length; mask++) {
    const pick = nums.filter((_, i) => mask & (1 << i));
    if (pick.length >= 2 && pick.length < nums.length) out.push(pick);
  }
  return out;
}

/** Whether four numbers make a round's puzzle: 325 at least two ways, and none with fewer of them */
export function fair(nums: readonly number[]): boolean {
  return (
    reaches(nums, MAKE_GOAL) &&
    smaller(nums).every((s) => !reaches(s, MAKE_GOAL)) &&
    waysTo(nums, MAKE_GOAL, 2).length >= 2
  );
}

/**
 * A round's puzzle, from its random (mulberry32 of its seed): one of the bank's (k, its place there) that is not among
 * recent (those this device dealt last, recentPuzzles), its four cards in an order of their own, and a way to 325 for
 * 看答案
 */
export function makePuzzle(random: () => number, recent: readonly number[] = []): { k: number; nums: number[]; answer: string } {
  const skip = new Set(recent);
  const open = MAKE_BANK.map((_, k) => k).filter((k) => !skip.has(k));
  const from = open.length ? open : MAKE_BANK.map((_, k) => k);
  const k = from[Math.min(from.length - 1, Math.floor(random() * from.length))];
  const nums = [...MAKE_BANK[k]];
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return { k, nums, answer: waysTo(MAKE_BANK[k], MAKE_GOAL, 1)[0].text };
}

const RECENT_KEY = "zhoup.study.make325";
/** The puzzles this page dealt last, for a browser that keeps nothing (a private window) */
let held: number[] = [];

/** The puzzles this device dealt last, by their place in the bank, the latest last: MAKE_RECENT at most */
export function recentPuzzles(): number[] {
  let kept: number[] = [];
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (Array.isArray(v)) kept = v.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < MAKE_BANK.length);
  } catch {}
  return [...kept.filter((k) => !held.includes(k)), ...held].slice(-MAKE_RECENT);
}

/** A puzzle dealt on this device: not dealt again until MAKE_RECENT others were */
export function dealtPuzzle(k: number) {
  held = [...recentPuzzles().filter((r) => r !== k), k].slice(-MAKE_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(held));
  } catch {}
}

/** The cards on the table, a place each (null: put together into another), and the tables before, for 撤一步 */
export type Table = { cards: (number | null)[]; past: (number | null)[][] };

export const table = (nums: readonly number[]): Table => ({ cards: [...nums], past: [] });

/** The card at from put together with the card at to, which takes the result; or why not */
export function put(t: Table, from: number, op: Op, to: number): Table | Refusal {
  const a = t.cards[from];
  const b = t.cards[to];
  if (a === null || b === null || from === to) return t;
  const n = combine(a, op, b);
  if (typeof n !== "number") return n;
  return { cards: t.cards.map((c, i) => (i === from ? null : i === to ? n : c)), past: [...t.past, t.cards] };
}

/** One step back */
export const undo = (t: Table): Table => (t.past.length ? { cards: t.past[t.past.length - 1], past: t.past.slice(0, -1) } : t);
/** Back to the four */
export const restart = (t: Table): Table => (t.past.length ? { cards: t.past[0], past: [] } : t);
/** The one card left, once there is only one */
export const lastCard = (t: Table): number | null => {
  const left = t.cards.filter((c): c is number => c !== null);
  return left.length === 1 ? left[0] : null;
};
