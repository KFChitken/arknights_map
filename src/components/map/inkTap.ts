import type { InkPoint } from "@/lib/siTiles";
import type { LngLat } from "@/lib/types";
import { INK_PX, INK_SIZE, interp, NEAR_FROM } from "./siLook";
import type { SiMapData } from "./types";

/** An ink roach of 缘缘庄 tapped on the map: your own, or another, by what its tile said of it */
export type InkTapped = { kind: "mine" } | { kind: "other"; ink: InkPoint };

/** However small they are drawn, a tap this close to one's middle (px) is on it: a fingertip */
const FINGER_PX = 11;

/**
 * Every ink roach a tap is on, the same on both maps, close up only (NEAR_FROM on, where they are drawn one by one),
 * each with how far from the middle of its figure the tap is: yours (drawn over the rest), then the others in the
 * order the tiles have them. The middle of each is worked out from where it stands (toScreen, at the middle of its
 * feet; the picture goes up from there). zoom: MapLibre's levels. reach: how far from its middle a tap still counts
 * (px); left out, as far as its figure, or a fingertip if it is drawn smaller
 */
export function inksNear(
  si: SiMapData | undefined,
  zoom: number,
  tap: { x: number; y: number },
  toScreen: (p: LngLat) => { x: number; y: number } | null,
  reach?: number,
): { ink: InkTapped; d: number }[] {
  if (!si || zoom < NEAR_FROM) return [];
  const px = INK_PX * interp(INK_SIZE, zoom, 2);
  /** How far from its middle the tap is, if it is on it */
  const off = (at: LngLat, size: number) => {
    const s = toScreen(at);
    if (!s) return null;
    const h = px * size;
    const d = Math.hypot(tap.x - s.x, tap.y - (s.y - h / 2));
    return d <= (reach ?? Math.max(h / 2, FINGER_PX)) ? d : null;
  };
  const out: { ink: InkTapped; d: number }[] = [];
  if (si.mine) {
    const d = off(si.mine.at, si.mine.size);
    if (d !== null) out.push({ ink: { kind: "mine" }, d });
  }
  for (const p of si.inks) {
    const d = off(p, p.size);
    if (d !== null) out.push({ ink: { kind: "other", ink: p }, d });
  }
  return out;
}

/**
 * Which ink roach a tap is on (inksNear): yours first, drawn over the others, then the nearest of the others whose
 * figure the tap is on; null for none
 */
export function inkTappedAt(
  si: SiMapData | undefined,
  zoom: number,
  tap: { x: number; y: number },
  toScreen: (p: LngLat) => { x: number; y: number } | null,
): InkTapped | null {
  let best: { ink: InkTapped; d: number } | null = null;
  for (const n of inksNear(si, zoom, tap, toScreen)) {
    if (n.ink.kind === "mine") return n.ink;
    if (!best || n.d < best.d) best = n;
  }
  return best ? best.ink : null;
}
