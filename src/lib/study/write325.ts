/**
 * 徒手写 325, a course of 325大学习 (src/components/app/study/Write325.tsx draws it): no dashed lines, the player writes
 * 3, 2 and 5 freehand in three copybook squares, and each is read on the device itself with the $P point-cloud
 * recognizer (Vatavu, Anthony and Wobbrock, "Gestures as point clouds", 2012): the strokes walked into WRITE.points
 * points, scaled into a unit square and moved to their middle, then matched against a few ways of writing each of the
 * digits 0 to 9 (DIGITS, written here), the nearer the better. Nothing written leaves the page.
 *
 * Everything here is pure. Places are in copybook units: a square is 0 to 1 across, and 0 to 1 down.
 */

/**
 * How it is marked, all in one place: after Breeze has played it, only these change. A square is read as the digit it
 * is for when that digit's nearest way of writing it is the nearest of all, or no further than near times it. A
 * square's mark goes from 100, at a $P distance of full or less, down to 0 at none or more; the marks' average, all
 * three read right and none under pass, gives the word for it. A scribbled square (scribbled) is read as no digit.
 */
export const WRITE = {
  /** How many points a square's strokes are walked into */
  points: 32,
  /** A digit's distance no more than so many times the nearest still reads as it */
  near: 1.15,
  /** The distances that mark 100 and 0 */
  full: 0.5,
  none: 5,
  /** Averages from which 字迹工整, 还挺像 and 医生体 are given; a square under pass, or read as another, is 鬼画符 */
  neat: 90,
  like: 75,
  pass: 60,
  /** Strokes in a square this long in all (copybook units) and it is written; a stroke shorter than dot is left out */
  ink: 0.25,
  dot: 0.02,
  /**
   * A square is scribbled when its strokes, steadied (scribbled), turn back by more than sharpTurn degrees sharp times
   * or more (a zigzag), or are more than scrawl times as long as they are big (hatching, a spiral, a digit gone over
   * and over); they are steadied over a sixteenth of their size, and never less than steady
   */
  sharp: 4,
  sharpTurn: 110,
  scrawl: 5.5,
  steady: 0.02,
};

/** What is written, in the order of the squares */
export const WRITE_DIGITS = [3, 2, 5] as const;

export type Pt = { x: number; y: number };
/** A stroke: the points the pen went through, in order */
export type Stroke = readonly Pt[];

/** The word a round's marks give, best first; ghost does not pass */
export type Word = "neat" | "like" | "doctor" | "ghost";

/** Points along an ellipse round cx, cy from angle a0 to a1 (degrees; 0 to the right, 90 down) */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 6));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

/** Points along a cubic Bézier curve from a to d, pulled towards b and c */
function bez(a: Pt, b: Pt, c: Pt, d: Pt): Pt[] {
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
      y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
    };
  });
}

const p = (x: number, y: number): Pt => ({ x, y });
const line = (x0: number, y0: number, x1: number, y1: number): Pt[] => [p(x0, y0), p(x1, y1)];
/** A stroke through the parts, one after the other */
const st = (...parts: Pt[][]): Stroke => parts.flat();
/** Leaning right by k (a top k of the square further right than its bottom) */
const lean = (k: number, strokes: Stroke[]): Stroke[] => strokes.map((s) => s.map((q) => p(q.x + (0.5 - q.y) * k, q.y)));
/** A stroke and a bowl after it: an arc of an ellipse rx by ry from angle a0 to a1, begun where the stroke ends */
function bowl(s: readonly Pt[], rx: number, ry: number, a0: number, a1: number): Stroke {
  const q = s[s.length - 1];
  const a = (a0 * Math.PI) / 180;
  return [...s, ...arc(q.x - rx * Math.cos(a), q.y - ry * Math.sin(a), rx, ry, a0, a1)];
}

/**
 * Ways of writing each digit, as they are written in a copybook square: a 2 with and without a loop at its foot, a 3
 * round or flat at the top, a 5 in one stroke or two, a 7 with and without a bar, and so on.
 */
export const DIGITS: Readonly<Record<number, readonly (readonly Stroke[])[]>> = {
  0: [
    [st(arc(0.5, 0.5, 0.2, 0.36, -90, 270))],
    [st(arc(0.5, 0.5, 0.26, 0.34, -100, 275))],
    lean(0.18, [st(arc(0.5, 0.5, 0.17, 0.36, -90, 270))]),
  ],
  1: [
    [st(line(0.5, 0.12, 0.5, 0.88))],
    [st(line(0.37, 0.27, 0.53, 0.12), line(0.53, 0.12, 0.53, 0.88))],
    [st(line(0.57, 0.12, 0.45, 0.88))],
  ],
  2: [
    [st(arc(0.5, 0.31, 0.19, 0.18, 195, 390), line(0.665, 0.4, 0.29, 0.87), line(0.29, 0.87, 0.73, 0.87))],
    [st(arc(0.5, 0.28, 0.2, 0.13, 200, 365), line(0.7, 0.3, 0.3, 0.86), line(0.3, 0.86, 0.73, 0.86))],
    [st(arc(0.5, 0.3, 0.2, 0.18, 190, 375), bez(p(0.69, 0.35), p(0.69, 0.55), p(0.42, 0.7), p(0.3, 0.84)), bez(p(0.3, 0.84), p(0.24, 0.92), p(0.38, 0.95), p(0.42, 0.86)), line(0.42, 0.86, 0.75, 0.86))],
    [st(arc(0.5, 0.31, 0.2, 0.19, 185, 380), bez(p(0.69, 0.37), p(0.66, 0.6), p(0.3, 0.7), p(0.28, 0.86)), bez(p(0.28, 0.86), p(0.45, 0.83), p(0.6, 0.88), p(0.74, 0.86)))],
  ],
  3: [
    [st(arc(0.5, 0.3, 0.19, 0.18, 200, 470), arc(0.5, 0.68, 0.21, 0.21, 250, 510))],
    [bowl(st(line(0.3, 0.15, 0.7, 0.14), line(0.7, 0.14, 0.5, 0.42)), 0.21, 0.22, 250, 510)],
    [st(arc(0.5, 0.27, 0.17, 0.15, 200, 455), arc(0.5, 0.66, 0.23, 0.23, 245, 505))],
    lean(0.15, [st(arc(0.5, 0.3, 0.18, 0.18, 205, 460), arc(0.5, 0.69, 0.2, 0.2, 255, 505))]),
    [bowl(arc(0.52, 0.27, 0.15, 0.12, 205, 440), 0.22, 0.2, 245, 505)],
  ],
  4: [
    [st(line(0.55, 0.12, 0.27, 0.62), line(0.27, 0.62, 0.76, 0.62)), st(line(0.6, 0.35, 0.6, 0.88))],
    [st(line(0.33, 0.12, 0.3, 0.6), line(0.3, 0.6, 0.74, 0.6)), st(line(0.62, 0.12, 0.62, 0.88))],
    [st(line(0.62, 0.88, 0.62, 0.12), line(0.62, 0.12, 0.26, 0.64), line(0.26, 0.64, 0.76, 0.64))],
  ],
  5: [
    [st(line(0.36, 0.13, 0.352, 0.513), arc(0.5, 0.665, 0.209, 0.215, 225, 510)), st(line(0.36, 0.13, 0.7, 0.13))],
    [st(line(0.7, 0.13, 0.36, 0.13), line(0.36, 0.13, 0.34, 0.5), arc(0.5, 0.66, 0.21, 0.22, 220, 510))],
    [st(line(0.38, 0.14, 0.33, 0.48), arc(0.5, 0.67, 0.22, 0.2, 215, 505)), st(line(0.38, 0.14, 0.72, 0.12))],
    lean(0.15, [st(line(0.37, 0.14, 0.36, 0.5), arc(0.5, 0.67, 0.2, 0.2, 225, 505)), st(line(0.37, 0.14, 0.69, 0.14))]),
    [bowl(line(0.36, 0.14, 0.34, 0.43), 0.24, 0.22, 205, 525), st(line(0.36, 0.14, 0.7, 0.14))],
  ],
  6: [
    [st(bez(p(0.6, 0.13), p(0.42, 0.18), p(0.3, 0.42), p(0.3, 0.66)), arc(0.5, 0.68, 0.2, 0.19, 180, 540))],
    [st(line(0.6, 0.12, 0.33, 0.6), arc(0.5, 0.68, 0.19, 0.19, 200, 560))],
    [st(bez(p(0.62, 0.15), p(0.5, 0.1), p(0.3, 0.22), p(0.3, 0.55)), arc(0.5, 0.65, 0.2, 0.22, 180, 545))],
  ],
  7: [
    [st(line(0.28, 0.15, 0.72, 0.15), line(0.72, 0.15, 0.42, 0.88))],
    [st(line(0.28, 0.15, 0.72, 0.15), line(0.72, 0.15, 0.42, 0.88)), st(line(0.38, 0.5, 0.68, 0.5))],
    [st(line(0.28, 0.15, 0.72, 0.15), bez(p(0.72, 0.15), p(0.55, 0.4), p(0.48, 0.6), p(0.46, 0.88)))],
  ],
  8: [
    [st(arc(0.5, 0.3, 0.17, 0.17, 0, 360)), st(arc(0.5, 0.69, 0.21, 0.19, 0, 360))],
    [st(arc(0.5, 0.29, 0.15, 0.16, 0, 360)), st(arc(0.5, 0.68, 0.22, 0.21, 0, 360))],
    [
      st(
        bez(p(0.66, 0.2), p(0.6, 0.08), p(0.34, 0.1), p(0.35, 0.28)),
        bez(p(0.35, 0.28), p(0.36, 0.45), p(0.7, 0.5), p(0.7, 0.7)),
        bez(p(0.7, 0.7), p(0.7, 0.9), p(0.3, 0.92), p(0.3, 0.7)),
        bez(p(0.3, 0.7), p(0.3, 0.52), p(0.64, 0.42), p(0.66, 0.24)),
      ),
    ],
  ],
  9: [
    [st(arc(0.5, 0.32, 0.19, 0.18, 0, 360), line(0.69, 0.32, 0.66, 0.88))],
    [st(arc(0.5, 0.32, 0.19, 0.19, 0, 360), bez(p(0.69, 0.32), p(0.7, 0.6), p(0.6, 0.85), p(0.38, 0.86)))],
    lean(0.15, [st(arc(0.5, 0.31, 0.18, 0.18, 0, 360), line(0.68, 0.31, 0.65, 0.88))]),
  ],
};

type Pid = { x: number; y: number; id: number };

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** $P's resampling: the strokes walked into n points the same way apart, never across from one stroke to the next */
function resample(points: Pid[], n: number): Pid[] | null {
  let length = 0;
  for (let i = 1; i < points.length; i++) if (points[i].id === points[i - 1].id) length += dist(points[i - 1], points[i]);
  if (!(length > 1e-9)) return null;
  const step = length / (n - 1);
  const pts = points.slice();
  const out: Pid[] = [pts[0]];
  let walked = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id !== pts[i - 1].id) continue;
    const d = dist(pts[i - 1], pts[i]);
    if (walked + d >= step && d > 0) {
      const k = (step - walked) / d;
      const q = { x: pts[i - 1].x + k * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + k * (pts[i].y - pts[i - 1].y), id: pts[i].id };
      out.push(q);
      // q is where the walk goes on from
      pts.splice(i, 0, q);
      walked = 0;
    } else walked += d;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out.slice(0, n);
}

/**
 * A square's strokes as a point cloud for $P: walked into n points, scaled the same both ways into a unit square, and
 * moved so that their middle is at 0, 0. Strokes shorter than WRITE.dot are left out; null if nothing is left
 */
export function cloudOf(strokes: readonly Stroke[], n = WRITE.points): Pt[] | null {
  const kept = strokes.filter((s) => lengthOf(s) >= WRITE.dot);
  const pts = resample(
    kept.flatMap((s, id) => s.map((q) => ({ x: q.x, y: q.y, id }))),
    n,
  );
  if (!pts) return null;
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(size > 1e-9)) return null;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const scaled = pts.map((q) => ({ x: (q.x - x0) / size, y: (q.y - y0) / size }));
  const cx = scaled.reduce((a, q) => a + q.x, 0) / n;
  const cy = scaled.reduce((a, q) => a + q.y, 0) / n;
  return scaled.map((q) => ({ x: q.x - cx, y: q.y - cy }));
}

/** $P's distance from one cloud to another, matching from start on: the nearest point not yet matched, weighed less as it goes */
function cloudDistance(a: readonly Pt[], b: readonly Pt[], start: number): number {
  const n = a.length;
  const matched = new Array<boolean>(n).fill(false);
  let sum = 0;
  let i = start;
  do {
    let min = Infinity;
    let index = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = dist(a[i], b[j]);
      if (d < min) {
        min = d;
        index = j;
      }
    }
    matched[index] = true;
    sum += (1 - ((i - start + n) % n) / n) * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

/** $P's greedy match of two clouds of as many points: the least distance, starting from every √n-th point, both ways */
export function matchClouds(a: readonly Pt[], b: readonly Pt[]): number {
  const n = a.length;
  const step = Math.max(1, Math.floor(Math.sqrt(n)));
  let min = Infinity;
  for (let i = 0; i < n; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  return min;
}

/** The clouds of every way of writing every digit, made once */
const TEMPLATES: readonly { digit: number; cloud: Pt[] }[] = Object.entries(DIGITS).flatMap(([digit, ways]) =>
  ways.map((strokes) => ({ digit: Number(digit), cloud: cloudOf(strokes)! })),
);

/** How far a cloud is from each digit (its nearest way of writing it), nearest first */
export function distances(cloud: readonly Pt[]): { digit: number; d: number }[] {
  const best = new Map<number, number>();
  for (const t of TEMPLATES) best.set(t.digit, Math.min(best.get(t.digit) ?? Infinity, matchClouds(cloud, t.cloud)));
  return [...best].map(([digit, d]) => ({ digit, d })).sort((a, b) => a.d - b.d);
}

/** A square's mark for a distance from the digit it is for: 100 at WRITE.full or less, 0 at WRITE.none or more */
export const markOf = (d: number): number => Math.round(100 * Math.min(1, Math.max(0, (WRITE.none - d) / (WRITE.none - WRITE.full))));

/** What a square was read as */
export type Reading = {
  /** Read as the digit it is for */
  ok: boolean;
  /** The digit nearest of all, and how far the one it is for is */
  nearest: number;
  d: number;
  /** 0 to 100: by how far it is, and 0 when it is read as another digit */
  mark: number;
};

/**
 * A square judged by how far it is from each digit (nearest first): read as the digit it is for when that one is the
 * nearest of all, or no further than WRITE.near times the nearest, and then marked by how far it is
 */
export function judge(all: readonly { digit: number; d: number }[], digit: number): Reading {
  const mine = all.find((x) => x.digit === digit)!;
  const ok = all[0].digit === digit || mine.d <= WRITE.near * all[0].d;
  return { ok, nearest: all[0].digit, d: mine.d, mark: ok ? markOf(mine.d) : 0 };
}

/** A square read as the digit it is for or not (judge); null when no digit can be read in it: only dots, or scribbled */
export function readSquare(strokes: readonly Stroke[], digit: number): Reading | null {
  const cloud = cloudOf(strokes);
  return cloud && !scribbled(strokes) ? judge(distances(cloud), digit) : null;
}

/**
 * Whether a square's strokes are scribbled rather than a digit, which $P, reading only where the ink is, can take for
 * one. Each stroke is steadied first (steady), so that a shaking hand or screen does not count, then walked at a
 * sixteenth of their size: how many times it turns back by more than WRITE.sharpTurn degrees (from two steps before to
 * two steps after; a run of such turns counted once), and how long the strokes are for their size. 3, 2 and 5 written
 * by hand turn back so once or twice, seldom three times, and are two to three times as long as they are big
 */
export function scribbled(strokes: readonly Stroke[]): boolean {
  const kept = strokes.filter((s) => lengthOf(s) >= WRITE.dot);
  const all = kept.flat();
  if (!all.length) return false;
  const xs = all.map((q) => q.x);
  const ys = all.map((q) => q.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(size > 1e-9)) return false;
  const step = size / 16;
  let ink = 0;
  let sharp = 0;
  for (const s of steady(kept, Math.max(step, WRITE.steady))) {
    const pts: Pt[] = [s[0]];
    let carry = 0;
    for (let i = 1; i < s.length; i++) {
      let a = s[i - 1];
      const b = s[i];
      let d = dist(a, b);
      ink += d;
      while (carry + d >= step) {
        const k = (step - carry) / d;
        a = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        pts.push(a);
        d = dist(a, b);
        carry = 0;
      }
      carry += d;
    }
    let turning = false;
    for (let i = 2; i + 2 < pts.length; i++) {
      const ux = pts[i].x - pts[i - 2].x;
      const uy = pts[i].y - pts[i - 2].y;
      const vx = pts[i + 2].x - pts[i].x;
      const vy = pts[i + 2].y - pts[i].y;
      const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
      const sharpNow = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI > WRITE.sharpTurn;
      if (sharpNow && !turning) sharp++;
      turning = sharpNow;
    }
  }
  return sharp >= WRITE.sharp || ink / size > WRITE.scrawl;
}

/**
 * Strokes steadied: each walked finely, then taken in runs, a run ending once it is tol from where it began and the
 * next beginning there, and every run put as its middle. A shake much smaller than tol is evened out
 */
function steady(strokes: readonly Stroke[], tol: number): Pt[][] {
  return strokes.map((s) => {
    const out: Pt[] = [];
    let run: Pt[] = [s[0]];
    const middle = () => out.push({ x: run.reduce((a, q) => a + q.x, 0) / run.length, y: run.reduce((a, q) => a + q.y, 0) / run.length });
    for (let i = 1; i < s.length; i++) {
      const k = Math.max(1, Math.ceil(dist(s[i - 1], s[i]) / (tol / 4)));
      for (let j = 1; j <= k; j++) {
        const q = { x: s[i - 1].x + ((s[i].x - s[i - 1].x) * j) / k, y: s[i - 1].y + ((s[i].y - s[i - 1].y) * j) / k };
        run.push(q);
        if (dist(q, run[0]) >= tol) {
          middle();
          run = [q];
        }
      }
    }
    if (run.length > 1 || !out.length) middle();
    return out;
  });
}

/** How long a stroke is (copybook units) */
export function lengthOf(s: Stroke): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) n += dist(s[i - 1], s[i]);
  return n;
}

/** Whether a square is written: its strokes WRITE.ink long or more in all */
export const written = (strokes: readonly Stroke[]): boolean => strokes.reduce((a, s) => a + lengthOf(s), 0) >= WRITE.ink;

/** Whether the paper can be handed in: every square written */
export const canHandIn = (squares: readonly (readonly Stroke[])[]): boolean => squares.length === WRITE_DIGITS.length && squares.every(written);

/**
 * The round marked: each square read (null, not read at all), the average of the marks (rounded) and the word for it;
 * a square not read as its digit, or marked under WRITE.pass, makes it 鬼画符
 */
export function markPaper(squares: readonly (readonly Stroke[])[]): { readings: (Reading | null)[]; mark: number; word: Word } {
  const readings = WRITE_DIGITS.map((digit, i) => readSquare(squares[i] ?? [], digit));
  const mark = Math.round(readings.reduce((a, r) => a + (r?.mark ?? 0), 0) / WRITE_DIGITS.length);
  return { readings, mark, word: wordOf(readings, mark) };
}

/** The word for the readings and their average mark */
export function wordOf(readings: readonly (Reading | null)[], mark: number): Word {
  if (readings.some((r) => !r || !r.ok || r.mark < WRITE.pass)) return "ghost";
  return mark >= WRITE.neat ? "neat" : mark >= WRITE.like ? "like" : mark >= WRITE.pass ? "doctor" : "ghost";
}
