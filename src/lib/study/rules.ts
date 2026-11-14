import { hash128, mulberry32 } from "../prng";
import { siteDayStart } from "../siteDay";

/**
 * 325大学习: a course a site day for each player (courses.ts, draw.ts), counted as studied once a round of it is played,
 * won or lost; then any course may be played, which adds nothing. Site days studied add up, at most one a day, and never
 * go down (src/lib/server/study.ts). The rules both sides go by.
 */

const DAY = 86_400_000;

/** The days studied that each bring a seal, in order */
export const SEALS = [7, 14, 30, 90, 180, 325] as const;

/** The next seal to study for: which one it is (from 1) and how many days are left to it; null with all of them */
export function nextSeal(days: number): { k: number; left: number } | null {
  const i = SEALS.findIndex((n) => days < n);
  return i < 0 ? null : { k: i + 1, left: SEALS[i] - days };
}

/**
 * What the map page knows of a signed-in player's 325大学习 (me.study): the site day the server spoke of, whether a
 * round of that day's course was played, and the days studied
 */
export type StudyMe = { day: string; done: boolean; days: number };

/** The day's course, as POST /api/study/today answers: drawn then, unless it was before. A course a page may not know yet */
export type StudyToday = StudyMe & { course: string };

/** The answer to a round of the day's course played (POST /api/study/done) */
export type StudyDone = { done: true; days: number };
/** The code of its refusal for a course that is not today's (409), which brings today's along (src/lib/studyClient.ts) */
export const NOT_TODAY = "notToday";

/** Whether the day the page was told of is still today, by this device's clock: done stops counting at 04:00 Beijing time */
export const sameDay = (day: string, now = Date.now()) => now < siteDayStart(day) + DAY;

/** Whether today's course was played, as far as the page knows */
export const studiedNow = (s: Pick<StudyMe, "day" | "done">, now = Date.now()) => s.done && sameDay(s.day, now);

/** Which of n 今日知识点 a site day shows: the same for everyone, one after the other */
export function factIndex(day: string, n: number) {
  const d = Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);
  return ((d % n) + n) % n;
}

/** A course's numbers for a site day, the same for everyone who plays it that day (今天的卷子): a random from 0 up to 1 */
export const dayRandom = (course: string, day: string) => mulberry32(hash128(`${course}:${day}`)[0]);
