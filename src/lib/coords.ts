import gcoord from "gcoord";
import data from "@/data/china-gcj.json";
import { area, inArea, type Box, type Ring } from "./shapes";
import type { LngLat } from "./types";

/**
 * Amap draws mainland China, Hong Kong, Macau and Taiwan shifted (GCJ-02) and the
 * rest of the world as it is (WGS-84). gcoord on its own shifts everything in a box
 * around China, the neighbours included, so here a point is only shifted when it
 * lies in that box and on nobody else's land (src/data/china-gcj.json, built by
 * scripts/build-china-areas.mjs). The sea and China's small islands count as China,
 * which is right for the islands and does no harm at sea. Borders are good to about 500 m.
 */
const BOX = data.box as Box;
const FOREIGN = area(data.foreign as Ring[]);

/** Whether Amap draws this spot shifted */
export function shifted(p: LngLat) {
  return p.lng >= BOX[0] && p.lng <= BOX[2] && p.lat >= BOX[1] && p.lat <= BOX[3] && !inArea(p, FOREIGN);
}

/** WGS-84 → what Amap draws */
export function toGcj(p: LngLat): [number, number] {
  if (!shifted(p)) return [p.lng, p.lat];
  const [lng, lat] = gcoord.transform([p.lng, p.lat], gcoord.WGS84, gcoord.GCJ02);
  return [lng, lat];
}

/** Amap → WGS-84. The shift is under a kilometre, so the shifted point itself tells whether to undo it. */
export function fromGcj(lng: number, lat: number): LngLat {
  if (!shifted({ lng, lat })) return { lng, lat };
  const [x, y] = gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84);
  return { lng: x, lat: y };
}
