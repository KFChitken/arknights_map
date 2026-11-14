import { screenDelta } from "./touchArt";
import type { LngLat, MapView } from "./types";

/**
 * Roaches drawn on top of each other. A tap close up that lands on two or more of them, the nearest two about as
 * near the finger as each other, opens a list of them to pick from (StackPicker.tsx) instead of whichever is drawn
 * on top; a tap clearly nearest one opens that one, as before. The maps find what lies under the finger and how far
 * from it each one's middle is; this says what that tap opens.
 */

/** How much nearer the finger (px) the nearest must be than the next, to be opened without asking */
export const STACK_GAP_PX = 10;
/** Rows the list shows; the rest it counts */
export const STACK_ROWS = 8;
/**
 * The zoom (MapLibre's levels; 高德's are one more) from which a tap is looked at like this. Further out an icon
 * stands for a whole crowd, and a tap opens the one drawn on top as before
 */
export const STACK_FROM_ZOOM = 12;

/** One thing under the finger, and how far from the finger its middle is (px) */
export type Near<T> = { ref: T; d: number };

/** Nearest first; those as near as each other in the order given */
export function byDistance<T>(near: readonly Near<T>[]): Near<T>[] {
  return near.map((n, i) => ({ n, i })).sort((a, b) => a.n.d - b.n.d || a.i - b.i).map(({ n }) => n);
}

/**
 * What a tap opens, given everything under the finger: null to open the nearest (nearestOf), which it is when it
 * is the only one, or nearer than the next by STACK_GAP_PX or more; otherwise all of them, nearest first, to pick from
 */
export function stackPick<T>(near: readonly Near<T>[]): T[] | null {
  if (near.length < 2) return null;
  const sorted = byDistance(near);
  return sorted[1].d - sorted[0].d < STACK_GAP_PX ? sorted.map((n) => n.ref) : null;
}

/** The one nearest the finger, the first given of those as near; null for none */
export function nearestOf<T>(near: readonly Near<T>[]): T | null {
  let best: Near<T> | null = null;
  for (const n of near) if (!best || n.d < best.d) best = n;
  return best ? best.ref : null;
}

/** The rows a list of n shows, and how many more it only counts */
export const stackRows = (n: number) => ({ rows: Math.min(n, STACK_ROWS), more: Math.max(0, n - STACK_ROWS) });

/** How far above the list's top (px) the middle of what lies under the tap goes, for their pictures to show whole */
export const STACK_ABOVE_PX = 56;
/** How far down the map (px) it goes at the least, for the buttons and counts along the top not to hide it */
export const STACK_TOP_PX = 90;
/** How far beside the list (px) it may be and still be hidden by it, its pictures being that wide */
const STACK_SIDE_PX = 24;
/** A slide shorter than this (px) is not made */
const STACK_SLIDE_MIN_PX = 8;

/** Where the list lies over the map (px from the map's top left) */
export type ListBox = { top: number; bottom: number; left: number; right: number };

/**
 * As the list opens, where the map's middle goes so that the list does not hide what lies under the tap (at), as
 * 祀 stands above her card: the map slides straight up till at is STACK_ABOVE_PX above the list's top, but no
 * higher than STACK_TOP_PX down the map. Null when the list leaves it in sight as it is: that far above it, below it
 * or beside it. view: the map's middle and zoom (MapLibre levels, north up); size: the map's, px
 */
export function stackSlide(view: MapView, at: LngLat, size: { w: number; h: number }, list: ListBox): MapView | null {
  const d = screenDelta(view, at, view.zoom);
  const x = size.w / 2 + d.x;
  const y = size.h / 2 + d.y;
  if (x < list.left - STACK_SIDE_PX || x > list.right + STACK_SIDE_PX || y > list.bottom + STACK_SIDE_PX) return null;
  const up = y - Math.max(STACK_TOP_PX, list.top - STACK_ABOVE_PX);
  if (up < STACK_SLIDE_MIN_PX) return null;
  // the middle, up px further down: Web Mercator's y, and back (as screenDelta has it)
  const world = 512 * 2 ** view.zoom;
  const s = Math.sin((view.lat * Math.PI) / 180);
  const t = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world + up;
  const lat = (Math.asin(Math.tanh((0.5 - t / world) * 2 * Math.PI)) * 180) / Math.PI;
  return { lng: view.lng, lat, zoom: view.zoom };
}

/** Whether the map came to rest where a slide (stackSlide) took it: within 3 px, at the same zoom */
export function slidTo(view: MapView, to: MapView): boolean {
  if (Math.abs(view.zoom - to.zoom) > 0.02) return false;
  const d = screenDelta(view, to, view.zoom);
  return Math.abs(d.x) <= 3 && Math.abs(d.y) <= 3;
}
