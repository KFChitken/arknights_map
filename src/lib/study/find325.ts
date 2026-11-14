/**
 * 找 325 (src/components/app/study/Find325.tsx): a 10 × 10 grid of digits with five 325s hidden in it, across, down
 * or slanting (down to the right, or up to the right, both read left to right). A finger dragged from a 3 to its 5
 * rings one; all five, or the minute running out, end the round. The grid is the day's, the same for everyone who plays
 * it that day (rules.ts dayRandom), with 32s, 25s and 352s in it meant to fool the eye, and no 325 read any way but
 * the five.
 */

/** Cells across the grid, and down */
export const FIND_SIDE = 10;
/** The 325s hidden in a grid */
export const FIND_COUNT = 5;
/** How long a round lasts (ms) */
export const FIND_MS = 60_000;

/** A cell: its row from the top and its column from the left */
export type Cell = { r: number; c: number };
/** A 325: the cell of its 3, and the step to its 2 and on to its 5 */
export type Word = Cell & { dr: number; dc: number };
export type Puzzle = { grid: number[][]; words: Word[] };

/** The ways a 325 is hidden: across, down, down to the right, up to the right */
export const FIND_WAYS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
] as const;
/** Every way a run of three can be read, the four above and the four back */
const EIGHT = [...FIND_WAYS, ...FIND_WAYS.map(([dr, dc]) => [-dr, -dc] as const)];
const THREE_TWO_FIVE = [3, 2, 5];

/** Put in to fool the eye: a 3 and a 2 with no 5 after, a 5 after a 2 alone, the three in the wrong order */
const DECOYS = [[3, 2], [3, 2], [2, 5], [2, 5], [3, 5, 2]];
/** The digits the rest is filled from */
const FILL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const inside = (r: number, c: number) => r >= 0 && r < FIND_SIDE && c >= 0 && c < FIND_SIDE;
const same = (a: Cell, b: Cell) => a.r === b.r && a.c === b.c;

/** The cell of a 325's 5 */
export const wordEnd = (w: Word): Cell => ({ r: w.r + 2 * w.dr, c: w.c + 2 * w.dc });

/** Every 325 in a grid, read any of the eight ways; cells not yet filled read as nothing */
export function readings(grid: readonly (readonly (number | null)[])[]): Word[] {
  const out: Word[] = [];
  for (let r = 0; r < FIND_SIDE; r++)
    for (let c = 0; c < FIND_SIDE; c++) {
      if (grid[r][c] !== 3) continue;
      for (const [dr, dc] of EIGHT)
        if (inside(r + 2 * dr, c + 2 * dc) && grid[r + dr][c + dc] === 2 && grid[r + 2 * dr][c + 2 * dc] === 5) out.push({ r, c, dr, dc });
    }
  return out;
}

/** Whether a digit in a cell would finish a 325 with filled cells next to it, read any way */
function finishes(grid: readonly (readonly (number | null)[])[], r: number, c: number, d: number): boolean {
  for (const [dr, dc] of FIND_WAYS)
    for (let k = 0; k < 3; k++) {
      const run: (number | null)[] = [];
      for (let j = 0; j < 3; j++) {
        const y = r + (j - k) * dr;
        const x = c + (j - k) * dc;
        run.push(!inside(y, x) ? null : j === k ? d : grid[y][x]);
      }
      if (run.includes(null)) continue;
      if (run.every((v, j) => v === THREE_TWO_FIVE[j]) || run.every((v, j) => v === THREE_TWO_FIVE[2 - j])) return true;
    }
  return false;
}

/**
 * The grid of the day, from its random (rules.ts dayRandom): five 325s, at least one each way, none sharing a cell;
 * then the things meant to fool the eye; then the rest, each digit one that finishes no 325. So the five put there
 * are all a grid has, whichever way it is read.
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
  /** Puts digits along a line from a cell if every cell is free and no 325 comes of it but those meant: undone if not */
  const put = (r: number, c: number, dr: number, dc: number, digits: readonly number[], words: number) => {
    const cells = digits.map((_, k) => [r + k * dr, c + k * dc] as const);
    if (!cells.every(([y, x]) => inside(y, x) && grid[y][x] === null)) return false;
    cells.forEach(([y, x], k) => (grid[y][x] = digits[k]));
    if (readings(grid).length === words) return true;
    cells.forEach(([y, x]) => (grid[y][x] = null));
    return false;
  };
  const words: Word[] = [];
  const ways = shuffle([0, 1, 2, 3, int(4)], random).map((i) => FIND_WAYS[i]);
  for (const [dr, dc] of ways) {
    let tries = 0;
    for (;;) {
      if (++tries > 300) return null;
      const r = int(FIND_SIDE);
      const c = int(FIND_SIDE);
      if (put(r, c, dr, dc, THREE_TWO_FIVE, words.length + 1)) {
        words.push({ r, c, dr, dc });
        break;
      }
    }
  }
  for (const d of DECOYS)
    for (let tries = 0; tries < 300; tries++) {
      const [dr, dc] = EIGHT[int(EIGHT.length)];
      if (put(int(FIND_SIDE), int(FIND_SIDE), dr, dc, d, FIND_COUNT)) break;
    }
  for (let r = 0; r < FIND_SIDE; r++)
    for (let c = 0; c < FIND_SIDE; c++) {
      if (grid[r][c] !== null) continue;
      // a 2, 3 or 5 is all that can finish one, so the others always fit
      const ok = FILL.filter((d) => !finishes(grid, r, c, d));
      grid[r][c] = ok[int(ok.length)];
    }
  return readings(grid).length === FIND_COUNT ? { grid: grid as number[][], words } : null;
}

function shuffle<T>(a: T[], random: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The 325 a drag from one cell to another rings, from its 3 to its 5 or the other way: its index, or -1 */
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
