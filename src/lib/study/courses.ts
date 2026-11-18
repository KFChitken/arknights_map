/**
 * 325大学习's courses: each player draws one a site day (draw.ts), and once it is played the rest are open to play as
 * well, which adds no day. A course's id is stored (users.study_course, a visitor's own browser) and never changes; its
 * name, rule and short name are in src/i18n/zh.ts study.courses, its subject's name in study.subjects. Each course comes
 * into this list with its game (src/components/app/study), and from then on into everyone's draws, unless it is held
 * back (HELD) for the 站长 and the admins alone.
 */

/** What a course is filed under on its card */
export const SUBJECTS = ["pe", "music", "math", "calligraphy", "labor"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const COURSES = [
  { id: "stopwatch", subject: "pe" },
  { id: "react325", subject: "pe" },
  { id: "echo325", subject: "music" },
  { id: "find325", subject: "math" },
  { id: "mental325", subject: "math" },
  { id: "beat325", subject: "music" },
  { id: "make325", subject: "math" },
  { id: "catch325", subject: "pe" },
  { id: "trace325", subject: "calligraphy" },
  { id: "match325", subject: "math" },
  { id: "stack325", subject: "labor" },
  { id: "rogue325", subject: "math" },
  { id: "snake325", subject: "pe" },
  { id: "run325", subject: "pe" },
  { id: "write325", subject: "calligraphy" },
] as const satisfies readonly { id: string; subject: Subject }[];

export type Course = (typeof COURSES)[number];
export type CourseId = Course["id"];

/** Every course, in the order the page lists them */
export const COURSE_IDS: readonly CourseId[] = COURSES.map((c) => c.id);

export const isCourse = (v: unknown): v is CourseId => typeof v === "string" && (COURSE_IDS as readonly string[]).includes(v);

/** Courses held back from players for now: only those who may pick (the 站长 and the admins) get them, whatever STUDY is; Breeze opens each */
export const HELD: readonly CourseId[] = ["beat325"];

/** Every course but those held back, in the page's order */
const OPEN: readonly CourseId[] = COURSE_IDS.filter((c) => !HELD.includes(c));

/** The courses a player is dealt from (today's, drawn; another at random) and offered: all of them to those who may pick, the open ones otherwise */
export const coursesFor = (pick: boolean): readonly CourseId[] => (pick ? COURSE_IDS : OPEN);

/** The courses besides today's on the page: to pick from (those who may pick), or to be dealt one at random once today's is done */
export const otherCourses = (pick: boolean, today: string): CourseId[] => coursesFor(pick).filter((c) => c !== today);

export const subjectOf = (id: CourseId): Subject => COURSES.find((c) => c.id === id)!.subject;
