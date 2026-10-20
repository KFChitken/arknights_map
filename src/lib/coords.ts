import gcoord from "gcoord";
import type { LngLat } from "./types";

/** WGS-84 → GCJ-02 (Amap). gcoord leaves points outside China unchanged. */
export function toGcj(p: LngLat): [number, number] {
  const [lng, lat] = gcoord.transform([p.lng, p.lat], gcoord.WGS84, gcoord.GCJ02);
  return [lng, lat];
}

export function fromGcj(lng: number, lat: number): LngLat {
  const [x, y] = gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84);
  return { lng: x, lat: y };
}

export function inBounds(p: LngLat, [sw, ne]: [LngLat, LngLat]) {
  if (p.lat < sw.lat || p.lat > ne.lat) return false;
  // sw.lng > ne.lng when the view crosses the antimeridian
  return sw.lng <= ne.lng
    ? p.lng >= sw.lng && p.lng <= ne.lng
    : p.lng >= sw.lng || p.lng <= ne.lng;
}
