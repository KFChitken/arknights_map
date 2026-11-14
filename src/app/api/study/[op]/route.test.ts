import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/server/db";
import { sessions, users } from "@/lib/server/schema";
import { studyMe } from "@/lib/server/study";
import { isCourse } from "@/lib/study/courses";
import { nextSiteDayAt, siteDay } from "@/lib/siteDay";
import { GET, POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// the route reads its cookie as any page does; here, the one this test signed in with
const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sid" && jar.token ? { name, value: jar.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

type Answer = { status: number; body: Record<string, unknown>; cache: string | null };

async function call(method: "GET" | "POST", op: string, body?: unknown): Promise<Answer> {
  const url = `http://localhost/api/study/${op}`;
  const req =
    method === "GET"
      ? new NextRequest(url)
      : new NextRequest(url, {
          method,
          headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
  const res = await { GET, POST }[method](req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}

/** Signed in as the player: the requests from here on are theirs */
async function signIn(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  jar.token = token;
}

const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions} cascade`);
  jar.token = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("325大学习's requests", () => {
  it("are answered 404 while STUDY is off, as if nothing were here", async () => {
    vi.stubEnv("STUDY", "off");
    expect((await call("POST", "today")).status).toBe(404);
    const owner = await account("owner@example.com");
    await signIn(owner);
    expect(await call("POST", "today")).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });
    expect((await call("POST", "done", { course: "stopwatch" })).status).toBe(404);
    expect(studyMe(await row(owner))).toBeUndefined();
    // unset is off
    vi.stubEnv("STUDY", "");
    expect((await call("POST", "today")).status).toBe(404);
  });

  it("are only for the 站长 and the admins while STUDY is admins; anyone else, visitors too, gets 404", async () => {
    vi.stubEnv("STUDY", "admins");
    expect((await call("POST", "today")).status).toBe(404);
    const player = await account("someone@example.com");
    await signIn(player);
    expect((await call("POST", "today")).status).toBe(404);
    expect((await call("POST", "done", { course: "stopwatch" })).status).toBe(404);
    expect(studyMe(await row(player))).toBeUndefined();
    const owner = await account("owner@example.com");
    await signIn(owner);
    expect(await call("POST", "today")).toMatchObject({ status: 200, body: { day: siteDay(), course: expect.any(String), done: false, days: 0 } });
    expect(studyMe(await row(owner))).toEqual({ day: siteDay(), done: false, days: 0 });
  });

  it("draw the day's course, count a day the first time a round of it is played, and no more that day", async () => {
    vi.stubEnv("STUDY", "on");
    expect(await call("POST", "today")).toMatchObject({ status: 401, body: { error: expect.any(String) } });
    const id = await account("player@example.com");
    await signIn(id);
    // only the ways in that exist, by POST
    expect((await call("GET", "today")).status).toBe(404);
    expect((await call("POST", "nothing")).status).toBe(404);
    expect((await call("POST", "toString")).status).toBe(404);

    const today = await call("POST", "today");
    expect(today).toMatchObject({ status: 200, body: { day: siteDay(), course: expect.any(String), done: false, days: 0 }, cache: "no-store" });
    const course = today.body.course as string;
    expect(isCourse(course)).toBe(true);
    expect(await row(id)).toMatchObject({ studyCourse: course, studyCourseOn: siteDay(), studyBag: [course], studyDays: 0, studiedOn: null });

    expect(await call("POST", "done", { course: "nothing" })).toMatchObject({ status: 400, body: { error: "没有这门课。" } });
    expect(await call("POST", "done", {})).toMatchObject({ status: 400 });
    expect(await call("POST", "done", { course })).toMatchObject({ status: 200, body: { done: true, days: 1 }, cache: "no-store" });
    expect(await call("POST", "done", { course })).toMatchObject({ status: 200, body: { done: true, days: 1 } });
    expect(await call("POST", "today")).toMatchObject({ status: 200, body: { course, done: true, days: 1 } });
    expect(studyMe(await row(id))).toEqual({ day: siteDay(), done: true, days: 1 });
  });

  it("refuse a round of a course not drawn today, with today's, drawn then if it was not", async () => {
    vi.stubEnv("STUDY", "on");
    const id = await account("player@example.com");
    await signIn(id);
    const refused = await call("POST", "done", { course: "stopwatch" });
    expect(refused).toMatchObject({
      status: 409,
      body: { code: "notToday", error: "今天抽到的不是这门课。", today: { day: siteDay(), course: expect.any(String), done: false, days: 0 } },
    });
    const drawn = (refused.body.today as { course: string }).course;
    expect((await row(id)).studyDays).toBe(0);
    // yesterday's course, kept from yesterday
    await db.update(users).set({ studyCourseOn: "2026-01-01" }).where(eq(users.id, id));
    expect(await call("POST", "done", { course: drawn })).toMatchObject({ status: 409, body: { today: { day: siteDay(), done: false } } });
    expect((await row(id)).studyCourseOn).toBe(siteDay());
  });

  it("count the next site day from 04:00 Beijing time, and never take days away", async () => {
    vi.stubEnv("STUDY", "on");
    const id = await account("player@example.com");
    await signIn(id);
    const turn = nextSiteDayAt();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(turn - 60_000);
    const before = siteDay();
    const course = (await call("POST", "today")).body.course as string;
    expect(await call("POST", "done", { course })).toMatchObject({ status: 200, body: { days: 1 } });

    vi.setSystemTime(turn + 60_000);
    expect(siteDay()).not.toBe(before);
    // yesterday's round, sent after 04:00: refused, with today's course
    const late = await call("POST", "done", { course });
    expect(late).toMatchObject({ status: 409, body: { today: { day: siteDay(), done: false, days: 1 } } });
    const next = (late.body.today as { course: string }).course;
    expect(await call("POST", "done", { course: next })).toMatchObject({ status: 200, body: { days: 2 } });
    expect(await row(id)).toMatchObject({ studyDays: 2, studiedOn: siteDay() });

    // a day skipped takes nothing away
    vi.setSystemTime(turn + 2 * 86_400_000 + 60_000);
    expect(await call("POST", "today")).toMatchObject({ status: 200, body: { done: false, days: 2 } });
  });

  it("wait for the age check and an updated privacy policy", async () => {
    vi.stubEnv("STUDY", "on");
    const id = await account("player@example.com");
    await signIn(id);
    await db.update(users).set({ ageCheckAt: new Date() }).where(eq(users.id, id));
    expect(await call("POST", "today")).toMatchObject({ status: 428, body: { code: "age" } });
    expect(await call("POST", "done", { course: "stopwatch" })).toMatchObject({ status: 428, body: { code: "age" } });
    await db.update(users).set({ ageCheckAt: null, policyAcceptedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(users.id, id));
    const policy = await call("POST", "today");
    expect(policy.status).toBe(428);
    expect(policy.body.code).toBeUndefined();
  });

  it("slow down a player who asks too fast", async () => {
    vi.stubEnv("STUDY", "on");
    await signIn(await account("player@example.com"));
    for (let i = 0; i < 30; i++) expect((await call("POST", "today")).status).not.toBe(429);
    expect(await call("POST", "today")).toMatchObject({ status: 429, body: { error: "点得太快了，歇一会儿再试。" } });
  });
});
