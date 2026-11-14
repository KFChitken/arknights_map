/**
 * What the games played on a field share (src/components/app/study/arena.ts draws them): the things to keep clear of,
 * and whether two round things touch. Places and sizes are in the field's own units (接住 3、2、5: field widths; 描红 325:
 * the copybook square's side), so a field is the same game on any screen.
 */

/** What can come at the player's roach: a bomb, a paper plane, a little slug with a crystal on its back */
export const OBSTACLES = ["bomb", "plane", "slug"] as const;
export type Obstacle = (typeof OBSTACLES)[number];

export const isObstacle = (v: unknown): v is Obstacle => typeof v === "string" && (OBSTACLES as readonly string[]).includes(v);

/** Whether two circles, at x, y with radius r each, touch or overlap */
export function touches(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= (ar + br) * (ar + br);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
