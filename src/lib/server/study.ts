import "server-only";
import { and, eq, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { T } from "@/i18n";
import { siteDay } from "../siteDay";
import { COURSE_IDS, isCourse } from "../study/courses";
import { drawCourse } from "../study/draw";
import { NOT_TODAY, type StudyDone, type StudyMe, type StudyToday } from "../study/rules";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { studyMode } from "./env";
import { HttpError } from "./http";
import { users, type UserRow } from "./schema";

/**
 * 325大学习 (src/lib/study): each player's course of the site day (src/lib/siteDay.ts, from 04:00 Beijing time), drawn
 * the first time they open it that day (today), and the days they studied, one a site day at most, counted by a round of
 * that day's course played, won or lost (done). Nothing else is kept: how a round went stays on the player's page, and
 * no one else learns whether they studied. Switched by STUDY (env.ts).
 */

/** Whether this player may study: everyone (on), the 站长 and the admins (admins), or nobody (off) */
export function studyOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = studyMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/** What me() carries for the way in (its dot) and the days studied: undefined when the player may not study */
export function studyMe(user: UserRow, now = Date.now()): StudyMe | undefined {
  if (!studyOpen(user)) return undefined;
  const day = siteDay(now);
  return { day, done: user.studiedOn === day, days: user.studyDays };
}

const STUDY_COLUMNS = { course: users.studyCourse, courseOn: users.studyCourseOn, studiedOn: users.studiedOn, days: users.studyDays };

/**
 * The player's course today, drawn now if it was not yet (drawCourse, from those not drawn this round, never the last
 * one). Two asks at once draw one course: the write only takes while today's is not drawn, and the other then reads it.
 * A course stored that this server no longer has is drawn again.
 */
export async function studyToday(user: Pick<UserRow, "id">, now = Date.now(), random: () => number = Math.random): Promise<StudyToday> {
  const day = siteDay(now);
  const [u] = await db.select({ ...STUDY_COLUMNS, bag: users.studyBag }).from(users).where(eq(users.id, user.id));
  if (!u) throw new HttpError(401, T.server.common.signIn);
  if (u.courseOn === day && isCourse(u.course)) return todayOf(u, day);
  const { course, bag } = drawCourse({ bag: u.bag, last: u.course }, COURSE_IDS, random);
  const [drawn] = await db
    .update(users)
    .set({ studyCourse: course, studyCourseOn: day, studyBag: bag })
    .where(
      and(
        eq(users.id, user.id),
        or(isNull(users.studyCourseOn), ne(users.studyCourseOn, day), isNull(users.studyCourse), notInArray(users.studyCourse, [...COURSE_IDS])),
      ),
    )
    .returning(STUDY_COLUMNS);
  if (drawn) return todayOf(drawn, day);
  const [other] = await db.select(STUDY_COLUMNS).from(users).where(eq(users.id, user.id));
  return todayOf(other, day);
}

function todayOf(u: { course: string | null; studiedOn: string | null; days: number }, day: string): StudyToday {
  return { day, course: u.course ?? "", done: u.studiedOn === day, days: u.days };
}

/**
 * A round of the day's course played: a site day studied, the first time today (another round adds nothing). Any other
 * course, or yesterday's course after 04:00, is refused (409) with today's, which the page then shows.
 */
export async function studyDone(user: Pick<UserRow, "id">, course: unknown, now = Date.now()): Promise<StudyDone> {
  if (!isCourse(course)) throw new HttpError(400, T.server.study.badCourse);
  const day = siteDay(now);
  const [u] = await db
    .update(users)
    .set({ studyDays: sql`case when ${users.studiedOn} = ${day} then ${users.studyDays} else ${users.studyDays} + 1 end`, studiedOn: day })
    .where(and(eq(users.id, user.id), eq(users.studyCourse, course), eq(users.studyCourseOn, day)))
    .returning({ days: users.studyDays });
  if (u) return { done: true, days: u.days };
  throw new HttpError(409, T.server.study.notToday, NOT_TODAY, { today: await studyToday(user, now) });
}
