import { nearestOf, stackPick, type Near } from "@/lib/stackPick";
import type { LngLat } from "@/lib/types";
import type { InkTapped } from "./inkTap";
import type { MapViewProps, StackHit } from "./types";

type Opens = Pick<MapViewProps, "onRoachClick" | "onMineClick" | "onInkClick" | "onStackClick">;

/** An ink roach under a tap, as a stack has it */
export const inkHit = (ink: InkTapped): StackHit => (ink.kind === "mine" ? { kind: "myInk" } : { kind: "ink", ink: ink.ink });

/** Opens one thing that lies under a tap, as a tap on it alone opens it */
export function openHit(p: Opens, h: StackHit) {
  if (h.kind === "mine") p.onMineClick(h.id);
  else if (h.kind === "roach") p.onRoachClick(h.id);
  else p.onInkClick?.(h.kind === "myInk" ? { kind: "mine" } : { kind: "other", ink: h.ink });
}

/**
 * A tap close up, given everything under it (src/lib/stackPick.ts): those lying on top of each other to pick from,
 * or the nearest opened as a tap on it alone opens it. False when nothing is under it, for the map to go on as
 * before (a tap on the map itself)
 */
export function tapNear(p: Opens, near: readonly Near<StackHit>[], at: LngLat): boolean {
  const stack = p.onStackClick ? stackPick(near) : null;
  if (stack) {
    p.onStackClick?.({ hits: stack, at });
    return true;
  }
  const one = nearestOf(near);
  if (!one) return false;
  openHit(p, one);
  return true;
}
