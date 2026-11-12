import type { LngLat, MapView } from "@/lib/types";

/**
 * The sums behind 圈禁放区 on the owner's map (ZoneDraw.tsx, ZoneView.tsx): a ring on the screen as big as a radius on the
 * ground, the spot a crosshair above the middle of the map points at, the zoom that shows a circle whole, and the circle
 * as a path for the map to draw. Both maps report their zoom as MapLibre does: Web Mercator, 512-pixel tiles.
 */

const EARTH_M = 40075016.686;
const RAD = Math.PI / 180;
/** Metres in a degree of latitude, near enough for drawing a circle of a few kilometres */
const DEGREE_M = 111320;

/** The ground a screen pixel covers there, in metres */
export const metresPerPx = (lat: number, zoom: number) => (EARTH_M * Math.cos(lat * RAD)) / (512 * 2 ** zoom);

/** The zoom at which `metres` on the ground take `px` pixels on the screen there */
export const zoomFor = (metres: number, lat: number, px: number) => Math.log2((EARTH_M * Math.cos(lat * RAD) * px) / (512 * metres));

/** The spot `up` pixels above the middle of a view (below it, when negative): the map's own Mercator, not a guess */
export function spotAbove(v: MapView, up: number): LngLat {
  const world = 512 * 2 ** v.zoom;
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + (v.lat * RAD) / 2)) / (2 * Math.PI)) * world - up;
  return { lng: v.lng, lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) / RAD };
}

/** A circle on the ground, as a closed path of points for the map to draw */
export function circlePath(at: LngLat, metres: number, points = 72): LngLat[] {
  const dLat = metres / DEGREE_M;
  const dLng = dLat / Math.cos(at.lat * RAD);
  return Array.from({ length: points + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / points;
    return { lng: at.lng + dLng * Math.sin(a), lat: at.lat + dLat * Math.cos(a) };
  });
}

/** What the owner's map has open of its 禁放区 tools: drawing one (round a spot, or where the map is), or seeing one */
export type ZoneTool = { kind: "draw"; at: LngLat | null; key: number } | { kind: "view"; id: string; key: number };

/**
 * Where the map last came to rest and whether it is moving now, for the drawing to follow without the whole map page
 * drawing itself again on every move: MapApp tells it, ZoneDraw reads it (useSyncExternalStore).
 */
export class MapPulse {
  private now: { view: MapView; moving: boolean };
  private readonly ears = new Set<() => void>();

  constructor(view: MapView) {
    this.now = { view, moving: false };
  }

  readonly get = () => this.now;

  readonly on = (ear: () => void) => {
    this.ears.add(ear);
    return () => {
      this.ears.delete(ear);
    };
  };

  rest(view: MapView) {
    this.now = { view, moving: false };
    for (const ear of this.ears) ear();
  }

  moving(moving: boolean) {
    if (this.now.moving === moving) return;
    this.now = { ...this.now, moving };
    for (const ear of this.ears) ear();
  }
}
