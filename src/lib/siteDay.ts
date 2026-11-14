import { beijingDate, beijingMidnight } from "./beijing";

/**
 * The site's own day for what a player may do so many times a day, turning at 04:00 Beijing time like the games'
 * daily reset (the hour players already expect things to come back at): a Beijing date, YYYY-MM-DD, that runs from
 * 04:00 that day to 04:00 the next. The same for everyone wherever they are, unlike deviceDay (src/lib/deviceDay.ts),
 * which follows each device's clock for what only that player sees.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The hour of the day, Beijing time, at which a new site day begins */
export const SITE_DAY_HOUR = 4;

/** The site day a moment falls in */
export function siteDay(now = Date.now()): string {
  return beijingDate(now - SITE_DAY_HOUR * HOUR);
}

/** The moment a site day begins: 04:00 Beijing time on its date */
export function siteDayStart(day: string): number {
  return beijingMidnight(day) + SITE_DAY_HOUR * HOUR;
}

/** The moment the next site day begins, after this one */
export function nextSiteDayAt(now = Date.now()): number {
  return siteDayStart(siteDay(now)) + DAY;
}
