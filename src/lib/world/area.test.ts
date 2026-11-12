import { describe, expect, it } from "vitest";
import { areaFor, BOX_MAX, boxFor, boxHolds, boxText, overviewCell, parseBox, tileOf, TILES_ACROSS, tilesFor, weightOf } from "./area";
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

describe("the overview's tiles round a view", () => {
  it("covers the view and a quarter more on each side, across ±180° too, every column when the world is in view", () => {
    const china = tilesFor([
      { lng: 100, lat: 20 },
      { lng: 125, lat: 45 },
    ]);
    for (const p of [
      { lng: 100, lat: 20 },
      { lng: 125, lat: 45 },
      { lng: 112, lat: 32 },
      { lng: 95, lat: 15 },
    ]) {
      const [x, y] = tileOf(p);
      expect(china.some(([a, b]) => a === x && b === y), JSON.stringify(p)).toBe(true);
    }
    // a 25° view and a quarter more each way, in tiles of 5.6°: some tens, not the world's thousands
    expect(china.length).toBeLessThan(100);
    // across the 180° meridian: both sides
    const pacific = tilesFor([
      { lng: 170, lat: -20 },
      { lng: 190, lat: -10 },
    ]);
    expect(pacific.some(([x]) => x === tileOf({ lng: 175, lat: -15 })[0])).toBe(true);
    expect(pacific.some(([x]) => x === tileOf({ lng: -175, lat: -15 })[0])).toBe(true);
    // the whole world: all 32 columns
    const world = tilesFor([
      { lng: -200, lat: -60 },
      { lng: 200, lat: 70 },
    ]);
    expect(new Set(world.map(([x]) => x)).size).toBe(TILES_ACROSS);
  });
});
