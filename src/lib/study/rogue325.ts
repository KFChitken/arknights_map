/**
 * 控分肉鸽 (src/components/app/study/Rogue325.tsx): a school building of ROGUE.floors floors, ROGUE.doors classroom
 * doors to a floor, what each does to the score chalked on it. The player's roach goes up from the first floor through
 * a door of each, and the score, from 0, changes as the door says, never below 0; a door gone through stays gone through.
 * Every door is in sight from the start and nothing is left to chance. At the top the round is passed with a score of
 * 300 to 350, and comes to 命运的 325 at exactly 325.
 *
 * A round's building is dealt from its random: each door +N (25 to 120), −N (10 to 60), ×2 (not on the first floor) or
 * the 源石虫's −40, as often as ROGUE.odds says, no two the same on a floor; kept only if, of its 3⁵ = 243 ways up, from
 * 1 to 6 come to exactly 325 and from 8% to 35% pass. About two in three of those dealt keep, most with 2 to 4 ways to
 * exactly 325 and 20 to 50 passing; after ROGUE.tries (of 20000 rounds tried, none took more than 12) the spare building
 * is dealt, SPARE.
 *
 * Everything here is pure.
 */

/** How it plays, all in one place: after Breeze has played it, only these change */
export const ROGUE = {
  floors: 5,
  doors: 3,
  /** How often a door is ×2 (not on the first floor, whose doors are +N instead), −N or the 源石虫: +N the rest */
  odds: { double: 0.15, minus: 0.17, slug: 0.08 },
  /** +N and −N: from, to, by */
  plus: [25, 120, 5] as const,
  minus: [10, 60, 5] as const,
  /** What the 源石虫 takes */
  slug: 40,
  /** The scores that pass, from and to */
  pass: [300, 350] as const,
  /** A building keeps with so many ways up to exactly 325, and so much of its ways up passing (from and to) */
  exact: [1, 6] as const,
  share: [0.08, 0.35] as const,
  /** Buildings dealt at most before the spare one */
  tries: 200,
};

/** The score a round is played for */
export const ROGUE_GOAL = 325;

/** A door: what is chalked on it */
export type Door = { kind: "plus"; n: number } | { kind: "minus"; n: number } | { kind: "double" } | { kind: "slug" };

/** A building: its floors from the first up, each its doors from the left */
export type Building = readonly (readonly Door[])[];

/** The score after a door: never below 0 */
export function enter(score: number, d: Door): number {
  const after = d.kind === "plus" ? score + d.n : d.kind === "minus" ? score - d.n : d.kind === "double" ? score * 2 : score - ROGUE.slug;
  return Math.max(0, after);
}

/** The score after a way up, or part of one: the door taken on each floor (from 0 at the left), from the first */
export const scoreOf = (b: Building, way: readonly number[]): number => way.reduce((s, door, f) => enter(s, b[f][door]), 0);

/** Every way up a building, all its floors, and the score at the top */
export function waysOf(b: Building): { way: number[]; score: number }[] {
  let ways: { way: number[]; score: number }[] = [{ way: [], score: 0 }];
  for (const floor of b) ways = ways.flatMap((w) => floor.map((d, door) => ({ way: [...w.way, door], score: enter(w.score, d) })));
  return ways;
}

/** Whether a score at the top passes */
export const passes = (score: number) => score >= ROGUE.pass[0] && score <= ROGUE.pass[1];

/** How a round ends with a score at the top: passed from 300 to 350, and 命运的 325 at exactly 325 */
export const endOf = (score: number) => ({ won: passes(score), fate: score === ROGUE_GOAL });

/** How many ways up a building has, how many pass, and how many come to exactly 325 */
export function countsOf(b: Building): { ways: number; pass: number; exact: number } {
  const ways = waysOf(b);
  return { ways: ways.length, pass: ways.filter((w) => passes(w.score)).length, exact: ways.filter((w) => w.score === ROGUE_GOAL).length };
}

/** Whether a building is one to deal: from 1 to 6 ways to exactly 325, and from 8% to 35% of its ways passing */
export function keeps(b: Building): boolean {
  const { ways, pass, exact } = countsOf(b);
  return exact >= ROGUE.exact[0] && exact <= ROGUE.exact[1] && pass >= ROGUE.share[0] * ways && pass <= ROGUE.share[1] * ways;
}

/** Two doors that do the same: the 源石虫 is −40 */
const sameAs = (a: Door, b: Door) => {
  const minus = (d: Door) => (d.kind === "slug" ? ROGUE.slug : d.kind === "minus" ? d.n : null);
  return a.kind === b.kind ? !("n" in a) || a.n === (b as { n: number }).n : minus(a) !== null && minus(a) === minus(b);
};

/** A door dealt for a floor (0 the first) */
function dealDoor(random: () => number, floor: number): Door {
  const pick = ([from, to, by]: readonly [number, number, number]) => from + by * Math.min((to - from) / by, Math.floor(random() * ((to - from) / by + 1)));
  const { double, minus, slug } = ROGUE.odds;
  const r = random();
  if (r < double) return floor > 0 ? { kind: "double" } : { kind: "plus", n: pick(ROGUE.plus) };
  if (r < double + minus) return { kind: "minus", n: pick(ROGUE.minus) };
  if (r < double + minus + slug) return { kind: "slug" };
  return { kind: "plus", n: pick(ROGUE.plus) };
}

/** A building dealt from a random, whether it keeps or not: no two doors the same on a floor */
export function dealBuilding(random: () => number): Building {
  return Array.from({ length: ROGUE.floors }, (_, floor) => {
    const doors: Door[] = [];
    while (doors.length < ROGUE.doors) {
      const d = dealDoor(random, floor);
      if (!doors.some((o) => sameAs(o, d))) doors.push(d);
    }
    return doors;
  });
}

/** The spare building: 3 ways up to exactly 325, 33 of the 243 passing */
export const SPARE: Building = [
  [
    { kind: "plus", n: 40 },
    { kind: "plus", n: 110 },
    { kind: "plus", n: 100 },
  ],
  [
    { kind: "plus", n: 110 },
    { kind: "slug" },
    { kind: "plus", n: 75 },
  ],
  [
    { kind: "plus", n: 30 },
    { kind: "plus", n: 35 },
    { kind: "minus", n: 35 },
  ],
  [
    { kind: "double" },
    { kind: "minus", n: 30 },
    { kind: "plus", n: 45 },
  ],
  [
    { kind: "plus", n: 60 },
    { kind: "double" },
    { kind: "plus", n: 115 },
  ],
];

/** A round's building, from its random (mulberry32 of its seed), as the top of this file says */
export function rogueBuilding(random: () => number): Building {
  for (let k = 0; k < ROGUE.tries; k++) {
    const b = dealBuilding(random);
    if (keeps(b)) return b;
  }
  return SPARE;
}

/**
 * A way up to exactly 325, shown once a round is over: of those, the one that keeps the most of the floors of a way
 * taken (from the first), and of them the leftmost doors first
 */
export function toGoal(b: Building, near: readonly number[] = []): number[] | null {
  const kept = (way: readonly number[]) => {
    let k = 0;
    while (k < near.length && way[k] === near[k]) k++;
    return k;
  };
  let best: number[] | null = null;
  for (const w of waysOf(b)) if (w.score === ROGUE_GOAL && (!best || kept(w.way) > kept(best))) best = w.way;
  return best;
}
