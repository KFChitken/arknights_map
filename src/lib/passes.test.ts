import { describe, expect, it } from "vitest";
import { CATALOG_IDS, CATALOG_SIZE, catalogCounts, isPassChar, passChar, passCharNamed, PASS_CATALOG, poolIds, poolSize } from "./passCatalog";
import {
  bestOf,
  claimable,
  DAY_TICKETS,
  FOLLOW_CODE_CHARS,
  followCode,
  goldKind,
  gotToday,
  isDrawSize,
  isFancy,
  isFoil,
  isPassPool,
  isTask,
  padNo,
  PASS_POOLS,
  passesDot,
  passPoolOf,
  PITY,
  pityLeft,
  randomFollowCode,
  rollChars,
  styleFor,
  TASK_MAX,
  TICKETS_CAP,
  tiersOf,
  unclaimed,
  type Tier,
} from "./passes";

/** Pearson's chi-square of counts against the same expected count for each */
function chiSquare(counts: readonly number[], expected: number): number {
  return counts.reduce((x, c) => x + (c - expected) ** 2 / expected, 0);
}

/**
 * About the 1-in-a-million mark of a chi-square with df degrees of freedom (Wilson–Hilferty: 37.5 for 5, 635 for 474),
 * so the tests only fail on a real bias
 */
function farTail(df: number): number {
  const z = 4.7534; // the standard normal's 1-in-a-million mark
  const v = 2 / (9 * df);
  return df * (1 - v + z * Math.sqrt(v)) ** 3;
}

/**
 * crypto's randomInt(n), but from a seed (mulberry32): the same numbers on every run, so a test of chances has one
 * answer and cannot fail by bad luck
 */
function seededInt(seed: number): (n: number) => number {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return (n) => {
    // whole numbers below n with no bias: draws past the last full run of n are thrown away
    const limit = 2 ** 32 - (2 ** 32 % n);
    let x = next();
    while (x >= limit) x = next();
    return x % n;
  };
}

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
    const { picks, miss } = rollChars(ids, [], 0, ids.length * per, seededInt(1));
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
    const rand = seededInt(2);
    let allSure = true;
    for (let i = 0; i < wish.length * per; i++) {
      const { picks, miss } = rollChars(ids, wish, PITY - 1, 1, rand);
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

/** rollChars as it drew before 卡池 (2026-11-17): what both games' must still draw, die for die */
function rollBefore(ids: readonly number[], wish: readonly number[], miss: number, n: number, rand: (n: number) => number) {
  const wished = new Set(wish);
  const picks: { charId: number; wish: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const charId = wish.length && miss >= PITY - 1 ? wish[rand(wish.length)] : ids[rand(ids.length)];
    const hit = wished.has(charId);
    miss = hit || !wish.length ? 0 : miss + 1;
    picks.push({ charId, wish: hit });
  }
  return { picks, miss };
}

describe("卡池", () => {
  const ids = CATALOG_IDS;
  const ak = poolIds("ak")!;
  const ef = poolIds("ef")!;

  it("is both games, 方舟's 441 or 终末地's 34", () => {
    expect(PASS_POOLS).toEqual(["both", "ak", "ef"]);
    expect(poolIds("both")).toBeNull();
    expect([poolSize("both"), poolSize("ak"), poolSize("ef")]).toEqual([475, 441, 34]);
    expect(ak.every((i) => passChar(i)!.game === "ak")).toBe(true);
    expect(ef.every((i) => passChar(i)!.game === "ef")).toBe(true);
    expect(new Set([...ak, ...ef]).size).toBe(CATALOG_SIZE);
    for (const p of PASS_POOLS) expect(isPassPool(p)).toBe(true);
    for (const x of ["", "arknights", "endfield", "EF", "toString", null, undefined, 1, ["ef"]]) expect(isPassPool(x), String(x)).toBe(false);
  });

  it("follows 在玩 until the player picks one: one game alone, else both", () => {
    expect(passPoolOf(null, ["endfield"])).toBe("ef");
    expect(passPoolOf(null, ["arknights"])).toBe("ak");
    expect(passPoolOf(null, ["arknights", "endfield"])).toBe("both");
    expect(passPoolOf(null, ["endfield", "arknights"])).toBe("both");
    expect(passPoolOf(null, [])).toBe("both");
    expect(passPoolOf("both", ["endfield"])).toBe("both");
    expect(passPoolOf("ak", ["endfield"])).toBe("ak");
    expect(passPoolOf("ef", [])).toBe("ef");
  });

  it("draws with both games just as before: the same dice bring the same passes, the sure ones too", () => {
    const wishes = [[], [5], [1, 145, 300, 442, 450, 475], [ef[0], ak[3]]];
    for (let seed = 1; seed <= 40; seed++) {
      const wish = wishes[seed % wishes.length];
      const miss = (seed * 7) % PITY;
      const before = rollBefore(ids, wish, miss, 300, seededInt(seed));
      expect(rollChars(ids, wish, miss, 300, seededInt(seed)), String(seed)).toEqual(before);
      expect(rollChars(ids, wish, miss, 300, seededInt(seed), poolIds("both")), String(seed)).toEqual(before);
      if (wish.length) expect(before.picks.some((p) => p.wish)).toBe(true);
    }
  });

  it("brings only 终末地's off the wish list, and the wish list, 方舟's too, as often as with both: 6 in 475", () => {
    const wish = [ak[0], ak[200], ak[440], ef[0], ef[17], ef[33]];
    const pulls = 300_000;
    const rand = seededInt(3);
    const wished = new Map(wish.map((i) => [i, 0]));
    const others = new Map(ef.filter((i) => !wish.includes(i)).map((i) => [i, 0]));
    let stray = 0;
    for (let i = 0; i < pulls; i++) {
      // a count of 0 each time: the chance alone, no sure pull
      const [p] = rollChars(ids, wish, 0, 1, rand, ef).picks;
      const seen = p.wish ? wished : others;
      if (seen.has(p.charId)) seen.set(p.charId, seen.get(p.charId)! + 1);
      else stray++;
    }
    expect(stray).toBe(0);
    const hits = [...wished.values()].reduce((a, b) => a + b, 0);
    const chance = wish.length / CATALOG_SIZE;
    expect(Math.abs(hits - pulls * chance)).toBeLessThan(4.75 * Math.sqrt(pulls * chance * (1 - chance)));
    // each of the wish list as likely, 方舟's as 终末地's; and everyone else of 终末地 as likely
    expect(chiSquare([...wished.values()], hits / wish.length)).toBeLessThan(farTail(wish.length - 1));
    expect(Math.min(...others.values())).toBeGreaterThan(0);
    expect(chiSquare([...others.values()], (pulls - hits) / others.size)).toBeLessThan(farTail(others.size - 1));

    // 只抽方舟 the same way round
    const theirs = rollChars(ids, [ef[5]], 0, 20_000, seededInt(4), ak).picks;
    expect(theirs.every((p) => (p.wish ? p.charId === ef[5] : ak.includes(p.charId)))).toBe(true);
    expect(theirs.some((p) => p.wish)).toBe(true);
  });

  it("takes the chance of a wish first, wish.length in all 475, then someone of the game off the wish list", () => {
    const wish = [ak[9], ef[4]];
    const rest = ef.filter((i) => !wish.includes(i));
    // dice: the first under wish.length brings that wish; past it, the next picks among the rest
    const script = [1, 474, 0, 300, 31, 0];
    let i = 0;
    const rand = (n: number) => {
      const x = script[i++];
      expect(x).toBeLessThan(n);
      return x;
    };
    const { picks, miss } = rollChars(ids, wish, 3, 4, rand, ef);
    expect(picks).toEqual([
      { charId: ef[4], wish: true },
      { charId: rest[0], wish: false },
      { charId: rest[31], wish: false },
      { charId: ak[9], wish: true },
    ]);
    expect(miss).toBe(0);
    expect(i).toBe(script.length);
  });

  it("keeps pity as it was: the 30th pull without a wish brings one of the list, whatever the 卡池", () => {
    const wish = [ak[5], ef[2]];
    const rest = ef.filter((i) => !wish.includes(i));
    // the chance never comes; the sure pull takes the first of the list, 方舟's
    const never = (n: number) => (n === ids.length ? n - 1 : 0);
    const run = rollChars(ids, wish, 0, PITY + 3, never, ef);
    expect(run.picks.findIndex((p) => p.wish)).toBe(PITY - 1);
    expect(run.picks[PITY - 1].charId).toBe(ak[5]);
    expect(run.picks.filter((p) => !p.wish).every((p) => p.charId === rest[0])).toBe(true);
    expect(run.miss).toBe(3);
    expect(rollChars(ids, wish, 28, 10, never, ef).picks.map((p) => p.wish)).toEqual(rollBefore(ids, wish, 28, 10, never).picks.map((p) => p.wish));
    // an empty wish list keeps no count
    expect(rollChars(ids, [], PITY - 1, 10, never, ef)).toEqual({ picks: Array(10).fill({ charId: ef[0], wish: false }), miss: 0 });
  });

  it("draws as both when a game has nobody off the wish list", () => {
    const { picks } = rollChars(ids, [5, 6], 0, 200, seededInt(5), [5, 6]);
    expect(picks.every((p) => isPassChar(p.charId))).toBe(true);
    expect(picks.some((p) => ![5, 6].includes(p.charId))).toBe(true);
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

  it("knows the gold numbers: the first hundred, and 靓号 with 325 or 799 in them", () => {
    for (const n of [1, 42, 100]) expect(goldKind(n), String(n)).toBe("top");
    for (const n of [325, 799, 1325, 3250, 7990, 13258, 17991]) expect(goldKind(n), String(n)).toBe("lucky");
    for (const n of [101, 666, 8888, 3000, 1111, 352, 797, 3205, 10000, 0]) expect(goldKind(n), String(n)).toBe("");
    for (const n of [1, 2, 12, 100, 325, 13258]) expect(isFoil(n), String(n)).toBe(true);
    for (const n of [101, 111, 8888, 1000, 3000, 352]) expect(isFoil(n), String(n)).toBe(false);
  });

  it("prints six digits, and the number as it is from a million on", () => {
    expect([1, 12, 345, 6789, 10000, 123456, 1234567].map(padNo)).toEqual(["000001", "000012", "000345", "006789", "010000", "123456", "1234567"]);
  });

  it("draws one or ten, and a day of play brings ten tickets at most", () => {
    expect([1, 10].every(isDrawSize)).toBe(true);
    for (const x of [0, 2, 5, 11, "1", "10", null, 1.5]) expect(isDrawSize(x), String(x)).toBe(false);
    expect(DAY_TICKETS).toBe(10);
  });
});

describe("每日任务", () => {
  it("are touching someone 3, declaring 2, answering a declaration 3 and touching an NPC 2 a day, ten in all", () => {
    expect(TASK_MAX).toEqual({ touch: 3, declare: 2, reply: 3, npc: 2 });
    expect(DAY_TICKETS).toBe(10);
    expect(["touch", "declare", "reply", "npc"].every(isTask)).toBe(true);
    for (const x of ["social", "guide", "gift", "toString", "", null, 1]) expect(isTask(x), String(x)).toBe(false);
  });

  it("claims what was done and not claimed, as many as fit under 50", () => {
    expect(claimable({ done: 3, got: 1 }, 10)).toBe(2);
    expect(claimable({ done: 3, got: 3 }, 10)).toBe(0);
    expect(claimable({ done: 3, got: 0 }, TICKETS_CAP - 1)).toBe(1);
    expect(claimable({ done: 3, got: 0 }, TICKETS_CAP)).toBe(0);
    // a gift may take a wallet past 50
    expect(claimable({ done: 2, got: 0 }, TICKETS_CAP + 2)).toBe(0);
    const day = [
      { done: 3, got: 1 },
      { done: 2, got: 2 },
      { done: 1, got: 0 },
      { done: 0, got: 0 },
    ];
    expect(unclaimed(day)).toBe(3);
    expect(gotToday(day)).toBe(3);
  });

  it("put a dot on the 寻访 button for the first ten, a ticket to claim with room for it, or ten for a draw", () => {
    const none = [{ done: 0, got: 0 }];
    const one = [{ done: 1, got: 0 }];
    expect(passesDot(false, 0, none)).toBe(true);
    expect(passesDot(true, 9, none)).toBe(false);
    expect(passesDot(true, 9, one)).toBe(true);
    expect(passesDot(true, 10, none)).toBe(true);
    expect(passesDot(true, 0, [{ done: 2, got: 2 }])).toBe(false);
  });
});

describe("关注 B 站领券's code", () => {
  it("is compared with no spaces, in capitals", () => {
    expect(followCode(" k7m q2x\t")).toBe("K7MQ2X");
    expect(followCode("  \n ")).toBe("");
  });

  it("comes from 「随机生成」 as 6 of 32 characters, none read as another, each byte picking one as likely as any", () => {
    expect(FOLLOW_CODE_CHARS).toHaveLength(32);
    expect(new Set(FOLLOW_CODE_CHARS).size).toBe(32);
    expect(FOLLOW_CODE_CHARS).not.toMatch(/[01IO]/);
    expect(randomFollowCode(new Uint8Array([0, 1, 2, 31, 32, 255]))).toBe("234Z2Z");
    const made = randomFollowCode();
    expect(made).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(followCode(made)).toBe(made);
  });
});
