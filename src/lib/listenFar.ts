import type { ListenRoom } from "./listen";
import type { DrawnAvatar, LngLat, MapView, RoachColor } from "./types";
import type { Friend } from "./world/types";

/**
 * 一起听's 拉远 (src/components/app/ListenFar.tsx), worked out apart from the page: who is drawn where (you and your
 * 触须之交 in the room, each at TA's main roach, from what the page has already; nobody else), the parts of the map no
 * buttons are over, the view that frames them in one of those, and whether the map was moved by hand since. Views and
 * zooms as MapView's: a world 512 px wide at zoom 0.
 */

/** Someone of the room on 拉远: TA's room number, where TA's main roach is, and how TA is drawn */
export type FarPerson = {
  h: number;
  lng: number;
  lat: number;
  name: string;
  avatar: DrawnAvatar;
  color: RoachColor;
  mine: boolean;
  friend: boolean;
  host: boolean;
};

/**
 * Those of the room drawn on 拉远: you at your main roach (none: not drawn), and each 触须之交 of yours in it at TA's
 * main roach as your list of 触须之交 has it (RoomMember.friendId), never a clone; others: how many in it are not drawn
 * (no 触须之交 of yours, or no main roach out), going round you as notes
 */
export function farPeople(room: ListenRoom, main: LngLat | null, friends: readonly Friend[]): { placed: FarPerson[]; others: number } {
  const byId = new Map(friends.map((f) => [f.id, f]));
  const placed: FarPerson[] = [];
  let others = 0;
  for (const m of room.members) {
    if (m.state !== "in") continue;
    const base = { h: m.h, name: m.card.displayName, avatar: m.card.avatar, color: m.card.color, host: m.host };
    if (m.h === room.you) {
      if (main) placed.push({ ...base, lng: main.lng, lat: main.lat, mine: true, friend: false });
      continue;
    }
    const at = m.friendId ? byId.get(m.friendId)?.roaches.find((r) => !r.clone) : undefined;
    if (at) placed.push({ ...base, lng: at.lng, lat: at.lat, mine: false, friend: true });
    else others += 1;
  }
  return { placed, others };
}

// ---- the world as the maps draw it (Web Mercator) ----

const MAX_LAT = 85.05112878;
/** Across the world, 0 at 180° W to 1 at 180° E */
export const mercX = (lng: number) => (lng + 180) / 360;
/** Down the world, 0 at its top to 1 at its bottom */
export function mercY(lat: number) {
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export const lngOf = (x: number) => (((x % 1) + 1) % 1) * 360 - 180;
export const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0, Math.min(1, y))))) * 180) / Math.PI;
/** How wide the world is drawn at a zoom, px */
export const worldPx = (zoom: number) => 512 * 2 ** zoom;

/**
 * Places' mercX, each moved by a whole world where that puts them all in the narrowest stretch of longitude that holds
 * them: Shanghai and Los Angeles across the Pacific (121° of it), not across Asia, Europe and the Atlantic (239°)
 */
export function narrowest(xs: readonly number[]): number[] {
  if (xs.length < 2) return [...xs];
  const sorted = xs.map((x, i) => ({ x: ((x % 1) + 1) % 1, i })).sort((a, b) => a.x - b.x);
  // the widest gap between neighbours, round the back of the world too: the stretch starts after it
  let gap = sorted[0].x + 1 - sorted[sorted.length - 1].x;
  let after = sorted.length - 1;
  for (let k = 0; k < sorted.length - 1; k++) {
    const g = sorted[k + 1].x - sorted[k].x;
    if (g > gap) {
      gap = g;
      after = k;
    }
  }
  const start = sorted[(after + 1) % sorted.length].x;
  const out = new Array<number>(xs.length);
  for (const { x, i } of sorted) out[i] = x < start ? x + 1 : x;
  return out;
}

/** The stretch places take on the world (mercX, mercY), across the narrowest way round */
export function spanOf(places: readonly LngLat[]) {
  const xs = narrowest(places.map((p) => mercX(p.lng)));
  const ys = places.map((p) => mercY(p.lat));
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

// ---- where on the screen ----

/** A part of the map on screen, px from its top left */
export type Rect = { left: number; top: number; right: number; bottom: number };

/** Inside the frame, kept clear for each roach's picture over its spot and its name under it (px; names are kept in the frame) */
export const FAR_EDGE = { x: 30, top: 48, bottom: 26 };
/** A frame no smaller than this (px) */
const MIN_SIDE = 96;

/**
 * The parts of box clear of every obstacle (the buttons over the map), each as wide as it can be at its heights and at
 * least MIN_SIDE each way: a phone's buttons down one side and along the top leave room below them across the whole
 * width, and beside them all the way down
 */
export function freeFrames(box: Rect, obstacles: readonly Rect[]): Rect[] {
  const inBox = obstacles
    .map((o) => ({ left: Math.max(box.left, o.left), top: Math.max(box.top, o.top), right: Math.min(box.right, o.right), bottom: Math.min(box.bottom, o.bottom) }))
    .filter((o) => o.right > o.left && o.bottom > o.top);
  const tops = [...new Set([box.top, ...inBox.map((o) => o.bottom)])].filter((t) => t >= box.top && t < box.bottom);
  const bottoms = [...new Set([box.bottom, ...inBox.map((o) => o.top)])].filter((b) => b > box.top && b <= box.bottom);
  const out: Rect[] = [];
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (bottom - top < MIN_SIDE) continue;
      // what is in the way at these heights, left to right, and the gaps between
      const across = inBox.filter((o) => o.top < bottom && o.bottom > top).sort((a, b) => a.left - b.left);
      let left = box.left;
      for (const o of [...across, { left: box.right, right: box.right }]) {
        if (o.left - left >= MIN_SIDE) out.push({ left, top, right: o.left, bottom });
        left = Math.max(left, o.right);
      }
    }
  }
  return out;
}

/** Where a place is on a map size big showing view (px from its top left), the copy of it nearest the middle */
export function onScreen(view: MapView, size: { w: number; h: number }, p: LngLat) {
  const W = worldPx(view.zoom);
  let dx = mercX(p.lng) - mercX(view.lng);
  dx -= Math.round(dx);
  return { x: size.w / 2 + dx * W, y: size.h / 2 + (mercY(p.lat) - mercY(view.lat)) * W };
}

/** frame less FAR_EDGE: where the places themselves go */
export const innerOf = (frame: Rect): Rect => ({
  left: frame.left + FAR_EDGE.x,
  right: frame.right - FAR_EDGE.x,
  top: frame.top + FAR_EDGE.top,
  bottom: frame.bottom - FAR_EDGE.bottom,
});

/**
 * The view framing places inside frame (px, on a map size big), with FAR_EDGE kept inside it, at zoom zooms[0] to the
 * smaller of zooms[1] and most: where they do not fit even at the least zoom, as many of them as fit, the middle
 * of them in the middle of the frame, and keep (yours) within it still. As the maps draw it: never further out than the
 * world as tall as the map, nor past its top or bottom (MapLibre's own limits), so a frame low on the screen may not
 * be had far out
 */
export function fitView(
  places: readonly LngLat[],
  frame: Rect,
  size: { w: number; h: number },
  zooms: [number, number],
  most: number,
  keep: LngLat | null = null,
): MapView | null {
  if (!places.length) return null;
  const s = spanOf(keep ? [...places, keep] : places);
  const inner = innerOf(frame);
  const w = Math.max(1, inner.right - inner.left);
  const h = Math.max(1, inner.bottom - inner.top);
  const want = Math.min(s.x1 > s.x0 ? Math.log2(w / (s.x1 - s.x0) / 512) : Infinity, s.y1 > s.y0 ? Math.log2(h / (s.y1 - s.y0) / 512) : Infinity);
  const least = Math.max(zooms[0], Math.log2(size.h / 512));
  const zoom = Math.max(least, Math.min(zooms[1], most, want));
  const W = worldPx(zoom);
  // the places' middle at the frame's middle: the map's own middle as far off it
  let cx = (s.x0 + s.x1) / 2 - ((inner.left + inner.right) / 2 - size.w / 2) / W;
  let cy = (s.y0 + s.y1) / 2 - ((inner.top + inner.bottom) / 2 - size.h / 2) / W;
  if (keep) {
    // yours on screen within the frame, where all of them do not fit (the nearest copy of it to the middle)
    const kx0 = mercX(keep.lng);
    const kx = kx0 + Math.round(cx - kx0);
    const x = size.w / 2 + (kx - cx) * W;
    const y = size.h / 2 + (mercY(keep.lat) - cy) * W;
    if (x < inner.left) cx -= (inner.left - x) / W;
    else if (x > inner.right) cx += (x - inner.right) / W;
    if (y < inner.top) cy -= (inner.top - y) / W;
    else if (y > inner.bottom) cy += (y - inner.bottom) / W;
  }
  const half = size.h / 2 / W;
  cy = Math.min(1 - half, Math.max(half, cy));
  return { lng: lngOf(cx), lat: latOf(cy), zoom };
}

/**
 * The view framing places in one of the parts of box clear of the obstacles (freeFrames), and that part: the one where
 * the most of them are seen once the map has gone there, of those the one that frames them closest in, and of two as
 * good the bigger; box itself where nothing big enough is clear. Null with no places
 */
export function farView(
  places: readonly LngLat[],
  box: Rect,
  obstacles: readonly Rect[],
  size: { w: number; h: number },
  zooms: [number, number],
  most: number,
  keep: LngLat | null = null,
): { view: MapView; frame: Rect } | null {
  let best: { view: MapView; frame: Rect; seen: number; area: number } | null = null;
  const frames = freeFrames(box, obstacles);
  for (const frame of frames.length ? frames : [box]) {
    const view = fitView(places, frame, size, zooms, most, keep);
    if (!view) return null;
    const inner = innerOf(frame);
    const seen = places.filter((p) => {
      const at = onScreen(view, size, p);
      return at.x >= inner.left - 1 && at.x <= inner.right + 1 && at.y >= inner.top - 1 && at.y <= inner.bottom + 1;
    }).length;
    const area = (frame.right - frame.left) * (frame.bottom - frame.top);
    const better =
      !best ||
      seen > best.seen ||
      (seen === best.seen && (view.zoom > best.view.zoom + 1e-6 || (view.zoom > best.view.zoom - 1e-6 && area > best.area)));
    if (better) best = { view, frame, seen, area };
  }
  return best && { view: best.view, frame: best.frame };
}

/** The map where it was sent (to within a few px, and a hair of zoom): not moved by hand since */
export function sameView(now: MapView, aimed: MapView, size: { w: number; h: number }) {
  if (Math.abs(now.zoom - aimed.zoom) > 0.02) return false;
  const W = worldPx(aimed.zoom);
  let dx = mercX(now.lng) - mercX(aimed.lng);
  dx -= Math.round(dx);
  const dy = mercY(now.lat) - mercY(aimed.lat);
  return Math.hypot(dx * W, dy * W) <= Math.max(4, Math.min(size.w, size.h) * 0.01);
}
