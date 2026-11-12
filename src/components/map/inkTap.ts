import type { InkPoint } from "@/lib/siTiles";
import type { LngLat } from "@/lib/types";
import { INK_PX, INK_SIZE, interp, NEAR_FROM } from "./siLook";
import type { SiMapData } from "./types";

/** An ink roach of 缘缘庄 tapped on the map: your own, or another, by what its tile said of it */
export type InkTapped = { kind: "mine" } | { kind: "other"; ink: InkPoint };

/** However small they are drawn, a tap this close to one's middle (px) is on it: a fingertip */
const FINGER_PX = 11;

/**
 * Which ink roach a tap is on, the same on both maps, close up only (NEAR_FROM on, where they are drawn one by one):
 * yours first, drawn over the rest, then the nearest of the others whose figure the tap is on, the middle of each
 * worked out from where it stands (toScreen, at the middle of its feet; the picture goes up from there); null for
 * none. zoom: MapLibre's levels.
 */
export function inkTappedAt(
  si: SiMapData | undefined,
  zoom: number,
  tap: { x: number; y: number },
  toScreen: (p: LngLat) => { x: number; y: number } | null,
): InkTapped | null {
  if (!si || zoom < NEAR_FROM) return null;
  const px = INK_PX * interp(INK_SIZE, zoom, 2);
  /** How far from its middle the tap is, if it is on it */
  const off = (at: LngLat, size: number) => {
    const s = toScreen(at);
    if (!s) return null;
    const h = px * size;
    const d = Math.hypot(tap.x - s.x, tap.y - (s.y - h / 2));
    return d <= Math.max(h / 2, FINGER_PX) ? d : null;
  };
  if (si.mine && off(si.mine.at, si.mine.size) !== null) return { kind: "mine" };
  let best: InkPoint | null = null;
  let bestOff = Infinity;
  for (const p of si.inks) {
    const d = off(p, p.size);
    if (d !== null && d < bestOff) {
      best = p;
      bestOff = d;
    }
  }
  return best ? { kind: "other", ink: best } : null;
}
