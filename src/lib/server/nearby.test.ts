import { describe, expect, it } from "vitest";
import { distanceKm } from "../geo";
import { mulberry32 } from "../prng";
import { DECLARATION_RADIUS_KM, RADAR_RADIUS_KM } from "../rules";
import type { LngLat } from "../types";
import { countNear, gridOf, snapSpot } from "./nearby";
import { rough } from "../counts";

/** Counted the plain way, every roach against the snapped spot */
function plain(roaches: LngLat[], spot: LngLat) {
  const at = snapSpot(spot);
  let near = 0;
  let far = 0;
  for (const r of roaches) {
    const d = distanceKm(at, r);
    if (d > RADAR_RADIUS_KM) continue;
    far += 1;
    if (d <= DECLARATION_RADIUS_KM) near += 1;
  }
  return { near: rough(near), far: rough(far) };
}

describe("roaches near a spot, for visitors", () => {
  it("counts the same as going through every roach, around cities and across the 180° meridian", () => {
    const rand = mulberry32(7);
    const roaches: LngLat[] = [];
    const centres = [
      { lng: 121.47, lat: 31.23 },
      { lng: 116.4, lat: 39.9 },
      { lng: 179.9, lat: -16.5 },
      { lng: 18.07, lat: 59.33 },
    ];
    for (const c of centres) {
      for (let i = 0; i < 3000; i++) roaches.push({ lng: c.lng + (rand() - 0.5) * 3, lat: c.lat + (rand() - 0.5) * 3 });
    }
    // past 180 is the other side of the world
    for (const r of roaches) if (r.lng > 180) r.lng -= 360;
    const grid = gridOf(roaches);
    for (const spot of [...centres, { lng: -179.95, lat: -16.4 }, { lng: 121.9, lat: 31.6 }, { lng: 0, lat: 0 }]) {
      expect(countNear(grid, spot)).toEqual(plain(roaches, spot));
    }
  });

  it("says the same for taps a few hundred metres apart, and a few for one roach alone", () => {
    const alone = [{ lng: 100.123, lat: 30.456 }];
    const grid = gridOf(alone);
    expect(countNear(grid, { lng: 100.121, lat: 30.454 })).toEqual(countNear(grid, { lng: 100.124, lat: 30.457 }));
    expect(countNear(grid, { lng: 100.12, lat: 30.45 })).toEqual({ near: 1, far: 1 });
    expect(countNear(grid, { lng: 110, lat: 30 })).toEqual({ near: 0, far: 0 });
  });
});
