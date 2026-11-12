import type { LngLat } from "../types";

/**
 * 只发看得到的 (the roach feed's form 4, src/lib/server/roachFeed.ts): a signed-in page downloads only the
 * roaches around what it shows, never the whole list. Close in, every roach in a box a little bigger
 * than the view; zoomed out (and wherever such a box would be too big), the overview: one roach for each
 * small square of the world, with how many there are in it, which the maps draw and count as that many.
 * Both come at the snapshot's version, with what changed since then for a box held already.
 */

/** West, south, east and north, in degrees */
export type Box = [number, number, number, number];

/** What a page holds: the roaches in a box, or the overview */
export type Area = Box | "overview";

/** View zooms (MapLibre's; 高德's are one more) below this get the overview: where the maps thin out piled roaches anyway */
export const OVERVIEW_BELOW_ZOOM = 7;
/** A box reaches this share of the view's own width and height past it on every side */
export const BOX_MARGIN = 0.5;
/** Its edges fall on multiples of this many degrees, so nearby views ask for the same box */
export const BOX_STEP = 0.25;
/** The widest and tallest box, in degrees; a view needing more gets the overview */
export const BOX_MAX: readonly [number, number] = [48, 32];
/**
 * The overview's squares: Web Mercator, this many across the world (about 0.022° of longitude each). Zoomed
 * out to a province, bigger squares left the crowded cities visibly lighter than with every roach drawn (one
 * icon every 10 px at 0.088°, every 5 px at 0.044°, against hundreds); at 0.022° they look the same. At
 * 106,000 roaches: 156 KB, against 62 KB at 0.088° and 909 KB for the whole list.
 */
export const OVERVIEW_CELLS = 16384;

const snapDown = (x: number) => Math.round(Math.floor(x / BOX_STEP + 1e-9) * BOX_STEP * 100) / 100;
const snapUp = (x: number) => Math.round(Math.ceil(x / BOX_STEP - 1e-9) * BOX_STEP * 100) / 100;

/**
 * The box a page holds for a view (its south-west and north-east corners): the view and BOX_MARGIN
 * around it, snapped outwards to BOX_STEP. Null where the overview does instead: the view crosses
 * ±180°, or the box would be bigger than BOX_MAX.
 */
export function boxFor([sw, ne]: [LngLat, LngLat]): Box | null {
  const w = ne.lng - sw.lng;
  const h = ne.lat - sw.lat;
  if (!(w > 0) || !(h > 0)) return null;
  const box: Box = [
    Math.max(-180, snapDown(sw.lng - w * BOX_MARGIN)),
    Math.max(-90, snapDown(sw.lat - h * BOX_MARGIN)),
    Math.min(180, snapUp(ne.lng + w * BOX_MARGIN)),
    Math.min(90, snapUp(ne.lat + h * BOX_MARGIN)),
  ];
  return box[2] - box[0] > BOX_MAX[0] || box[3] - box[1] > BOX_MAX[1] ? null : box;
}

/** The area a view wants: the overview zoomed out, else its box (or the overview where there is none) */
export const areaFor = (zoom: number, bounds: [LngLat, LngLat]): Area =>
  zoom < OVERVIEW_BELOW_ZOOM ? "overview" : (boxFor(bounds) ?? "overview");

/** Whether a box holds all of a view */
export const boxHolds = (b: Box, [sw, ne]: [LngLat, LngLat]) => sw.lng >= b[0] && sw.lat >= b[1] && ne.lng <= b[2] && ne.lat <= b[3];

/** Whether a place is in a box, edges included */
export const inBox = (p: LngLat, b: Box) => p.lng >= b[0] && p.lng <= b[2] && p.lat >= b[1] && p.lat <= b[3];

export const boxText = (b: Box) => b.join(",");

/** A box as a page sends it: four multiples of BOX_STEP, west of east, south of north, no bigger than BOX_MAX */
export function parseBox(text: string | null): Box | null {
  const parts = (text ?? "").split(",");
  if (parts.length !== 4 || parts.some((p) => !/^-?\d{1,3}(\.\d{1,2})?$/.test(p))) return null;
  const b = parts.map(Number) as Box;
  const onStep = b.every((x) => Math.abs(x / BOX_STEP - Math.round(x / BOX_STEP)) < 1e-9);
  const inWorld = b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90;
  const sized = b[2] > b[0] && b[3] > b[1] && b[2] - b[0] <= BOX_MAX[0] && b[3] - b[1] <= BOX_MAX[1];
  return onStep && inWorld && sized ? b : null;
}

/** The overview square a place is in (Web Mercator, OVERVIEW_CELLS across), as one number */
export function overviewCell(p: LngLat): number {
  const lat = Math.max(-85.05, Math.min(85.05, p.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  const x = Math.min(OVERVIEW_CELLS - 1, Math.max(0, Math.floor(((p.lng + 180) / 360) * OVERVIEW_CELLS)));
  const y = Math.min(OVERVIEW_CELLS - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * OVERVIEW_CELLS)));
  return y * OVERVIEW_CELLS + x;
}

/** A view as a page sends it to be counted: west, south, east, north to 7 places, a centimetre (west may be east of east, across 180°) */
export function parseView(text: string | null): Box | null {
  const parts = (text ?? "").split(",");
  if (parts.length !== 4 || parts.some((p) => !/^-?\d{1,3}(\.\d{1,7})?$/.test(p))) return null;
  const b = parts.map(Number) as Box;
  return b[0] >= -180 && b[0] <= 180 && b[2] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90 && b[3] > b[1] && b[0] !== b[2] ? b : null;
}

/** How many roaches a roach of the feed stands for: in the overview, all those in its square */
export const weightOf = (r: { n?: number }) => r.n ?? 1;
