import { describe, expect, it } from "vitest";
import { mulberry32 } from "../prng";
import { FAMILY, FISH_ITEMS, GIANT, KIND_ODDS, MINI, MOON, TIER_ODDS, dexCells, inDex, itemOf, type FishItem } from "./items";
import { dryAfter, junkAfter, mayBite, rollCatch, type RollAsk } from "./roll";
import { ADMIRAL_AFTER, PERFECT_GRACE_MS, PITY_AFTER, RING_MS, biteAfter, onTime } from "./rules";

/** A table with something of every tier on the bank, none of it held to a time or a crowd */
const FULL: FishItem[] = [1, 2, 3, 4, 5, 6].flatMap((tier): FishItem[] => [
  { no: tier * 10 + 1, key: `f${tier}`, cat: "fish", tier, fam: "fish", at: { pier: "big" }, cm: [20, 60] },
  { no: tier * 10 + 2, key: `j${tier}`, cat: "junk", tier, fam: "junk", at: { pier: "mid" } },
]);

const ask = (random: () => number, more: Partial<RollAsk> = {}): RollAsk => ({ spot: "pier", dry: 0, hour: 12, crowd: 0, caught: () => 0, random, ...more });

describe("what bites", () => {
  it("draws each tier as often as its odds over 100,000 casts", () => {
    const random = mulberry32(20261120);
    const seen = [0, 0, 0, 0, 0, 0];
    const N = 100_000;
    for (let i = 0; i < N; i++) seen[rollCatch(ask(random), FULL).tier - 1]++;
    // the odds need not add up to 100
    const sum = TIER_ODDS.reduce((a, b) => a + b, 0);
    seen.forEach((n, i) => expect(Math.abs((n / N) * 100 - (TIER_ODDS[i] * 100) / sum)).toBeLessThan(0.5));
  });

  it("never lets more than eight casts in a row go without blue, and makes 空军司令 of ten junk in a row", () => {
    const random = mulberry32(7);
    let dry = 0;
    let longest = 0;
    let junk = 0;
    let admirals = 0;
    for (let i = 0; i < 100_000; i++) {
      const roll = rollCatch(ask(random, { dry }), FULL);
      if (dry >= PITY_AFTER) expect(roll.tier).toBeGreaterThanOrEqual(3);
      dry = dryAfter(dry, roll.tier);
      longest = Math.max(longest, dry);
      junk = junkAfter(junk, FULL.find((x) => x.no === roll.no)!);
      if (junk === ADMIRAL_AFTER) admirals++;
    }
    expect(longest).toBe(PITY_AFTER);
    expect(admirals).toBeGreaterThan(0);
    expect(junkAfter(9, { cat: "junk" })).toBe(10);
    expect(junkAfter(9, { cat: "fish" })).toBe(0);
    expect(junkAfter(9, { cat: "junk", kind: "ticket" })).toBe(0);
  });

  it("gives one in twenty a variant of its family, 月夜的 only at night, and sizes in range", () => {
    const random = mulberry32(42);
    let variants = 0;
    let moonByDay = 0;
    let moonAtNight = 0;
    const N = 60_000;
    for (let i = 0; i < N; i++) {
      const day = rollCatch(ask(random, { hour: 13 }), FULL);
      const night = rollCatch(ask(random, { hour: 22 }), FULL);
      for (const r of [day, night]) {
        const item = FULL.find((x) => x.no === r.no)!;
        if (r.variant) {
          variants++;
          expect(FAMILY[item.fam!]).toContain(r.variant);
        }
        if (item.cm) {
          const scale = r.variant === MINI ? 0.5 : r.variant === GIANT ? 1.6 : 1;
          expect(r.cm!).toBeGreaterThanOrEqual(Math.floor(item.cm[0] * scale * 100) - 1);
          expect(r.cm!).toBeLessThanOrEqual(Math.ceil(item.cm[1] * scale * 100) + 1);
          if (r.variant === GIANT) expect(r.shadow).toBe("l");
        } else expect(r.cm).toBeNull();
      }
      if (day.variant === MOON) moonByDay++;
      if (night.variant === MOON) moonAtNight++;
    }
    expect(Math.abs(variants / (2 * N) - 0.05)).toBeLessThan(0.005);
    expect(moonByDay).toBe(0);
    expect(moonAtNight).toBeGreaterThan(0);
  });

  it("goes by an item's time, crowd and what was caught before, and keeps the room's own and the 通行证 out", () => {
    const base = { spot: "pier" as const, hour: 12, crowd: 0, caught: () => 0 };
    const dusk: FishItem = { no: 1, key: "d", cat: "fish", tier: 2, at: { pier: "mid" }, when: { hours: [17, 19] } };
    expect(mayBite(dusk, base)).toBe(false);
    expect(mayBite(dusk, { ...base, hour: 18 })).toBe(true);
    const late: FishItem = { ...dusk, when: { hours: [23, 2] } };
    expect(mayBite(late, { ...base, hour: 1 })).toBe(true);
    expect(mayBite(late, { ...base, hour: 3 })).toBe(false);
    const crowd: FishItem = { ...dusk, when: { crowd: 10 } };
    expect(mayBite(crowd, { ...base, crowd: 9 })).toBe(false);
    expect(mayBite(crowd, { ...base, crowd: 10 })).toBe(true);
    const after: FishItem = { ...dusk, when: { after: [4, 5] } };
    expect(mayBite(after, { ...base, caught: (no) => (no === 4 ? 4 : 0) })).toBe(false);
    expect(mayBite(after, { ...base, caught: (no) => (no === 4 ? 5 : 0) })).toBe(true);
    expect(mayBite({ ...dusk, when: { squad4: true } }, base)).toBe(false);
    expect(mayBite({ ...dusk, kind: "ticket" }, base)).toBe(false);
    expect(mayBite({ ...dusk, at: { pond: "big" } }, base)).toBe(false);
    expect(mayBite({ ...dusk, off: true }, base)).toBe(false);
    // the net: blue at most, and no variants
    const random = mulberry32(3);
    for (let i = 0; i < 2_000; i++) {
      const r = rollCatch({ ...ask(random), spot: "auto" }, FULL.map((x) => ({ ...x, at: { auto: "big" } })));
      expect(r.tier).toBeLessThanOrEqual(3);
      expect(r.variant).toBe(0);
    }
  });

  it("lets 寻访券 and 漂流瓶 bite only while the server says they may, never from the net; a tier given is drawn from, else the one under it", () => {
    const base = { spot: "pier" as const, hour: 12, crowd: 0, caught: () => 0 };
    const ticket = itemOf(27)!;
    const bottle = itemOf(30)!;
    expect([ticket.kind, bottle.kind]).toEqual(["ticket", "bottle"]);
    expect(mayBite(ticket, base)).toBe(false);
    expect(mayBite(ticket, { ...base, ticket: true })).toBe(true);
    expect(mayBite(ticket, { ...base, bottle: true })).toBe(false);
    expect(mayBite(bottle, { ...base, bottle: true })).toBe(true);
    expect(mayBite(bottle, { ...base, spot: "auto", bottle: true })).toBe(false);
    const random = mulberry32(5);
    for (let i = 0; i < 500; i++) {
      // a tier given (one that may no longer come by the pull): something else of it, never one of the two
      const gold = rollCatch(ask(random, { ticket: true, bottle: true }), FISH_ITEMS, 5);
      expect(gold.tier).toBe(5);
      expect(itemOf(gold.no)!.kind).toBeUndefined();
      // nothing else red: gold
      expect(rollCatch(ask(random), FISH_ITEMS, 6).tier).toBe(5);
      // nothing else of the tier at all: the one under it
      expect(rollCatch(ask(random), FULL.filter((x) => x.tier !== 5), 5).tier).toBe(4);
    }
    // no hour at all: nothing held to one, even one that runs past midnight
    const late: FishItem = { no: 1, key: "d", cat: "fish", tier: 2, at: { pier: "mid" }, when: { hours: [23, 2] } };
    expect(mayBite(late, { ...base, hour: -1 })).toBe(false);
  });

  it("draws 寻访券 and 漂流瓶 on their own, at their own odds wherever they may come, the same with more gold in the table", () => {
    const ticket = itemOf(27)!;
    const bottle = itemOf(30)!;
    expect([KIND_ODDS.ticket, KIND_ODDS.bottle]).toEqual([1.7, 0.4]);
    // by a draw in a hundred: the ticket's 1.7 first, then the bottle's 0.4, then the rest
    const fixed = (r: number, more: Partial<RollAsk> = { ticket: true, bottle: true }) => rollCatch(ask(() => r, more)).no;
    expect(fixed(0.0169)).toBe(ticket.no);
    expect(fixed(0.0171)).toBe(bottle.no);
    expect(fixed(0.0209)).toBe(bottle.no);
    expect([ticket.no, bottle.no]).not.toContain(fixed(0.0211));
    // one that may not come is no share at all: the other keeps its own
    expect(fixed(0.0039, { bottle: true })).toBe(bottle.no);
    expect(fixed(0.0041, { bottle: true })).not.toBe(bottle.no);
    expect(fixed(0.0169, { ticket: false, bottle: false })).not.toBe(ticket.no);
    const share = (items: readonly FishItem[], seed: number, more: Partial<RollAsk>) => {
      const random = mulberry32(seed);
      const N = 200_000;
      let t = 0;
      let b = 0;
      for (let i = 0; i < N; i++) {
        const no = rollCatch(ask(random, more), items).no;
        if (no === ticket.no) t++;
        else if (no === bottle.no) b++;
      }
      return [(t / N) * 100, (b / N) * 100];
    };
    const [t, b] = share(FISH_ITEMS, 31, { ticket: true, bottle: true });
    expect(Math.abs(t - 1.7)).toBeLessThan(0.1);
    expect(Math.abs(b - 0.4)).toBeLessThan(0.05);
    // eight more gold things: the same
    const more: FishItem[] = Array.from({ length: 8 }, (_, k) => ({ no: 900 + k, key: `gold${k}`, cat: "fish", tier: 5, at: { pier: "big" } }));
    const [t2, b2] = share([...FISH_ITEMS, ...more], 32, { ticket: true, bottle: true, dry: PITY_AFTER });
    expect(Math.abs(t2 - 1.7)).toBeLessThan(0.1);
    expect(Math.abs(b2 - 0.4)).toBeLessThan(0.05);
    // and a 鱼群 in the pond changes neither
    const [t3, b3] = share(FISH_ITEMS, 33, { spot: "pond", ticket: true, bottle: true, school: true });
    expect(Math.abs(t3 - 1.7)).toBeLessThan(0.1);
    expect(Math.abs(b3 - 0.4)).toBeLessThan(0.05);
    // nor the 方舟原物 in the table (eight of them gold)
    const [t4, b4] = share(FISH_ITEMS, 34, { ticket: true, bottle: true, game: true });
    expect(Math.abs(t4 - 1.7)).toBeLessThan(0.1);
    expect(Math.abs(b4 - 0.4)).toBeLessThan(0.05);
  });

  it("drops a tier with nothing that may bite to the one under it", () => {
    const random = mulberry32(9);
    const thin = FULL.filter((x) => x.tier !== 6);
    for (let i = 0; i < 5_000; i++) expect(rollCatch(ask(random), thin).tier).toBeLessThan(6);
  });

  it("holds 龙门霓虹鳞 to the night, 泰拉巨鳞 to a 龙门跃鲤 caught first, the net to blue, and 黑胶 and 荧光棒 back for now", () => {
    const base = { spot: "pier" as const, hour: 12, crowd: 0, caught: () => 0 };
    const byKey = (key: string) => FISH_ITEMS.find((i) => i.key === key)!;
    const neon = byKey("neonfish");
    for (const hour of [19, 22, 0, 4]) expect(mayBite(neon, { ...base, hour }), String(hour)).toBe(true);
    for (const hour of [5, 12, 18]) expect(mayBite(neon, { ...base, hour }), String(hour)).toBe(false);
    const terra = byKey("terrafish");
    const carp = byKey("dragoncarp");
    expect(mayBite(terra, base)).toBe(false);
    expect(mayBite(terra, { ...base, caught: (no) => (no === carp.no ? 1 : 0) })).toBe(true);
    for (const key of ["vinyl", "glowstick"]) {
      expect(byKey(key).off, key).toBe(true);
      for (const spot of ["pier", "pond"] as const) expect(mayBite(byKey(key), { ...base, spot, together: 4 })).toBe(false);
    }
    const random = mulberry32(13);
    for (let i = 0; i < 20_000; i++) {
      const r = rollCatch({ ...ask(random, { hour: i % 24 }), spot: "auto" });
      expect(r.tier).toBeLessThanOrEqual(3);
      expect(r.variant).toBe(0);
      expect(itemOf(r.no)!.kind).toBeUndefined();
    }
  });

  it("lets the 方舟原物 bite only for a player FISH_GAME lets have them, on the bank and in the pond, never from the net", () => {
    const base = { spot: "pier" as const, hour: 12, crowd: 0, caught: () => 0 };
    const game = FISH_ITEMS.filter((i) => i.cat === "game");
    for (const item of game) {
      expect(mayBite(item, base), item.key).toBe(false);
      expect(mayBite(item, { ...base, game: true }), item.key).toBe(true);
      expect(mayBite(item, { ...base, spot: "pond", game: true }), item.key).toBe(true);
      expect(mayBite(item, { ...base, spot: "auto", game: true }), item.key).toBe(false);
    }
    const count = (more: Partial<RollAsk>, seed: number) => {
      const random = mulberry32(seed);
      let n = 0;
      for (let i = 0; i < 20_000; i++) if (itemOf(rollCatch(ask(random, more)).no)!.cat === "game") n++;
      return n;
    };
    expect(count({}, 41)).toBe(0);
    expect(count({ game: true }, 42)).toBeGreaterThan(1_000);
    expect(count({ spot: "auto", game: true }, 43)).toBe(0);
    // the dex: their column only for such a player, a cell each (no variants)
    expect(inDex(game[0])).toBe(false);
    expect(inDex(game[0], true)).toBe(true);
    expect(dexCells(FISH_ITEMS, true)).toBe(dexCells() + 64);
  });

  it("runs on the real table: the bank's items only, and the dex counts a cell for each item and variant", () => {
    const random = mulberry32(11);
    for (let i = 0; i < 5_000; i++) {
      const r = rollCatch(ask(random, { hour: i % 24 }));
      const item = itemOf(r.no)!;
      expect(item.at.pier).toBeDefined();
      expect(item.off).toBeFalsy();
      expect(item.cat).not.toBe("squad");
    }
    expect(dexCells()).toBe(FISH_ITEMS.filter((i) => i.cat !== "game").reduce((n, i) => n + 1 + (i.fam ? FAMILY[i.fam].length : 0), 0));
  });
});

describe("the pull", () => {
  it("is on time in the last 0.4 s of each ring, with a little grace for the way here", () => {
    expect(onTime(-1)).toBe(false);
    expect(onTime(0)).toBe(false);
    expect(onTime(999)).toBe(false);
    expect(onTime(1000)).toBe(true);
    expect(onTime(1399)).toBe(true);
    expect(onTime(RING_MS + PERFECT_GRACE_MS - 1)).toBe(true);
    expect(onTime(RING_MS + PERFECT_GRACE_MS)).toBe(false);
    expect(onTime(2 * RING_MS + 1100)).toBe(true);
    expect(onTime(2 * RING_MS + 500)).toBe(false);
  });

  it("bites 20 s to 3 min after the cast", () => {
    const random = mulberry32(5);
    for (let i = 0; i < 10_000; i++) {
      const t = biteAfter(random);
      expect(t).toBeGreaterThanOrEqual(20_000);
      expect(t).toBeLessThanOrEqual(180_000);
    }
  });
});
