import { describe, expect, it } from "vitest";
import data from "@/data/china-gcj.json";
import { mulberry32 } from "./prng";
import { area, boxMeetsArea, inArea, inRing, viewBoxes, widen, type Box, type Ring } from "./shapes";

const square: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
// an L shape, to have a notch outside it
const ell: Ring = [
  [0, 0],
  [10, 0],
  [10, 4],
  [4, 4],
  [4, 10],
  [0, 10],
];

/** The ray cast as first written, unpacking each point, to hold the faster one to */
function plainInRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("shapes", () => {
  it("says the same as the plain ray cast for 10,000 spots around China, on the real outlines", () => {
    const rings = data.foreign as Ring[];
    const foreign = area(rings);
    const [w, s, e, n] = data.box as Box;
    const rand = mulberry32(20261111);
    let inside = 0;
    for (let k = 0; k < 10_000; k++) {
      const p = { lng: w + rand() * (e - w), lat: s + rand() * (n - s) };
      const plain = rings.some((r) => plainInRing(p.lng, p.lat, r));
      expect(inArea(p, foreign)).toBe(plain);
      if (plain) inside++;
    }
    // both answers turn up plenty, so the comparison means something
    expect(inside).toBeGreaterThan(1000);
    expect(inside).toBeLessThan(9000);
  });

  it("tells points inside a ring from those outside", () => {
    expect(inRing(5, 5, square)).toBe(true);
    expect(inRing(11, 5, square)).toBe(false);
    expect(inRing(2, 8, ell)).toBe(true);
    expect(inRing(8, 8, ell)).toBe(false);
    const both = area([square, [[20, 20], [30, 20], [30, 30], [20, 30]]]);
    expect(inArea({ lng: 25, lat: 25 }, both)).toBe(true);
    expect(inArea({ lng: 15, lat: 15 }, both)).toBe(false);
  });

  it("finds a box meeting an area by corner, by edge or by containing it", () => {
    const a = area([ell]);
    expect(boxMeetsArea([-5, -5, 1, 1], a)).toBe(true); // overlaps a corner
    expect(boxMeetsArea([1, 1, 2, 2], a)).toBe(true); // inside
    expect(boxMeetsArea([-20, -20, 20, 20], a)).toBe(true); // around it all
    expect(boxMeetsArea([3, -1, 3.5, 11], a)).toBe(true); // a thin strip crossing it, no corners inside either
    expect(boxMeetsArea([6, 6, 9, 9], a)).toBe(false); // in the notch
    expect(boxMeetsArea([11, 0, 12, 10], a)).toBe(false);
  });

  it("splits views across the 180° meridian and copes with longitudes past it", () => {
    expect(viewBoxes([{ lng: 10, lat: 20 }, { lng: 30, lat: 40 }])).toEqual([[10, 20, 30, 40]]);
    // MapLibre panned east past 180: longitudes run on
    expect(viewBoxes([{ lng: 170, lat: -10 }, { lng: 190, lat: 10 }])).toEqual([
      [170, -10, 180, 10],
      [-180, -10, -170, 10],
    ]);
    // and the same view given west to east across the meridian
    expect(viewBoxes([{ lng: 170, lat: -10 }, { lng: -170, lat: 10 }])).toEqual([
      [170, -10, 180, 10],
      [-180, -10, -170, 10],
    ]);
    // panned far west, a whole world over
    expect(viewBoxes([{ lng: -370, lat: 0 }, { lng: -350, lat: 5 }])).toEqual([[-10, 0, 10, 5]]);
    expect(viewBoxes([{ lng: -200, lat: -80 }, { lng: 200, lat: 80 }])).toEqual([[-180, -80, 180, 80]]);
  });

  it("widens a view by a share of its size each way", () => {
    expect(widen([{ lng: 10, lat: 20 }, { lng: 20, lat: 30 }], 0.2)).toEqual([
      { lng: 8, lat: 18 },
      { lng: 22, lat: 32 },
    ]);
    // across the meridian it keeps going east
    expect(widen([{ lng: 175, lat: 0 }, { lng: -175, lat: 10 }], 0.5)).toEqual([
      { lng: 170, lat: -5 },
      { lng: 190, lat: 15 },
    ]);
  });
});
