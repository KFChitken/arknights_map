import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { issueLoginCode } from "./loginCodes";
import { forgetMailCount, MAIL_SLOW_LOCK } from "./mailQuota";
import { loginCodes, mailSends, users } from "./schema";

// Gmail paused altogether (MAIL_SLOW_DAILY_LIMIT=-1: 0 would read as the default), or only for addresses
// with no account (MAIL_SLOW_NEW_SHARE=-1), as each test sets
const slow = vi.hoisted(() => ({ daily: -1, newShare: 0.3 }));
vi.mock("./env", async (original) => ({
  ...(await original<typeof import("./env")>()),
  MAIL_SLOW_DOMAINS: ["gmail.com", "googlemail.com"],
  get MAIL_SLOW_DAILY_LIMIT() {
    return slow.daily;
  },
  get MAIL_SLOW_NEW_SHARE() {
    return slow.newShare;
  },
}));

/** Ask for a code to this address while another ask holds the slow services' lock: were it to wait for that lock, the two would wait for each other */
const whileLocked = (ask: () => Promise<unknown>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${MAIL_SLOW_LOCK})`);
    await ask();
  });

beforeEach(async () => {
  await db.delete(loginCodes);
  await db.delete(mailSends);
  await db.execute(sql`truncate ${users} cascade`);
  forgetMailCount();
  Object.assign(slow, { daily: -1, newShare: 0.3 });
});

describe("codes to a slow mail service that is paused", () => {
  it("sends none there, without waiting for the slow services' lock, and other addresses theirs", async () => {
    await whileLocked(() => expect(issueLoginCode("doctor@gmail.com")).rejects.toThrow("我们先暂停了发往 Gmail 的验证码"));
    expect(await db.$count(loginCodes)).toBe(0);
    expect((await issueLoginCode("doctor@example.com")).code).toMatch(/^\d{6}$/);
    expect(await db.$count(mailSends)).toBe(1);
  });

  it("sends none there to players with an account either, whatever the share of new addresses", async () => {
    slow.newShare = -1;
    await db.insert(users).values({ email: "doctor@gmail.com" });
    await expect(issueLoginCode("doctor@gmail.com")).rejects.toThrow("我们先暂停了发往 Gmail 的验证码");
    await expect(issueLoginCode("new@gmail.com")).rejects.toThrow("我们先暂停了发往 Gmail 的验证码");
  });

  it("paused for new addresses only: sends none to an address with no account there, at once, and players with one theirs", async () => {
    Object.assign(slow, { daily: 6, newShare: -1 });
    await db.insert(users).values({ email: "doctor@gmail.com" });
    await whileLocked(() =>
      expect(issueLoginCode("new@googlemail.com")).rejects.toThrow(
        "Gmail 现在限制我们的发信，发往 Gmail 的验证码先留给老玩家登录。新注册请换 QQ、163 或 Outlook 邮箱，马上就能收到。",
      ),
    );
    expect(await db.$count(loginCodes)).toBe(0);
    expect((await issueLoginCode("doctor@gmail.com")).code).toMatch(/^\d{6}$/);
    expect((await issueLoginCode("new@example.com")).code).toMatch(/^\d{6}$/);
    expect(await db.$count(mailSends, eq(mailSends.kind, "login-slow"))).toBe(1);
    expect(await db.$count(mailSends, eq(mailSends.kind, "login-slow-new"))).toBe(0);
  });
});
