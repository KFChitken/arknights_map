/**
 * How the change log (src/lib/changelog.ts) is shown on the notice board's second tab: each row numbered
 * from the oldest, the rows by day with runs of the vague ones folded into one, and a square for every
 * day since the site opened. The rows come in as they are, so the page downloads them only when shown.
 */
import { addDays, beijingDate, daysBetween } from "./beijing";
import type { ChangeKind, ChangeRow } from "./changelog";

/** The kinds, in the order the filters show them */
export const KINDS: readonly ChangeKind[] = ["new", "better", "fix", "tweak", "chore"];

/** A filter: every row, or one kind */
export type KindPick = ChangeKind | "all";

/** Days drawn at first, and again each time the list nears its end */
export const DAYS_AT_A_TIME = 14;

/** A line as shown: one change, or a run of vague ones folded together, numbered lo to hi (equal for one) */
export type LogLine = { lo: number; hi: number; kind: ChangeKind; text: string; vague: boolean };

/** A day: its lines, newest first; count is how many of its changes they hold (with a filter, of that kind) */
export type LogDay = { date: string; opening: boolean; count: number; lines: LogLine[] };

/** A day's square: how many changes it had, and how dark it is drawn (0 for none to 4 for 30 or more) */
export type Square = { date: string; n: number; level: 0 | 1 | 2 | 3 | 4 };

/**
 * One of the rows written to say little, which are greyed and folded when they come in a run: what
 * changed behind the scenes, and what changed that we keep vague (changelog.test.ts holds the rows to
 * those words)
 */
export const isVague = (r: ChangeRow) => r.kind === "chore" || r.text === "一些小改动";

/** The day the site opened: the oldest row's */
export const openingDay = (rows: readonly ChangeRow[]) => rows[rows.length - 1].date;

/** Today in Beijing, as this device's clock has it; never before the newest row, for a clock that is behind */
export function logToday(rows: readonly ChangeRow[], now = Date.now()) {
  const today = beijingDate(now);
  return today < rows[0].date ? rows[0].date : today;
}

/** The count at the top: every change, the days since the site opened (both ends counted), the changes of the last 7 days */
export function logTotals(rows: readonly ChangeRow[], today: string) {
  return {
    total: rows.length,
    daysOpen: daysBetween(openingDay(rows), today) + 1,
    lastWeek: rows.filter((r) => r.date <= today && daysBetween(r.date, today) < 7).length,
  };
}

/** How many rows there are of each kind, and of all */
export function kindCounts(rows: readonly ChangeRow[]): Record<KindPick, number> {
  const counts: Record<KindPick, number> = { all: rows.length, new: 0, better: 0, fix: 0, tweak: 0, chore: 0 };
  for (const r of rows) counts[r.kind]++;
  return counts;
}

const levelOf = (n: number): Square["level"] => (n === 0 ? 0 : n < 5 ? 1 : n < 15 ? 2 : n < 30 ? 3 : 4);

/** A square for every day from the site's first to today, today last */
export function logSquares(rows: readonly ChangeRow[], today: string): Square[] {
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
  const squares: Square[] = [];
  for (let date = openingDay(rows); date <= today; date = addDays(date, 1)) {
    const n = perDay.get(date) ?? 0;
    squares.push({ date, n, level: levelOf(n) });
  }
  return squares;
}

/**
 * The rows by day, newest first, each numbered from the oldest (#1) so a row keeps its number as new ones
 * go on top. Vague rows next to each other, of the same words and numbers in a row, become one line; a
 * filter keeps only its kind, and a day left with none is left out.
 */
export function logDays(rows: readonly ChangeRow[], pick: KindPick = "all"): LogDay[] {
  const first = openingDay(rows);
  const days: LogDay[] = [];
  rows.forEach((r, i) => {
    if (pick !== "all" && r.kind !== pick) return;
    const n = rows.length - i;
    let day = days[days.length - 1];
    if (day?.date !== r.date) days.push((day = { date: r.date, opening: r.date === first, count: 0, lines: [] }));
    day.count++;
    const vague = isVague(r);
    const last = day.lines[day.lines.length - 1];
    if (vague && last?.vague && last.kind === r.kind && last.text === r.text && last.lo === n + 1) last.lo = n;
    else day.lines.push({ lo: n, hi: n, kind: r.kind, text: r.text, vague });
  });
  return days;
}

/** A Beijing date (YYYY-MM-DD) as its month, day and day of the week (0 for Sunday), which the date itself gives */
export function dateParts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
