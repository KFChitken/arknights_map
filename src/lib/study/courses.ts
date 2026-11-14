/**
 * 325大学习's courses: each player draws one a site day (draw.ts), and once it is played the rest are open to play as
 * well, which adds no day. A course's id is stored (users.study_course, a visitor's own browser) and never changes; its
 * name, rule and short name are in src/i18n/zh.ts study.courses, its subject's name in study.subjects. Each course comes
 * into this list with its game (src/components/app/study), and from then on into everyone's draws.
 */

/** What a course is filed under on its card */
export const SUBJECTS = ["pe", "music", "math"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const COURSES = [
  { id: "stopwatch", subject: "pe" },
  { id: "react325", subject: "pe" },
  { id: "echo325", subject: "music" },
  { id: "find325", subject: "math" },
  { id: "mental325", subject: "math" },
  { id: "beat325", subject: "music" },
] as const satisfies readonly { id: string; subject: Subject }[];

export type Course = (typeof COURSES)[number];
export type CourseId = Course["id"];

/** Every course, in the order the page lists them */
export const COURSE_IDS: readonly CourseId[] = COURSES.map((c) => c.id);

export const isCourse = (v: unknown): v is CourseId => typeof v === "string" && (COURSE_IDS as readonly string[]).includes(v);

export const subjectOf = (id: CourseId): Subject => COURSES.find((c) => c.id === id)!.subject;
