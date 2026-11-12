import type { LngLat } from "./types";

/**
 * 缘缘庄 (src/lib/si.ts): 祀掌柜's inn by 南湖 in 宏村, and the ink roaches (墨小强) queuing
 * for it, staying in it, and lying in the fields outside once their half day is over. Where
 * each one is follows from its ticket and a few counts alone (src/lib/server/si.ts), worked
 * out the same way by the server and every page.
 *
 * The queue starts at the door of the rooms, in the inn's front yard, and runs: back and forth
 * along the yard between ink railings; out of the gate onto the causeway, over the painted bridge
 * (画桥) to the south bank, east along it, round the lake's east end and back west along the north
 * bank; north into the village up the lanes the water channel (水圳, the ox's gut) runs beside, to
 * 月沼 (the ox's stomach) and half round it; then west along the lanes to the village gate, out
 * between the two old trees (the ox's horns) and over the bridge; and on, three abreast, in an
 * Archimedean spiral round the whole village, a ring every 120 m. Traced on OpenStreetMap's paths
 * (checked against satellite pictures, WGS84), each place 3 m from the next.
 */

/** Rooms at 缘缘庄: everyone stays half a day, so 5000 a day */
export const ROOMS = 2500;
/** How long a stay is */
export const STAY_MS = 12 * 3_600_000;

/** The room ticket n gets: the one ticket n − ROOMS leaves as it arrives */
export const roomOf = (n: number) => ((n - 1) % ROOMS) + 1;

// ---- a flat map of the village, in metres ----

/** The village's middle, which the spiral winds round (between the lake, 月沼 and the village's edges) */
export const INN_CENTER: LngLat = { lng: 117.985, lat: 30.005 };
const M_PER_DEG = 111_320;
const K = Math.cos((INN_CENTER.lat * Math.PI) / 180);
/** Metres east and north of INN_CENTER */
export const toXY = (p: LngLat): [number, number] => [(p.lng - INN_CENTER.lng) * M_PER_DEG * K, (p.lat - INN_CENTER.lat) * M_PER_DEG];
export const toLngLat = (x: number, y: number): LngLat => ({ lng: INN_CENTER.lng + x / (M_PER_DEG * K), lat: INN_CENTER.lat + y / M_PER_DEG });

// ---- the route through the village (segments 1–4) ----

/** Places in the queue are this far apart along the route */
export const STEP_M = 3;

/**
 * The route, door first, as [lng, lat]. 1: the yard (three rows between railings); 2: round the
 * lake's east half over the bridge; 3: up into the village to 月沼 and half round it; 4: out
 * of the village to the gate and over the bridge. Mostly OpenStreetMap's own paths.
 */
const YARD_ROWS = [30.004, 30.004 - 0.00002695, 30.004 - 2 * 0.00002695];
export const ROUTE_SEGMENTS: [number, number][][] = [
  [
    // the rooms' door, at the north-west corner of the yard; three rows
    [117.98363, 30.00407],
    [117.98363, YARD_ROWS[0]],
    [117.98432, YARD_ROWS[0]],
    [117.98432, YARD_ROWS[1]],
    [117.98366, YARD_ROWS[1]],
    [117.98366, YARD_ROWS[2]],
    [117.98436, YARD_ROWS[2]],
    // out of the gate in the south wall
    [117.98438, 30.0039],
  ],
  [
    // down to the causeway, over the painted bridge
    [117.984413, 30.0035],
    [117.984414, 30.003473],
    [117.984272, 30.003103],
    [117.98426, 30.003071],
    [117.984249, 30.003042],
    [117.984206, 30.002918],
    [117.984193, 30.002879],
    // east along the south bank, round the east end, back west along the north bank
    [117.984766, 30.002769],
    [117.984977, 30.002769],
    [117.985195, 30.002805],
    [117.985458, 30.002883],
    [117.98562, 30.002958],
    [117.986031, 30.003241],
    [117.986234, 30.003415],
    [117.985926, 30.003818],
    [117.985493, 30.00352],
  ],
  [
    // north up the lanes to the middle of the village
    [117.98543, 30.003687],
    [117.985368, 30.003768],
    [117.985297, 30.003946],
    [117.985258, 30.004029],
    [117.985231, 30.004089],
    [117.985185, 30.004227],
    [117.985162, 30.004318],
    [117.985229, 30.004385],
    [117.985242, 30.004519],
    [117.985286, 30.004613],
    [117.985333, 30.004782],
    [117.98531, 30.004873],
    [117.985154, 30.004901],
    [117.984852, 30.004962],
    // to 月沼, and half round it along its south bank
    [117.984944, 30.005203],
    [117.984629, 30.005318],
    [117.984576, 30.005271],
    [117.984487, 30.00525],
    [117.984386, 30.005269],
    [117.984275, 30.005329],
    [117.984238, 30.005371],
    [117.984174, 30.00547],
    [117.984161, 30.005557],
    [117.984175, 30.005636],
  ],
  [
    // west along the lanes north of the inn to the village's west edge
    [117.98379, 30.005782],
    [117.983576, 30.005769],
    [117.983307, 30.005761],
    [117.982808, 30.005585],
    [117.982528, 30.005547],
    [117.982546, 30.005274],
    // between the two old trees, over the bridge, and across the road beyond, clear of the river
    [117.982427, 30.005026],
    [117.982346, 30.004972],
    [117.981943, 30.00474],
    [117.98172, 30.00466],
    [117.9814, 30.00466],
  ],
];

/** The two old trees by the village gate (牛角): the queue walks out between them */
export const GATE_TREES: LngLat[] = [
  { lng: 117.98257, lat: 30.00515 },
  { lng: 117.98235, lat: 30.00508 },
];

type Path = { xy: [number, number][]; at: number[]; length: number };
function pathOf(points: [number, number][]): Path {
  const xy = points.map(([lng, lat]) => toXY({ lng, lat }));
  const at = [0];
  for (let i = 1; i < xy.length; i++) at.push(at[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  return { xy, at, length: at[at.length - 1] };
}
/** The whole route as one path, and where each segment ends along it (metres) */
const ROUTE = pathOf(ROUTE_SEGMENTS.flat());
export const SEGMENT_ENDS_M = ROUTE_SEGMENTS.map((_, i) => pathOf(ROUTE_SEGMENTS.slice(0, i + 1).flat()).length);

/** The point s metres along a path, and the way the path runs there (unit vector, away from its start) */
function along(p: Path, s: number): { x: number; y: number; dx: number; dy: number } {
  const t = Math.max(0, Math.min(p.length, s));
  let i = 1;
  // a binary search: the route has under a hundred points, the spiral's places are many
  let lo = 1;
  let hi = p.at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.at[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  i = lo;
  const [x0, y0] = p.xy[i - 1];
  const [x1, y1] = p.xy[i];
  const seg = p.at[i] - p.at[i - 1] || 1;
  const f = (t - p.at[i - 1]) / seg;
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, dx: (x1 - x0) / seg, dy: (y1 - y0) / seg };
}

/**
 * Where along the route (metres) each place is: the door's first, then each the first point along it a
 * straight STEP_M from the one before, so nobody stands closer to their neighbour where it turns a corner
 */
const PLACES_AT: number[] = (() => {
  const out = [0];
  const fine = 0.05;
  let s = 0;
  while (s < ROUTE.length) {
    const from = along(ROUTE, s);
    let t = s;
    while (t < ROUTE.length) {
      t = Math.min(ROUTE.length, t + fine);
      const a = along(ROUTE, t);
      if (Math.hypot(a.x - from.x, a.y - from.y) >= STEP_M) break;
    }
    const a = along(ROUTE, t);
    if (Math.hypot(a.x - from.x, a.y - from.y) < STEP_M) break;
    out.push(t);
    s = t;
  }
  return out;
})();
/** Places along the route, the door's the first: everyone past the last of them waits on the spiral */
export const ROUTE_PLACES = PLACES_AT.length;

// ---- the spiral round the village (segment 5) ----

/** Rings of the spiral are this far apart */
export const RING_M = 120;
/** Three abreast, this far apart side by side, rows this far apart */
export const ABREAST = 3;
export const LANE_M = 3;
export const ROW_M = 6;
const B = RING_M / (2 * Math.PI);
const START = ROUTE.xy[ROUTE.xy.length - 1];
/** The spiral's start: where the route ends, over the bridge west of the village */
export const SPIRAL_R0 = Math.hypot(START[0], START[1]);
const THETA0 = Math.atan2(START[1], START[0]);

/** Arc length of the spiral from its start to a radius r (r ≥ SPIRAL_R0) */
function arcTo(r: number) {
  const F = (q: number) => (q * Math.sqrt(q * q + B * B) + B * B * Math.log(q + Math.sqrt(q * q + B * B))) / (2 * B);
  return F(r) - F(SPIRAL_R0);
}
/** The radius s metres along the spiral */
function radiusAt(s: number) {
  // Newton's method from the radius a circle would give
  let r = Math.sqrt(SPIRAL_R0 * SPIRAL_R0 + 2 * B * s);
  for (let k = 0; k < 6; k++) {
    const f = arcTo(r) - s;
    r -= (f * B) / Math.sqrt(r * r + B * B);
  }
  return Math.max(SPIRAL_R0, r);
}
/** The spiral s metres along, and its way there: counter-clockwise on the map, west → south → east → north */
function spiralAt(s: number) {
  const r = radiusAt(s);
  const phi = (r - SPIRAL_R0) / B;
  const th = THETA0 + phi;
  const x = r * Math.cos(th);
  const y = r * Math.sin(th);
  // tangent of r = r0 + B·φ: (B cos − r sin, B sin + r cos)
  const tx = B * Math.cos(th) - r * Math.sin(th);
  const ty = B * Math.sin(th) + r * Math.cos(th);
  const n = Math.hypot(tx, ty);
  return { x, y, dx: tx / n, dy: ty / n, r, phi };
}
/**
 * For a point (metres from INN_CENTER): whether it is inside the spiral's first ring (the village), and how
 * far it is along its own radius from the nearest ring (close enough to the distance across for rings this wide)
 */
export function fromSpiral(x: number, y: number) {
  const d = Math.hypot(x, y);
  const turn = 2 * Math.PI;
  const phi0 = (((Math.atan2(y, x) - THETA0) % turn) + turn) % turn;
  const first = SPIRAL_R0 + B * phi0;
  if (d < first) return { inside: true, gap: first - d };
  const k = Math.floor((d - first) / RING_M);
  const below = first + k * RING_M;
  return { inside: false, gap: Math.min(d - below, below + RING_M - d) };
}

/** How many times round the village a point s metres along the spiral is */
export const turnsAt = (s: number) => spiralAt(s).phi / (2 * Math.PI);

/** Where on the spiral the q-th of those waiting past the route (from 0) stands, in metres along it, and across */
function spiralPlace(q: number) {
  const row = Math.floor(q / ABREAST);
  const lane = (q % ABREAST) - (ABREAST - 1) / 2;
  return { s: STEP_M + row * ROW_M, side: lane * LANE_M };
}

// ---- where each one is ----

/** A spot, and the way someone standing there faces as they wait (towards the door): left or right on screen */
export type InkSpot = { x: number; y: number; left: boolean };

/** Where the one p-th in the queue (1: at the door) stands */
export function queueSpot(place: number): InkSpot {
  const p = Math.max(1, Math.floor(place));
  if (p <= ROUTE_PLACES) {
    const a = along(ROUTE, PLACES_AT[p - 1]);
    // facing back along the route, towards the door
    return { x: a.x, y: a.y, left: a.dx > 0 };
  }
  const { s, side } = spiralPlace(p - ROUTE_PLACES - 1);
  const a = spiralAt(s);
  // across: the right of the way it runs is (dy, −dx)
  return { x: a.x + a.dy * side, y: a.y - a.dx * side, left: a.dx > 0 };
}

/** How many times round the village the end of a queue this long reaches (0 within the village) */
export function queueTurns(queue: number) {
  if (queue <= ROUTE_PLACES) return 0;
  return turnsAt(spiralPlace(queue - ROUTE_PLACES - 1).s);
}

// ---- the inn ----

/** Rooms are on a grid this wide, filling the inn's ground row by row from the yard, wherever it is dry land */
export const ROOM_M = 2.5;
/** The inn's ground: west, south, east, north (its yard is just south of it) */
export const INN_BOUNDS = { west: 117.9829, south: 30.0041, east: 117.9844, north: 30.00515 };
/** The yard in front, and its gate: where the inn's walls and railings are drawn */
export const YARD_BOUNDS = { west: 117.98355, south: 30.0039, east: 117.9844, north: 30.00408 };
/** Water (lake, 月沼) is kept this far from */
const SHORE_M = 4;

/** 南湖 and 月沼, as OpenStreetMap draws them (WGS84) */
export const LAKE: [number, number][] = [
  [117.984258, 30.003048], [117.984198, 30.002924], [117.983482, 30.003069], [117.983286, 30.003141], [117.983179, 30.003211],
  [117.983105, 30.003296], [117.983062, 30.003381], [117.982898, 30.004135], [117.983131, 30.004194], [117.983304, 30.003934],
  [117.983391, 30.003848], [117.983544, 30.003744], [117.983829, 30.003608], [117.983974, 30.003567], [117.984347, 30.003488],
  [117.984386, 30.003429], [117.984263, 30.003099], [117.984279, 30.003094], [117.984407, 30.003425], [117.98448, 30.003455],
  [117.98487, 30.00338], [117.985055, 30.003355], [117.985242, 30.003373], [117.985558, 30.003528], [117.985878, 30.003762],
  [117.985966, 30.00374], [117.98611, 30.003541], [117.986099, 30.003407], [117.985629, 30.003022], [117.985495, 30.002957],
  [117.985279, 30.002888], [117.985063, 30.00285], [117.984811, 30.002843], [117.984218, 30.002929], [117.984258, 30.003048],
];
export const MOON_POND: [number, number][] = [
  [117.984185, 30.005618], [117.984666, 30.005467], [117.984656, 30.005404], [117.984627, 30.005341], [117.984587, 30.005292],
  [117.984539, 30.005272], [117.984479, 30.00526], [117.984407, 30.005272], [117.984336, 30.005306], [117.984265, 30.005355],
  [117.984234, 30.005402], [117.984191, 30.005474], [117.984176, 30.005556], [117.984185, 30.005618],
];
const LAKE_XY = LAKE.map(([lng, lat]) => toXY({ lng, lat }));
const MOON_XY = MOON_POND.map(([lng, lat]) => toXY({ lng, lat }));

/** Whether a point (metres) is inside a ring of points */
export function inside(x: number, y: number, ring: [number, number][]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}
/** How far a point is from a ring's edge (or a path), in metres */
export function distanceTo(x: number, y: number, pts: [number, number][]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}
const wet = (x: number, y: number, margin: number) =>
  inside(x, y, LAKE_XY) || inside(x, y, MOON_XY) || distanceTo(x, y, LAKE_XY) < margin || distanceTo(x, y, MOON_XY) < margin;

let rooms: Float64Array | null = null;
/** Every room's spot (metres), room 1 first: row by row northwards from the yard, west to east, on dry land */
function roomSpots() {
  if (rooms) return rooms;
  const [x0, y0] = toXY({ lng: INN_BOUNDS.west, lat: INN_BOUNDS.south });
  const [x1, y1] = toXY({ lng: INN_BOUNDS.east, lat: INN_BOUNDS.north });
  const out: number[] = [];
  for (let y = y0 + ROOM_M / 2; y <= y1 && out.length < ROOMS * 2; y += ROOM_M) {
    for (let x = x0 + ROOM_M / 2; x <= x1 && out.length < ROOMS * 2; x += ROOM_M) {
      if (!wet(x, y, SHORE_M)) out.push(x, y);
    }
  }
  rooms = Float64Array.from(out);
  return rooms;
}
/** Where the one staying in room `room` (1–ROOMS) stands */
export function roomSpot(room: number): InkSpot {
  const all = roomSpots();
  const i = (Math.max(1, Math.min(ROOMS, Math.floor(room))) - 1) * 2;
  // half look one way, half the other, by room
  return { x: all[i], y: all[i + 1], left: room % 2 === 0 };
}
/** How many rooms the inn's ground holds (at least ROOMS) */
export const roomsThatFit = () => roomSpots().length / 2;

// ---- the numbers, and what she says about them ----

/** What the counts make: waiting at the door, in rooms, free rooms, and lying in the fields outside */
export function innNumbers(s: { drawn: number; tickets: number; checkedIn: number; checkedOut: number }) {
  const queue = Math.max(0, s.tickets - s.checkedIn);
  const staying = Math.max(0, s.checkedIn - s.checkedOut);
  return { queue, staying, free: Math.max(0, ROOMS - staying), outside: Math.max(0, s.drawn - (s.tickets - s.checkedOut)) };
}

/** 塔川, the hamlet north-east of 宏村 known for its autumn leaves: as far from the middle of the village */
export const TACHUAN: LngLat = { lng: 118.003978, lat: 30.021824 };

/** The queue reaches a landmark once this many wait at the door (src/lib/siInn.test.ts checks them) */
export const MILESTONES = (() => {
  // the first place at or past a point along the route
  const placeAt = (s: number) => PLACES_AT.findIndex((t) => t >= s - 1e-6) + 1 || ROUTE_PLACES;
  const ringPlaces = (turns: number) => {
    // rows within the first `turns` rings, three abreast
    const s = arcTo(SPIRAL_R0 + turns * RING_M);
    return ROUTE_PLACES + Math.floor((s - STEP_M) / ROW_M + 1) * ABREAST;
  };
  const [tx, ty] = toXY(TACHUAN);
  const tachuan = arcTo(Math.hypot(tx, ty));
  // the bridge's south end and 月沼's east end, along the route
  const bridge = ROUTE.at[ROUTE_SEGMENTS[0].length + 6];
  const moon = ROUTE.at[ROUTE_SEGMENTS[0].length + ROUTE_SEGMENTS[1].length + 15];
  return {
    bridge: placeAt(bridge),
    moon: placeAt(moon),
    gate: ROUTE_PLACES,
    ring1: ringPlaces(1),
    ring5: ringPlaces(5),
    ring10: ringPlaces(10),
    tachuan: ROUTE_PLACES + Math.floor((tachuan - STEP_M) / ROW_M + 1) * ABREAST,
  };
})();

/** What she says on her card about how far the queue reaches */
export const QUEUE_LINES = {
  bridge: "画桥上也排满了。……桥是让人看的，不是让你们排队的。",
  moon: "排到月沼边了。别往水里挤，掉下去我可不捞。",
  gate: "出村了。村口那两棵老树都快被你们挤歪了。……哼，挤就挤吧。",
  ring1: "绕了宏村一整圈。你们是不是都没别的事做？……我可没有一直在数。",
  ring5: "绕了五圈了。我的墨又不是用不完的！……还、还够画就是了。",
  ring10: "盘得跟蚊香似的……才、才不是我故意画成这样。",
  tachuan: "排到塔川了。那边秋天叶子红，排着也不闷。……我、我随口说的。",
  shrink: "队伍短了。……哼，人少了我也没觉得冷清。",
};

/**
 * What she says on her card about how far the queue reaches (3.6): that it shrank by a whole round of
 * the village since a day ago; else the furthest landmark its end has passed. Null before the first.
 */
export function queueTailLine(queue: number, queueDayAgo: number): string | null {
  if (queueTurns(queueDayAgo) - queueTurns(queue) >= 1) return QUEUE_LINES.shrink;
  const passed = (["tachuan", "ring10", "ring5", "ring1", "gate", "moon", "bridge"] as const).find((k) => queue >= MILESTONES[k]);
  return passed ? QUEUE_LINES[passed] : null;
}

// ---- drawing the queue from afar ----

/**
 * The queue's line from the door to its end, for the map from the middle distance (3.8): the route,
 * then the spiral as far as `queue` reach, as [lng, lat], a point every few metres along the spiral.
 */
export function queueLine(queue: number): [number, number][] {
  if (queue <= 0) return [];
  const pts: [number, number][] = [];
  const routeEnd = Math.min(queue, ROUTE_PLACES);
  const routeTo = PLACES_AT[routeEnd - 1];
  for (let i = 0; i < ROUTE.xy.length && ROUTE.at[i] <= routeTo; i++) {
    const p = toLngLat(ROUTE.xy[i][0], ROUTE.xy[i][1]);
    pts.push([p.lng, p.lat]);
  }
  const end = along(ROUTE, routeTo);
  const e = toLngLat(end.x, end.y);
  pts.push([e.lng, e.lat]);
  if (queue > ROUTE_PLACES) {
    const s = spiralPlace(queue - ROUTE_PLACES - 1).s;
    // every 15 m is smooth enough for a ring 300 m and more across
    for (let t = 0; t < s; t += 15) {
      const a = spiralAt(t);
      const p = toLngLat(a.x, a.y);
      pts.push([p.lng, p.lat]);
    }
    const a = spiralAt(s);
    const p = toLngLat(a.x, a.y);
    pts.push([p.lng, p.lat]);
  }
  return pts;
}

/** How far out (metres from INN_CENTER) the spiral runs at its start and after `turns` rings */
export const spiralRadius = (turns: number) => SPIRAL_R0 + turns * RING_M;

// ---- each one's hand-drawn look ----

/**
 * A little of what makes each ink roach look painted by hand, the same for everyone: a size within
 * ±10%, how dark the ink is, a tilt within ±8°, from its number.
 */
export function brushOf(no: number) {
  let a = (no * 2654435761) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { size: 0.9 + 0.2 * next(), ink: 0.7 + 0.3 * next(), tilt: -8 + 16 * next(), headLeft: next() < 0.5 };
}

// ---- the inn drawn in ink ----

/**
 * 缘缘庄 as the map draws it in ink lines: its outer wall (with its gate in the south wall of the yard),
 * the walls between its courtyards (几进院子, with doorways), and the railings the queue winds between in the
 * yard; and where its sign hangs (客满 when full) and the two old trees by the village gate stand.
 */
export function innDrawing() {
  const yard = YARD_BOUNDS;
  const inn = INN_BOUNDS;
  const gateW = 0.00004;
  const gate = 117.98438;
  const wall: [number, number][] = [
    [gate - gateW, yard.south],
    [yard.west, yard.south],
    [yard.west, inn.south],
    [117.98335, inn.south],
    [inn.west, 30.00435],
    [inn.west, inn.north],
    [inn.east, inn.north],
    [inn.east, yard.south],
    [gate + gateW, yard.south],
  ];
  // courtyards: three across, two deep, a doorway in each wall
  const cols = [117.9834, 117.9839];
  const mid = 30.00462;
  const door = 0.00003;
  const courts: [number, number][][] = [
    ...cols.flatMap((x): [number, number][][] => [
      [
        [x, inn.south],
        [x, mid - door],
      ],
      [
        [x, mid + door],
        [x, inn.north],
      ],
    ]),
    [
      [inn.west, mid],
      [117.9836 - door, mid],
    ],
    [
      [117.9836 + door, mid],
      [117.9841 - door, mid],
    ],
    [
      [117.9841 + door, mid],
      [inn.east, mid],
    ],
    // the rooms' door onto the yard
    [
      [yard.west, inn.south],
      [117.98358, inn.south],
    ],
    [
      [117.98368, inn.south],
      [inn.east, inn.south],
    ],
  ];
  // railings between the yard's rows, open at the ends where the queue turns
  const between = (a: number, b: number) => (YARD_ROWS[a] + YARD_ROWS[b]) / 2;
  const railings: [number, number][][] = [
    [
      [yard.west, between(0, 1)],
      [117.98426, between(0, 1)],
    ],
    [
      [117.98372, between(1, 2)],
      [inn.east, between(1, 2)],
    ],
  ];
  return {
    walls: [wall, ...courts],
    railings,
    sign: { lng: gate + 0.0001, lat: yard.south + 0.00002 } as LngLat,
    trees: GATE_TREES,
  };
}

// ---- your own, as the page draws it ----

/**
 * Where your own ink roach is at `now` (3.8: the page draws it itself, ringed, never from the tiles), from what
 * me() said of it and how many had their room by the last count (checkedIn, null before it comes): still queuing
 * (place: how many are ahead of it, itself included, as far forward as the fresher of the two puts it), in its
 * room since its check-in, or home in the fields from its check-out, whatever me() said a moment ago; and when it
 * next changes (until: its check-in or check-out; null once it lies outside).
 */
export function inkNow(
  ink: (
    | { state: "queue"; n: number; place: number; checkinAt: number }
    | { state: "stay"; n: number; room: number; checkoutAt: number }
    | { state: "out" }
  ) & { inkNo: number; home: LngLat },
  checkedIn: number | null,
  now: number,
):
  | { state: 0; at: LngLat; left: boolean; place: number; until: number }
  | { state: 1; at: LngLat; left: boolean; room: number; until: number }
  | { state: 2; at: LngLat; left: boolean; until: null } {
  // lying at home, its head the way its number says (siHomes.ts homeSpot)
  const home = () => ({ state: 2 as const, at: ink.home, left: brushOf(ink.inkNo).headLeft, until: null });
  if (ink.state === "out") return home();
  const checkinAt = ink.state === "queue" ? ink.checkinAt : ink.checkoutAt - STAY_MS;
  const checkoutAt = checkinAt + STAY_MS;
  if (now >= checkoutAt) return home();
  if (now >= checkinAt) {
    const room = roomOf(ink.n);
    const s = roomSpot(room);
    return { state: 1, at: toLngLat(s.x, s.y), left: s.left, room, until: checkoutAt };
  }
  const told = ink.state === "queue" ? ink.place : ink.n;
  const place = Math.max(1, Math.min(told, checkedIn === null ? told : ink.n - checkedIn));
  const s = queueSpot(place);
  return { state: 0, at: toLngLat(s.x, s.y), left: s.left, place, until: checkinAt };
}
