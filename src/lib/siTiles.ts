import type { LngLat } from "./types";

/**
 * 缘缘庄's ink roaches as the map asks for them close up (GET /api/si/ink, src/lib/server/siInk.ts): by Web
 * Mercator tiles at INK_TILE_ZOOM (about 270 m across at 宏村), each ink roach in INK_BYTES bytes: where in
 * the tile (to a centimetre), its look, whether it queues, stays or lies outside, which way it faces, and the
 * little differences that make it look painted by hand. Nothing that tells one from another, or whose.
 */

export const INK_TILE_ZOOM = 17;
export const INK_BYTES = 8;

/** The tile a point is in, and where in it (0–1 across and down) */
export function tileOf(p: LngLat, z: number) {
  const n = 2 ** z;
  const x = ((p.lng + 180) / 360) * n;
  const r = (p.lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return { x: tx, y: ty, key: `${tx}/${ty}`, fx: x - tx, fy: y - ty };
}

/** A point of a tile (0–1 across and down) as WGS84 */
export function pointOf(x: number, y: number, z: number, fx: number, fy: number): LngLat {
  const n = 2 ** z;
  const lng = ((x + fx) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + fy)) / n))) * 180) / Math.PI;
  return { lng, lat };
}

/** The tiles that cover a box (south-west, north-east), at most `max` of them; none past that */
export function tilesOver(sw: LngLat, ne: LngLat, z: number, max = 64) {
  const a = tileOf(sw, z);
  const b = tileOf(ne, z);
  const out: { x: number; y: number }[] = [];
  for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) out.push({ x, y });
  return out.length > max ? [] : out;
}

/** 0 queues at the door, 1 stays in a room, 2 lies outside the village */
export type InkState = 0 | 1 | 2;

/** One ink roach as a tile carries it */
export type InkCell = {
  fx: number;
  fy: number;
  /** Index into ROACH_AVATARS */
  look: number;
  state: number;
  /** Facing left on screen (standing), or its head to the left (lying) */
  left: boolean;
  /** Its brush (siInn.ts brushOf): size 0.9–1.1, tilt −8–8°, ink 0.7–1 */
  size: number;
  tilt: number;
  ink: number;
};

const u16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v * 65535)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function encodeInk(out: Uint8Array, at: number, c: InkCell) {
  const x = u16(c.fx);
  const y = u16(c.fy);
  out[at] = x & 255;
  out[at + 1] = x >> 8;
  out[at + 2] = y & 255;
  out[at + 3] = y >> 8;
  out[at + 4] = (c.look & 7) | ((c.state & 3) << 3) | (c.left ? 32 : 0);
  out[at + 5] = u8((c.size - 0.9) / 0.2);
  out[at + 6] = u8((c.tilt + 8) / 16);
  out[at + 7] = u8((c.ink - 0.7) / 0.3);
}

export function decodeInk(bytes: Uint8Array, at: number): InkCell {
  const f = bytes[at + 4];
  return {
    fx: (bytes[at] | (bytes[at + 1] << 8)) / 65535,
    fy: (bytes[at + 2] | (bytes[at + 3] << 8)) / 65535,
    look: f & 7,
    state: (f >> 3) & 3,
    left: (f & 32) !== 0,
    size: 0.9 + (bytes[at + 5] / 255) * 0.2,
    tilt: -8 + (bytes[at + 6] / 255) * 16,
    ink: 0.7 + (bytes[at + 7] / 255) * 0.3,
  };
}

/** An ink roach on the map, from a tile: where (WGS84) and how it is drawn */
export type InkPoint = { lng: number; lat: number; look: number; state: InkState; left: boolean; size: number; tilt: number; ink: number };

/** Every ink roach in one tile's bytes */
export function decodeTile(x: number, y: number, z: number, bytes: Uint8Array): InkPoint[] {
  const out: InkPoint[] = [];
  for (let at = 0; at + INK_BYTES <= bytes.length; at += INK_BYTES) {
    const c = decodeInk(bytes, at);
    const p = pointOf(x, y, z, c.fx, c.fy);
    out.push({ lng: p.lng, lat: p.lat, look: c.look, state: c.state as InkState, left: c.left, size: c.size, tilt: c.tilt, ink: c.ink });
  }
  return out;
}
