/**
 * 贪吃小强 (src/components/app/study/Snake325.tsx): a grid of SNAKE.size by SNAKE.size squares, the player's roach
 * crawling in it a square a step the way it goes, a train of small roaches behind it, each going where the one before
 * it was. A turn waits in a queue, SNAKE.queue long, and is taken at the next step; a turn straight back, or the way it
 * goes already (each as the last turn waiting leaves it), is not queued. On the grid there are always four crumbs, one
 * each of SNAKE.crumbs: crawled onto, one is eaten, its number added to what is eaten, the train longer by
 * SNAKE.grows of it (the end of the train stays where it is that many steps), and another of the same put down on a
 * square free of the roaches and the other crumbs, not near the head nor on its way just ahead. Eaten to exactly 325
 * the round is passed; past it the roach bursts; into the grid's edge or its own train, or SNAKE.seconds gone, the
 * round is over too. A step takes SNAKE.stepMs[0], less the more is eaten, down to SNAKE.stepMs[1] at 325.
 *
 * Everything here is pure: a round's crumbs are put down from its random (mulberry32 of its seed).
 */

export type Dir = "up" | "down" | "left" | "right";
export type Cell = { x: number; y: number };
export type Crumb = Cell & { n: number };
/** How a round ended: passed, or burst, into the edge, into the train, out of time */
export type End = "won" | "burst" | "wall" | "self" | "time";

/** How it plays, all in one place: after Breeze has played it, only these change */
export const SNAKE = {
  size: 13,
  /** The head at first, the way it goes, and how many small roaches are behind it */
  start: { x: 4, y: 6, dir: "right" as Dir, train: 2 },
  crumbs: [5, 20, 50, 100] as const,
  /** How many longer the train gets for each crumb */
  grows: { 5: 1, 20: 1, 50: 2, 100: 4 } as Readonly<Record<number, number>>,
  /** A step's ms at first, and with 325 eaten: in proportion between */
  stepMs: [220, 160] as const,
  seconds: 90,
  /** Turns that may wait */
  queue: 2,
  /** A crumb is put down no nearer the head than this many squares across or up and down, nor this many ahead of it */
  clear: 2,
  ahead: 5,
};

/** What a round is played for */
export const SNAKE_GOAL = 325;

export type Snake = {
  /** The head, then the train behind it */
  body: readonly Cell[];
  /** Where each of them was before the last step, to be drawn on its way (one new to the train where it is) */
  was: readonly Cell[];
  dir: Dir;
  /** Turns waiting, the next first */
  turns: readonly Dir[];
  /** Steps the end of the train stays where it is for yet */
  grow: number;
  eaten: number;
  /** One of each of SNAKE.crumbs, in that order */
  crumbs: readonly Crumb[];
  /** The round's clock (ms), and the ms since the last step */
  ms: number;
  since: number;
  /** The crumb eaten at the step just taken, if any */
  ate: Crumb | null;
  end: End | null;
};

/** A step's way across and down */
export const STEP: Readonly<Record<Dir, Cell>> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const BACK: Readonly<Record<Dir, Dir>> = { up: "down", down: "up", left: "right", right: "left" };

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
const inside = (c: Cell) => c.x >= 0 && c.y >= 0 && c.x < SNAKE.size && c.y < SNAKE.size;

/** A step's ms with so much eaten */
export function stepMsOf(eaten: number): number {
  const [first, last] = SNAKE.stepMs;
  return Math.round(first - ((first - last) * Math.min(Math.max(eaten, 0), SNAKE_GOAL)) / SNAKE_GOAL);
}

/** Whether a crumb may be put down on a square: free, not near the head, not on its way just ahead */
export function fitForCrumb(c: Cell, body: readonly Cell[], crumbs: readonly Cell[], dir: Dir): boolean {
  if (!inside(c) || body.some((b) => same(b, c)) || crumbs.some((b) => same(b, c))) return false;
  const h = body[0];
  if (Math.max(Math.abs(c.x - h.x), Math.abs(c.y - h.y)) <= SNAKE.clear) return false;
  const d = STEP[dir];
  for (let k = 1; k <= SNAKE.ahead; k++) if (c.x === h.x + d.x * k && c.y === h.y + d.y * k) return false;
  return true;
}

/** A square for a crumb, from a random: one fit for it, or if none is, any free one (none on a full grid) */
function squareFor(random: () => number, body: readonly Cell[], crumbs: readonly Cell[], dir: Dir): Cell | null {
  const all: Cell[] = [];
  for (let y = 0; y < SNAKE.size; y++) for (let x = 0; x < SNAKE.size; x++) all.push({ x, y });
  let pool = all.filter((c) => fitForCrumb(c, body, crumbs, dir));
  if (!pool.length) pool = all.filter((c) => !body.some((b) => same(b, c)) && !crumbs.some((b) => same(b, c)));
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] : null;
}

/** A round as it starts: the roach and its train, and the crumbs put down from the round's random */
export function snakeStart(random: () => number): Snake {
  const { x, y, dir, train } = SNAKE.start;
  const back = STEP[BACK[dir]];
  const body = Array.from({ length: train + 1 }, (_, i) => ({ x: x + back.x * i, y: y + back.y * i }));
  const crumbs: Crumb[] = [];
  for (const n of SNAKE.crumbs) {
    const at = squareFor(random, body, crumbs, dir);
    if (at) crumbs.push({ ...at, n });
  }
  return { body, was: body, dir, turns: [], grow: 0, eaten: 0, crumbs, ms: 0, since: 0, ate: null, end: null };
}

/** A turn asked for (a swipe, an arrow key): queued, unless it is straight back or the way it goes, or the queue is full */
export function turn(s: Snake, d: Dir): Snake {
  if (s.end) return s;
  const last = s.turns.length ? s.turns[s.turns.length - 1] : s.dir;
  if (d === last || d === BACK[last] || s.turns.length >= SNAKE.queue) return s;
  return { ...s, turns: [...s.turns, d] };
}

/** A step: the next turn waiting taken, the roach a square on, the train after it, a crumb there eaten */
export function step(s: Snake, random: () => number): Snake {
  if (s.end) return s;
  const dir = s.turns.length ? s.turns[0] : s.dir;
  const turns = s.turns.slice(1);
  const h = s.body[0];
  const to = { x: h.x + STEP[dir].x, y: h.y + STEP[dir].y };
  if (!inside(to)) return { ...s, was: s.body, dir, turns, ate: null, end: "wall" };
  // the end of the train goes on out of its square this step, unless it stays where it is
  const stays = s.grow > 0;
  const train = stays ? s.body : s.body.slice(0, -1);
  if (train.some((c) => same(c, to))) return { ...s, was: s.body, dir, turns, ate: null, end: "self" };
  const body = [to, ...train];
  const was = body.map((c, i) => (i < s.body.length ? s.body[i] : c));
  const ate = s.crumbs.find((c) => same(c, to)) ?? null;
  let { eaten, crumbs } = s;
  let grow = stays ? s.grow - 1 : 0;
  let end: End | null = null;
  if (ate) {
    eaten += ate.n;
    grow += SNAKE.grows[ate.n] ?? 1;
    end = eaten === SNAKE_GOAL ? "won" : eaten > SNAKE_GOAL ? "burst" : null;
    const others = s.crumbs.filter((c) => c !== ate);
    const at = squareFor(random, body, others, dir);
    crumbs = at ? s.crumbs.map((c) => (c === ate ? { ...at, n: ate.n } : c)) : others;
  }
  return { ...s, body, was, dir, turns, grow, eaten, crumbs, ate, end };
}

/** The round's clock on by dt (ms): the steps due taken, and the round over once SNAKE.seconds are gone */
export function advance(s: Snake, dt: number, random: () => number): Snake {
  if (s.end) return s;
  const ms = s.ms + dt;
  if (ms >= SNAKE.seconds * 1000) return { ...s, was: s.body, ms: SNAKE.seconds * 1000, ate: null, end: "time" };
  let t: Snake = { ...s, ms, since: s.since + dt, ate: null };
  for (let due = stepMsOf(t.eaten); !t.end && t.since >= due; due = stepMsOf(t.eaten)) {
    const ate = t.ate;
    t = step(t, random);
    t = { ...t, since: t.since - due, ate: t.ate ?? ate };
  }
  return t;
}
