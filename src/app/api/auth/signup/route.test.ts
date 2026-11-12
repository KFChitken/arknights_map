import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession, readSignupProof, setSignupProof } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { sessions, userBadges, userPasswords, users } from "@/lib/server/schema";
import { POST } from "./route";

// One browser's cookies, which every request below shares, as the two requests of a double tap do
const jar = vi.hoisted(() => {
  const held = new Map<string, string>();
  return {
    held,
    get: (name: string) => (held.has(name) ? { name, value: held.get(name)! } : undefined),
    set: (name: string, value: string) => void held.set(name, value),
    delete: (name: string) => void held.delete(name),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const EMAIL = "new.doctor@qq.com";
const PW = "roach-in-the-rain";

/** 完成注册, ticks and a password given, with the proof the email was verified moments ago */
const signUp = () =>
  POST(
    new NextRequest("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ adult: true, acceptPolicy: true, acceptCrossBorder: true, password: PW }),
    }),
    undefined,
  );

const accounts = () => db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
const badgesOf = async (userId: string) =>
  (await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, userId))).map((b) => b.badge);
const hasPassword = async (userId: string) =>
  (await db.select().from(userPasswords).where(eq(userPasswords.userId, userId))).length === 1;

/** Until a statement elsewhere waits for a row this test's open transaction holds */
async function untilWaiting() {
  for (let i = 0; i < 200; i++) {
    const [{ n }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'insert into "users"%'`,
    );
    if (n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("the sign-up never got to its insert");
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  jar.held.clear();
  await setSignupProof(new NextRequest("http://localhost/"), EMAIL);
});

describe("finishing a sign-up", () => {
  it("makes the account, wakes it up, keeps the password and signs in", async () => {
    const res = await signUp();
    expect(res.status).toBe(200);
    const [account, ...more] = await accounts();
    expect(more).toEqual([]);
    expect(await badgesOf(account.id)).toContain("survivor");
    expect(await hasPassword(account.id)).toBe(true);
    expect((await currentSession())?.userId).toBe(account.id);
    expect(await readSignupProof()).toBeNull();
  });

  it("answers both requests of a double tap, with one account", async () => {
    // connections open already, so neither request waits for one and both look for the account at once
    await Promise.all(Array.from({ length: 4 }, () => db.execute(sql`select pg_sleep(0.02)`)));
    const [a, b] = await Promise.all([signUp(), signUp()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const [account, ...more] = await accounts();
    expect(more).toEqual([]);
    // signed in to it, whichever answer came last
    expect((await currentSession())?.userId).toBe(account.id);
    expect(await hasPassword(account.id)).toBe(true);
  });

  it("signs in to the account another sign-up of the email made after this one looked for it", async () => {
    let other = "";
    let answer!: Promise<Response>;
    // the other one (a double tap's first request) has put its row in and is not through yet
    await db.transaction(async (tx) => {
      [{ id: other }] = await tx.insert(users).values({ email: EMAIL }).returning({ id: users.id });
      answer = signUp();
      await untilWaiting();
    });
    const res = await answer;
    expect(res.status).toBe(200);
    expect(await accounts()).toEqual([{ id: other }]);
    expect((await currentSession())?.userId).toBe(other);
    expect(await hasPassword(other)).toBe(true);
    expect(await readSignupProof()).toBeNull();
    // waking the account up is the other one's to do, not done a second time here
    expect(await badgesOf(other)).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, other))).toHaveLength(1);
  });
});
