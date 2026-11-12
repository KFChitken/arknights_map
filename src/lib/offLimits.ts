import type { LngLat } from "./types";

/**
 * Places where no roach may stand: a few national sites, in WGS-84 like every stored spot.
 * Putting a roach down or moving it there is refused with OFF_LIMITS_MESSAGE (checkSpot in
 * world/logic.ts, and the map before it asks). The spots the server picks itself skip them:
 * seats by a friend's roach or the fire (pickSeat), 明河都尉's queue (queueSpots); a roach going
 * home to one, from a visit or a ride, stops just outside (outsideOffLimits); and the roaches
 * that stood in one before it was listed move out as the server starts (src/lib/server/offLimits.ts).
 * The places are drawn nowhere, and no message names them.
 */

type Ring = [lng: number, lat: number][];
type Place = { id: string } & ({ ring: Ring } | { at: LngLat; m: number });

/**
 * Each a ring of corners (Beijing's streets run a little off north) or a circle, a little
 * bigger than the site so that its edge is not right on it. The circles are measured from
 * WGS-84 readings of the site, and made wide enough to hold the GCJ-02 ones too where
 * the sources disagreed.
 */
export const OFF_LIMITS: Place[] = [
  // Zhongnanhai: from Wenjin Street down to Chang'an Avenue, Fuyou Street across to Beichang and Nanchang Street
  {
    id: "zhongnanhai",
    ring: [
      [116.3736, 39.9211],
      [116.385, 39.9211],
      [116.3857, 39.9059],
      [116.3742, 39.9056],
    ],
  },
  // Tiananmen Square with the Monument to the People's Heroes, the Chairman Mao Memorial Hall, the Great Hall
  // of the People, the National Museum and Zhengyangmen, and the Tiananmen gate north of Chang'an Avenue
  {
    id: "tiananmen",
    ring: [
      [116.3853, 39.8986],
      [116.3975, 39.8986],
      [116.3975, 39.9071],
      [116.393, 39.9071],
      [116.393, 39.9095],
      [116.3895, 39.9095],
      [116.3895, 39.9071],
      [116.3853, 39.9071],
    ],
  },
  { id: "babaoshan-cemetery", at: { lng: 116.2235, lat: 39.9083 }, m: 400 },
  // the Marco Polo Bridge, Wanping and the Museum of the War of Chinese People's Resistance Against Japanese Aggression
  { id: "lugou-bridge", at: { lng: 116.217, lat: 39.8495 }, m: 650 },
  { id: "nanjing-massacre-memorial", at: { lng: 118.7392, lat: 32.0368 }, m: 500 },
  { id: "yuhuatai", at: { lng: 118.7748, lat: 32.002 }, m: 600 },
  { id: "sun-yat-sen-mausoleum", at: { lng: 118.8488, lat: 32.0612 }, m: 550 },
  { id: "first-cpc-congress-site", at: { lng: 121.4707, lat: 31.2214 }, m: 180 },
  // the former residence, the memorial hall and the square with the statue: the sources put them up to 800 m apart, so it is wide
  { id: "shaoshan", at: { lng: 112.4935, lat: 27.9115 }, m: 1100 },
  { id: "september-18-museum", at: { lng: 123.46, lat: 41.8323 }, m: 450 },
  { id: "unit-731-site", at: { lng: 126.6315, lat: 45.6077 }, m: 750 },
];

/** What a player is told who picks a spot in one: the same everywhere, naming no place */
export const OFF_LIMITS_MESSAGE = "这里不能放蟑螂，换个地方吧。";

const M_PER_DEG = 111_320;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Metres between two points, flat-earth: plenty within a few kilometres */
function metres(a: LngLat, b: LngLat) {
  const dx = (a.lng - b.lng) * M_PER_DEG * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dx, (a.lat - b.lat) * M_PER_DEG);
}

/** A point some metres from p along a compass bearing */
function offset(p: LngLat, deg: number, m: number): LngLat {
  return {
    lng: p.lng + (m * Math.sin(rad(deg))) / (M_PER_DEG * Math.cos(rad(p.lat))),
    lat: p.lat + (m * Math.cos(rad(deg))) / M_PER_DEG,
  };
}

/** Even-odd test against a ring of corners */
function inRing(ring: Ring, p: LngLat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Each place's middle and how far from it its farthest point is: a quick test first, and what the server looks through */
export const OFF_LIMITS_REACH: { id: string; at: LngLat; m: number }[] = OFF_LIMITS.map((p) => {
  if ("at" in p) return { id: p.id, at: p.at, m: p.m };
  const at = {
    lng: p.ring.reduce((s, [lng]) => s + lng, 0) / p.ring.length,
    lat: p.ring.reduce((s, [, lat]) => s + lat, 0) / p.ring.length,
  };
  return { id: p.id, at, m: Math.max(...p.ring.map(([lng, lat]) => metres(at, { lng, lat }))) };
});

// a box around each, in degrees, so most points are let through without any arithmetic
const BOXES = OFF_LIMITS_REACH.map(({ at, m }) => {
  const dLat = (m / M_PER_DEG) * 1.01;
  const dLng = dLat / Math.cos(rad(at.lat));
  return { w: at.lng - dLng, e: at.lng + dLng, s: at.lat - dLat, n: at.lat + dLat };
});

/** The id of the place p is in, or null */
export function offLimitsAt(p: LngLat): string | null {
  for (const [i, place] of OFF_LIMITS.entries()) {
    const b = BOXES[i];
    if (p.lng < b.w || p.lng > b.e || p.lat < b.s || p.lat > b.n) continue;
    if ("ring" in place ? inRing(place.ring, p) : metres(place.at, p) < place.m) return place.id;
  }
  return null;
}

export const isOffLimits = (p: LngLat) => offLimitsAt(p) !== null;

/** How finely, and how far at most, the way out is looked for: every place is far smaller */
const STEP_M = 10;
const MAX_M = 4000;

/**
 * Where a roach that would stand at p stands instead: p itself where it may, else out of
 * the place the shortest way (of 36, a tie picked at random), and then on between `past`
 * metres more, a little to either side, so that roaches moved out of one place spread out
 * around it instead of lining its edge.
 */
export function outsideOffLimits(p: LngLat, random: () => number = Math.random, past: [number, number] = [60, 300]): LngLat {
  if (!isOffLimits(p)) return p;
  let edge = MAX_M;
  let ways: number[] = [];
  for (let deg = 0; deg < 360; deg += 10) {
    for (let m = STEP_M; m <= edge; m += STEP_M) {
      if (isOffLimits(offset(p, deg, m))) continue;
      if (m < edge) ways = [];
      edge = m;
      ways.push(deg);
      break;
    }
  }
  const way = ways.length ? ways[Math.floor(random() * ways.length)] : 0;
  const deg = way + (random() * 2 - 1) * 10;
  // on past the edge; another place further along the way is walked through the same way
  for (let m = edge + past[0] + random() * (past[1] - past[0]); m < edge + MAX_M; m += STEP_M) {
    const q = offset(p, deg, m);
    if (!isOffLimits(q)) return q;
  }
  return offset(p, way, edge);
}
