#!/usr/bin/env node
// Build src/data/china-gcj.json and src/data/china-view.json, the outlines the map needs about China, from
// Natural Earth's 10m admin-0 countries (public domain, naturalearthdata.com):
//
//   node scripts/build-china-areas.mjs <folder with the Natural Earth geojson files>
//
// That folder needs ne_10m_admin_0_countries.geojson and ne_10m_admin_0_countries_chn.geojson
// (github.com/nvkelso/natural-earth-vector, geojson/). One thing goes in each file:
//
// - foreign: every other country's land inside the box where gcoord would shift
//   coordinates (src/lib/coords.ts), simplified. Amap shifts mainland China, Hong
//   Kong, Macau and Taiwan (checked on 2026-11-06: Amap puts Taipei 101 515 m from
//   where it is, 14 m once shifted), and nowhere else, so a point in that box is
//   shifted unless it lies in one of these: Korea, Japan, Vietnam and the rest. The
//   sea and China's islands (some too small for Natural Earth) are shifted, which is
//   right for the islands and harmless at sea. Borders are good to about 500 m.
// - view: where the map must be Amap (src/lib/chinaView.ts): China as China draws
//   it (Natural Earth's China point of view: Taiwan, 藏南 and Aksai Chin included),
//   Hong Kong and Macau, the South China Sea within the nine-dash line, and the
//   Diaoyu Islands, as cells of a grid widened by a cell all round, so it only
//   ever errs towards showing Amap.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) throw new Error("usage: node scripts/build-china-areas.mjs <folder with the Natural Earth geojson files>");
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));

/** gcoord's own idea of China, the only place it shifts anything */
const GCJ_BOX = [72.004, 0.8293, 137.8347, 55.8271];
const CHINA = new Set(["CHN", "HKG", "MAC", "TWN"]);
/**
 * How finely each foreign country is kept: Douglas–Peucker tolerance in degrees, and the
 * smallest island kept (km²; smaller ones get shifted, which nobody will notice). China's
 * neighbours show on Amap near the border, so they are kept closely there (near) and
 * roughly elsewhere; the rest only ever at small scale, since the map changes to our
 * own near them.
 */
const DETAIL = {
  neighbour: { tolerance: 0.05, near: 0.005, minKm2: 20 },
  far: { tolerance: 0.05, minKm2: 150 },
};
const NEIGHBOURS = new Set(["PRK", "RUS", "MNG", "KAZ", "KGZ", "TJK", "AFG", "PAK", "IND", "NPL", "BTN", "MMR", "LAO", "VNM"]);
const detailOf = (a3) => (NEIGHBOURS.has(a3) ? DETAIL.neighbour : DETAIL.far);
/** The view grid: cell size in degrees, and the area it covers */
const STEP = 0.1;
const GRID = { west: 73, south: 3, east: 136, north: 54 };

const outerRings = (geometry) =>
  (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).map((polygon) => polygon[0]);
const round = (v) => Math.round(v * 1e4) / 1e4;

function areaKm2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return Math.abs(a / 2) * 111.32 * 111.32 * Math.cos((lat * Math.PI) / 180);
}

/** Sutherland–Hodgman: the part of a ring inside a box */
function clip(ring, [w, s, e, n]) {
  const edges = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

/** Douglas–Peucker on an open list of points; tol in degrees, or a function giving it for a point */
function simplify(points, tol) {
  const tolOf = typeof tol === "function" ? tol : () => tol;
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay);
    // the point standing out most beyond its own tolerance
    let far = -1;
    let farD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      const over = d - tolOf(points[i]);
      if (over > 0 && over > farD) {
        far = i;
        farD = over;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A closed ring simplified: split at its farthest point from the start so both halves keep their ends */
function simplifyRing(ring, tol) {
  const pts = ring.slice(0, -1);
  let far = 0;
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  }
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

// ---- where the map must be Amap, as grid cells ----

const china = load("ne_10m_admin_0_countries_chn.geojson");
// Taiwan is part of CHN in this point of view, and stays so in case the file ever separates it
const chinaRings = china.features.filter((f) => CHINA.has(f.properties.ADM0_A3)).flatMap((f) => outerRings(f.geometry));
// Drawn by hand, generously, just outside the nine-dash line, keeping off the land of Vietnam,
// Malaysia, Brunei and the Philippines, and closing through mainland China
const SOUTH_CHINA_SEA = [
  [108.0, 21.6], [107.7, 19.5], [108.3, 17.0], [109.9, 15.0], [110.1, 12.5], [109.7, 10.5], [108.7, 8.0],
  [109.5, 6.0], [112.0, 3.4], [113.6, 5.1], [114.6, 6.0], [115.6, 7.4], [116.4, 8.9], [117.7, 10.8],
  [118.4, 13.4], [118.9, 16.0], [119.5, 18.5], [120.8, 20.6], [122.0, 22.0], [122.7, 24.9], [119.5, 25.5],
  [116.0, 23.0], [113.0, 21.6], [110.0, 21.0],
];
const DIAOYU = [[123.3, 25.6], [124.75, 25.6], [124.75, 26.05], [123.3, 26.05]];
const rings = [...chinaRings, SOUTH_CHINA_SEA, DIAOYU];

const cols = Math.round((GRID.east - GRID.west) / STEP);
const rows = Math.round((GRID.north - GRID.south) / STEP);
const cells = new Uint8Array(cols * rows);
const mark = (c, r) => {
  if (c >= 0 && c < cols && r >= 0 && r < rows) cells[r * cols + c] = 1;
};
const colOf = (x) => Math.floor((x - GRID.west) / STEP);
const rowOf = (y) => Math.floor((y - GRID.south) / STEP);

for (const ring of rings) {
  const pts = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  // every cell an edge passes through, walked in steps a fifth of a cell long
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (STEP / 5)));
    for (let k = 0; k <= n; k++) mark(colOf(ax + ((bx - ax) * k) / n), rowOf(ay + ((by - ay) * k) / n));
  }
  // and every cell whose middle is inside, row by row
  for (let r = 0; r < rows; r++) {
    const y = GRID.south + (r + 0.5) * STEP;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay > y !== by > y) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let c = Math.max(0, Math.ceil((xs[i] - GRID.west) / STEP - 0.5)); c < cols; c++) {
        if (GRID.west + (c + 0.5) * STEP > xs[i + 1]) break;
        mark(c, r);
      }
    }
  }
}

// ---- foreign land inside gcoord's box ----

/** Within about 30 km of China (the grid's cells before widening): where borders must be kept closely */
const nearChina = (x, y) => {
  const c0 = colOf(x);
  const r0 = rowOf(y);
  for (let r = r0 - 3; r <= r0 + 3; r++) {
    for (let c = c0 - 3; c <= c0 + 3; c++) if (c >= 0 && c < cols && r >= 0 && r < rows && cells[r * cols + c]) return true;
  }
  return false;
};

const countries = load("ne_10m_admin_0_countries.geojson");
const foreign = [];
let foreignPoints = 0;
for (const f of countries.features) {
  if (CHINA.has(f.properties.ADM0_A3)) continue;
  const detail = detailOf(f.properties.ADM0_A3);
  for (const ring of outerRings(f.geometry)) {
    const inBox = clip(ring.slice(0, -1), GCJ_BOX);
    if (inBox.length < 3 || areaKm2(inBox) < detail.minKm2) continue;
    const tolerance = (p) => (detail.near && nearChina(p[0], p[1]) ? detail.near : detail.tolerance);
    const simple = simplifyRing([...inBox, inBox[0]], tolerance).map(([x, y]) => [round(x), round(y)]);
    if (simple.length < 3) continue;
    foreign.push(simple);
    foreignPoints += simple.length;
  }
}

// a cell more all round
const wide = new Uint8Array(cells);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (!cells[r * cols + c]) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (r + dr >= 0 && r + dr < rows && c + dc >= 0 && c + dc < cols) wide[(r + dr) * cols + c + dc] = 1;
  }
}

// each row as runs of marked cells: [row, first column, how many]
const runs = [];
for (let r = 0; r < rows; r++) {
  let c = 0;
  while (c < cols) {
    if (!wide[r * cols + c]) {
      c++;
      continue;
    }
    const start = c;
    while (c < cols && wide[r * cols + c]) c++;
    runs.push([r, start, c - start]);
  }
}

const source = "Natural Earth 10m admin-0 countries (public domain); built by scripts/build-china-areas.mjs";
writeFileSync("src/data/china-gcj.json", `${JSON.stringify({ source, box: GCJ_BOX, foreign })}\n`);
writeFileSync(
  "src/data/china-view.json",
  `${JSON.stringify({ source, west: GRID.west, south: GRID.south, step: STEP, cols, rows, runs })}\n`,
);
console.log(`foreign: ${foreign.length} rings, ${foreignPoints} points; view: ${runs.length} runs over ${cols}×${rows} cells`);
