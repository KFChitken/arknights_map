import type { LngLat } from "./types";

/**
 * Small plane geometry on longitude and latitude, for the outlines that decide
 * where Amap's offset applies (coords.ts) and where the map must be Amap
 * (chinaView.ts). Rings are lists of [lng, lat] points, closed or not; an area is
 * a list of rings, a point being in it when it is inside any of them. Distances
 * are never measured here, so degrees are fine.
 */

export type Ring = [number, number][];
/** west, south, east, north, with west <= east (never across the 180° meridian) */
export type Box = [number, number, number, number];

export function boxOf(rings: Ring[]): Box {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

// by index, not destructured: these run for every roach the GCJ shift looks at (coords.ts), and unpacking is slower
const inBox = (x: number, y: number, b: Box) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const boxesMeet = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/** Ray casting: whether a point lies inside one ring. */
export function inRing(x: number, y: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const yi = a[1];
    const yj = b[1];
    if (yi > y !== yj > y && x < ((b[0] - a[0]) * (y - yi)) / (yj - yi) + a[0]) inside = !inside;
  }
  return inside;
}

/** Whether two segments touch or cross. */
function segmentsMeet(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const side = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  if (d1 !== d2 && d3 !== d4) return true;
  // touching or overlapping in a line: count it, as the outlines are drawn generously anyway
  const onSeg = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  return (
    (d1 === 0 && onSeg(c, d, a)) || (d2 === 0 && onSeg(c, d, b)) || (d3 === 0 && onSeg(a, b, c)) || (d4 === 0 && onSeg(a, b, d))
  );
}

/** An area: its rings and their overall box, for a quick first look. */
export type Area = { rings: Ring[]; box: Box; boxes: Box[] };

export function area(rings: Ring[]): Area {
  return { rings, box: boxOf(rings), boxes: rings.map((r) => boxOf([r])) };
}

export function inArea(p: LngLat, a: Area) {
  const x = p.lng;
  const y = p.lat;
  if (!inBox(x, y, a.box)) return false;
  for (let i = 0; i < a.rings.length; i++) if (inBox(x, y, a.boxes[i]) && inRing(x, y, a.rings[i])) return true;
  return false;
}

/** Whether a box and an area overlap at all: a corner of one inside the other, or edges crossing. */
export function boxMeetsArea(box: Box, a: Area) {
  if (!boxesMeet(box, a.box)) return false;
  const [w, s, e, n] = box;
  const corners: [number, number][] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ];
  return a.rings.some((ring, i) => {
    if (!boxesMeet(box, a.boxes[i])) return false;
    if (ring.some(([x, y]) => inBox(x, y, box))) return true;
    if (corners.some(([x, y]) => inRing(x, y, ring))) return true;
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      for (let c = 0; c < 4; c++) {
        if (segmentsMeet(ring[j], ring[k], corners[c], corners[(c + 1) % 4])) return true;
      }
    }
    return false;
  });
}

/**
 * A map's view, south-west and north-east corners as the map reports them, as one
 * or two boxes within ±180°: a view across the 180° meridian, or with longitudes
 * past ±180 (MapLibre lets them run on), is split there; a view wider than the world is all of it.
 */
export function viewBoxes([sw, ne]: [LngLat, LngLat]): Box[] {
  const s = Math.max(-90, Math.min(sw.lat, ne.lat));
  const n = Math.min(90, Math.max(sw.lat, ne.lat));
  let w = sw.lng;
  let e = ne.lng;
  // a view reported across the meridian the other way round (west east of east)
  if (e < w) e += 360;
  if (e - w >= 360) return [[-180, s, 180, n]];
  // bring the west edge into [-180, 180)
  const shift = Math.floor((w + 180) / 360) * 360;
  w -= shift;
  e -= shift;
  return e <= 180
    ? [[w, s, e, n]]
    : [
        [w, s, 180, n],
        [-180, s, e - 360, n],
      ];
}

/** A view widened by a share of its size on every side (0.2: a fifth more each way), kept within the poles. */
export function widen([sw, ne]: [LngLat, LngLat], share: number): [LngLat, LngLat] {
  let width = ne.lng - sw.lng;
  if (width < 0) width += 360;
  const height = ne.lat - sw.lat;
  return [
    { lng: sw.lng - width * share, lat: Math.max(-90, sw.lat - height * share) },
    { lng: sw.lng + width * (1 + share), lat: Math.min(90, ne.lat + height * share) },
  ];
}

/** Whether a point lies in a map's view; across the 180° meridian the west edge is east of the east one. */
export function inBounds(p: LngLat, [sw, ne]: [LngLat, LngLat]) {
  if (p.lat < sw.lat || p.lat > ne.lat) return false;
  return sw.lng <= ne.lng ? p.lng >= sw.lng && p.lng <= ne.lng : p.lng >= sw.lng || p.lng <= ne.lng;
}
