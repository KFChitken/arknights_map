import grid from "@/data/china-view.json";
import { viewBoxes, widen, type Box } from "./shapes";
import type { LngLat } from "./types";

/**
 * Where a visitor from mainland China must see Amap, the only map approved there:
 * China as China's standard map draws it (Taiwan, 藏南, Aksai Chin, the Diaoyu
 * Islands, and the South China Sea within the nine-dash line), as cells of a 0.1°
 * grid widened by a cell all round (src/data/china-view.json, built by
 * scripts/build-china-areas.mjs), so it only ever errs towards Amap. Our own map
 * takes over only where none of this is in view (src/lib/overseas.ts).
 */

const { west, south, step, cols, rows } = grid;
const runs = grid.runs as [number, number, number][];

function boxMeetsChina([w, s, e, n]: Box) {
  const c0 = Math.floor((w - west) / step);
  const c1 = Math.floor((e - west) / step);
  const r0 = Math.floor((s - south) / step);
  const r1 = Math.floor((n - south) / step);
  if (c1 < 0 || r1 < 0 || c0 >= cols || r0 >= rows) return false;
  return runs.some(([r, c, len]) => r >= r0 && r <= r1 && c <= c1 && c + len - 1 >= c0);
}

/** The grid's cells as one byte each (1: China), made when first asked */
let cells: Uint8Array | null = null;
function cellsOf() {
  if (cells) return cells;
  cells = new Uint8Array(cols * rows);
  for (const [r, c, len] of runs) cells.fill(1, r * cols + c, r * cols + c + len);
  return cells;
}

/** Whether a point is in China by the same cells (so it errs towards China within a cell of the border) */
export function inChina({ lng, lat }: LngLat) {
  const c = Math.floor((lng - west) / step);
  const r = Math.floor((lat - south) / step);
  return c >= 0 && r >= 0 && c < cols && r < rows && cellsOf()[r * cols + c] === 1;
}

/** Whether any of China shows in a map's view (south-west and north-east corners, WGS-84). */
export const seesChina = (bounds: [LngLat, LngLat]) => viewBoxes(bounds).some(boxMeetsChina);

/** Leaving Amap only once even a fifth more of the view all round would not show China, so the edge never flickers */
export const clearOfChina = (bounds: [LngLat, LngLat]) => !seesChina(widen(bounds, 0.2));

/**
 * The view a map will show at a centre and zoom (MapLibre levels, 512 px tiles),
 * on a screen this many pixels wide and high, before any map is there to ask.
 */
export function viewAround(center: LngLat, zoom: number, width: number, height: number): [LngLat, LngLat] {
  const halfLng = (180 * width) / (512 * 2 ** zoom);
  const halfLat = Math.min(85, halfLng * (height / width) * Math.cos((center.lat * Math.PI) / 180));
  return [
    { lng: center.lng - halfLng, lat: Math.max(-85, center.lat - halfLat) },
    { lng: center.lng + halfLng, lat: Math.min(85, center.lat + halfLat) },
  ];
}

/**
 * The same cells as polygons, for covering China on our own map while it is
 * dragged across (rows of cells with the same span are joined into one rectangle).
 */
export function chinaCover(): GeoJSON.FeatureCollection {
  const spans = new Map<string, [number, number, number]>(); // "c,len" -> [first row, last row, c]
  const rectangles: number[][][][] = [];
  const close = (first: number, last: number, c: number, len: number) => {
    const x0 = west + c * step;
    const x1 = west + (c + len) * step;
    const y0 = south + first * step;
    const y1 = south + (last + 1) * step;
    rectangles.push([
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ]);
  };
  for (const [r, c, len] of runs) {
    const key = `${c},${len}`;
    const open = spans.get(key);
    if (open && open[1] === r - 1) open[1] = r;
    else {
      if (open) close(open[0], open[1], c, len);
      spans.set(key, [r, r, c]);
    }
  }
  for (const [key, [first, last, c]] of spans) close(first, last, c, Number(key.split(",")[1]));
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: rectangles } }],
  };
}
