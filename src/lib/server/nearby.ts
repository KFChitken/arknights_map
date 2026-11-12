import { rough } from "../counts";
import { distanceKm } from "../geo";
import { DECLARATION_RADIUS_KM, RADAR_RADIUS_KM } from "../rules";
import type { LngLat } from "../types";

/**
 * How many roaches are near a spot, for a visitor who has not signed in and taps the map to see where
 * theirs would go (src/app/api/around): counted on the shared snapshot (roachFeed.ts), never sent as a
 * list. The spot goes to about a kilometre first and the counts are rounded down (counts.ts), so tapping
 * about and watching the numbers cannot pin one roach down.
 */

/** The snapshot's roaches by whole degree of longitude and latitude */
export type Grid = Map<string, LngLat[]>;

const cellKey = (x: number, y: number) => `${x},${y}`;

export function gridOf(roaches: readonly LngLat[]): Grid {
  const grid: Grid = new Map();
  for (const r of roaches) {
    const k = cellKey(Math.floor(r.lng), Math.floor(r.lat));
    const cell = grid.get(k);
    if (cell) cell.push(r);
    else grid.set(k, [r]);
  }
  return grid;
}

/** The spot as counted: to two places of a degree, about a kilometre */
export const snapSpot = (p: LngLat): LngLat => ({ lng: Math.round(p.lng * 100) / 100, lat: Math.round(p.lat * 100) / 100 });

/** Roaches within the declaration and the radar radius of the spot (snapped first), rounded down */
export function countNear(grid: Grid, spot: LngLat): { near: number; far: number } {
  const at = snapSpot(spot);
  // the cells the radar's circle can reach, a degree of latitude being 111 km and of longitude less
  const dLat = RADAR_RADIUS_KM / 111;
  const dLng = Math.min(180, dLat / Math.max(0.01, Math.cos((at.lat * Math.PI) / 180)));
  let near = 0;
  let far = 0;
  for (let y = Math.floor(at.lat - dLat); y <= Math.floor(at.lat + dLat); y++) {
    const seen = new Set<number>();
    for (let x = Math.floor(at.lng - dLng); x <= Math.floor(at.lng + dLng); x++) {
      // across the 180° meridian, to the same cell once
      const cx = ((((x + 180) % 360) + 360) % 360) - 180;
      if (seen.has(cx)) continue;
      seen.add(cx);
      for (const r of grid.get(cellKey(cx, y)) ?? []) {
        const d = distanceKm(at, r);
        if (d > RADAR_RADIUS_KM) continue;
        far += 1;
        if (d <= DECLARATION_RADIUS_KM) near += 1;
      }
    }
  }
  return { near: rough(near), far: rough(far) };
}
