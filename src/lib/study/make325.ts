/**
 * 凑 325 (src/components/app/study/Make325.tsx): four numbers to make 325 with + − × ÷, each used once, two at a time
 * put together into one until one is left. Every step must come out a whole number above nought: nothing divided
 * unevenly, nothing taken away down to nought or below. The day's four are the same for everyone who plays it that day
 * (rules.ts dayRandom): drawn until they make 325, no two or three of them alone do (else 325 could be made with a
 * number left over, or × 7 ÷ 7 given away), and it can be done at least two ways (else it is likely a knot only one way
 * undoes).
 */

/** What the day's four are drawn from */
export const MAKE_POOL: readonly number[] = [...Array.from({ length: 24 }, (_, i) => i + 2), 30, 40, 50, 60, 75, 100];
export const MAKE_GOAL = 325;
/** How many draws before falling back on a set four (over a thousand days it never has) */
export const MAKE_TRIES = 5000;
export const MAKE_FALLBACK: readonly number[] = [9, 10, 25, 40];
/** How long before 看答案 is offered (ms) */
export const MAKE_HELP_MS = 60_000;

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

/** Whether four numbers make a day's puzzle: 325 at least two ways, and none with fewer of them */
export function fair(nums: readonly number[]): boolean {
  return (
    reaches(nums, MAKE_GOAL) &&
    smaller(nums).every((s) => !reaches(s, MAKE_GOAL)) &&
    waysTo(nums, MAKE_GOAL, 2).length >= 2
  );
}

/** The day's four, smallest first, from its random (rules.ts dayRandom), and a way to 325 for 看答案 */
export function makePuzzle(random: () => number): { nums: number[]; answer: string; fallback: boolean } {
  for (let t = 0; t < MAKE_TRIES; t++) {
    const pool = [...MAKE_POOL];
    const nums: number[] = [];
    while (nums.length < 4) nums.push(pool.splice(Math.min(pool.length - 1, Math.floor(random() * pool.length)), 1)[0]);
    nums.sort((a, b) => a - b);
    if (fair(nums)) return { nums, answer: waysTo(nums, MAKE_GOAL, 1)[0].text, fallback: false };
  }
  return { nums: [...MAKE_FALLBACK], answer: waysTo(MAKE_FALLBACK, MAKE_GOAL, 1)[0].text, fallback: true };
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
