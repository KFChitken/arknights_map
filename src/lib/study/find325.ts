/**
 * 找 325 (src/components/app/study/Find325.tsx): a 10 × 10 grid of digits with five 325s hidden in it: three in a
 * line, across, down or slanting (down to the right, or up to the right, both read left to right), and two that turn a
 * corner, a step across or down to the 2 and a quarter turn to the 5, any of the eight ways round (an L). A finger
 * dragged from a 3 to its 5 rings one; all five, or the time (FIND_MS) running out, end the round. The grid is dealt
 * afresh each round (rules.ts newSeed), with 32s, 25s and 352s in it meant to fool the eye, no 325 read any way but the
 * five, and no other 3, 2, 5 through cells that touch, side or corner (a V, or any other bend), that could pass for one.
 */

/** Cells across the grid, and down */
export const FIND_SIDE = 10;
/** The 325s hidden in a grid, and how many of them turn a corner */
export const FIND_COUNT = 5;
export const FIND_TURNING = 2;
/** How long a round lasts (ms) */
export const FIND_MS = 75_000;

/** A cell: its row from the top and its column from the left */
export type Cell = { r: number; c: number };
/**
 * A 325: the cell of its 3, the step to its 2 (dr, dc), and the step on from the 2 to its 5 (tr, tc): the same step
 * for one in a line, a quarter turn of it for one that turns a corner
 */
export type Word = Cell & { dr: number; dc: number; tr: number; tc: number };
export type Puzzle = { grid: number[][]; words: Word[] };

/** The ways a 325 in a line is hidden: across, down, down to the right, up to the right */
export const FIND_WAYS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
] as const;
/** -v, but never -0 */
const neg = (v: number) => (v === 0 ? 0 : -v);
/** Every way a run of three can be read in a line, the four above and the four back */
const EIGHT = [...FIND_WAYS, ...FIND_WAYS.map(([dr, dc]) => [neg(dr), neg(dc)] as const)];
/** A step across or down, either way */
const SIDEWAYS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;
/** The ways a 325 that turns a corner is hidden, as [dr, dc, tr, tc] (Word): a step across or down, then a quarter turn either way */
export const FIND_TURNS: readonly (readonly [number, number, number, number])[] = SIDEWAYS.flatMap(([dr, dc]) => [
  [dr, dc, dc, neg(dr)] as const,
  [dr, dc, neg(dc), dr] as const,
]);
/** The eight cells around one, side or corner */
const AROUND = [...SIDEWAYS, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const THREE_TWO_FIVE = [3, 2, 5];

/** Put in to fool the eye: a 3 and a 2 with no 5 after, a 5 after a 2 alone, the three in the wrong order */
const DECOYS = [[3, 2], [3, 2], [2, 5], [2, 5], [3, 5, 2]];
/** The digits the rest is filled from */
const FILL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type Grid = readonly (readonly (number | null)[])[];

const inside = (r: number, c: number) => r >= 0 && r < FIND_SIDE && c >= 0 && c < FIND_SIDE;
const same = (a: Cell, b: Cell) => a.r === b.r && a.c === b.c;
/** The digit in a cell, or null for one not yet filled or off the grid */
const at = (grid: Grid, r: number, c: number) => (inside(r, c) ? grid[r][c] : null);

/** The cell of a 325's 2, and of its 5 */
export const wordMid = (w: Word): Cell => ({ r: w.r + w.dr, c: w.c + w.dc });
export const wordEnd = (w: Word): Cell => ({ r: w.r + w.dr + w.tr, c: w.c + w.dc + w.tc });
/** Whether a 325 turns a corner at its 2 */
export const turns = (w: Word) => w.tr !== w.dr || w.tc !== w.dc;

/** Whether a 3, 2, 5 taken in these two steps counts: in a line, or a quarter turn after a step across or down */
const counts = (dr: number, dc: number, tr: number, tc: number) =>
  (dr === tr && dc === tc) || (dr * dc === 0 && tr * tc === 0 && dr * tr + dc * tc === 0);

/** Every 325 in a grid that counts: in a line, read any of the eight ways, or turning a corner; cells not yet filled read as nothing */
export function readings(grid: Grid): Word[] {
  const out: Word[] = [];
  for (let r = 0; r < FIND_SIDE; r++)
    for (let c = 0; c < FIND_SIDE; c++) {
      if (grid[r][c] !== 3) continue;
      for (const [dr, dc] of EIGHT) if (at(grid, r + dr, c + dc) === 2 && at(grid, r + 2 * dr, c + 2 * dc) === 5) out.push({ r, c, dr, dc, tr: dr, tc: dc });
      for (const [dr, dc, tr, tc] of FIND_TURNS)
        if (at(grid, r + dr, c + dc) === 2 && at(grid, r + dr + tr, c + dc + tc) === 5) out.push({ r, c, dr, dc, tr, tc });
    }
  return out;
}

/** How many runs of 3, 2, 5 through cells that touch (side or corner) a grid has that do not count: a V, or any other bend */
export function strays(grid: Grid): number {
  let n = 0;
  for (let r = 0; r < FIND_SIDE; r++)
    for (let c = 0; c < FIND_SIDE; c++) {
      if (grid[r][c] !== 3) continue;
      for (const [dr, dc] of AROUND) {
        if (at(grid, r + dr, c + dc) !== 2) continue;
        for (const [tr, tc] of AROUND)
          if (!(dr + tr === 0 && dc + tc === 0) && at(grid, r + dr + tr, c + dc + tc) === 5 && !counts(dr, dc, tr, tc)) n++;
      }
    }
  return n;
}

/** Whether a digit in a cell would finish a 3, 2, 5 through cells that touch, any shape, with the filled cells around it */
function finishes(grid: Grid, r: number, c: number, d: number): boolean {
  const around = (y: number, x: number) => AROUND.map(([dy, dx]) => [y + dy, x + dx] as const).filter(([yy, xx]) => inside(yy, xx));
  if (d === 2) return around(r, c).some(([y, x]) => grid[y][x] === 3) && around(r, c).some(([y, x]) => grid[y][x] === 5);
  if (d !== 3 && d !== 5) return false;
  const end = d === 3 ? 5 : 3;
  return around(r, c).some(([y, x]) => grid[y][x] === 2 && around(y, x).some(([yy, xx]) => !(yy === r && xx === c) && grid[yy][xx] === end));
}

/**
 * A round's grid, from its random (mulberry32 of its seed): five 325s, three in a line, each a different way, and two
 * turning a corner, two different ways round, none sharing a cell; then the things meant to fool the eye; then the
 * rest, each digit one that finishes no 3, 2, 5 of any shape. So the five put there are all a grid has, whichever way
 * it is read, and nothing else in it bends like one.
 */
export function findPuzzle(random: () => number): Puzzle {
  for (;;) {
    const p = tryPuzzle(random);
    if (p) return p;
  }
}

function tryPuzzle(random: () => number): Puzzle | null {
  const int = (n: number) => Math.min(n - 1, Math.floor(random() * n));
  const grid: (number | null)[][] = Array.from({ length: FIND_SIDE }, () => Array<number | null>(FIND_SIDE).fill(null));
  /** Puts digits in cells if every cell is free and nothing comes of it but the 325s meant: undone if not */
  const put = (cells: readonly Cell[], digits: readonly number[], words: number) => {
    if (!cells.every(({ r, c }) => inside(r, c) && grid[r][c] === null)) return false;
    cells.forEach(({ r, c }, k) => (grid[r][c] = digits[k]));
    if (readings(grid).length === words && strays(grid) === 0) return true;
    cells.forEach(({ r, c }) => (grid[r][c] = null));
    return false;
  };
  // three ways in a line and two ways round a corner, each its own, in an order of their own
  const lines = shuffle([0, 1, 2, 3], random)
    .slice(0, FIND_COUNT - FIND_TURNING)
    .map((i) => [...FIND_WAYS[i], ...FIND_WAYS[i]]);
  const corners = shuffle([...FIND_TURNS.keys()], random)
    .slice(0, FIND_TURNING)
    .map((i) => [...FIND_TURNS[i]]);
  const words: Word[] = [];
  for (const [dr, dc, tr, tc] of shuffle([...lines, ...corners], random)) {
    let tries = 0;
    for (;;) {
      if (++tries > 300) return null;
      const r = int(FIND_SIDE);
      const c = int(FIND_SIDE);
      const cells = [
        { r, c },
        { r: r + dr, c: c + dc },
        { r: r + dr + tr, c: c + dc + tc },
      ];
      if (put(cells, THREE_TWO_FIVE, words.length + 1)) {
        words.push({ r, c, dr, dc, tr, tc });
        break;
      }
    }
  }
  for (const d of DECOYS)
    for (let tries = 0; tries < 300; tries++) {
      const [dr, dc] = EIGHT[int(EIGHT.length)];
      const r = int(FIND_SIDE);
      const c = int(FIND_SIDE);
      if (put(d.map((_, k) => ({ r: r + k * dr, c: c + k * dc })), d, FIND_COUNT)) break;
    }
  for (let r = 0; r < FIND_SIDE; r++)
    for (let c = 0; c < FIND_SIDE; c++) {
      if (grid[r][c] !== null) continue;
      // a 2, 3 or 5 is all that can finish one, so the others always fit
      const ok = FILL.filter((d) => !finishes(grid, r, c, d));
      grid[r][c] = ok[int(ok.length)];
    }
  return readings(grid).length === FIND_COUNT && strays(grid) === 0 ? { grid: grid as number[][], words } : null;
}

function shuffle<T>(a: T[], random: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * The 325 a drag from one cell to another rings, from its 3 to its 5 or the other way: its index, or -1. A drag
 * between two cells corner to corner rings the one that turns at whichever of the two cells beside both is its 2 (a
 * grid never has a 2 in both), however the finger went.
 */
export const wordAt = (words: readonly Word[], a: Cell, b: Cell) =>
  words.findIndex((w) => (same(a, w) && same(b, wordEnd(w))) || (same(b, w) && same(a, wordEnd(w))));

/**
 * Where a drag from a cell has got to: the finger (x and y in cells from the grid's top left corner) taken to the
 * nearest straight line, across, down or slanting, and as far along it as the finger is, inside the grid
 */
export function dragTo(from: Cell, x: number, y: number): Cell {
  const vx = x - (from.c + 0.5);
  const vy = y - (from.r + 0.5);
  const k = (((Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) % 8) + 8) % 8) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const [dc, dr] = ([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const)[k];
  let n = Math.round(Math.hypot(vx, vy) / Math.hypot(dc, dr));
  while (n > 0 && !inside(from.r + n * dr, from.c + n * dc)) n--;
  return { r: from.r + n * dr, c: from.c + n * dc };
}

/** Whether two cells are side by side (across or down), and whether corner to corner */
const sideBySide = (a: Cell, b: Cell) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
const cornerToCorner = (a: Cell, b: Cell) => Math.abs(a.r - b.r) === 1 && Math.abs(a.c - b.c) === 1;

/**
 * Where a drag from a cell has got to, as it is shown: along dragTo's straight line, or round a corner. passed is the
 * last cell beside the first that the finger went over (null for none, or once it went back to the first): with the
 * finger then on a cell beside that one and corner to corner with the first, the drag turned the corner there.
 */
export function dragOn(from: Cell, passed: Cell | null, x: number, y: number): { to: Cell; passed: Cell | null; corner: Cell | null } {
  const to = dragTo(from, x, y);
  const under = { r: Math.floor(y), c: Math.floor(x) };
  const last = sideBySide(from, to) ? to : same(from, to) ? null : passed;
  if (last && inside(under.r, under.c) && sideBySide(last, under) && cornerToCorner(from, under)) return { to: under, passed: last, corner: last };
  return { to, passed: last, corner: null };
}
