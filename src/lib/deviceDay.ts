/**
 * Days and weeks by the player's device clock, turning at 04:00 like the games'
 * daily reset. offsetMin is the device's Date.getTimezoneOffset(), kept within
 * ±14 hours and never stored; Beijing time without one. The server works these
 * out from the offset the page sends, the page from its own clock.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_OFFSET_MIN = 14 * 60;

/** The day: its date, and the moment it began. */
export function deviceDay(offsetMin: unknown, now = Date.now()) {
  const n = Number(offsetMin);
  const offset = Number.isFinite(n) ? Math.max(-MAX_OFFSET_MIN, Math.min(MAX_OFFSET_MIN, Math.round(n))) : -480;
  const shift = -offset * 60_000;
  const day = new Date(now + shift - 4 * HOUR).toISOString().slice(0, 10);
  return { day, start: Date.parse(`${day}T04:00:00Z`) - shift };
}

/** The week, from Monday 04:00: when this one began, and the one before. An hour off across a clock change does not matter. */
export function deviceWeek(offsetMin: unknown, now = Date.now()) {
  const { day, start } = deviceDay(offsetMin, now);
  const monday = start - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) * DAY;
  return { start: monday, prevStart: monday - 7 * DAY };
}

/** Whole days from one date (YYYY-MM-DD) to another */
export const daysFromTo = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
