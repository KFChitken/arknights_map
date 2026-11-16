import { BOB, FREE, JUMP, SPIN, SWAY, WAVE } from "./choreo";

/**
 * The moves as numbers, for the few roaches drawn as page elements (your own on the 高德 map, the guides): the same
 * sums as the shaders' bounce() and pose() (glsl.ts), which draw all the others.
 */

const ease = (k: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, k)))) / 2;
const seg = (p: number, a: number, b: number, va: number, vb: number) => va + (vb - va) * ease((p - a) / (b - a));

/** 舟友的酒's hop over a beat (p 0..1): squashed landing, stretched rising. [height, width, how far up (icons, up below 0)] */
export function bounce(p: number): [number, number, number] {
  if (p < 0.1) return [seg(p, 0, 0.1, 0.8, 0.94), seg(p, 0, 0.1, 1.18, 1.06), seg(p, 0, 0.1, 0, -2) / 64];
  if (p < 0.3) return [seg(p, 0.1, 0.3, 0.94, 1.16), seg(p, 0.1, 0.3, 1.06, 0.9), seg(p, 0.1, 0.3, -2, -9) / 64];
  if (p < 0.52) return [seg(p, 0.3, 0.52, 1.16, 1.03), seg(p, 0.3, 0.52, 0.9, 0.98), seg(p, 0.3, 0.52, -9, -6) / 64];
  if (p < 0.75) return [seg(p, 0.52, 0.75, 1.03, 0.97), seg(p, 0.52, 0.75, 0.98, 1.02), seg(p, 0.52, 0.75, -6, -1.5) / 64];
  if (p < 0.92) return [seg(p, 0.75, 0.92, 0.97, 1.05), seg(p, 0.75, 0.92, 1.02, 0.96), seg(p, 0.75, 0.92, -1.5, -0.3) / 64];
  return [seg(p, 0.92, 1, 1.05, 0.8), seg(p, 0.92, 1, 0.96, 1.18), seg(p, 0.92, 1, -0.3, 0) / 64];
}

/** [across (icons), up (icons, up below 0), tilt (degrees), width, height, turn (degrees)] */
export type Pose = [number, number, number, number, number, number];

/** Move m at beat b; free: the free sway's own clock (FREE_S) */
export function pose(m: number, b: number, free: number): Pose {
  if (m === FREE) {
    const w = Math.sin(Math.PI * free);
    return [0.07 * w, 0, 13 * w, 1, 1, 0];
  }
  const p = b - Math.floor(b);
  const k = ((Math.floor(b) % 4) + 4) % 4;
  const [h, w, hop] = bounce(p);
  if (m === SWAY) {
    const s = Math.sin(Math.PI * b);
    return [0.07 * s, hop * 0.35, 13 * s, 1 + (w - 1) * 0.35, 1 + (h - 1) * 0.35, 0];
  }
  if (m === BOB) return [0, hop * 1.4, 4 * Math.sin(Math.PI * b), w, h, 0];
  if (m === JUMP) return [0, hop * (k === 0 || k === 2 ? 3.4 : 1), 0, w, h, 0];
  if (m === WAVE) return [0, hop * 2.2, 6 * Math.sin(Math.PI * b), w, h, 0];
  if (m === SPIN) {
    const c = ((b % 8) + 8) % 8;
    return [0, hop * 1.2, 0, w, h, c < 2 ? 360 * ease(c / 2) : 0];
  }
  // BANG: twice a beat
  const q = b * 2 - Math.floor(b * 2);
  const [h2, w2, hop2] = bounce(q);
  return [0, hop2 * 0.7, 9 * Math.sin(Math.PI * b), w2, 1 + (h2 - 1) * 0.6, 0];
}

/**
 * Two moves mixed, at a size (amp) and as far danced as on (0: standing as ever, 1: dancing): what to draw, as
 * [across, up (icons), tilt (deg), width, height]; turned past a quarter the picture shows mirrored (width below 0)
 */
export function posed(a: Pose, b: Pose, mix: number, amp: number, on: number): [number, number, number, number, number] {
  const m = (i: number) => a[i] + (b[i] - a[i]) * mix;
  const ct = Math.cos((m(5) * on * Math.PI) / 180);
  const width = (1 + (m(3) - 1) * amp * on) * (ct < 0 ? -1 : 1) * Math.max(0.12, Math.abs(ct));
  return [m(0) * amp * on, m(1) * amp * on, m(2) * amp * on, width, 1 + (m(4) - 1) * amp * on];
}
