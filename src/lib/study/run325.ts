/**
 * 325 米跑酷 (src/components/app/study/Run325.tsx): the player's roach seen from the side, running right by itself along
 * a row of desks in a classroom, faster the further it has run: RUN.speed[0] m/s at first, RUN.speed[1] at 325 m, in
 * proportion between. A press (a tap anywhere, the space bar) jumps it, higher the longer it is held, up to
 * RUN.holdMs. On the desks are piles of textbooks, blackboard erasers and slippers to jump over; pieces of chalk fly in
 * at RUN.chalkY over the desks, which the roach runs under, not to be jumped into. Run into one, it lies belly up
 * RUN.downMs, and then can not be hit for RUN.safeMs; RUN.hits times and the round is over. 325 m run, it is passed.
 * Hits do not slow it: how far it has run is a matter of time alone (distanceAt), and so is where everything is.
 *
 * A round's course is laid from its random (mulberry32 of its seed): one thing at a time, each to be jumped over with
 * the press held all of RUN.holdMs at the speed there (or, chalk, run under), and the next far enough on for the roach
 * to land from that jump, and RUN.react more, before it has to jump again.
 *
 * Everything here is pure. Lengths are in metres, the roach's nose at the way run (d), heights over the desks.
 */

/** What there is on the course */
export type Kind = "books" | "eraser" | "slipper" | "chalk";

/**
 * A thing on the course: where it starts (m along the desks; a piece of chalk, where it is when it is over the roach's
 * middle, at the second at), how long, how high its bottom and how tall (m); a pile of books, how many
 */
export type Thing = { kind: Kind; x: number; w: number; y: number; h: number; books?: number; at?: number };

/** How a round ended: 325 m run, or hit RUN.hits times */
export type End = "won" | "out";

/** How it plays, all in one place: after Breeze has played it, only these change */
export const RUN = {
  /** m/s at first and at 325 m, in proportion to the way run between */
  speed: [8, 13] as const,
  /**
   * The roach: how long and how tall (m), as big as its picture's body (Run325.tsx), and what of it can be hit (in so
   * many m from its front, back and top)
   */
  len: 0.9,
  tall: 0.9,
  inset: 0.1,
  /** A jump: how fast it goes up (m/s), how fast it is pulled down (m/s²), and how fast while the press is held, for
   * RUN.holdMs at most */
  jumpV: 6.5,
  gravity: 30,
  holdGravity: 8,
  holdMs: 250,
  /** A press this many ms before it lands jumps it as it lands */
  earlyMs: 120,
  /** Run into, it lies belly up so long (ms), and then can not be hit for so long; so many times and the round is over */
  downMs: 600,
  safeMs: 1000,
  hits: 3,
  /** The course: the first thing so far on, nothing in the last so many m, how often each comes */
  first: 30,
  last: 12,
  odds: { books: 0.34, eraser: 0.24, slipper: 0.2, chalk: 0.22 } as Readonly<Record<Kind, number>>,
  /**
   * After a thing, room at the speed there for a jump held all of RUN.holdMs and react s more, times from 1 to 1 +
   * spread
   */
  react: 0.3,
  spread: 0.6,
  /** Chalk flies in so fast (m/s, the desks standing still) with its bottom so high (m): over the roach on the desks */
  chalkV: 3,
  chalkY: 0.95,
  /** The step it is played in (ms) */
  tickMs: 4,
};

/** What is run for (m) */
export const RUN_GOAL = 325;

/** How long and how tall each thing is (m); books, as tall as so many in the pile */
export const SIZES = {
  books: { w: 0.8, h: { 2: 0.4, 3: 0.6, 4: 0.8 } as Readonly<Record<number, number>> },
  eraser: { w: 0.6, h: 0.3 },
  slipper: { w: 1, h: 0.32 },
  chalk: { w: 0.6, h: 0.2 },
};

/** The speed (m/s) with so much run */
export function speedAt(d: number): number {
  const [first, last] = RUN.speed;
  return first + ((last - first) * Math.min(Math.max(d, 0), RUN_GOAL)) / RUN_GOAL;
}

/** How fast the speed grows with the way (1/s): the speed is first × e^(k t) */
const K = (RUN.speed[1] - RUN.speed[0]) / RUN_GOAL;

/** How far it has run (m) so many seconds in */
export const distanceAt = (t: number): number => (RUN.speed[0] / K) * (Math.exp(K * Math.max(0, t)) - 1);

/** The second it has run so far (m) at */
export const timeAt = (d: number): number => Math.log(1 + (K * Math.max(0, d)) / RUN.speed[0]) / K;

/** Where a thing starts (m along the desks) at a second: a piece of chalk flies in, the rest stand */
export const thingAt = (o: Thing, t: number): number => (o.kind === "chalk" ? o.x + RUN.chalkV * ((o.at ?? 0) - t) : o.x);

/** A jump held h ms (at most RUN.holdMs): how high its feet go, how long it takes to get there and in the air (s) */
export function jumpOf(h: number): { top: number; up: number; air: number } {
  const held = Math.min(Math.max(h, 0), RUN.holdMs) / 1000;
  const v = RUN.jumpV - RUN.holdGravity * held;
  const y = RUN.jumpV * held - (RUN.holdGravity * held * held) / 2;
  const top = y + (v * v) / (2 * RUN.gravity);
  const up = held + v / RUN.gravity;
  return { top, up, air: up + Math.sqrt((2 * top) / RUN.gravity) };
}

/** The first thing on a course (laid in order) that ends past x */
export function firstPast(course: readonly Thing[], x: number): number {
  let lo = 0;
  let hi = course.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (course[mid].x + course[mid].w <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A round: the course, the clock (ms), the roach and the press */
export type Run = {
  course: readonly Thing[];
  ms: number;
  /** The way run (m): the roach's nose */
  d: number;
  /** Its feet over the desks (m), and how fast it goes up (m/s) */
  y: number;
  vy: number;
  air: boolean;
  /** The press is down; the jump is still held, and so long it has been (ms) */
  pressed: boolean;
  hold: boolean;
  heldMs: number;
  /** A press in the air (ms), to jump as it lands */
  early: number | null;
  hits: number;
  /** Belly up till, and not to be hit till (ms) */
  downTill: number;
  safeTill: number;
  /** The thing last run into */
  hit: Thing | null;
  end: End | null;
};

/** A thing's kind, from the random, by RUN.odds */
function kindOf(random: () => number): Kind {
  let r = random();
  for (const k of Object.keys(RUN.odds) as Kind[]) {
    r -= RUN.odds[k];
    if (r < 0) return k;
  }
  return "books";
}

/** A round's course, from its random: things one at a time, each with room after it, as the top of this file says */
export function layCourse(random: () => number): Thing[] {
  const course: Thing[] = [];
  const full = jumpOf(RUN.holdMs).air;
  let x = RUN.first;
  while (x < RUN_GOAL - RUN.last) {
    const kind = kindOf(random);
    let o: Thing;
    if (kind === "books") {
      const books = 2 + Math.min(2, Math.floor(random() * 3));
      o = { kind, x, w: SIZES.books.w, y: 0, h: SIZES.books.h[books], books };
    } else if (kind === "chalk") {
      // x is where it is when it is over the roach's middle, then
      const at = timeAt(x + SIZES.chalk.w / 2 + RUN.len / 2);
      o = { kind, x, w: SIZES.chalk.w, y: RUN.chalkY, h: SIZES.chalk.h, at };
    } else o = { kind, x, w: SIZES[kind].w, y: 0, h: SIZES[kind].h };
    course.push(o);
    const end = x + o.w;
    x = end + speedAt(end) * (full + RUN.react) * (1 + random() * RUN.spread);
  }
  return course;
}

/** A round as it starts: the course laid, the roach on the desks at 0 m */
export function runStart(random: () => number): Run {
  return {
    course: layCourse(random),
    ms: 0,
    d: 0,
    y: 0,
    vy: 0,
    air: false,
    pressed: false,
    hold: false,
    heldMs: 0,
    early: null,
    hits: 0,
    downTill: 0,
    safeTill: 0,
    hit: null,
    end: null,
  };
}

/** Whether it lies belly up */
export const isDown = (r: Run) => r.ms < r.downTill;

/** A press (a tap, the space bar): on the desks it jumps, in the air it is kept to jump as it lands */
export function press(r: Run): Run {
  if (r.end || r.pressed) return r;
  if (isDown(r)) return { ...r, pressed: true };
  if (r.air) return { ...r, pressed: true, early: r.ms };
  return { ...r, pressed: true, air: true, vy: RUN.jumpV, hold: true, heldMs: 0, early: null };
}

/** The press let go: the jump is held no more */
export function release(r: Run): Run {
  if (!r.pressed && !r.hold) return r;
  return { ...r, pressed: false, hold: false };
}

/** Whether the roach as it is now runs into a thing at second t */
function into(r: Run, o: Thing, t: number): boolean {
  const back = r.d - RUN.len + RUN.inset;
  const front = r.d - RUN.inset;
  const x = thingAt(o, t);
  return front > x && back < x + o.w && r.y < o.y + o.h && r.y + RUN.tall - RUN.inset > o.y;
}

/** One step of h ms */
function stepOn(r: Run, h: number) {
  r.ms += h;
  const t = r.ms / 1000;
  r.d = distanceAt(t);
  if (r.d >= RUN_GOAL) {
    r.d = RUN_GOAL;
    r.end = "won";
    return;
  }
  const down = isDown(r);
  if (r.air) {
    const holding = r.hold && !down && r.heldMs < RUN.holdMs;
    if (holding) r.heldMs += h;
    else r.hold = false;
    r.vy -= ((holding ? RUN.holdGravity : RUN.gravity) * h) / 1000;
    r.y += (r.vy * h) / 1000;
    if (r.y <= 0) {
      r.y = 0;
      r.vy = 0;
      r.air = false;
      r.hold = false;
      // a press just before it landed jumps it now, held as long as it is still down
      if (r.early !== null && r.ms - r.early <= RUN.earlyMs && !down) {
        r.air = true;
        r.vy = RUN.jumpV;
        r.hold = r.pressed;
        r.heldMs = 0;
      }
      r.early = null;
    }
  }
  if (r.ms < r.safeTill) return;
  // only what is near the roach can be run into: a piece of chalk is near when the roach is near where it meets it
  for (let i = firstPast(r.course, r.d - RUN.len - 2); i < r.course.length; i++) {
    const o = r.course[i];
    if (o.x > r.d + 2) break;
    if (!into(r, o, t)) continue;
    r.hits += 1;
    r.hit = o;
    r.downTill = r.ms + RUN.downMs;
    r.safeTill = r.downTill + RUN.safeMs;
    r.hold = false;
    r.early = null;
    if (r.hits >= RUN.hits) r.end = "out";
    return;
  }
}

/** The round's clock on by dt (ms), in steps of RUN.tickMs: the roach run on, jumped, landed and run into things */
export function advance(r: Run, dt: number): Run {
  if (r.end || dt <= 0) return r;
  const next = { ...r };
  for (let left = dt; left > 0 && !next.end; left -= RUN.tickMs) stepOn(next, Math.min(RUN.tickMs, left));
  return next;
}
