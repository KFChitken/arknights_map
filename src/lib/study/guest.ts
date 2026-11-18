import { siteDay } from "../siteDay";
import { coursesFor, isCourse, type CourseId } from "./courses";
import { drawCourse } from "./draw";
import { GIVE_UP_AFTER, type StudyMe } from "./rules";

/**
 * 325大学习 for a visitor who has not signed in (while STUDY is on): the day's course is drawn and kept in this browser
 * alone, as the server would draw it for a player who may not pick (draw.ts, of the courses not held back), and so are
 * the rounds of it lost and whether it was passed or given up. Nothing of it goes to the server, and nothing counts
 * towards days studied, then or after signing in. Where the browser keeps nothing (a private window), this page keeps
 * it while it is open.
 */

const KEY = "zhoup.study";

type Kept = { day: string; course: CourseId; bag: string[]; done: boolean; fails: number; skipped: boolean };

/** The visitor's course of a site day: whether it was passed (or given up, skipped), and the rounds of it lost */
export type GuestToday = Pick<Kept, "day" | "course" | "done" | "fails" | "skipped">;

/** What this page wrote last, for a browser whose storage keeps nothing */
let held: Kept | null = null;

function read(): Kept | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Kept> | null;
    if (v && typeof v.day === "string" && isCourse(v.course) && Array.isArray(v.bag)) {
      return {
        day: v.day,
        course: v.course,
        bag: v.bag.filter((c): c is string => typeof c === "string"),
        done: v.done === true,
        fails: Number.isInteger(v.fails) && v.fails! > 0 ? v.fails! : 0,
        skipped: v.skipped === true,
      };
    }
  } catch {}
  return held;
}

function write(k: Kept) {
  held = k;
  try {
    localStorage.setItem(KEY, JSON.stringify(k));
  } catch {}
}

const shown = ({ day, course, done, fails, skipped }: Kept): GuestToday => ({ day, course, done, fails, skipped });

/**
 * The visitor's course today, drawn now if it was not yet today, whether they passed it, and the rounds of it lost. One
 * kept today that is held back (courses.ts HELD) is drawn again, as the server does it: passed or given up today stays
 * so, and no round of the new one is lost yet.
 */
export function guestToday(now = Date.now(), random = Math.random): GuestToday {
  const day = siteDay(now);
  const kept = read();
  const courses = coursesFor(false);
  if (kept?.day === day && courses.includes(kept.course)) return shown(kept);
  const { course, bag } = drawCourse({ bag: kept?.bag ?? [], last: kept?.course ?? null }, courses, random);
  const again = kept?.day === day ? kept : null;
  const k = { day, course, bag, done: again?.done ?? false, fails: 0, skipped: again?.skipped ?? false };
  write(k);
  return shown(k);
}

/** The visitor's course of that day, while it is still that day and it is that course: null otherwise */
function todays(day: string, course: CourseId, now: number): Kept | null {
  const kept = read();
  return siteDay(now) === day && kept?.day === day && kept.course === course ? kept : null;
}

/**
 * A round of the visitor's course of that day was played: won, it is passed; lost, one more round of it lost, until it
 * is passed. Null once that day is over, or for another course.
 */
export function guestDone(day: string, course: CourseId, won: boolean, now = Date.now()): GuestToday | null {
  const kept = todays(day, course, now);
  if (!kept) return null;
  const k = won ? { ...kept, done: true } : kept.done ? kept : { ...kept, fails: kept.fails + 1 };
  write(k);
  return shown(k);
}

/** The visitor's course of that day given up, after GIVE_UP_AFTER rounds of it lost: null before, once the day is over, or for another course */
export function guestGiveUp(day: string, course: CourseId, now = Date.now()): GuestToday | null {
  const kept = todays(day, course, now);
  if (!kept || kept.fails < GIVE_UP_AFTER) return null;
  const k = kept.done ? kept : { ...kept, done: true, skipped: true };
  write(k);
  return shown(k);
}

/** For the dot on the way in (rules.ts studiedNow): the day the visitor's course was last drawn for, and whether it was passed */
export function guestStudy(): Pick<StudyMe, "day" | "done"> | null {
  const kept = read();
  return kept && { day: kept.day, done: kept.done };
}
