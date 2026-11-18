import "server-only";
import { and, eq, gte, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { siteDay, siteDayStart } from "../siteDay";
import { coursesFor, isCourse } from "../study/courses";
import { drawCourse } from "../study/draw";
import type { PassesDot } from "../passes";
import { GIVE_UP_AFTER, NOT_TODAY, NOT_YET, type StudyDone, type StudyMe, type StudySaid, type StudyToday } from "../study/rules";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { studyMode } from "./env";
import { HttpError } from "./http";
import { declarations, users, type UserRow } from "./schema";

/**
 * 325大学习 (src/lib/study): each player's course of the site day (src/lib/siteDay.ts, from 04:00 Beijing time), drawn
 * the first time they open it that day (today); the rounds of it lost (done, won: false), and the days studied, one a
 * site day at most, counted by a round of that day's course won (done), or by giving it up once GIVE_UP_AFTER rounds
 * of it are lost (giveUp). Nothing else is kept: how a round went stays on the player's page, and no one else learns
 * whether they studied, unless they say so in one of its two declarations (studySay.ts). Switched by STUDY (env.ts).
 */

/** Whether this player may study: everyone (on), the 站长 and the admins (admins), or nobody (off) */
export function studyOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = studyMode();
  return mode === "on" || (mode === "admins" && mayPick(user));
}

/** Whether this player may pick any course to play, today's not done yet as well: the 站长 and the admins, whatever STUDY is */
const mayPick = (user: Pick<UserRow, "id" | "email">) => isOwnerEmail(user.email) || isModHere(user.id);

/** What me() carries for the way in (its dot) and the days studied: undefined when the player may not study */
export function studyMe(user: UserRow, now = Date.now()): StudyMe | undefined {
  if (!studyOpen(user)) return undefined;
  const day = siteDay(now);
  return { day, done: user.studiedOn === day, days: user.studyDays, fails: user.studyCourseOn === day ? user.studyFails : 0 };
}

const STUDY_COLUMNS = {
  course: users.studyCourse,
  courseOn: users.studyCourseOn,
  studiedOn: users.studiedOn,
  days: users.studyDays,
  fails: users.studyFails,
  skippedOn: users.studySkippedOn,
};

type Kept = { course: string | null; courseOn: string | null; studiedOn: string | null; days: number; fails: number; skippedOn: string | null };

/**
 * The player's course today, drawn now if it was not yet (drawCourse, from those not drawn this round, never the last
 * one), with none of its rounds lost yet: of every course for one who may pick, of those not held back (courses.ts
 * HELD) for anyone else. Two asks at once draw one course: the write only takes while today's is not drawn, and the
 * other then reads it. A course stored that this server no longer has is drawn again, and so is one held back from a
 * player who may not pick. Once it is done, whether 已完成今日的325大学习 was said today as well.
 */
export async function studyToday(user: Pick<UserRow, "id" | "email">, now = Date.now(), random: () => number = Math.random): Promise<StudyToday> {
  const t = await drawnToday(user, now, random);
  return t.done ? { ...t, announced: await announcedOn(user.id, t.day) } : t;
}

async function drawnToday(user: Pick<UserRow, "id" | "email">, now: number, random: () => number): Promise<StudyToday> {
  const day = siteDay(now);
  const pick = mayPick(user);
  const courses = coursesFor(pick);
  const [u] = await db.select({ ...STUDY_COLUMNS, bag: users.studyBag }).from(users).where(eq(users.id, user.id));
  if (!u) throw new HttpError(401, T.server.common.signIn);
  if (u.courseOn === day && isCourse(u.course) && courses.includes(u.course)) return todayOf(u, day, pick);
  const { course, bag } = drawCourse({ bag: u.bag, last: u.course }, courses, random);
  const [drawn] = await db
    .update(users)
    .set({ studyCourse: course, studyCourseOn: day, studyBag: bag, studyFails: 0 })
    .where(
      and(
        eq(users.id, user.id),
        or(isNull(users.studyCourseOn), ne(users.studyCourseOn, day), isNull(users.studyCourse), notInArray(users.studyCourse, [...courses])),
      ),
    )
    .returning(STUDY_COLUMNS);
  if (drawn) return todayOf(drawn, day, pick);
  const [other] = await db.select(STUDY_COLUMNS).from(users).where(eq(users.id, user.id));
  return todayOf(other, day, pick);
}

function todayOf(u: Kept, day: string, pick: boolean): StudyToday {
  const drawnToday = u.courseOn === day;
  return {
    day,
    course: u.course ?? "",
    done: u.studiedOn === day,
    days: u.days,
    fails: drawnToday ? u.fails : 0,
    skipped: u.skippedOn === day,
    pick,
    announced: false,
  };
}

/** Whether the player said 已完成今日的325大学习 on that site day: once a day at most (studySay.ts) */
export async function announcedOn(userId: string, day: string): Promise<boolean> {
  const [said] = await db
    .select({ id: declarations.id })
    .from(declarations)
    .where(and(eq(declarations.senderId, userId), eq(declarations.template, "studied"), gte(declarations.createdAt, new Date(siteDayStart(day)))))
    .limit(1);
  return Boolean(said);
}

/** Today's course, the site day it is, and whether `course` is it: what a round or giving up is checked against */
const todays = (course: string, day: string) => and(eq(users.studyCourse, course), eq(users.studyCourseOn, day));

/** One more site day studied, unless today was counted already */
const countToday = (day: string) => ({
  studyDays: sql`case when ${users.studiedOn} = ${day} then ${users.studyDays} else ${users.studyDays} + 1 end`,
  studiedOn: day,
});

const DONE_COLUMNS = { days: users.studyDays, fails: users.studyFails, studiedOn: users.studiedOn, skippedOn: users.studySkippedOn };

/** What a round or giving up answers: today passed or given up, the days studied, the rounds lost, and whether it was given up */
const doneOf = (u: { days: number; fails: number; studiedOn: string | null; skippedOn: string | null }, day: string): StudyDone => ({
  done: u.studiedOn === day,
  days: u.days,
  fails: u.fails,
  skipped: u.skippedOn === day,
});

/**
 * A round of the day's course played. Won: a site day studied, the first time today (another round adds nothing). Lost:
 * one more round of it lost, until today is counted. A page that does not say (one from before rounds were lost) won.
 * Any other course, or yesterday's course after 04:00, is refused (409) with today's, which the page then shows.
 */
export async function studyDone(user: Pick<UserRow, "id" | "email">, course: unknown, won: unknown = true, now = Date.now()): Promise<StudyDone> {
  if (!isCourse(course)) throw new HttpError(400, T.server.study.badCourse);
  const day = siteDay(now);
  const set =
    won === false ? { studyFails: sql`case when ${users.studiedOn} = ${day} then ${users.studyFails} else ${users.studyFails} + 1 end` } : countToday(day);
  const [u] = await db
    .update(users)
    .set(set)
    .where(and(eq(users.id, user.id), todays(course, day)))
    .returning(DONE_COLUMNS);
  if (u) return doneOf(u, day);
  throw new HttpError(409, T.server.study.notToday, NOT_TODAY, { today: await studyToday(user, now) });
}

/**
 * The day's course given up, once GIVE_UP_AFTER rounds of it are lost: a site day studied as a round won would. Then,
 * and only then, saying is asked to say 苦也！ (studySay.ts), whose answer comes along. Passed or given up already
 * today, it is as it was. Before GIVE_UP_AFTER it is refused (409) with today's; any other course, or yesterday's, as
 * done refuses it.
 */
export async function studyGiveUp(
  user: Pick<UserRow, "id" | "email">,
  course: unknown,
  now = Date.now(),
  saying?: () => Promise<{ said: StudySaid } & PassesDot>,
): Promise<StudyDone & PassesDot> {
  if (!isCourse(course)) throw new HttpError(400, T.server.study.badCourse);
  const day = siteDay(now);
  const [u] = await db
    .update(users)
    .set({ studyDays: sql`${users.studyDays} + 1`, studiedOn: day, studySkippedOn: day })
    .where(
      and(
        eq(users.id, user.id),
        todays(course, day),
        gte(users.studyFails, GIVE_UP_AFTER),
        or(isNull(users.studiedOn), ne(users.studiedOn, day)),
      ),
    )
    .returning(DONE_COLUMNS);
  if (u) return saying ? { ...doneOf(u, day), ...(await saying()) } : doneOf(u, day);
  const [k] = await db
    .select({ ...DONE_COLUMNS, course: users.studyCourse, courseOn: users.studyCourseOn })
    .from(users)
    .where(eq(users.id, user.id));
  if (k && k.course === course && k.courseOn === day && k.studiedOn === day) return doneOf(k, day);
  const today = await studyToday(user, now);
  if (today.course !== course) throw new HttpError(409, T.server.study.notToday, NOT_TODAY, { today });
  throw new HttpError(409, fmt(T.server.study.notYet, { n: GIVE_UP_AFTER }), NOT_YET, { today });
}
