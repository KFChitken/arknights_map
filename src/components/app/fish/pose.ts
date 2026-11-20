/**
 * The rod, line, float and catch at a moment of each step (the design's Pier canvas): the rod a bent quadratic curve
 * from its pivot, the line a sagging one from its tip; the cast swings back and throws (CAST_MS), the reel bends the
 * rod and drags the catch in under the water (REEL_MS), and it leaps out to land by the roach (LEAP_MS). In a scene's
 * own units (WinScene.tsx: the window's bank and 卫戍池塘).
 */

export type FishPhase = "idle" | "cast" | "wait" | "bite" | "reel" | "leap" | "caught";

export const CAST_MS = 1_300;
export const REEL_MS = 1_400;
export const LEAP_MS = 700;

type Pt = [number, number];

/**
 * A scene's rod and water: the rod's pivot and length, its resting angle and how far back it swings to cast, the float
 * in the water, where the catch surfaces and where it lands, the line's sag while it waits, how far the rod pulls up
 */
export type Geo = { P: Pt; L: number; a0: number; back: number; B: Pt; S: Pt; K: Pt; sag: number; pull: number };

export type Pose = {
  rod: string;
  grip: string;
  reel: Pt;
  line: string | null;
  bob: Pt | null;
  /** The catch: under the water (a dark shape) or in the air (itself), turned and grown */
  fish: { at: Pt; under: boolean; rot: number; scale: number } | null;
};

const D = Math.PI / 180;
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
const easeIn = (x: number) => x * x;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const f1 = (x: number) => x.toFixed(1);
const q = (p0: Pt, c: Pt, p1: Pt, u: number): Pt => [
  (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0],
  (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1],
];
const curve = (a: Pt, b: Pt, sag: number) => `M${f1(a[0])} ${f1(a[1])} Q${f1((a[0] + b[0]) / 2)} ${f1((a[1] + b[1]) / 2 + sag)} ${f1(b[0])} ${f1(b[1])}`;

export function poseAt(phase: FishPhase, ms: number, G: Geo): Pose {
  const tipAt = (a: number): Pt => [G.P[0] + G.L * Math.cos(a * D), G.P[1] + G.L * Math.sin(a * D)];
  let ang = G.a0;
  let bend = 5;
  let bob: Pt | null = null;
  let line: string | null = null;
  let fish: Pose["fish"] = null;
  if (phase === "cast") {
    if (ms < 350) ang = G.a0 - G.back * easeOut(ms / 350);
    else if (ms < 480) ang = G.a0 - G.back;
    else if (ms < 620) ang = G.a0 - G.back + (G.back + 16) * easeIn((ms - 480) / 140);
    else if (ms < 850) ang = G.a0 + 16 - 16 * easeOut((ms - 620) / 230);
    const tip = tipAt(ang);
    if (ms < 600) bob = [tip[0] + 2, tip[1] + 16];
    else {
      const rel = tipAt(G.a0 + 13);
      const u = Math.min(1, (ms - 600) / 700);
      bob = q(rel, [(rel[0] + G.B[0]) / 2 + 10, Math.min(rel[1], G.B[1]) - 90], G.B, u);
    }
    line = curve(tip, bob, 4);
  } else if (phase === "wait" || phase === "bite") {
    bob = G.B;
    line = curve(tipAt(G.a0), [G.B[0], G.B[1] - 4], G.sag);
  } else if (phase === "reel") {
    ang = G.a0 - G.pull * easeOut(Math.min(1, ms / 180)) + 2.2 * Math.sin(ms / 28);
    bend = 26;
    const u = easeInOut(Math.min(1, ms / REEL_MS));
    const dx = G.S[0] - G.B[0];
    const dy = G.S[1] - G.B[1];
    const len = Math.hypot(dx, dy);
    const w = 9 * Math.sin(ms / 90) * (1 - u);
    const at: Pt = [G.B[0] + dx * u - (dy / len) * w, G.B[1] + dy * u + (dx / len) * w];
    fish = { at, under: true, rot: 0, scale: 1 };
    line = curve(tipAt(ang), at, 0);
  } else if (phase === "leap") {
    const u = Math.min(1, ms / LEAP_MS);
    ang = G.a0 - G.pull + 18 * easeOut(u);
    bend = 26 - 18 * u;
    const at = q(G.S, [G.S[0] - 16, G.S[1] - 170], G.K, easeOut(u));
    fish = { at, under: false, rot: -30 + 390 * u, scale: 0.7 + 0.4 * u };
    line = curve(tipAt(ang), at, 0);
  } else if (phase === "caught") {
    ang = G.a0 - 10;
    line = curve(tipAt(ang), [G.K[0], G.K[1] - 20], 6);
  }
  const tip = tipAt(ang);
  const v: Pt = [tip[0] - G.P[0], tip[1] - G.P[1]];
  const nl = Math.hypot(v[0], v[1]);
  const nrm: Pt = [-v[1] / nl, v[0] / nl];
  const mid: Pt = [G.P[0] + v[0] * 0.5 + nrm[0] * bend, G.P[1] + v[1] * 0.5 + nrm[1] * bend];
  const grip: Pt = [G.P[0] + v[0] * 0.22, G.P[1] + v[1] * 0.22];
  return {
    rod: `M${f1(G.P[0])} ${f1(G.P[1])} Q${f1(mid[0])} ${f1(mid[1])} ${f1(tip[0])} ${f1(tip[1])}`,
    grip: `M${f1(G.P[0] - v[0] * 0.05)} ${f1(G.P[1] - v[1] * 0.05)} L${f1(grip[0])} ${f1(grip[1])}`,
    reel: [G.P[0] + v[0] * 0.12 + nrm[0] * 5, G.P[1] + v[1] * 0.12 + nrm[1] * 5],
    line,
    bob,
    fish,
  };
}
