import { eq, sql, type AnyColumn } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODES_PER_DAY } from "../rules";
import { db } from "./db";
import { MAIL_DAILY_LIMIT } from "./env";
import { forgetLoginCodes, issueLoginCode, redeemLoginCode } from "./loginCodes";
import { loginCodes, mailSends } from "./schema";

const EMAIL = "player@example.com";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Pretend the code for an address was sent, and its day started, this much earlier. */
async function rewind(ms: { sent?: number; day?: number; expiry?: number }, email = EMAIL) {
  const back = (col: AnyColumn, by = 0) => sql`${col} - make_interval(secs => ${by / 1000})`;
  await db
    .update(loginCodes)
    .set({
      sentAt: back(loginCodes.sentAt, ms.sent),
      dayStart: back(loginCodes.dayStart, ms.day),
      expiresAt: back(loginCodes.expiresAt, ms.expiry),
    })
    .where(eq(loginCodes.email, email));
}

const row = async (email = EMAIL) => (await db.select().from(loginCodes).where(eq(loginCodes.email, email)))[0];
const fulfilled = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === "fulfilled").length;
const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

beforeEach(async () => {
  await db.delete(loginCodes);
  await db.delete(mailSends);
});

describe("login codes", () => {
  it("sends one code a minute to an address, and a code works once", async () => {
    const code = await issueLoginCode(EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("秒后可以再发");

    await redeemLoginCode(EMAIL, code);
    await expect(redeemLoginCode(EMAIL, code)).rejects.toThrow("过期");
    // signing in does not lift the cooldown
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("秒后可以再发");
  });

  it("caps the codes one address receives in a day, sign-ins included", async () => {
    let last = "";
    for (let i = 0; i < LOGIN_CODES_PER_DAY; i++) {
      last = await issueLoginCode(EMAIL);
      await rewind({ sent: 2 * MINUTE });
    }
    await expect(issueLoginCode(EMAIL)).rejects.toThrow(`今天已经收了 ${LOGIN_CODES_PER_DAY} 次`);
    await redeemLoginCode(EMAIL, last);
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("明天再试");

    await rewind({ day: DAY + MINUTE });
    await issueLoginCode(EMAIL);
    expect((await row()).sentToday).toBe(1);
  });

  it("lets only one of many simultaneous requests send a code", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 20 }, () => issueLoginCode(EMAIL)));
    expect(fulfilled(rs)).toBe(1);
    expect((await row()).sentToday).toBe(1);
    expect(await db.$count(mailSends)).toBe(1);
  });

  it("stops sending for the whole site once a day's mail is used up", async () => {
    await db.insert(mailSends).values(Array.from({ length: MAIL_DAILY_LIMIT - 1 }, () => ({})));
    const rs = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => issueLoginCode(`p${i}@example.com`)));
    expect(fulfilled(rs)).toBe(1);
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("验证码邮件发完了");
    // a refused address keeps no cooldown and no count
    expect(await row()).toBeUndefined();

    await db.update(mailSends).set({ sentAt: sql`${mailSends.sentAt} - interval '1 day 1 minute'` });
    await issueLoginCode(EMAIL);
    expect(await db.$count(mailSends)).toBe(1);
  });

  it("allows a fixed number of tries per code, even when guesses arrive at once", async () => {
    const code = await issueLoginCode(EMAIL);
    const rs = await Promise.allSettled(Array.from({ length: 20 }, () => redeemLoginCode(EMAIL, wrongFor(code))));
    expect(fulfilled(rs)).toBe(0);
    expect((await row()).attempts).toBe(LOGIN_CODE_MAX_ATTEMPTS);
    await expect(redeemLoginCode(EMAIL, code)).rejects.toThrow("错误次数太多");
  });

  it("signs in once when the right code arrives twice at the same time", async () => {
    const code = await issueLoginCode(EMAIL);
    const rs = await Promise.allSettled([redeemLoginCode(EMAIL, code), redeemLoginCode(EMAIL, code), redeemLoginCode(EMAIL, code)]);
    expect(fulfilled(rs)).toBe(1);
  });

  it("refuses an expired code, and a code sent to another address", async () => {
    const code = await issueLoginCode(EMAIL);
    await expect(redeemLoginCode("other@example.com", code)).rejects.toThrow("过期");
    await rewind({ expiry: 11 * MINUTE });
    await expect(redeemLoginCode(EMAIL, code)).rejects.toThrow("过期");
  });

  it("drops rows past their day and forgets an address on request", async () => {
    await issueLoginCode("old@example.com");
    await rewind({ sent: DAY + MINUTE, day: DAY + MINUTE, expiry: DAY + MINUTE }, "old@example.com");
    await issueLoginCode(EMAIL);
    expect(await row("old@example.com")).toBeUndefined();

    await forgetLoginCodes(EMAIL);
    expect(await row()).toBeUndefined();
  });
});
