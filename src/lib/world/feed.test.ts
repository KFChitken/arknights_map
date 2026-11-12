import { describe, expect, it } from "vitest";
import { RoachAreaCopy, totalsOf } from "./feed";

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
