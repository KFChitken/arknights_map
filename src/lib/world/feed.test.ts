import { describe, expect, it } from "vitest";
import { RoachAreaCopy, RoachTilesCopy, totalsOf } from "./feed";
import { packRoaches } from "./packed";
import type { MapRoach } from "./types";

describe("the counts that come with an area", () => {
  it("reads how many players there are last, and none from a server from before it said", () => {
    expect(totalsOf([5, 1, 2, 3])).toEqual({ total: 5, fire: 1, riders: 2, players: 3 });
    expect(totalsOf([5, 1, 2])).toEqual({ total: 5, fire: 1, riders: 2 });

    const copy = new RoachAreaCopy();
    copy.apply({ v: "0000abcd.1", t: [4, 0, 0, 2] });
    expect(copy.totals).toEqual({ total: 4, fire: 0, riders: 0, players: 2 });
    // what changed in a box from a server from before it (just after a deploy, for a moment)
    copy.apply({ v: "0000abcd.2", t: [4, 0, 0] });
    expect(copy.totals).toEqual({ total: 4, fire: 0, riders: 0 });
  });
});

describe("the page's copy of the overview's tiles", () => {
  const roach = (id: string, lng: number, lat: number, n?: number): MapRoach => ({ id, clone: false, avatar: "hood", color: "cyan", lng, lat, ...(n ? { n } : {}) });
  const tile = (x: number, y: number, roaches: MapRoach[]) => ({ v: "0000abcd.1", tile: [x, y] as [number, number], packed: packRoaches(roaches, 4) });

  it("draws the tiles round the view as they come, keeps the others for the way back, and lets go of empty ones", () => {
    const c = new RoachTilesCopy();
    c.applyIndex({ v: "0000abcd.1", t: [5, 0, 0, 3], tiles: [[26, 13, 2], [27, 13, 1], [9, 12, 1]] });
    expect(c.listed(26, 13)).toBe(true);
    expect(c.listed(1, 1)).toBe(false);
    expect(c.want([[26, 13], [27, 13]])).toBe(false);
    expect(c.any).toBe(false);
    expect(c.applyTile(tile(26, 13, [roach("aaaa0001", 121.4, 31.2, 3)]))).toBe(true);
    expect(c.any).toBe(true);
    // one not round the view: kept, not drawn
    expect(c.applyTile(tile(9, 12, [roach("aaaa0009", -74, 40.7)]))).toBe(false);
    expect(c.applyTile(tile(27, 13, [roach("aaaa0002", 139.7, 35.7)]))).toBe(true);
    expect(c.roaches.map((r) => r.id)).toEqual(["aaaa0001", "aaaa0002"]);
    expect(c.roaches.reduce((k, r) => k + (r.n ?? 1), 0)).toBe(4);
    // the view moves to the one kept: drawn at once
    expect(c.want([[9, 12]])).toBe(true);
    expect(c.roaches.map((r) => r.id)).toEqual(["aaaa0009"]);
    // the list no longer has it: let go
    c.applyIndex({ v: "0000abcd.2", tiles: [[26, 13, 2], [27, 13, 1]] });
    expect(c.roaches).toEqual([]);
    expect(c.heldAt(9, 12)).toBeUndefined();
  });
});
