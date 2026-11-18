import { describe, expect, it } from "vitest";
import { mulberry32 } from "../prng";
import { COURSE_IDS, type CourseId, coursesFor, HELD, isCourse, otherCourses } from "./courses";
import { drawCourse } from "./draw";

/** Draws one a day for so many days, as the server keeps the bag and the last course, each day's random another */
function days(courses: readonly string[], n: number, seed: number) {
  const random = mulberry32(seed);
  let bag: string[] = [];
  let last: string | null = null;
  const drawn: string[] = [];
  for (let i = 0; i < n; i++) {
    const d: { course: string; bag: string[] } = drawCourse({ bag, last }, courses, random);
    drawn.push(d.course);
    ({ bag } = d);
    last = d.course;
  }
  return drawn;
}

describe("courses held back from players", () => {
  it("are 节拍 for now, a course there is", () => {
    expect(HELD).toEqual(["beat325"]);
    for (const id of HELD) expect(isCourse(id)).toBe(true);
  });

  it("are dealt and offered to those who may pick, and to no one else", () => {
    expect(coursesFor(true)).toEqual(COURSE_IDS);
    expect(coursesFor(false)).toEqual(COURSE_IDS.filter((c) => !HELD.includes(c)));
    expect(coursesFor(false).length).toBe(COURSE_IDS.length - HELD.length);
  });

  it("never come in a thousand days' draws for one who may not pick; one who may draws them each round", () => {
    const open = days(coursesFor(false), 1000, 1);
    expect(open.filter((c) => HELD.includes(c as never))).toEqual([]);
    // every open course still has its turn each round
    const n = coursesFor(false).length;
    for (let r = 0; r + n <= open.length; r += n) expect(new Set(open.slice(r, r + n)).size).toBe(n);

    const all = days(coursesFor(true), 1000, 1);
    const rounds = Math.floor(1000 / COURSE_IDS.length);
    for (const id of HELD) expect(all.filter((c) => c === id).length).toBeGreaterThanOrEqual(rounds);
  });

  it("never come with another random each time, for one who may not pick", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const { course } = drawCourse({ bag: [], last: null }, coursesFor(false), mulberry32(seed));
      expect(HELD.includes(course)).toBe(false);
    }
  });

  it("are not among the other courses on the page, picked or 随机来一门, but for one who may pick", () => {
    for (const today of COURSE_IDS) {
      expect(otherCourses(true, today)).toEqual(COURSE_IDS.filter((c) => c !== today));
      expect(otherCourses(false, today)).toEqual(COURSE_IDS.filter((c) => c !== today && !HELD.includes(c)));
    }
    // 随机来一门 once today's is done, as the page deals it: none dealt again until all the others have been
    for (const today of coursesFor(false)) {
      let bag: string[] = [];
      let last: string | null = null;
      const random = mulberry32(today.length);
      for (let i = 0; i < 1000; i++) {
        const d: { course: CourseId; bag: CourseId[] } = drawCourse({ bag, last }, otherCourses(false, today), random);
        expect(HELD.includes(d.course)).toBe(false);
        expect(d.course).not.toBe(today);
        ({ bag } = d);
        last = d.course;
      }
    }
  });
});
