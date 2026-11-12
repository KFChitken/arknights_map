import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { issueLoginCode } from "./loginCodes";
import { forgetMailCount, MAIL_SLOW_LOCK } from "./mailQuota";
import { loginCodes, mailSends } from "./schema";

// Gmail paused altogether: MAIL_SLOW_DAILY_LIMIT=-1 (0 would read as the default)
vi.mock("./env", async (original) => ({
  ...(await original<typeof import("./env")>()),
  MAIL_SLOW_DOMAINS: ["gmail.com", "googlemail.com"],
  MAIL_SLOW_DAILY_LIMIT: -1,
}));

beforeEach(async () => {
  await db.delete(loginCodes);
  await db.delete(mailSends);
  forgetMailCount();
});

describe("codes to a slow mail service that is paused", () => {
  it("sends none there, without waiting for the slow services' lock, and other addresses theirs", async () => {
    await db.transaction(async (tx) => {
      // another ask holding the lock: were the paused one to wait for it, the two would wait for each other
      await tx.execute(sql`select pg_advisory_xact_lock(${MAIL_SLOW_LOCK})`);
      await expect(issueLoginCode("doctor@gmail.com")).rejects.toThrow("我们先暂停了发往 Gmail 的验证码");
    });
    expect(await db.$count(loginCodes)).toBe(0);
    expect((await issueLoginCode("doctor@example.com")).code).toMatch(/^\d{6}$/);
    expect(await db.$count(mailSends)).toBe(1);
  });
});
