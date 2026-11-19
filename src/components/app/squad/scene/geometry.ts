/**
 * The fight on the map (src/components/app/squad/scene): where each of the room's four stands and what it may hit,
 * worked out from the stage's size alone, so it can be tested without a page. Each stands at a seat, 1 to 4, given by
 * its place in the room (seatFor), never by its number there (h: one who came in after another left has 5 or more,
 * a 人机 one below 0); W and H are the stage's size in px; rs a roach's size, ss a monster's (rs × 1.4).
 */

export type Foe = "slug" | "acid" | "infused" | "hound" | "drone";
/** Height over width of each monster's picture (public/squad/*.svg) */
export const ASPECT: Readonly<Record<Foe, number>> = { slug: 0.68, acid: 0.68, infused: 0.68, hound: 0.64, drone: 0.714 };

/** A roach's size and a monster's, from the stage's: 15% of its width or 17% of its height, 38–70 px */
export function sizesOf(W: number, H: number) {
  const rs = Math.round(Math.max(38, Math.min(70, Math.min(W * 0.15, H * 0.17))));
  return { rs, ss: Math.round(rs * 1.4) };
}

/**
 * The seats of the room's first, second, third and fourth (the host first, as the room lists them): 1 and 3 first, so
 * two face both sides (A's columns, B's and C's left and right), then 2 and 4.
 */
export const SEAT_ORDER: readonly number[] = [1, 3, 2, 4];
export const seatFor = (i: number) => SEAT_ORDER[i] ?? SEAT_ORDER[SEAT_ORDER.length - 1];

// ---- A: slugs crawl in from both sides ----

/** Where each seat is, as parts of the stage: 1 and 2 on the left, 3 and 4 on the right */
export const SEAT_A: Readonly<Record<number, readonly [number, number]>> = { 1: [0.36, 0.38], 2: [0.36, 0.69], 3: [0.64, 0.38], 4: [0.64, 0.69] };
/** The side a seat faces its slugs from: -1 left, 1 right */
export const sideOf = (h: number) => (h <= 2 ? -1 : 1);
export const seatA = (h: number, W: number, H: number): [number, number] => {
  const [x, y] = SEAT_A[h] ?? SEAT_A[1];
  return [x * W, y * H];
};
/** Where a slug coming for seat h stops: just short of it, on its side */
export const stopA = (h: number, W: number, rs: number, ss: number, big: boolean) => seatA(h, W, 1)[0] + sideOf(h) * (rs * 0.5 + ss * (big ? 0.85 : 0.5) * 0.9);
/** A slug waits this long in front of a roach that never hits it (asleep), then slips past; a big one never does */
export const SLIP_AFTER_S = 3.4;
export const slips = (waited: number, big: boolean) => !big && waited > SLIP_AFTER_S;

/** A slug as A's roaches see it: where it is (the middle of its foot), its side, big or not, slipping past or not */
export type SlugAt = { x: number; y: number; side: number; big: boolean; sneak: boolean };

/**
 * The slug the roach of seat h hits next: on its own side, within reach, the nearest (by x and y together). Its reach
 * is wider while the other of its side sleeps (it helps), or while it is in a frenzy (剩下的交给我吧).
 */
export function targetA<S extends SlugAt>(h: number, slugs: readonly S[], g: { W: number; H: number; rs: number; ss: number }, wide: boolean): S | null {
  const side = sideOf(h);
  const [rx, ry] = seatA(h, g.W, g.H);
  const fy = ry + g.rs * 0.42;
  let best: S | null = null;
  let bd = Infinity;
  for (const s of slugs) {
    if (s.sneak || s.side !== side) continue;
    const reach = g.rs * 0.5 + g.ss * (s.big ? 0.95 : 0.62) + 10;
    const dx = Math.abs(s.x - rx);
    const dy = Math.abs(s.y - fy);
    if (dx <= reach && dy <= g.rs * (wide ? 2 : 0.8) && dx + dy < bd) {
      best = s;
      bd = dx + dy;
    }
  }
  return best;
}

// ---- B: one big monster in the middle ----

/** The monsters taking turns in B, and the hits each takes; one grown big (大的来了) takes half as many again */
export const BOSSES: readonly Foe[] = ["slug", "acid", "infused"];
export const BOSS_HP: Readonly<Record<string, number>> = { slug: 24, acid: 27, infused: 30 };
export const bossHp = (kind: Foe, big: boolean) => (BOSS_HP[kind] ?? 24) * (big ? 1.5 : 1);
/** The one after the i-th (counting from a random start) */
export const bossAt = (i: number) => BOSSES[((i % BOSSES.length) + BOSSES.length) % BOSSES.length];
/** Where round the monster each stands, in degrees (0 right, y down): 1 and 3 behind it, 2 and 4 in front */
export const ANG_B: Readonly<Record<number, number>> = { 1: 222, 2: 138, 3: 318, 4: 42 };
/** The monster's width: 40% of the stage's width or 50% of its height, 100–240 px */
export const bossWidth = (W: number, H: number) => Math.round(Math.max(100, Math.min(240, Math.min(W * 0.4, H * 0.5))));
/** Where seat h is round the monster: on an ellipse round its foot (cx, gy), wider as it grows */
export function seatB(h: number, g: { cx: number; gy: number; bw: number; rs: number; grow: number }): [number, number] {
  const a = ((ANG_B[h] ?? ANG_B[1]) * Math.PI) / 180;
  const rx = g.bw * 0.5 * g.grow + g.rs * 0.85;
  const ry = g.bw * 0.26 + g.rs * 0.8;
  return [g.cx + Math.cos(a) * rx, g.gy - g.bw * 0.1 + Math.sin(a) * ry - g.rs * 0.42];
}
/** 1 and 3 stand behind the monster */
export const behindB = (h: number) => h === 1 || h === 3;

// ---- C: the brawl cloud ----

/** Where round the cloud each stands, in degrees */
export const ANG_C: Readonly<Record<number, number>> = { 1: 200, 2: 153, 3: 340, 4: 27 };
/** The cloud's size: R is 25% of the stage's width or 27% of its height, 54–140 px; the cloud is 2.5R wide, 2R high */
export const cloudR = (W: number, H: number) => Math.round(Math.max(54, Math.min(140, Math.min(W * 0.25, H * 0.27))));
/** Where seat h is at the cloud's rim; one asleep lies further out */
export function seatC(h: number, g: { cx: number; cy: number; R: number }, awake: boolean): [number, number] {
  const a = ((ANG_C[h] ?? ANG_C[1]) * Math.PI) / 180;
  const far = awake ? 1.04 : 1.45;
  return [g.cx + Math.cos(a) * g.R * 1.1 * far, g.cy + Math.sin(a) * g.R * 0.8 * far];
}
/** A point on the cloud's rim at angle a (radians), k times out */
export const rimC = (a: number, k: number, g: { cx: number; cy: number; R: number }): [number, number] => [g.cx + Math.cos(a) * g.R * k, g.cy + Math.sin(a) * g.R * 0.82 * k];
/** The ten puffs of the cloud: x, y and r, as parts of R */
export const PUFFS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0.62],
  [-0.55, -0.12, 0.48],
  [0.55, -0.1, 0.5],
  [-0.28, -0.45, 0.45],
  [0.3, -0.46, 0.44],
  [-0.62, 0.28, 0.4],
  [0.6, 0.3, 0.42],
  [0, 0.42, 0.45],
  [-0.86, 0.04, 0.3],
  [0.87, 0.02, 0.3],
];
