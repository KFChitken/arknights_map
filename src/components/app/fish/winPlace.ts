import type { FishSpot } from "@/lib/fish/items";

/**
 * Where 钓鳞's small window (FishWin.tsx) stands in the page, worked out apart from the page: the design's sizes, open
 * and small, a computer's and a phone's; where it opens first; kept inside the page as it is dragged (a phone's between
 * the search bar and the bars at its foot, 卫戍's bar too while in a room); a phone's against the nearer edge once let
 * go; and which scene it shows.
 */

/** From this width up, a computer's window (a strip when small); under it, a phone's (a ball) */
export const WIDE = 720;
/**
 * A computer's: open 360 × 308 (the title bar 36, the scene 190, the buttons), first 24 from the bottom right; small, a
 * 260 × 42 strip in the middle of where its foot was
 */
export const PC = { w: 360, h: 308, stripW: 260, stripH: 42, gap: 24, stripDx: 50, stripDy: 266 };
/**
 * A phone's: open 264 × 248, small a ball of 58, each 8 from its edge; under the search bar (100 from the top), over the
 * bars at the foot (70, and 卫戍's 58 more in a room); first at the right, 460 down; the ball 90 under the open top
 */
export const PHONE = { w: 264, h: 248, ball: 58, edge: 8, top: 100, foot: 70, bar: 58, ballDy: 90, firstY: 460 };
/** A press that moves less than this is a tap */
export const TAP_PX = 6;

export type Size = { w: number; h: number };
/**
 * Where it was put, each device its own (localStorage): a computer's by its open top left, a phone's by its edge and
 * open top; dragged once (the first-open hint then goes)
 */
export type Place = { pc: { x: number; y: number } | null; phone: { side: "left" | "right"; y: number } | null; dragged: boolean };
export const NO_PLACE: Place = { pc: null, phone: null, dragged: false };
/** How it is shown: a computer's or a phone's, small or open, in a room (卫戍's bar at the foot) */
export type WinLook = { wide: boolean; small: boolean; inRoom: boolean };
export type Box = { left: number; top: number; w: number; h: number; atLeft: boolean };

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v));

/** The lowest a phone's window may come: over the bars at the foot, and 卫戍's in a room */
const footOf = (vp: Size, inRoom: boolean) => vp.h - (inRoom ? PHONE.foot + PHONE.bar : PHONE.foot) - PHONE.edge;

export const sizeOf = ({ wide, small }: Pick<WinLook, "wide" | "small">): Size =>
  wide ? (small ? { w: PC.stripW, h: PC.stripH } : { w: PC.w, h: PC.h }) : small ? { w: PHONE.ball, h: PHONE.ball } : { w: PHONE.w, h: PHONE.h };

/** Where it stands now, inside the page; dragX, a phone's on its way across */
export function boxOf(vp: Size, place: Place, look: WinLook, dragX: number | null = null): Box {
  const { w, h } = sizeOf(look);
  if (look.wide) {
    const at = place.pc ?? { x: vp.w - PC.w - PC.gap, y: vp.h - PC.h - PC.gap };
    const left = clamp(look.small ? at.x + PC.stripDx : at.x, 0, vp.w - w);
    const top = clamp(look.small ? at.y + PC.stripDy : at.y, 0, vp.h - h);
    return { left, top, w, h, atLeft: false };
  }
  const at = place.phone ?? { side: "right" as const, y: PHONE.firstY };
  const left = dragX ?? (at.side === "left" ? PHONE.edge : vp.w - w - PHONE.edge);
  const top = clamp(look.small ? at.y + PHONE.ballDy : at.y, PHONE.top, footOf(vp, look.inRoom) - h);
  return { left, top, w, h, atLeft: left + w / 2 < vp.w / 2 };
}

/** Dragged by (dx, dy) from where it stood (from): where it is put, inside the page, and a phone's across (dragX) */
export function dragOf(
  vp: Size,
  place: Place,
  look: WinLook,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): { place: Place; dragX: number | null } {
  const { w, h } = sizeOf(look);
  const x = clamp(from.x + dx, 0, vp.w - w);
  if (look.wide) {
    const y = clamp(from.y + dy, 0, vp.h - h);
    return { place: { ...place, pc: look.small ? { x: x - PC.stripDx, y: y - PC.stripDy } : { x, y } }, dragX: null };
  }
  const y = clamp(from.y + dy, PHONE.top, footOf(vp, look.inRoom) - h);
  return { place: { ...place, phone: { side: place.phone?.side ?? "right", y: look.small ? y - PHONE.ballDy : y } }, dragX: x };
}

/** Let go where it stands (box): kept, the hint gone; a phone's against the nearer edge */
export function dropOf(vp: Size, place: Place, look: WinLook, box: Box): Place {
  if (look.wide) return { ...place, dragged: true };
  const y = place.phone?.y ?? (look.small ? box.top - PHONE.ballDy : box.top);
  return { ...place, phone: { side: box.left + box.w / 2 < vp.w / 2 ? "left" : "right", y }, dragged: true };
}

/**
 * The scene: the line's while one is in the water, else 卫戍池塘 in a room of 一起卫戍 and the bank out of one;
 * pending, the one it goes to once the line is done (a room joined or left meanwhile)
 */
export function sceneOf(line: FishSpot | null, inRoom: boolean): { scene: FishSpot; pending: FishSpot | null } {
  const target: FishSpot = inRoom ? "pond" : "pier";
  const scene = line ?? target;
  return { scene, pending: scene === target ? null : target };
}

/** Out of the room with no 钓鳞 of their own (FISH) and no line left in the water: the window goes */
export const goesOnLeaving = (s: { kept: boolean; fishOk: boolean; inRoom: boolean; line: FishSpot | null }) =>
  s.kept && !s.fishOk && !s.inRoom && !s.line;
