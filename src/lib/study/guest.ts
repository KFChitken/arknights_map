import { siteDay } from "../siteDay";
import { COURSE_IDS, isCourse, type CourseId } from "./courses";
import { drawCourse } from "./draw";
import type { StudyMe } from "./rules";

/**
 * 325大学习 for a visitor who has not signed in (while STUDY is on): the day's course is drawn and kept in this browser
 * alone, as the server would draw it (draw.ts), and so is whether it was played. Nothing of it goes to the server, and
 * nothing counts towards days studied, then or after signing in. Where the browser keeps nothing (a private window),
 * this page keeps it while it is open.
 */

const KEY = "zhoup.study";

type Kept = { day: string; course: CourseId; bag: string[]; done: boolean };

/** What this page wrote last, for a browser whose storage keeps nothing */
let held: Kept | null = null;

function read(): Kept | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Kept> | null;
    if (v && typeof v.day === "string" && isCourse(v.course) && Array.isArray(v.bag)) {
      return { day: v.day, course: v.course, bag: v.bag.filter((c): c is string => typeof c === "string"), done: v.done === true };
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

/** The visitor's course today, drawn now if it was not yet today, and whether they played it */
export function guestToday(now = Date.now(), random = Math.random): { day: string; course: CourseId; done: boolean } {
  const day = siteDay(now);
  const kept = read();
  if (kept?.day === day) return { day, course: kept.course, done: kept.done };
  const { course, bag } = drawCourse({ bag: kept?.bag ?? [], last: kept?.course ?? null }, COURSE_IDS, random);
  write({ day, course, bag, done: false });
  return { day, course, done: false };
}

/** A round of the visitor's course of that day was played: false once that day is over, or for another course */
export function guestDone(day: string, course: CourseId, now = Date.now()): boolean {
  const kept = read();
  if (siteDay(now) !== day || !kept || kept.day !== day || kept.course !== course) return false;
  write({ ...kept, done: true });
  return true;
}

/** For the dot on the way in (rules.ts studiedNow): the day the visitor's course was last drawn for, and whether it was played */
export function guestStudy(): Pick<StudyMe, "day" | "done"> | null {
  const kept = read();
  return kept && { day: kept.day, done: kept.done };
}
