import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CATALOG_IDS, CATALOG_SIZE, catalogCounts, isPassChar, passChar, passCharNamed, PASS_CATALOG } from "./passCatalog";
import {
  bestOf,
  DAY_TICKETS,
  isDrawSize,
  isFancy,
  isFoil,
  padNo,
  PITY,
  pityLeft,
  rollChars,
  styleFor,
  tiersOf,
  type Tier,
} from "./passes";

/** Pearson's chi-square of counts against the same expected count for each */
function chiSquare(counts: readonly number[], expected: number): number {
  return counts.reduce((x, c) => x + (c - expected) ** 2 / expected, 0);
}

/** Far past the 1-in-a-million mark of a chi-square with df degrees of freedom, so the tests only fail on a real bias */
const farTail = (df: number) => df + 5 * Math.sqrt(2 * df);

describe("通行证寻访's characters", () => {
  it("are both games' lists, story and collaboration characters included, each once", () => {
    expect(CATALOG_SIZE).toBe(475);
    expect(catalogCounts()).toEqual({ ak: 441, ef: 34 });
    expect(new Set(CATALOG_IDS).size).toBe(CATALOG_SIZE);
    expect(new Set(PASS_CATALOG.map((c) => `${c.game}:${c.name}`)).size).toBe(CATALOG_SIZE);
    for (const c of PASS_CATALOG) {
      expect(c.color, c.name).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.isInteger(c.id) && c.id > 0 && c.id < 32768, c.name).toBe(true);
    }
    expect(passCharNamed("arknights", "阿米娅")).toMatchObject({ game: "ak", name: "阿米娅" });
    expect(passCharNamed("endfield", "管理员")).toMatchObject({ game: "ef" });
    expect(passCharNamed("endfield", "阿米娅")).toBeNull();
    expect(passChar(passCharNamed("arknights", "能天使")!.id)?.name).toBe("能天使");
    for (const x of [0, -1, 99999, 1.5, "1", null, undefined]) expect(isPassChar(x), String(x)).toBe(false);
  });
});

describe("rollChars", () => {
  const ids = CATALOG_IDS;

  it("gives every character the same chance (chi-square over all 475)", () => {
    const per = 200;
    const counts = new Map(ids.map((id) => [id, 0]));
    const { picks, miss } = rollChars(ids, [], 0, ids.length * per, randomInt);
    for (const p of picks) counts.set(p.charId, counts.get(p.charId)! + 1);
    expect(counts.size).toBe(ids.length);
    expect(Math.min(...counts.values())).toBeGreaterThan(0);
    expect(chiSquare([...counts.values()], per)).toBeLessThan(farTail(ids.length - 1));
    // nobody wished for: no count towards pity
    expect(miss).toBe(0);
    expect(picks.every((p) => !p.wish)).toBe(true);
  });

  it("brings someone from the wish list on the 30th draw without one, and starts the count again", () => {
    const wish = [5, 6];
    const never = ids.indexOf(400);
    // the dice never land on a wish by chance; for the sure pull, the first of the list
    const rand = (n: number) => (n === ids.length ? never : 0);
    const run = rollChars(ids, wish, 0, PITY + 3, rand);
    const at = run.picks.findIndex((p) => p.wish);
    expect(at).toBe(PITY - 1);
    expect(run.picks[at].charId).toBe(5);
    expect(run.picks.slice(0, at).every((p) => p.charId === 400)).toBe(true);
    expect(run.miss).toBe(3);
    // counted across draws: 28 before, then a ten
    const ten = rollChars(ids, wish, 28, 10, rand);
    expect(ten.picks.map((p) => p.wish)).toEqual([false, true, false, false, false, false, false, false, false, false]);
    expect(ten.miss).toBe(8);
    expect(pityLeft(0)).toBe(PITY);
    expect(pityLeft(PITY - 1)).toBe(1);
  });

  it("starts the count again on a wish that came by chance, owned or not", () => {
    const wish = [5, 6];
    let i = 0;
    // the fourth pull lands on 6 by chance
    const rand = () => (i++ === 3 ? ids.indexOf(6) : ids.indexOf(400));
    const { picks, miss } = rollChars(ids, wish, 20, 6, rand);
    expect(picks.map((p) => p.wish)).toEqual([false, false, false, true, false, false]);
    expect(miss).toBe(2);
  });

  it("shares the sure pulls evenly over the wish list, characters already owned included", () => {
    const wish = [1, 145, 300, 442, 450, 475];
    const per = 10_000;
    const counts = new Map(wish.map((id) => [id, 0]));
    let allSure = true;
    for (let i = 0; i < wish.length * per; i++) {
      const { picks, miss } = rollChars(ids, wish, PITY - 1, 1, randomInt);
      allSure &&= picks[0].wish && miss === 0;
      counts.set(picks[0].charId, counts.get(picks[0].charId)! + 1);
    }
    expect(allSure).toBe(true);
    expect(counts.size).toBe(wish.length);
    expect(chiSquare([...counts.values()], per)).toBeLessThan(farTail(wish.length - 1));
  });

  it("keeps no count with an empty wish list", () => {
    const rand = () => ids.indexOf(400);
    expect(rollChars(ids, [], 0, 100, rand).miss).toBe(0);
    expect(rollChars(ids, [], PITY - 1, 10, rand).picks.every((p) => p.charId === 400 && !p.wish)).toBe(true);
  });
});

describe("tiersOf", () => {
  const pick = (charId: number, wish = false) => ({ charId, wish });

  it("tells a new character, the second copy (special look unlocked), and the third on (潜能)", () => {
    expect(tiersOf([pick(1)], new Map(), [])).toEqual([{ tier: "new", up: false, fancy: false }]);
    expect(tiersOf([pick(1)], new Map([[1, 1]]), [])).toEqual([{ tier: "up", up: true, fancy: true }]);
    expect(tiersOf([pick(1)], new Map([[1, 2]]), [])).toEqual([{ tier: "dup", up: false, fancy: true }]);
    expect(tiersOf([pick(1)], new Map([[1, 7]]), [])).toEqual([{ tier: "dup", up: false, fancy: true }]);
  });

  it("counts a character drawn twice in one draw: new the first time, special look the second", () => {
    const tiers = tiersOf([pick(9), pick(1), pick(9), pick(9)], new Map([[1, 3]]), []);
    expect(tiers.map((t) => t.tier)).toEqual<Tier[]>(["new", "dup", "up", "dup"]);
    expect(tiers.map((t) => t.fancy)).toEqual([false, true, true, true]);
    expect(tiers.map((t) => t.up)).toEqual([false, false, true, false]);
  });

  it("names a wish first whichever copy it is, and keeps the normal look for those the player chose it for", () => {
    expect(tiersOf([pick(5, true), pick(5, true)], new Map(), [])).toEqual([
      { tier: "wish", up: false, fancy: false },
      { tier: "wish", up: true, fancy: true },
    ]);
    expect(tiersOf([pick(5), pick(5)], new Map(), [5])).toEqual([
      { tier: "new", up: false, fancy: false },
      { tier: "up", up: true, fancy: false },
    ]);
  });

  it("names the best of a draw: a wish, else a new character, else a special look, else the first", () => {
    const d = (tier: Tier, no: number) => ({ tier, no });
    expect(bestOf([d("dup", 1), d("new", 2), d("wish", 3), d("new", 4)])).toEqual(d("wish", 3));
    expect(bestOf([d("dup", 1), d("up", 2), d("new", 3)])).toEqual(d("new", 3));
    expect(bestOf([d("dup", 1), d("up", 2)])).toEqual(d("up", 2));
    expect(bestOf([d("dup", 1), d("dup", 2)])).toEqual(d("dup", 1));
    expect(bestOf([])).toBeUndefined();
  });
});

describe("a pass's look and number", () => {
  it("draws ① / ③ for one copy, ② / ④ from the second, and ① / ③ again for those kept plain", () => {
    expect(styleFor("ak", isFancy(1, false))).toBe("ra");
    expect(styleFor("ef", isFancy(1, false))).toBe("tag");
    expect(styleFor("ak", isFancy(2, false))).toBe("rax");
    expect(styleFor("ef", isFancy(5, false))).toBe("tagx");
    expect(styleFor("ak", isFancy(2, true))).toBe("ra");
    expect(styleFor("ef", isFancy(9, true))).toBe("tag");
  });

  it("knows No.1 and 靓号", () => {
    for (const n of [1, 111, 666, 8888, 11111, 1000, 3000, 999, 77777, 20000]) expect(isFoil(n), String(n)).toBe(true);
    for (const n of [112, 1001, 10, 2, 11, 22, 100, 1100, 12345, 0]) expect(isFoil(n), String(n)).toBe(false);
  });

  it("prints four digits below 10000, and the number as it is from there", () => {
    expect([1, 12, 345, 6789, 10000, 123456].map(padNo)).toEqual(["0001", "0012", "0345", "6789", "10000", "123456"]);
  });

  it("draws one or ten, and a day of play brings ten tickets at most", () => {
    expect([1, 10].every(isDrawSize)).toBe(true);
    for (const x of [0, 2, 5, 11, "1", "10", null, 1.5]) expect(isDrawSize(x), String(x)).toBe(false);
    expect(DAY_TICKETS).toBe(10);
  });
});
