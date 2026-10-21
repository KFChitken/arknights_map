import { hash128 } from "./prng";

/**
 * Public position fuzzing. The true point is snapped to a grid of roughly
 * square cells (about cellKm on a side at every latitude), then replaced by a
 * point inside that cell picked by a keyed hash of (secret, roach key, cell).
 * The result does not depend on where in the cell the true point is, so moving
 * inside a cell, refreshing or averaging reveals nothing finer than the cell.
 *
 * While all data lives in the browser the hash is a fast non-cryptographic
 * one. Once positions move to a server, swap it for HMAC-SHA256 with a secret
 * that never reaches clients, so offsets cannot be recomputed from this code.
 */

const KM_PER_DEG_LAT = 111.32;
const MAX_LAT = 85;

export type Point = { lng: number; lat: number };

export function cellOf(p: Point, cellKm: number) {
  const dLat = cellKm / KM_PER_DEG_LAT;
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
  const row = Math.floor(lat / dLat);
  // columns widen towards the poles so a cell stays about cellKm wide on the ground
  const midLat = (row + 0.5) * dLat;
  const dLng = dLat / Math.cos((midLat * Math.PI) / 180);
  const col = Math.floor((wrapLng(p.lng) + 180) / dLng);
  return { row, col, dLat, dLng };
}

/** key identifies the roach (owner and slot), so each roach gets its own spot in a cell. */
export function fuzz(p: Point, key: string, secret: string, cellKm: number): Point {
  const { row, col, dLat, dLng } = cellOf(p, cellKm);
  const [a, b] = hash128(`${secret}|${key}|${row}|${col}`);
  const west = col * dLng - 180;
  // the last column before the antimeridian is narrower than the rest
  const width = Math.min(dLng, 180 - west);
  return {
    lng: west + (a / 2 ** 32) * width,
    lat: (row + b / 2 ** 32) * dLat,
  };
}

function wrapLng(lng: number) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Great-circle distance in km. */
export function distanceKm(a: Point, b: Point) {
  const R = 6371.0088;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
