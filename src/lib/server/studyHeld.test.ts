import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { siteDayStart } from "../siteDay";
import { COURSE_IDS, coursesFor, HELD } from "../study/courses";
import { db } from "./db";
import { users } from "./schema";
import { studyToday } from "./study";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// every course there is, 节拍 held back (courses.ts HELD): the draw on the server, for those who may pick and those who may not
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (day: string) => siteDayStart(day) + HOUR;
const held = HELD[0];

async function account(email: string) {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  return u.id;
}
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

/** A course drawn each site day for so many days, each day's random another */
async function days(id: string, email: string, n: number) {
  const drawn: string[] = [];
  let now = at("2026-11-21");
  for (let i = 0; i < n; i++, now += DAY) drawn.push((await studyToday({ id, email }, now, () => ((i * 7919) % 1000) / 1000)).course);
  return drawn;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
});

describe("325大学习's courses held back, on the server", () => {
  it("are never drawn for a player who may not pick, every other course still once a round", async () => {
    const id = await account("player@example.com");
    const drawn = await days(id, "player@example.com", 3 * coursesFor(false).length);
    expect(drawn.filter((c) => HELD.includes(c as never))).toEqual([]);
    const n = coursesFor(false).length;
    for (let r = 0; r < drawn.length; r += n) expect(new Set(drawn.slice(r, r + n)).size).toBe(n);
  });

  it("are drawn for the 站长 as any other course, once a round", async () => {
    const id = await account("owner@example.com");
    const drawn = await days(id, "owner@example.com", 2 * COURSE_IDS.length);
    expect(drawn.filter((c) => c === held)).toHaveLength(2);
  });

  it("are drawn again when stored as today's for a player who may not pick, as a course the server no longer has", async () => {
    const id = await account("player@example.com");
    const day = "2026-11-21";
    // passed today already: drawn again, today stays passed, no round of the new one lost
    await db
      .update(users)
      .set({ studyCourse: held, studyCourseOn: day, studyBag: [held], studyFails: 3, studiedOn: day, studyDays: 4 })
      .where(eq(users.id, id));
    const t = await studyToday({ id, email: "player@example.com" }, at(day), () => 0);
    expect(t).toMatchObject({ day, course: coursesFor(false).find((c) => c !== held), done: true, days: 4, fails: 0, pick: false });
    expect(await row(id)).toMatchObject({ studyCourse: t.course, studyCourseOn: day, studyFails: 0, studiedOn: day, studyDays: 4 });
    expect((await row(id)).studyBag).not.toContain(held);
    // and kept the rest of the day
    expect((await studyToday({ id, email: "player@example.com" }, at(day) + 10 * HOUR)).course).toBe(t.course);
  });

  it("stay today's for the 站长", async () => {
    const id = await account("owner@example.com");
    const day = "2026-11-21";
    await db.update(users).set({ studyCourse: held, studyCourseOn: day, studyBag: [held] }).where(eq(users.id, id));
    expect(await studyToday({ id, email: "owner@example.com" }, at(day), () => 0)).toMatchObject({ course: held, pick: true });
    expect((await row(id)).studyCourse).toBe(held);
  });
});
