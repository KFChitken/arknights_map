import { markPaper, type Stroke, WRITE_DIGITS } from "./write325";

/**
 * 手写榜: 徒手写 325's papers (write325.ts) put up for everyone to see, each rated 0 to BOARD.max by players who once
 * passed 徒手写, and ranked by their ratings' average pulled toward the whole site's (so a paper a few rated full marks
 * does not beat one many rated a little under). Breeze asked for it (2026-11-18), the 800 to play on 325799: most will
 * rate 799, which lights 325799. The server keeps the papers and their ratings (src/lib/server/handwriting.ts); all
 * here is pure, the page's and the server's alike.
 */

export const BOARD = {
  /** Ratings a player may give a site day, and papers they may skip */
  ratesPerDay: 10,
  skipsPerDay: 20,
  /** Raters a paper needs before it is on the board, and how many site-average ratings its average is pulled by */
  minRaters: 5,
  prior: 5,
  /** The top of a rating, where the slider starts, and the rating that lights 325799 */
  max: 800,
  start: 400,
  meme: 799,
  /** Papers a player may put on the board a site day (each replaces the last) */
  publishesPerDay: 5,
  /** Papers to a page of the board */
  page: 20,
};

/**
 * A paper as the page sends it and the server keeps it: its squares, each its strokes, each its points one after
 * another, x then y, in thousandths of a square (0 to 1000 across and down; a stroke goes on off its square's edge, so
 * a little way outside that too). Flat whole numbers, half the bytes of points as { x, y }.
 */
export type Sheet = number[][][];

/**
 * How a paper is sent and kept: a point is kept at most off its square's edge by `off` (thousandths), and dropped
 * within `near` of the point kept before it; kept on the board, each stroke is simplified to within `simple`
 * (Ramer–Douglas–Peucker). The server takes no more than so many squares, strokes in a square and points in all, nor a
 * request of more than `bytes`.
 */
export const SHEET = { off: 500, near: 4, simple: 6, squares: WRITE_DIGITS.length, strokes: 30, points: 4000, bytes: 32 * 1024 };

/** How a paper is shown on the board: as 匿名舟P, or under the name its writer uses on the map */
export type Show = "anon" | "named";
export const isShow = (v: unknown): v is Show => v === "anon" || v === "named";

const thousandths = (v: number) => Math.max(-SHEET.off, Math.min(1000 + SHEET.off, Math.round(v * 1000)));

/**
 * The squares' strokes as they are sent (Sheet): each point to the nearest thousandth of a square, none further off
 * than SHEET.off, none within SHEET.near of the point kept before it. The page marks what it sends, so the server,
 * marking it again, finds what the page found.
 */
export function tidySheet(squares: readonly (readonly Stroke[])[]): Sheet {
  return squares.map((strokes) =>
    strokes.flatMap((s) => {
      const out: number[] = [];
      for (const p of s) {
        const x = thousandths(p.x);
        const y = thousandths(p.y);
        const n = out.length;
        if (n && Math.hypot(x - out[n - 2], y - out[n - 1]) < SHEET.near) continue;
        out.push(x, y);
      }
      return out.length ? [out] : [];
    }),
  );
}

/** A paper's strokes in copybook units again, for marking and drawing */
export function strokesOf(sheet: Sheet): Stroke[][] {
  return sheet.map((square) =>
    square.map((s) => {
      const pts = [];
      for (let i = 0; i + 1 < s.length; i += 2) pts.push({ x: s[i] / 1000, y: s[i + 1] / 1000 });
      return pts;
    }),
  );
}

/** A paper marked as 交卷 marks it (write325.ts markPaper): its average mark, and whether it passed (60 or more, every square read right) */
export function markSheet(sheet: Sheet): { mark: number; passed: boolean } {
  const m = markPaper(strokesOf(sheet));
  return { mark: m.mark, passed: m.word !== "ghost" };
}

/**
 * A paper as sent, read: the Sheet, "big" when it is one but more than SHEET takes (squares, strokes in a square,
 * points in all), or null when it is none (a point not whole, too far off, a stroke without points or with half a one)
 */
export function readSheet(v: unknown): Sheet | "big" | null {
  if (!Array.isArray(v)) return null;
  if (v.length > SHEET.squares) return "big";
  let points = 0;
  for (const square of v) {
    if (!Array.isArray(square)) return null;
    if (square.length > SHEET.strokes) return "big";
    for (const s of square) {
      if (!Array.isArray(s) || s.length < 2 || s.length % 2) return null;
      points += s.length / 2;
      if (points > SHEET.points) return "big";
      for (const c of s) if (!Number.isInteger(c) || c < -SHEET.off || c > 1000 + SHEET.off) return null;
    }
  }
  return v as Sheet;
}

/** How far point i of a flat stroke is from the line between points a and b (its ends, where they are one point) */
function offLine(s: readonly number[], i: number, a: number, b: number) {
  const [x, y, ax, ay, bx, by] = [s[2 * i], s[2 * i + 1], s[2 * a], s[2 * a + 1], s[2 * b], s[2 * b + 1]];
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** A flat stroke simplified (Ramer–Douglas–Peucker): its ends, and between them only the points further than tol off the line the others make */
function simplifyStroke(s: readonly number[], tol: number): number[] {
  const n = s.length / 2;
  if (n <= 2) return [...s];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const todo: [number, number][] = [[0, n - 1]];
  while (todo.length) {
    const [a, b] = todo.pop()!;
    let far = -1;
    let most = tol;
    for (let i = a + 1; i < b; i++) {
      const d = offLine(s, i, a, b);
      if (d > most) {
        most = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    todo.push([a, far], [far, b]);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(s[2 * i], s[2 * i + 1]);
  return out;
}

/** A paper as the board keeps it: every stroke simplified to within SHEET.simple, about a kilobyte for the three squares */
export const simplified = (sheet: Sheet): Sheet => sheet.map((square) => square.map((s) => simplifyStroke(s, SHEET.simple)));

/** Whether a rating is one: a whole number from 0 to BOARD.max */
export const isScore = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= BOARD.max;

/** The site's average rating from all ratings' sum and how many there are: BOARD.start until anyone has rated */
export const averageOf = (sum: number, n: number) => (n > 0 ? sum / n : BOARD.start);

/** A paper's score: the average of its ratings, pulled toward the site's (average) as if BOARD.prior more had rated it that */
export const scoreOf = (sum: number, n: number, average: number) => Math.round((BOARD.prior * average + sum) / (BOARD.prior + n));

/** A paper as the board ranks it: its score, how many rated it and how many gave 799, and when it was put up (ms) */
export type Ranked = { id: string; score: number; n: number; n799: number; at: number };

/** Which of two papers stands higher: the higher score, then the more raters, then the one put up first */
export const before = (a: Ranked, b: Ranked) => b.score - a.score || b.n - a.n || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A paper's counts as kept, for ranking it */
export type Counted = { id: string; n: number; sum: number; n799: number; at: number };

/** The papers on the board, highest first: only those BOARD.minRaters or more have rated (the hidden are never given) */
export function rankPapers(papers: readonly Counted[], average: number): Ranked[] {
  return papers
    .filter((p) => p.n >= BOARD.minRaters)
    .map((p) => ({ id: p.id, score: scoreOf(p.sum, p.n, average), n: p.n, n799: p.n799, at: p.at }))
    .sort(before);
}

/** Where a paper stands among those ranked, 1 for the top: as if it were on the board, whether or not it is in it yet (or in it as it was) */
export function rankAmong(ranked: readonly Ranked[], p: Ranked): number {
  let higher = 0;
  for (const r of ranked) if (r.id !== p.id && before(r, p) < 0) higher++;
  return higher + 1;
}

/** Whether this player may rate now, and if not why: never passed 徒手写, signed up under 3 days ago, interactions paused (until then), today's ratings given, or a visitor */
export type RateState =
  | { can: true; left: number; skipsLeft: number }
  | { can: false; why: "pass" | "young" | "full" | "signIn" }
  | { can: false; why: "suspended"; until: number };

/** A row of the board: its place, the paper, its writer's name (null: 匿名舟P), its score, how many rated it and how many gave 799 */
export type BoardRow = { id: string; rank: number; sheet: Sheet; name: string | null; score: number; n: number; n799: number };

/**
 * The player's own paper, for the line under the board: its place (null while under BOARD.minRaters have rated it,
 * or hidden), its score, how many rated it and how many gave 799, and whether it is hidden while reports of it wait
 */
export type BoardMine = { id: string; rank: number | null; score: number; n: number; n799: number; hidden: boolean };

/**
 * A page of the board: its rows, which page of how many, the player's own paper (signed in, with one up), and whether
 * they may rate; while the board is paused, only their own paper (to take it down)
 */
export type BoardPage =
  | { paused: false; rows: BoardRow[]; page: number; pages: number; mine: BoardMine | null; rate: RateState }
  | { paused: true; mine: BoardMine | null };

/** A paper dealt to rate: which (to rate it by), and the paper; never whose */
export type Dealt = { id: string; sheet: Sheet };

/** What dealing, rating and skipping answer: the paper to rate next (null: none left to rate), and whether the player may rate on */
export type DealState = { deal: Dealt | null; rate: RateState };

/**
 * What a paper passed answers: the player's own on the board, if they have one (to say putting up this one replaces
 * it), how many more they may put up today, and whether the board is paused (nothing goes up meanwhile)
 */
export type Passed = { mine: BoardMine | null; publishesLeft: number; paused: boolean };

/** The code of a refusal while the owner has paused the 手写榜 (src/lib/server/siteSettings.ts) */
export const BOARD_PAUSED = "board_paused";
/** The code of a refusal for a paper not the one dealt (another tab, or it was hidden or taken down meanwhile): the page asks for the one to rate */
export const STALE_DEAL = "stale_deal";

/**
 * The 管理台's 手写榜 card (the owner's): what STUDY is (the board goes with 325大学习), whether it is paused, how many
 * papers are up, how many of them are on the board (rated by enough) and how many hidden while reports wait, and how
 * many ratings were given in all
 */
export type BoardDesk = { mode: "off" | "admins" | "on"; paused: boolean; papers: number; ranked: number; hidden: number; ratings: number };
