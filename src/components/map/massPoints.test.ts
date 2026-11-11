import { describe, expect, it } from "vitest";
import { generateFakeRoaches } from "@/lib/fakeRoaches";
import type { PublicRoach } from "@/lib/world/types";
import { FeatureCache, MAX_DIFF, roachFeature } from "./features";
import { MassCache, STILL, type MassPoint } from "./massPoints";

const looks = ["hood", "doctor", "endmin", "imp"] as const;
const crowd = (n: number): PublicRoach[] =>
  generateFakeRoaches(n, 20261111).map((r, i) => ({
    id: `r${i}`,
    clone: i % 5 === 0,
    avatar: looks[i % looks.length],
    color: r.color,
    lng: r.lng,
    lat: r.lat,
    friend: i % 7 === 0,
    ...(i % 13 === 0 ? { asleep: true as const } : {}),
  }));

const woken = (r: PublicRoach): PublicRoach => {
  const awake = { ...r };
  delete awake.asleep;
  return awake;
};

/** What happens to the i-th roach in an update (round: which update), and so whether it changes */
const fate = (i: number, round: number) => (i + round) % 40;
const GONE = 0;
const CHANGED = [1, 2, 3, 4];

/**
 * An update of the list: some gone, some moved, fallen asleep or woken up, become a 触须之交's or no
 * longer, in another look, some sent again as they were (a new object), and some new ones.
 */
function update(list: PublicRoach[], round: number): PublicRoach[] {
  const next: PublicRoach[] = [];
  list.forEach((r, i) => {
    const k = fate(i, round);
    if (k === GONE) return;
    if (k === 1) next.push({ ...r, lng: r.lng + 0.01 });
    else if (k === 2) next.push(r.asleep ? woken(r) : { ...r, asleep: true });
    else if (k === 3) next.push({ ...r, friend: !r.friend });
    else if (k === 4) next.push({ ...r, avatar: r.avatar === "hood" ? "imp" : "hood" });
    else if (k === 5) next.push({ ...r });
    else next.push(r);
  });
  for (let j = 0; j < 30; j++) next.push({ ...list[j], id: `new${round}-${j}`, lat: list[j].lat + 0.005 });
  return next;
}

const pointsById = (groups: MassPoint[][]) => new Map(groups.flat().map((p) => [p.id, p]));

describe("the 高德 map's roach cache", () => {
  it("gives what working every roach out afresh gives, after update after update", () => {
    const cache = new MassCache();
    let list = crowd(3000);
    cache.groups(list);
    cache.gl();
    for (let round = 0; round < 4; round++) {
      list = update(list, round);
      const groups = cache.groups(list);
      const fresh = new MassCache();
      const freshGroups = fresh.groups(list);
      expect(groups).toEqual(freshGroups);
      expect(cache.gl()).toEqual(fresh.gl());
    }
  });

  it("works out again only the roaches that changed, and drops the ones gone", () => {
    const cache = new MassCache();
    const list = crowd(2000);
    const first = cache.groups(list);
    const before = pointsById(first);
    const glBefore = new Map(cache.gl().map((r) => [r.id, r]));
    const next = update(list, 0);
    const groups = cache.groups(next);
    const after = pointsById(groups);
    const glAfter = new Map(cache.gl().map((r) => [r.id, r]));
    list.forEach((r, i) => {
      const k = fate(i, 0);
      if (k === GONE) {
        expect(after.has(r.id)).toBe(false);
      } else if (CHANGED.includes(k)) {
        expect(after.get(r.id)).not.toBe(before.get(r.id));
        expect(glAfter.get(r.id)).not.toBe(glBefore.get(r.id));
      } else {
        expect(after.get(r.id)).toBe(before.get(r.id));
        expect(glAfter.get(r.id)).toBe(glBefore.get(r.id));
      }
    });
    for (let j = 0; j < 30; j++) expect(after.has(`new0-${j}`)).toBe(true);
    expect(after.size).toBe(next.length);
  });

  it("moves a roach that fell asleep to the still batch, and back when it wakes", () => {
    const cache = new MassCache();
    const list = crowd(200);
    const awake = list.findIndex((r) => !r.asleep);
    const asleep = list.map((r, i) => (i === awake ? { ...r, asleep: true as const } : r));
    expect(cache.groups(asleep)[STILL].some((p) => p.id === list[awake].id)).toBe(true);
    expect(cache.groups(list)[STILL].some((p) => p.id === list[awake].id)).toBe(false);
  });

  it("keeps 触须之交 last in every batch and last for the GPU layer, so they are drawn on top", () => {
    const cache = new MassCache();
    const groups = cache.groups(update(crowd(2000), 1));
    for (const g of groups) {
      const firstFriend = g.findIndex((p) => p.friend);
      if (firstFriend >= 0) expect(g.slice(firstFriend).every((p) => p.friend)).toBe(true);
    }
    const gl = cache.gl();
    const firstFriend = gl.findIndex((r) => r.friend);
    expect(firstFriend).toBeGreaterThan(0);
    expect(gl.slice(firstFriend).every((r) => r.friend)).toBe(true);
  });
});

describe("the MapLibre map's roach cache", () => {
  it("gives the features made afresh, keeping those of the roaches that stayed as they were", () => {
    const cache = new FeatureCache();
    const list = crowd(2000);
    const before = new Map(cache.collection(list).features.map((f) => [f.properties!.id as string, f]));
    const next = update(list, 2);
    const features = cache.collection(next).features;
    expect(features).toEqual(next.map((r) => roachFeature(r)));
    list.forEach((r, i) => {
      const k = fate(i, 2);
      if (k === GONE) return;
      const f = features.find((x) => x.properties!.id === r.id);
      if (CHANGED.includes(k)) expect(f).not.toBe(before.get(r.id));
      else expect(f).toBe(before.get(r.id));
    });
  });

  it("hands the map only what changed, which brings what it had to what is there now", () => {
    const cache = new FeatureCache();
    let list = crowd(2000);
    // what the map holds, as MapLibre keeps it: by id, an added feature taking the place of its id's
    const held = new Map(cache.collection(list).features.map((f) => [f.properties!.id as string, f]));
    for (let round = 0; round < 4; round++) {
      const next = update(list, round);
      const u = cache.update(next);
      expect(u.all).toBeNull();
      for (const id of u.diff.remove) held.delete(id);
      for (const f of u.diff.add) held.set(f.properties!.id as string, f);
      expect([...held.values()].sort((a, b) => ((a.properties!.id as string) < (b.properties!.id as string) ? -1 : 1))).toEqual(
        next.map((r) => roachFeature(r)).sort((a, b) => ((a.properties!.id as string) < (b.properties!.id as string) ? -1 : 1)),
      );
      // only the new and changed ones go, and only theirs can need new icons
      expect(u.diff.add.length).toBe(u.fresh.length);
      expect(u.diff.add.length).toBeLessThan(next.length / 5);
      list = next;
    }
  });

  it("hands over everything when too much changed at once for a diff", () => {
    const cache = new FeatureCache();
    const list = crowd(MAX_DIFF + 2000);
    cache.collection(list.slice(0, 1000));
    const big = cache.update(list);
    expect(big.all?.features).toHaveLength(list.length);
    expect(big.fresh).toHaveLength(list.length - 1000);
    const small = cache.update(update(list, 0));
    expect(small.all).toBeNull();
    expect(small.diff.add.length + small.diff.remove.length).toBeLessThanOrEqual(MAX_DIFF);
  });

  it("hands over everything after an update the map missed, and every id once", () => {
    const cache = new FeatureCache();
    const list = crowd(500);
    expect(cache.update(list).all?.features).toHaveLength(500);
    cache.reset();
    const again = cache.update([...list, { ...list[0] }]);
    expect(again.all?.features).toHaveLength(500);
    expect(again.fresh.length).toBeGreaterThanOrEqual(500);
    const next = cache.update(list);
    expect(next.all).toBeNull();
    expect(next.diff).toEqual({ add: [], remove: [] });
  });
});
