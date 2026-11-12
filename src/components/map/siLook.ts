import { iconPx } from "@/lib/swarm";

/**
 * How 祀掌柜's corner of the map looks at each zoom, the same on both maps (siMap.ts draws it on MapLibre,
 * siAmap.ts and inkGl.ts on 高德): when 缘缘庄 is a blot, a line and dots, or ink roaches one by one; how big
 * each thing is drawn and how strongly; where her scroll hangs beside her, rolled or open; and where her
 * ink butterflies are as they fly round it. Zooms are MapLibre's levels (高德's are one more).
 */

/** Far: up to here the blot; the middle distance from here; close up from NEAR_FROM */
export const FAR_BELOW = 13;
export const NEAR_FROM = 16.5;
/** Her scroll beside her from this zoom, rolled; open from SCROLL_OPEN_FROM, with the butterflies round it */
export const SCROLL_FROM = 6;
export const SCROLL_OPEN_FROM = 14;
/** The inn's lines from here, its trees and sign from MARKS_FROM */
export const INN_FROM = 14;
export const MARKS_FROM = 15;
/** 看看我在哪: close enough to tell one ink roach from the next */
export const FIND_ZOOM = 18.5;

export const INK = "#24221f";

export type Stops = [number, number][];

/** MapLibre's "interpolate" on the zoom: linear (base 1) or exponential, held at the first and last stop */
export function interp(stops: Stops, z: number, base = 1) {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [z1, v1] = stops[i];
    if (z > z1) continue;
    const [z0, v0] = stops[i - 1];
    const d = z1 - z0;
    const t = base === 1 ? (z - z0) / d : (base ** (z - z0) - 1) / (base ** d - 1);
    return v0 + (v1 - v0) * t;
  }
  return stops[stops.length - 1][1];
}

/**
 * The same as a MapLibre expression; times: an expression of the feature each stop's value is multiplied by
 * (MapLibre takes the zoom only in an interpolate at the top, so the feature's part goes into each stop)
 */
export const zoomExpr = (stops: Stops, base = 1, times?: unknown) => [
  "interpolate",
  base === 1 ? ["linear"] : ["exponential", base],
  ["zoom"],
  ...stops.flatMap(([z, v]) => [z, times === undefined ? v : ["*", v, times]]),
];

/** An ink roach's picture: this many CSS px across at size 1, times INK_SIZE, times its brush */
export const INK_PX = 32;
/** A few metres across: tiny at 17, a crowd of figures by 19 (exponential, base 2) */
export const INK_SIZE: Stops = [
  [16.5, 0.28],
  [18, 0.55],
  [19, 0.8],
  [20, 1.1],
];
/** The inn's trees (INK_PX across) and its sign (1.5 × INK_PX across, half as high), base 2 */
export const MARK_SIZE: Stops = [
  [15, 0.4],
  [19, 1.4],
];
/** The fields' dots: radius in px, and how strongly they show */
export const DOT_RADIUS: Stops = [
  [13, 1],
  [16, 2.4],
];
export const DOT_OPACITY: Stops = [
  [12.5, 0],
  [13.5, 0.35],
  [16, 0.3],
  [17, 0],
];
/** The blot's radius in px for one ink roach; more of them make it bigger (blotGrowth) */
export const BLOT_RADIUS: Stops = [
  [3, 3],
  [8, 6],
  [12, 18],
];
export const BLOT_OPACITY = 0.32;
export const blotGrowth = (drawn: number) => 1 + Math.log(1 + drawn) / 4;
/** The queue's line: three abreast, about 9 m (base 2), fading in from afar and out as the roaches show */
export const QUEUE_WIDTH: Stops = [
  [12.5, 1.2],
  [16, 9],
  [17, 18],
];
export const QUEUE_OPACITY: Stops = [
  [12.5, 0],
  [13.2, 0.7],
  [NEAR_FROM, 0.6],
  [NEAR_FROM + 0.6, 0],
];
/** The inn's walls and the yard's railings (base 2), and how strongly they show */
export const WALL_WIDTH: Stops = [
  [14, 1.2],
  [19, 5],
];
export const RAILING_WIDTH: Stops = [
  [14, 0.6],
  [19, 2.5],
];
export const INN_OPACITY: Stops = [
  [14, 0],
  [15, 0.75],
];
/** Ink roaches are drawn this strongly, times their brush's ink */
export const INK_OPACITY = 0.92;

// ---- her scroll, and the butterflies round it ----

/** The scroll's picture in CSS px: open (60 × 100 drawn at 0.6), and rolled (60 × 20) */
export const SCROLL_OPEN = { w: 36, h: 60 };
export const SCROLL_ROLLED = { w: 36, h: 12 };

/** How big she is drawn at a zoom (guideMarker.ts guideSize) */
const herPx = (zoom: number) => Math.max(18, Math.round(iconPx(zoom) * 1.3));

/** Her scroll at a zoom: rolled, open or not drawn, and where its middle is from her spot (CSS px, y down) */
export function scrollAt(zoom: number) {
  if (zoom < SCROLL_FROM) return null;
  const open = zoom >= SCROLL_OPEN_FROM;
  const { w, h } = open ? SCROLL_OPEN : SCROLL_ROLLED;
  // hung just to her right, a little higher than her middle when open so her name stays clear below
  return { open, w, h, dx: herPx(zoom) / 2 + 4 + w / 2, dy: open ? -8 : 0 };
}

/** Where the scroll's middle sits beside her for MapLibre's rolled layer, by zoom (her size grows up to 12) */
export const ROLLED_SHIFT: Stops = [6, 8, 10, 12].map((z) => [z, scrollAt(z)!.dx]);

export const BUTTERFLIES = 3;
/** A butterfly's picture in CSS px */
export const BUTTERFLY_PX = 12;

/**
 * Butterfly i round the open scroll at time t (ms; null: at rest, motion turned down): where its middle is from
 * her spot (CSS px, y down), and which of its two pictures (wings open or half shut) shows
 */
export function butterflyAt(i: number, t: number | null, zoom: number) {
  const s = scrollAt(Math.max(zoom, SCROLL_OPEN_FROM))!;
  const phase = 0.6 + (i * 2 * Math.PI) / BUTTERFLIES;
  const sec = t === null ? 0 : t / 1000;
  // slowly round, each at its own pace, the middle one the other way
  const a = phase + sec * (0.32 + 0.07 * i) * (i === 1 ? -1 : 1);
  const rx = s.w / 2 + 8 + 4 * i;
  const ry = s.h / 2 + 2;
  const bob = t === null ? 0 : Math.sin(sec * 1.9 + i * 2) * 3;
  return {
    dx: s.dx + Math.cos(a) * rx,
    dy: s.dy + Math.sin(a) * ry * 0.8 + bob,
    frame: t === null ? 0 : Math.floor(sec * 7 + i * 0.37) % 2,
  };
}

// ---- your own, drawn apart ----

/** Your own ink roach's ringed picture has this much room round the figure on each side (inkArt.ts inkCanvas) */
export const RING_PAD = 0.08;
/** How long it takes her brush to draw it, the first time */
export const BRUSH_MS = 1100;
