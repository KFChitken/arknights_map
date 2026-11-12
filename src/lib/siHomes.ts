import { brushOf, fromSpiral, LAKE, MOON_POND, toLngLat, toXY, type InkSpot } from "./siInn";
import { RESERVOIR, RIVER } from "./siWater";

/**
 * Where each ink roach lies outside the village once its half day at 缘缘庄 is over (src/lib/siInn.ts):
 * a home of its own, by its number, the same for everyone. Homes are on a 3 m grid between the spiral's
 * rings, never within 8 m of the queue's three lanes, nor in or right beside the water (南湖, 月沼, the
 * river 西溪, the reservoir 奇墅湖), and fill outwards from the village: the higher the number, the further
 * out. Working out the grid takes a moment, so the server does it once (the page is told its own one's home).
 */

const GRID_M = 3;
/** Kept this far (along the radius) from a ring's middle lane: 8 m from its outer lane, 3 m off it */
const RING_CLEAR_M = 11;

/** The water's outlines in metres */
const WATER = [LAKE, MOON_POND, RESERVOIR, RIVER].map((pts) => pts.map(([lng, lat]) => toXY({ lng, lat })));

/**
 * Which cells of a grid (n cells each way from the middle, GRID_M apart) are water or within a cell of it:
 * each outline filled row by row where its edges cross, then widened by a cell all round
 */
function waterMask(n: number) {
  const size = 2 * n + 1;
  const mask = new Uint8Array(size * size);
  for (const ring of WATER) {
    for (let j = -n; j <= n; j++) {
      const y = j * GRID_M;
      const xs: number[] = [];
      for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
        const [x1, y1] = ring[m];
        const [x2, y2] = ring[k];
        if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const from = Math.max(-n, Math.ceil(xs[q] / GRID_M));
        const to = Math.min(n, Math.floor(xs[q + 1] / GRID_M));
        for (let i = from; i <= to; i++) mask[(j + n) * size + (i + n)] = 1;
      }
    }
  }
  // a cell beside water is too close to it
  const near = new Uint8Array(mask);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      if (!mask[j * size + i]) continue;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < size && b < size) near[b * size + a] = 1;
        }
    }
  return near;
}

let homes: Float32Array = new Float32Array(0);
let reachM = 0;

/** Every home within `radius` metres of the middle, nearest first (ties by direction), in a few hundred ms */
function build(radius: number) {
  const n = Math.ceil(radius / GRID_M);
  const size = 2 * n + 1;
  const wet = waterMask(n);
  // sorted by one number each: distance (to 0.1 mm) and direction, then the cell's index in the low 22 bits
  const keys: number[] = [];
  const LOW = 2 ** 22;
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      const x = i * GRID_M;
      const y = j * GRID_M;
      const d = Math.hypot(x, y);
      if (d > radius || wet[(j + n) * size + (i + n)]) continue;
      const s = fromSpiral(x, y);
      if (s.inside || s.gap < RING_CLEAR_M) continue;
      const turn = (Math.atan2(y, x) + Math.PI) / (2 * Math.PI);
      keys.push(Math.round(d * 1e4 + turn * 9) * LOW + ((j + n) * size + (i + n)));
    }
  }
  const sorted = Float64Array.from(keys).sort();
  const out = new Float32Array(sorted.length * 2);
  for (let k = 0; k < sorted.length; k++) {
    const cell = sorted[k] % LOW;
    out[k * 2] = ((cell % size) - n) * GRID_M;
    out[k * 2 + 1] = (Math.floor(cell / size) - n) * GRID_M;
  }
  homes = out;
  reachM = radius;
}

/** Make sure the first `count` homes are worked out (further out, the grid is worked out again, bigger) */
export function ensureHomes(count: number) {
  let radius = reachM || 1200;
  while (homes.length / 2 < count) {
    if (reachM) radius *= 1.5;
    build(radius);
  }
}

/** Where ink roach number `no` lies: its spot, and the way its head points */
export function homeSpot(no: number): InkSpot {
  ensureHomes(no);
  const i = (no - 1) * 2;
  return { x: homes[i], y: homes[i + 1], left: brushOf(no).headLeft };
}

/** How far from the middle of the village the homes reach once `drawn` ink roaches have one */
export function homesReach(drawn: number) {
  if (drawn <= 0) return 0;
  const { x, y } = homeSpot(drawn);
  return Math.hypot(x, y);
}

/**
 * Faint ink dots spread over the ground the homes cover out to `reach` metres (how the fields outside look from
 * the middle distance, src/components/map): `count` of them, the same every time, between the rings and out of
 * the water like the homes, without working out the homes' grid.
 */
export function homeDots(reach: number, count: number): [number, number][] {
  if (reach <= 0 || count <= 0) return [];
  let a = 20261111;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: [number, number][] = [];
  const inner = 300;
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    // even over the area between inner and reach
    const r = Math.sqrt(inner * inner + rand() * (reach * reach - inner * inner));
    const th = rand() * 2 * Math.PI;
    const x = r * Math.cos(th);
    const y = r * Math.sin(th);
    const s = fromSpiral(x, y);
    if (s.inside || s.gap < RING_CLEAR_M) continue;
    if (WATER.some((w) => insideRing(x, y, w))) continue;
    const p = toLngLat(x, y);
    out.push([p.lng, p.lat]);
  }
  return out;
}

function insideRing(x: number, y: number, ring: [number, number][]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}
