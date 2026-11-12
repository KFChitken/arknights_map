import { describe, expect, it } from "vitest";
import { areaFor, BOX_MAX, boxFor, boxHolds, boxText, overviewCell, parseBox, weightOf } from "./area";
import { packRoaches, unpackRoaches } from "./packed";
import type { MapRoach } from "./types";

const VIEW: [{ lng: number; lat: number }, { lng: number; lat: number }] = [
  { lng: 121.2, lat: 31.1 },
  { lng: 121.7, lat: 31.4 },
];

describe("the areas a page asks for", () => {
  it("makes a box of the view and half of it again on every side, on a quarter-degree grid", () => {
    const b = boxFor(VIEW)!;
    expect(b).toEqual([120.75, 30.75, 122, 31.75]);
    expect(boxHolds(b, VIEW)).toBe(true);
    // a little move is still held by it, so the page asks for no new one
    expect(boxHolds(b, [{ lng: 121.25, lat: 31.12 }, { lng: 121.75, lat: 31.42 }])).toBe(true);
    expect(boxHolds(b, [{ lng: 121.6, lat: 31.12 }, { lng: 122.1, lat: 31.42 }])).toBe(false);
    expect(parseBox(boxText(b))).toEqual(b);
  });

  it("uses the overview zoomed out, for too big a view, and across ±180°", () => {
    expect(areaFor(6.9, VIEW)).toBe("overview");
    expect(areaFor(7, VIEW)).toEqual(boxFor(VIEW));
    expect(boxFor([{ lng: 80, lat: 20 }, { lng: 80 + BOX_MAX[0], lat: 30 }])).toBeNull();
    expect(boxFor([{ lng: 179, lat: 0 }, { lng: -179, lat: 1 }])).toBeNull();
  });

  it("takes only boxes as pages make them", () => {
    for (const bad of [null, "", "1,2,3", "121,31,122,31.6", "122,31,121,32", "0,0,60,10", "a,b,c,d", "121,31,122,31.25e1", "-181,0,-180,1"]) {
      expect(parseBox(bad)).toBeNull();
    }
    expect(parseBox("-180,-90,-179.75,-89.5")).toEqual([-180, -90, -179.75, -89.5]);
  });

  it("puts nearby places in one overview square and far ones in others", () => {
    expect(overviewCell({ lng: 121.47, lat: 31.23 })).toBe(overviewCell({ lng: 121.471, lat: 31.231 }));
    expect(overviewCell({ lng: 121.47, lat: 31.23 })).not.toBe(overviewCell({ lng: 121.6, lat: 31.23 }));
    expect(overviewCell({ lng: 180, lat: 90 })).toBeGreaterThanOrEqual(0);
  });

  it("packs how many each roach of the overview stands for, and none when all are one", () => {
    const list: MapRoach[] = [
      { id: "0123abcd", clone: false, avatar: "hood", color: "cyan", lng: 121.47, lat: 31.23, n: 12 },
      { id: "0123abce", clone: true, avatar: "hood", color: "white", lng: 139.7, lat: 35.68 },
    ];
    const packed = packRoaches(list, 4);
    expect(packed.n).toEqual([12, 1]);
    expect(unpackRoaches(packed).map(weightOf)).toEqual([12, 1]);
    expect(packRoaches(list.map((r) => ({ ...r, n: undefined })), 4).n).toBeUndefined();
  });
});
