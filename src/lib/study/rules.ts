import type { PassesDot } from "../passes";
import { siteDayStart } from "../siteDay";

/**
 * 325大学习: a course a site day for each player (courses.ts, draw.ts), counted as studied once a round of it is won, or
 * given up after GIVE_UP_AFTER rounds of it lost; then any course may be played, which adds nothing. Site days studied
 * add up, at most one a day, and never go down (src/lib/server/study.ts). Each round is dealt afresh from a seed of its
 * own. The rules both sides go by.
 */

const DAY = 86_400_000;

/** The days studied that each bring a seal, in order */
export const SEALS = [7, 14, 30, 90, 180, 325] as const;

/** After this many rounds of the day's course lost, it may be given up, and the day counts as studied all the same */
export const GIVE_UP_AFTER = 5;

/** The next seal to study for: which one it is (from 1) and how many days are left to it; null with all of them */
export function nextSeal(days: number): { k: number; left: number } | null {
  const i = SEALS.findIndex((n) => days < n);
  return i < 0 ? null : { k: i + 1, left: SEALS[i] - days };
}

/**
 * What the map page knows of a signed-in player's 325大学习 (me.study): the site day the server spoke of, whether that
 * day's course was passed (or given up), the days studied, and the rounds of that day's course lost
 */
export type StudyMe = { day: string; done: boolean; days: number; fails: number };

/**
 * The day's course, as POST /api/study/today answers: drawn then, unless it was before (a course a page may not know
 * yet); whether it was given up rather than passed; whether the player may pick any course to play (the 站长 and the
 * admins), where everyone else is dealt one at random once today's is done; and whether 已完成今日的325大学习 was said
 * today
 */
export type StudyToday = StudyMe & { course: string; skipped: boolean; pick: boolean; announced: boolean };

/** What became of a declaration 325大学习 sent: how far it reached (world.ts reachText), or why it was not sent */
export type StudySaid = { reach: string } | { failed: string };

/**
 * The answer to a round of the day's course played (POST /api/study/done) or given up (POST /api/study/giveup); the
 * time it was given up, what became of 苦也！ (said), and the 每日任务 dot it may have lit (src/lib/passes.ts)
 */
export type StudyDone = { done: boolean; days: number; fails: number; skipped: boolean; said?: StudySaid } & PassesDot;

/** The answer to 已完成今日的325大学习 said (POST /api/study/announce): how far it reached */
export type StudyAnnounced = { reach: string } & PassesDot;
/** The code of the refusal for a course that is not today's (409), which brings today's along (src/lib/studyClient.ts) */
export const NOT_TODAY = "notToday";
/** The code of the refusal to give up before GIVE_UP_AFTER rounds lost (409), which brings today's along */
export const NOT_YET = "notYet";

/** Whether the day the page was told of is still today, by this device's clock: done stops counting at 04:00 Beijing time */
export const sameDay = (day: string, now = Date.now()) => now < siteDayStart(day) + DAY;

/** Whether today's course was passed or given up, as far as the page knows */
export const studiedNow = (s: Pick<StudyMe, "day" | "done">, now = Date.now()) => s.done && sameDay(s.day, now);

/** Which of n 今日知识点 a site day shows: the same for everyone, one after the other */
export function factIndex(day: string, n: number) {
  const d = Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);
  return ((d % n) + n) % n;
}

/** A seed for a round, which deals its numbers (src/lib/prng.ts mulberry32): another every round */
export const newSeed = () => Math.floor(Math.random() * 2 ** 32);
