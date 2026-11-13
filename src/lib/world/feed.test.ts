import { describe, expect, it } from "vitest";
import { RoachAreaCopy, totalsOf } from "./feed";
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

describe("the overview held", () => {
  it("says whether it is of main roaches only (只看本体), which a box never is", () => {
    const one: MapRoach[] = [{ id: "a1000000", lng: 121.47, lat: 31.23, clone: false, avatar: "hood", color: "cyan" }];
    const copy = new RoachAreaCopy();
    copy.apply({ v: "0000abcd.1", overview: true, mains: true, packed: packRoaches(one, 4, true) });
    expect([copy.area, copy.mains]).toEqual(["overview", true]);
    copy.apply({ v: "0000abcd.2", overview: true, packed: packRoaches(one, 4, true) });
    expect([copy.area, copy.mains]).toEqual(["overview", false]);
    copy.apply({ v: "0000abcd.3", overview: true, mains: true, packed: packRoaches(one, 4, true) });
    // what changed in a box, then a box whole
    copy.apply({ v: "0000abcd.4", changed: [] });
    expect(copy.mains).toBe(true);
    copy.apply({ v: "0000abcd.5", box: [121, 31, 122, 32], packed: packRoaches(one, 4) });
    expect([copy.area, copy.mains]).toEqual([[121, 31, 122, 32], false]);
  });
});
