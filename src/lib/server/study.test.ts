import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteDay, siteDayStart } from "../siteDay";
import { db } from "./db";
import { users } from "./schema";
import { studyDone, studyMe, studyToday } from "./study";

// four courses, as the first batch will have: what is tested here is the draw and what is written, not the games
vi.mock("../study/courses", () => {
  const COURSE_IDS = ["stopwatch", "react325", "echo325", "find325"];
  return { COURSE_IDS, isCourse: (v: unknown) => typeof v === "string" && COURSE_IDS.includes(v) };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An hour into a site day */
const at = (day: string) => siteDayStart(day) + HOUR;

async function account() {
  const [u] = await db.insert(users).values({ email: "player@example.com" }).returning({ id: users.id });
  return u.id;
}
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

afterEach(() => vi.unstubAllEnvs());

describe("325大学习 on the server", () => {
  it("draws one course for asks that come at once, whichever each would have drawn", async () => {
    const id = await account();
    const now = at("2026-11-21");
    const got = await Promise.all([0, 0.99, 0.5, 0.3, 0.7, 0.1].map((x) => studyToday({ id }, now, () => x)));
    expect(new Set(got.map((t) => t.course)).size).toBe(1);
    expect(await row(id)).toMatchObject({ studyCourse: got[0].course, studyCourseOn: "2026-11-21", studyBag: [got[0].course] });
  });

  it("deals each course once a round, never the same two days running, a day at a time", async () => {
    const id = await account();
    const drawn: string[] = [];
    let now = at("2026-11-21");
    for (let i = 0; i < 16; i++, now += DAY) {
      const t = await studyToday({ id }, now);
      // the same all day
      expect((await studyToday({ id }, now + 20 * HOUR)).course).toBe(t.course);
      drawn.push(t.course);
    }
    for (let r = 0; r < 16; r += 4) expect(new Set(drawn.slice(r, r + 4)).size).toBe(4);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1]);
  });

  it("draws again a course stored that this server no longer has", async () => {
    const id = await account();
    await db.update(users).set({ studyCourse: "gone", studyCourseOn: "2026-11-21", studyBag: ["gone"] }).where(eq(users.id, id));
    const t = await studyToday({ id }, at("2026-11-21"), () => 0);
    expect(t).toEqual({ day: "2026-11-21", course: "stopwatch", done: false, days: 0 });
    expect(await row(id)).toMatchObject({ studyCourse: "stopwatch", studyBag: ["stopwatch"] });
  });

  it("counts a day the first time a round of the day's course is played, once a day, and keeps every day counted", async () => {
    const id = await account();
    const day1 = at("2026-11-21");
    const { course } = await studyToday({ id }, day1);
    const other = ["stopwatch", "react325"].find((c) => c !== course)!;

    // another course is refused, with today's along
    await expect(studyDone({ id }, other, day1)).rejects.toMatchObject({ status: 409, code: "notToday", extra: { today: { course, done: false, days: 0 } } });
    await expect(studyDone({ id }, "nothing", day1)).rejects.toMatchObject({ status: 400 });
    expect(await studyDone({ id }, course, day1)).toEqual({ done: true, days: 1 });
    expect(await studyDone({ id }, course, day1 + 20 * HOUR)).toEqual({ done: true, days: 1 });
    vi.stubEnv("STUDY", "on");
    expect(studyMe(await row(id), day1 + 20 * HOUR)).toEqual({ day: "2026-11-21", done: true, days: 1 });
    // what the map page is told the next morning: not played yet today
    expect(studyMe(await row(id), day1 + DAY)).toEqual({ day: "2026-11-22", done: false, days: 1 });

    // the next site day, from 04:00: yesterday's course is refused, today's counts a second day
    const day2 = day1 + DAY;
    await expect(studyDone({ id }, course, day2)).rejects.toMatchObject({ status: 409, extra: { today: { day: "2026-11-22", done: false, days: 1 } } });
    const t2 = await studyToday({ id }, day2);
    expect(t2.course).not.toBe(course);
    expect(await studyDone({ id }, t2.course, day2)).toEqual({ done: true, days: 2 });
    expect(await row(id)).toMatchObject({ studyDays: 2, studiedOn: "2026-11-22" });

    // days skipped take nothing away
    const t5 = await studyToday({ id }, day2 + 3 * DAY);
    expect(t5).toMatchObject({ day: "2026-11-25", done: false, days: 2 });
    expect(siteDay(day2 + 3 * DAY)).toBe("2026-11-25");
  });
});
