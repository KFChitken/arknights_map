import { describe, expect, it } from "vitest";
import { mulberry32 } from "../prng";
import { drawCourse } from "./draw";

/** A random that gives these numbers in turn, then the last one again */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
};

/** Draws one a day for so many days, as the server would keep the bag and the last course */
function days(courses: readonly string[], n: number, random: () => number, start: { bag: string[]; last: string | null } = { bag: [], last: null }) {
  let { bag, last } = start;
  const drawn: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = drawCourse({ bag, last }, courses, random);
    drawn.push(d.course);
    ({ bag } = d);
    last = d.course;
  }
  return drawn;
}

describe("the day's course", () => {
  const four = ["stopwatch", "react325", "echo325", "find325"];

  it("is each course once in a round, before any comes again", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const drawn = days(four, 40, mulberry32(seed));
      for (let r = 0; r < 40; r += 4) expect(new Set(drawn.slice(r, r + 4)).size, `seed ${seed}, round from ${r}`).toBe(4);
    }
  });

  it("is never the one drawn the day before, not even across rounds", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const drawn = days(four, 60, mulberry32(seed));
      for (let i = 1; i < drawn.length; i++) expect(drawn[i], `seed ${seed}, day ${i}`).not.toBe(drawn[i - 1]);
    }
  });

  it("takes a course that came out after the round began into that round at once", () => {
    // three of four were drawn in this round; a fifth course comes out
    const five = [...four, "trace325"];
    const d = drawCourse({ bag: ["stopwatch", "react325", "echo325"], last: "echo325" }, five, seq(0.99));
    expect(d.course).toBe("trace325");
    expect(d.bag).toEqual(["stopwatch", "react325", "echo325", "trace325"]);
    // and, drawn first, it is drawn as well as find325 before the round ends
    const first = drawCourse({ bag: ["stopwatch"], last: "stopwatch" }, five, seq(0));
    expect(first.course).toBe("react325");
    expect(days(five, 4, mulberry32(7), { bag: first.bag, last: first.course }).slice(0, 3).sort()).toEqual(["echo325", "find325", "trace325"]);
  });

  it("starts a new round once all were drawn, keeping out the last one", () => {
    expect(drawCourse({ bag: four, last: "find325" }, four, seq(0.99))).toEqual({ course: "echo325", bag: ["echo325"] });
    expect(drawCourse({ bag: four, last: "find325" }, four, seq(0))).toEqual({ course: "stopwatch", bag: ["stopwatch"] });
  });

  it("forgets what the bag holds of courses there are no more of, and a last one that is gone", () => {
    expect(drawCourse({ bag: ["gone", "stopwatch"], last: "gone" }, ["stopwatch", "react325"], seq(0))).toEqual({
      course: "react325",
      bag: ["stopwatch", "react325"],
    });
  });

  it("is the one course there is, every day, while there is only one", () => {
    expect(days(["stopwatch"], 5, Math.random)).toEqual(Array(5).fill("stopwatch"));
    expect(drawCourse({ bag: ["stopwatch"], last: "stopwatch" }, ["stopwatch"], Math.random)).toEqual({ course: "stopwatch", bag: ["stopwatch"] });
  });

  it("stays within the list whatever the random gives", () => {
    for (const r of [0, 0.5, 0.999999, 1]) expect(four).toContain(drawCourse({ bag: [], last: null }, four, () => r).course);
    expect(() => drawCourse({ bag: [], last: null }, [], Math.random)).toThrow();
  });
});
