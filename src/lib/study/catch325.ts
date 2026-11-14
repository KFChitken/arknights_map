/**
 * 接住 3、2、5 (src/components/app/study/Catch325.tsx): things fall down a field, and the player's roach, moved left and
 * right along the bottom, catches the digits 3, 2 and 5 in that order, a set at a time, and keeps clear of the rest. A
 * wrong digit empties the set begun; an obstacle (field.ts) empties it too, and turns the roach belly up for a moment.
 * Five sets inside the minute pass. What falls, where and when, is the same for everyone that day (rules.ts
 * dayRandom), and is drawn again until it is fair: nothing comes down crowded together, there are enough of each of 3,
 * 2 and 5, and a player who caught each digit wanted as it came would have the five sets in well inside the minute.
 */
import { clamp, isObstacle, OBSTACLES, type Obstacle } from "./field";

/** A round's length (ms), and the sets that pass it */
export const CATCH_MS = 60_000;
export const CATCH_SETS = 5;
/** The order the digits are caught in: a set */
export const CATCH_ORDER = [3, 2, 5] as const;
/** The other digits, which fall too */
export const CATCH_OTHER: readonly number[] = [0, 1, 4, 6, 7, 8, 9];

/** When the first thing starts to fall, and how far apart they start (ms): 0.55 s on average */
export const CATCH_FIRST_MS = 600;
export const CATCH_GAP_MS: readonly [number, number] = [400, 700];
/** What falls, as shares: each of 3, 2 and 5; obstacles; the other digits are the rest (26%) */
export const CATCH_EACH = 0.18;
export const CATCH_OBSTACLES = 0.2;
/** At least this many of each of 3, 2 and 5 a day, that come down inside the minute */
export const CATCH_MIN_EACH = 15;
/** How long a thing takes to fall to the roach (ms): at the round's start, and at its end */
export const CATCH_FALL_MS: readonly [number, number] = [3000, 2200];
/** With motion turned down, things fall at this much of the speed (30% slower) */
export const CATCH_CALM = 0.7;
/** Belly up after running into an obstacle (ms): the roach cannot move, and nothing touches it */
export const CATCH_STUN_MS = 800;
/** Two things coming down within this of each other (ms) are at least this far apart (field widths) */
export const CATCH_CROWD_MS = 450;
export const CATCH_CROWD_GAP = 0.26;
/** Each digit wanted caught as it came, the five sets would be in by this (ms), on every day */
export const CATCH_PAR_MS = 40_000;
/** How many days' worth of drops to draw before taking the best of them (over a thousand days it never has) */
export const CATCH_TRIES = 400;
/** Where things come down: field widths from the left, kept this far off either side */
export const CATCH_SIDE = 0.09;
/** How far sideways a paper plane glides on its way down to the roach (field widths) */
export const CATCH_GLIDE: readonly [number, number] = [0.2, 0.36];
/** Sizes, in field widths: a falling thing's radius; the roach's picture (a square) */
export const CATCH_THING_R = 0.06;
export const CATCH_ROACH_BOX = 0.2;
/**
 * A thing is caught, or run into, the moment it comes down to the roach (dropAt's down reaching 1, as high as the top of
 * its head) if it is within this of the roach's middle then (field widths): a moment, not while it falls past, so two
 * things a little apart in time never both touch it
 */
export const CATCH_REACH = 0.1;

/** What falls: a digit, or an obstacle */
export type Thing = number | Obstacle;

/**
 * A thing that falls: when it starts (ms into the round), what it is, where it starts and where it comes down to the
 * roach (field widths from the left; the same but for a paper plane), and how long it falls to the roach (ms)
 */
export type Drop = { at: number; what: Thing; from: number; to: number; fall: number };

/** How a round stands: how many of the set begun are caught (0 to 2), and the sets caught */
export type Tally = { filled: number; sets: number };
export const TALLY_START: Tally = { filled: 0, sets: 0 };

/** What catching a thing did: one more of the set, the set done, a wrong digit, an obstacle run into */
export type Catch = "fill" | "set" | "wrong" | "hit";

/** A thing caught (or run into): how the round stands after it, and whether that passes it */
export function caught(t: Tally, what: Thing): { tally: Tally; did: Catch; end: "pass" | null } {
  if (isObstacle(what)) return { tally: { ...t, filled: 0 }, did: "hit", end: null };
  if (what !== CATCH_ORDER[t.filled]) return { tally: { ...t, filled: 0 }, did: "wrong", end: null };
  if (t.filled + 1 < CATCH_ORDER.length) return { tally: { ...t, filled: t.filled + 1 }, did: "fill", end: null };
  const sets = t.sets + 1;
  return { tally: { filled: 0, sets }, did: "set", end: sets >= CATCH_SETS ? "pass" : null };
}

/** How long a thing takes to fall to the roach, by when it starts: a little quicker as the round goes on */
export const fallMs = (at: number) => CATCH_FALL_MS[0] + (CATCH_FALL_MS[1] - CATCH_FALL_MS[0]) * clamp(at / CATCH_MS, 0, 1);

/** When a drop reaches the roach (ms into the round); calm: with motion turned down */
export const arrives = (d: Drop, calm = false) => d.at + (calm ? d.fall / CATCH_CALM : d.fall);

/** Where a drop is at a time: how far down (0 at the top, 1 at the roach, and on past it) and across (field widths) */
export function dropAt(d: Drop, t: number, calm = false): { down: number; x: number } {
  const down = (t - d.at) / (calm ? d.fall / CATCH_CALM : d.fall);
  return { down, x: d.from + (d.to - d.from) * Math.max(0, down) };
}

/** Whether a drop comes down to the roach between two times (ms into the round): after the first, by the second */
export const comesDown = (d: Drop, from: number, to: number, calm = false) => dropAt(d, from, calm).down < 1 && dropAt(d, to, calm).down >= 1;

/** Whether a thing coming down at x reaches the roach at roachX (field widths) */
export const inReach = (x: number, roachX: number) => Math.abs(x - roachX) <= CATCH_REACH;

/** Whether two of a day's drops come down crowded: within CATCH_CROWD_MS of each other, nearer than CATCH_CROWD_GAP */
export function crowded(drops: readonly Drop[]): boolean {
  const byTime = [...drops].sort((a, b) => arrives(a) - arrives(b));
  for (let i = 0; i < byTime.length; i++)
    for (let j = i + 1; j < byTime.length && arrives(byTime[j]) - arrives(byTime[i]) < CATCH_CROWD_MS; j++)
      if (Math.abs(byTime[j].to - byTime[i].to) < CATCH_CROWD_GAP) return true;
  return false;
}

/** The drops that come down to the roach inside the minute */
export const inTime = (drops: readonly Drop[]) => drops.filter((d) => arrives(d) <= CATCH_MS);

/** When the five sets would be in had each digit wanted been caught as it came (ms into the round), or null */
export function parMs(drops: readonly Drop[]): number | null {
  let tally = TALLY_START;
  for (const d of [...inTime(drops)].sort((a, b) => arrives(a) - arrives(b))) {
    if (d.what !== CATCH_ORDER[tally.filled]) continue;
    tally = caught(tally, d.what).tally;
    if (tally.sets >= CATCH_SETS) return arrives(d);
  }
  return null;
}

/** Whether a day's drops are fair (see above) */
export function fairDrops(drops: readonly Drop[]): boolean {
  const near = inTime(drops);
  const par = parMs(drops);
  return (
    !crowded(drops) &&
    CATCH_ORDER.every((n) => near.filter((d) => d.what === n).length >= CATCH_MIN_EACH) &&
    par !== null &&
    par <= CATCH_PAR_MS
  );
}

/** The day's drops, from its random (rules.ts dayRandom), in the order they start to fall */
export function catchDrops(random: () => number): Drop[] {
  let best: Drop[] = [];
  let bestPar = Infinity;
  for (let k = 0; k < CATCH_TRIES; k++) {
    const drops = drawDrops(random);
    if (fairDrops(drops)) return drops;
    // the next best: not crowded, and the five sets in soonest
    const par = parMs(drops);
    if (!crowded(drops) && par !== null && par < bestPar) [best, bestPar] = [drops, par];
  }
  return best.length ? best : drawDrops(random);
}

/** One try at a day's drops */
function drawDrops(random: () => number): Drop[] {
  const between = () => CATCH_GAP_MS[0] + (CATCH_GAP_MS[1] - CATCH_GAP_MS[0]) * random();
  const times: number[] = [];
  for (let t = CATCH_FIRST_MS; Math.round(t) < CATCH_MS; t += between()) times.push(Math.round(t));
  // what falls, in its shares, in an order of its own
  const things: Thing[] = [];
  for (const n of CATCH_ORDER) for (let i = Math.round(times.length * CATCH_EACH); i > 0; i--) things.push(n);
  for (let i = Math.round(times.length * CATCH_OBSTACLES); i > 0; i--) things.push(OBSTACLES[Math.floor(random() * OBSTACLES.length)]);
  while (things.length < times.length) things.push(CATCH_OTHER[Math.floor(random() * CATCH_OTHER.length)]);
  for (let i = things.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [things[i], things[j]] = [things[j], things[i]];
  }
  const drops: Drop[] = [];
  times.forEach((at, i) => {
    const fall = Math.round(fallMs(at));
    // where it comes down: of a few places tried, the first clear of what comes down just before it, else the clearest
    const near = drops.filter((d) => arrives(d) > at + fall - CATCH_CROWD_MS);
    let to = 0.5;
    let room = -1;
    for (let k = 0; k < 12 && room < CATCH_CROWD_GAP; k++) {
      const x = round3(CATCH_SIDE + (1 - 2 * CATCH_SIDE) * random());
      const r = Math.min(1, ...near.map((d) => Math.abs(d.to - x)));
      if (r > room) [to, room] = [x, r];
    }
    const what = things[i];
    let from = to;
    if (what === "plane") {
      // gliding in from one side or the other, wherever it starts on the field
      const glide = CATCH_GLIDE[0] + (CATCH_GLIDE[1] - CATCH_GLIDE[0]) * random();
      const left = random() < 0.5 ? to - glide : to + glide;
      from = round3(left >= CATCH_SIDE && left <= 1 - CATCH_SIDE ? left : 2 * to - left);
    }
    drops.push({ at, what, from, to, fall });
  });
  return drops;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
