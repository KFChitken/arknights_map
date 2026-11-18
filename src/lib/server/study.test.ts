import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteDay, siteDayStart } from "../siteDay";
import { loadMods } from "./admins";
import { db } from "./db";
import { admins, users } from "./schema";
import { studyDone, studyGiveUp, studyMe, studyToday } from "./study";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// four courses, as the first batch will have, none held back (studyHeld.test.ts has those): what is tested here is the
// draw and what is written, not the games
vi.mock("../study/courses", () => {
  const COURSE_IDS = ["stopwatch", "react325", "echo325", "find325"];
  return { COURSE_IDS, coursesFor: () => COURSE_IDS, isCourse: (v: unknown) => typeof v === "string" && COURSE_IDS.includes(v) };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An hour into a site day */
const at = (day: string) => siteDayStart(day) + HOUR;

async function account(email = "player@example.com") {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  return u.id;
}
/** The player as the server's study asks for them */
const who = (id: string, email = "player@example.com") => ({ id, email });
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

afterEach(() => vi.unstubAllEnvs());

describe("325大学习 on the server", () => {
  it("draws one course for asks that come at once, whichever each would have drawn", async () => {
    const id = await account();
    const now = at("2026-11-21");
    const got = await Promise.all([0, 0.99, 0.5, 0.3, 0.7, 0.1].map((x) => studyToday(who(id), now, () => x)));
    expect(new Set(got.map((t) => t.course)).size).toBe(1);
    expect(await row(id)).toMatchObject({ studyCourse: got[0].course, studyCourseOn: "2026-11-21", studyBag: [got[0].course] });
  });

  it("deals each course once a round, never the same two days running, a day at a time", async () => {
    const id = await account();
    const drawn: string[] = [];
    let now = at("2026-11-21");
    for (let i = 0; i < 16; i++, now += DAY) {
      const t = await studyToday(who(id), now);
      // the same all day
      expect((await studyToday(who(id), now + 20 * HOUR)).course).toBe(t.course);
      drawn.push(t.course);
    }
    for (let r = 0; r < 16; r += 4) expect(new Set(drawn.slice(r, r + 4)).size).toBe(4);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]).not.toBe(drawn[i - 1]);
  });

  it("draws again a course stored that this server no longer has", async () => {
    const id = await account();
    await db.update(users).set({ studyCourse: "gone", studyCourseOn: "2026-11-21", studyBag: ["gone"] }).where(eq(users.id, id));
    const t = await studyToday(who(id), at("2026-11-21"), () => 0);
    expect(t).toEqual({ day: "2026-11-21", course: "stopwatch", done: false, days: 0, fails: 0, skipped: false, pick: false, announced: false });
    expect(await row(id)).toMatchObject({ studyCourse: "stopwatch", studyBag: ["stopwatch"] });
  });

  it("counts a day the first time a round of the day's course is won, once a day, and keeps every day counted", async () => {
    const id = await account();
    const day1 = at("2026-11-21");
    const { course } = await studyToday(who(id), day1);
    const other = ["stopwatch", "react325"].find((c) => c !== course)!;

    // another course is refused, with today's along
    await expect(studyDone(who(id), other, true, day1)).rejects.toMatchObject({ status: 409, code: "notToday", extra: { today: { course, done: false, days: 0 } } });
    await expect(studyDone(who(id), other, false, day1)).rejects.toMatchObject({ status: 409, code: "notToday" });
    await expect(studyDone(who(id), "nothing", true, day1)).rejects.toMatchObject({ status: 400 });
    expect(await studyDone(who(id), course, true, day1)).toEqual({ done: true, days: 1, fails: 0, skipped: false });
    expect(await studyDone(who(id), course, true, day1 + 20 * HOUR)).toEqual({ done: true, days: 1, fails: 0, skipped: false });
    vi.stubEnv("STUDY", "on");
    expect(studyMe(await row(id), day1 + 20 * HOUR)).toEqual({ day: "2026-11-21", done: true, days: 1, fails: 0 });
    // what the map page is told the next morning: not passed yet today
    expect(studyMe(await row(id), day1 + DAY)).toEqual({ day: "2026-11-22", done: false, days: 1, fails: 0 });

    // the next site day, from 04:00: yesterday's course is refused, today's counts a second day
    const day2 = day1 + DAY;
    await expect(studyDone(who(id), course, true, day2)).rejects.toMatchObject({ status: 409, extra: { today: { day: "2026-11-22", done: false, days: 1 } } });
    const t2 = await studyToday(who(id), day2);
    expect(t2.course).not.toBe(course);
    expect(await studyDone(who(id), t2.course, true, day2)).toEqual({ done: true, days: 2, fails: 0, skipped: false });
    expect(await row(id)).toMatchObject({ studyDays: 2, studiedOn: "2026-11-22" });

    // days skipped take nothing away
    const t5 = await studyToday(who(id), day2 + 3 * DAY);
    expect(t5).toMatchObject({ day: "2026-11-25", done: false, days: 2 });
    expect(siteDay(day2 + 3 * DAY)).toBe("2026-11-25");
  });

  it("counts the rounds of today's course lost until it is won, and none once it is; a page that does not say won", async () => {
    vi.stubEnv("STUDY", "on");
    const id = await account();
    const day1 = at("2026-11-21");
    const { course } = await studyToday(who(id), day1);
    expect(await studyDone(who(id), course, false, day1)).toEqual({ done: false, days: 0, fails: 1, skipped: false });
    expect(await studyDone(who(id), course, false, day1 + HOUR)).toEqual({ done: false, days: 0, fails: 2, skipped: false });
    expect(await studyToday(who(id), day1 + 2 * HOUR)).toMatchObject({ course, done: false, days: 0, fails: 2 });
    expect(studyMe(await row(id), day1 + 2 * HOUR)).toEqual({ day: "2026-11-21", done: false, days: 0, fails: 2 });
    expect(await studyDone(who(id), course, true, day1 + 3 * HOUR)).toEqual({ done: true, days: 1, fails: 2, skipped: false });
    // lost after it was won: nothing more
    expect(await studyDone(who(id), course, false, day1 + 4 * HOUR)).toEqual({ done: true, days: 1, fails: 2, skipped: false });
    expect(await row(id)).toMatchObject({ studyDays: 1, studyFails: 2, studiedOn: "2026-11-21", studySkippedOn: null });

    // the next day's course is drawn with none lost; until then, yesterday's are not today's
    const day2 = day1 + DAY;
    expect(studyMe(await row(id), day2)).toEqual({ day: "2026-11-22", done: false, days: 1, fails: 0 });
    const t2 = await studyToday(who(id), day2);
    expect(t2).toMatchObject({ day: "2026-11-22", done: false, fails: 0, skipped: false });
    expect((await row(id)).studyFails).toBe(0);
    // a page from before rounds were lost says nothing of it: won
    expect(await studyDone(who(id), t2.course, undefined, day2)).toEqual({ done: true, days: 2, fails: 0, skipped: false });
  });

  it("lets today's course be given up once five rounds of it are lost, as a day studied, once", async () => {
    vi.stubEnv("STUDY", "on");
    const id = await account();
    const day1 = at("2026-11-21");
    const { course } = await studyToday(who(id), day1);
    const other = ["stopwatch", "react325"].find((c) => c !== course)!;
    for (let i = 1; i < 5; i++) {
      expect((await studyDone(who(id), course, false, day1)).fails).toBe(i);
      await expect(studyGiveUp(who(id), course, day1)).rejects.toMatchObject({
        status: 409,
        code: "notYet",
        message: "今天这门没过满 5 次，还不能跳过。",
        extra: { today: { course, done: false, fails: i, skipped: false } },
      });
    }
    expect((await studyDone(who(id), course, false, day1)).fails).toBe(5);
    await expect(studyGiveUp(who(id), other, day1)).rejects.toMatchObject({ status: 409, code: "notToday", extra: { today: { course } } });
    await expect(studyGiveUp(who(id), "nothing", day1)).rejects.toMatchObject({ status: 400 });
    expect(await studyGiveUp(who(id), course, day1 + HOUR)).toEqual({ done: true, days: 1, fails: 5, skipped: true });
    expect(await studyGiveUp(who(id), course, day1 + 2 * HOUR)).toEqual({ done: true, days: 1, fails: 5, skipped: true });
    expect(await studyToday(who(id), day1 + 3 * HOUR)).toMatchObject({ course, done: true, days: 1, fails: 5, skipped: true });
    expect(await row(id)).toMatchObject({ studyDays: 1, studiedOn: "2026-11-21", studySkippedOn: "2026-11-21" });
    // yesterday's, after 04:00
    await expect(studyGiveUp(who(id), course, day1 + DAY)).rejects.toMatchObject({ status: 409, code: "notToday" });

    // won after five lost, then given up as well: a day counted once, and not given up
    const day2 = day1 + DAY;
    const t2 = await studyToday(who(id), day2);
    expect(t2).toMatchObject({ done: false, fails: 0, skipped: false });
    for (let i = 0; i < 5; i++) await studyDone(who(id), t2.course, false, day2);
    expect(await studyDone(who(id), t2.course, true, day2)).toEqual({ done: true, days: 2, fails: 5, skipped: false });
    expect(await studyGiveUp(who(id), t2.course, day2)).toEqual({ done: true, days: 2, fails: 5, skipped: false });
    expect(await studyToday(who(id), day2)).toMatchObject({ done: true, days: 2, skipped: false });
  });

  it("lets the 站长 and the admins pick any course to play, and nobody else", async () => {
    const owner = await account("owner@example.com");
    const mod = await account("mod@example.com");
    const someone = await account("someone@example.com");
    await db.insert(admins).values({ userId: mod, role: "mod", alias: "小管" });
    await loadMods();
    const now = at("2026-11-21");
    expect((await studyToday(who(owner, "owner@example.com"), now)).pick).toBe(true);
    expect((await studyToday(who(mod, "mod@example.com"), now)).pick).toBe(true);
    expect((await studyToday(who(someone, "someone@example.com"), now)).pick).toBe(false);
    // the same once it is open to everyone
    vi.stubEnv("STUDY", "on");
    expect((await studyToday(who(owner, "owner@example.com"), now)).pick).toBe(true);
    expect((await studyToday(who(someone, "someone@example.com"), now)).pick).toBe(false);
  });
});
