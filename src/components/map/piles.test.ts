import { describe, expect, it } from "vitest";
import { generateFakeRoaches } from "@/lib/fakeRoaches";
import type { PublicRoach } from "@/lib/world/types";
import { MassCache } from "./massPoints";
import { countBadgeText, pileMul, Piles, type Box, type PileItem } from "./piles";
import { PILE_MAX_ZOOM } from "./pileWork";

const looks = ["hood", "doctor", "endmin", "imp"] as const;
const crowd = (n: number): PublicRoach[] =>
  generateFakeRoaches(n, 20261111).map((r, i) => ({
    id: `r${i}`,
    clone: i % 5 === 0,
    avatar: looks[i % looks.length],
    color: r.color,
    lng: r.lng,
    lat: r.lat,
    friend: i % 500 === 0,
    ...(i % 97 === 0 ? { asleep: true as const } : {}),
  }));

/** The piles of a view, from a fresh Piles (its work on the page here: there are no workers in Node) */
function pilesOf(list: PublicRoach[], view: Box, z: number) {
  const cache = new MassCache();
  const groups = cache.groups(list);
  return new Promise<{ items: PileItem[]; piles: Piles }>((resolve) => {
    const piles = new Piles((items) => resolve({ items, piles }));
    piles.load(groups);
    piles.view(view, z);
  });
}

const SHANGHAI: Box = [121.2, 31.0, 121.8, 31.45];

describe("轻量's piles", () => {
  it("covers every roach of the view once, 触须之交 alone and on top", async () => {
    const list = crowd(20_000);
    const { items, piles } = await pilesOf(list, SHANGHAI, 10);
    piles.stop();
    const crowdItems = items.filter((i) => i.kind === 0);
    const friends = items.filter((i) => i.kind === 2);
    // 触须之交 last, on their own
    expect(items.slice(items.length - friends.length).every((i) => i.kind === 2)).toBe(true);
    expect(friends.every((f) => f.n === 1 && typeof f.ref === "string")).toBe(true);
    // the piles are fewer than the roaches, and lone ones are known by their id
    expect(crowdItems.some((i) => i.n > 1)).toBe(true);
    for (const i of crowdItems) expect(typeof i.ref === (i.n > 1 ? "number" : "string")).toBe(true);
    // the southern ones drawn later
    for (let k = 1; k < crowdItems.length; k++) expect(crowdItems[k].lat).toBeLessThanOrEqual(crowdItems[k - 1].lat);
  });

  it("draws every roach on its own from 高德's 17th zoom", async () => {
    const list = crowd(5000);
    const { items, piles } = await pilesOf(list, [121.46, 31.22, 121.49, 31.24], PILE_MAX_ZOOM + 1);
    piles.stop();
    expect(items.every((i) => i.n === 1)).toBe(true);
  });

  it("says at which zoom a pile comes apart", async () => {
    const { items, piles } = await pilesOf(crowd(20_000), SHANGHAI, 8);
    const big = items.find((i) => i.n > 50)!;
    const z = await piles.expand(big.ref as number);
    piles.stop();
    expect(z).toBeGreaterThan(8);
    expect(z).toBeLessThanOrEqual(PILE_MAX_ZOOM + 1);
  });

  it("sizes piles and writes their counts as the design says", () => {
    expect(pileMul(1)).toBe(1);
    expect(pileMul(2)).toBeCloseTo(1.18);
    expect(pileMul(10)).toBeCloseTo(1.598, 2);
    expect(pileMul(80)).toBeCloseTo(2.138, 2);
    expect(pileMul(128)).toBe(2.2);
    expect(countBadgeText(9999)).toBe("9999");
    expect(countBadgeText(12_960)).toBe("1.3万");
  });
});
