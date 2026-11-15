import gcoord from "gcoord";
import data from "@/data/china-gcj.json";
import { area, inArea, type Area, type Box, type Ring } from "./shapes";
import type { LngLat } from "./types";

/**
 * Amap draws mainland China, Hong Kong, Macau and Taiwan shifted (GCJ-02) and the
 * rest of the world as it is (WGS-84). gcoord on its own shifts everything in a box
 * around China, the neighbours included, so here a point is only shifted when it
 * lies in that box and on nobody else's land (src/data/china-gcj.json, built by
 * scripts/build-china-areas.mjs), as China draws the borders. The sea and China's small
 * islands count as China, which is right for the islands and does no harm at sea.
 * Borders are good to a few hundred metres, and to about 100 m around the towns on
 * China's land borders, where the file holds them finely in boxes of their own.
 */
const BOX = data.box as Box;
const FOREIGN = area(data.foreign as Ring[]);
/** Around a border town: the foreign land there, and the holes in it (China's islands in a border river) */
type Fine = { box: Box; foreign: Area; holes: Area | null };
const FINE: Fine[] = (data.fine as { box: number[]; foreign: Ring[]; holes?: Ring[] }[]).map((f) => ({
  box: f.box as Box,
  foreign: area(f.foreign),
  holes: f.holes ? area(f.holes) : null,
}));

/** Whether Amap draws this spot shifted */
export function shifted(p: LngLat) {
  if (!(p.lng >= BOX[0] && p.lng <= BOX[2] && p.lat >= BOX[1] && p.lat <= BOX[3])) return false;
  for (let i = 0; i < FINE.length; i++) {
    const f = FINE[i];
    if (p.lng >= f.box[0] && p.lng <= f.box[2] && p.lat >= f.box[1] && p.lat <= f.box[3]) {
      return !inArea(p, f.foreign) || (f.holes !== null && inArea(p, f.holes));
    }
  }
  return !inArea(p, FOREIGN);
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

/**
 * Tencent's map shifts what Amap does, except Taiwan, Penghu, Kinmen and Matsu, which it draws as they
 * are (checked on 2026-11-12 at Taipei 101, the county halls of Penghu, Kinmen and Lienchiang, against
 * the IFC in Hong Kong and the Lisboa in Macau, which it shifts). Drawn by hand in the sea around them,
 * checked on Tencent's map: through the straits between Kinmen and Xiamen's island and new airport.
 */
const TAIWAN = area([
  [[119.25, 23.0], [120.3, 21.75], [121.75, 21.85], [121.85, 22.7], [122.15, 24.4], [122.3, 25.75], [121.6, 25.55], [121.1, 25.3], [120.55, 24.95], [119.95, 24.25], [119.25, 23.85]],
  [[118.2, 24.41], [118.212, 24.452], [118.24, 24.468], [118.275, 24.47], [118.3, 24.497], [118.335, 24.508], [118.37, 24.52], [118.4, 24.532], [118.45, 24.546], [118.49, 24.546], [118.52, 24.47], [118.52, 24.36], [118.38, 24.33], [118.2, 24.35], [118.18, 24.38]],
  [[119.85, 26.08], [119.86, 26.19], [119.93, 26.26], [120.05, 26.31], [120.2, 26.4], [120.45, 26.42], [120.56, 26.4], [120.56, 26.33], [120.4, 26.3], [120.12, 26.2], [120.06, 26.12], [120.06, 25.92], [119.97, 25.9], [119.88, 25.93], [119.84, 26.0]],
  // Wuqiu
  [[119.4, 24.94], [119.5, 24.94], [119.5, 25.03], [119.4, 25.03]],
]);

/** A longitude in [-180, 180), where maps take it: MapLibre's own runs on past 180 across the date line, Tencent's throws */
export function wrapLng(lng: number) {
  return lng >= -180 && lng < 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The longitude halfway between two, the short way round: across the date line when that is shorter */
export function midLng(from: number, to: number) {
  return wrapLng(from + wrapLng(to - from) / 2);
}

/** Whether Tencent's map draws this spot shifted */
export function tencentShifted(p: LngLat) {
  return shifted(p) && !inArea(p, TAIWAN);
}

/** WGS-84 → what Tencent's map draws */
export function toTencent(p: LngLat): [number, number] {
  if (!tencentShifted(p)) return [p.lng, p.lat];
  const [lng, lat] = gcoord.transform([p.lng, p.lat], gcoord.WGS84, gcoord.GCJ02);
  return [lng, lat];
}

/** Tencent's map → WGS-84, as fromGcj */
export function fromTencent(lng: number, lat: number): LngLat {
  if (!tencentShifted({ lng, lat })) return { lng, lat };
  const [x, y] = gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84);
  return { lng: x, lat: y };
}
