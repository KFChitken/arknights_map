import { eq, sql, type AnyColumn } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODES_PER_DAY } from "../rules";
import { db } from "./db";
import { MAIL_DAILY_LIMIT } from "./env";
import { forgetLoginCodes, issueLoginCode, pruneSignInMail, redeemLoginCode, withdrawLoginCode } from "./loginCodes";
import { neverReached, rateLimited, sendWith } from "./mail";
import { forgetMailCount, MAIL_SLOW_LOCK } from "./mailQuota";
import { loginCodes, mailSends } from "./schema";

// Gmail slow to take our mail, with small caps to reach in a test (other addresses are not affected)
vi.mock("./env", async (original) => ({
  ...(await original<typeof import("./env")>()),
  MAIL_SLOW_DOMAINS: ["gmail.com", "googlemail.com"],
  MAIL_SLOW_DAILY_LIMIT: 6,
  MAIL_SLOW_HOURLY_LIMIT: 4,
  MAIL_SLOW_PER_ADDRESS: 3,
}));

const EMAIL = "player@example.com";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Past the longest wait between codes (rules.ts LOGIN_CODE_COOLDOWNS_S) */
const PAST_ANY_WAIT = 10 * MINUTE + 1000;

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
  forgetMailCount();
});

describe("login codes", () => {
  it("sends one code a minute to an address, and a code works once", async () => {
    const { code } = await issueLoginCode(EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("后可以再发");

    await redeemLoginCode(EMAIL, code);
    await expect(redeemLoginCode(EMAIL, code)).rejects.toThrow("过期");
    // signing in does not lift the cooldown
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("后可以再发");
  });

  it("waits longer before each sending of the same code: 2 minutes, then 5, then 10", async () => {
    const first = await issueLoginCode(EMAIL);
    expect(first.waitS).toBe(120);
    await rewind({ sent: 2 * MINUTE + 1000 });
    expect(await issueLoginCode(EMAIL)).toMatchObject({ code: first.code, again: true, waitS: 300 });
    await rewind({ sent: 2 * MINUTE + 1000 });
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("2 分 59 秒后可以再发");
    await rewind({ sent: 3 * MINUTE });
    expect(await issueLoginCode(EMAIL)).toMatchObject({ again: true, waitS: 600 });
    await rewind({ sent: 5 * MINUTE + 1000 });
    await expect(issueLoginCode(EMAIL)).rejects.toThrow("4 分 59 秒后可以再发");
    expect((await row()).sends).toBe(3);
  });

  it("starts again at 2 minutes with a new code, and an email that never went out takes its sending back", async () => {
    const first = await issueLoginCode(EMAIL);
    await rewind({ sent: 2 * MINUTE + 1000 });
    const again = await issueLoginCode(EMAIL);
    await withdrawLoginCode(EMAIL, again);
    expect((await row()).sends).toBe(1);
    // at once, as the second sending once more
    expect(await issueLoginCode(EMAIL)).toMatchObject({ again: true, waitS: 300 });
    // used: the next is a new code, after the shortest wait
    await redeemLoginCode(EMAIL, first.code);
    await rewind({ sent: 2 * MINUTE + 1000 });
    expect(await issueLoginCode(EMAIL)).toMatchObject({ again: false, waitS: 120 });
    expect((await row()).sends).toBe(1);
  });

  it("takes back a new code that never went out: it is void, and asking again is held up by nothing", async () => {
    const lost = await issueLoginCode(EMAIL);
    expect(await db.select().from(mailSends)).toHaveLength(1);
    await withdrawLoginCode(EMAIL, lost);
    expect(await row()).toMatchObject({ codeHash: "", sentToday: 0 });
    expect(await db.select().from(mailSends)).toHaveLength(0);
    await expect(redeemLoginCode(EMAIL, lost.code)).rejects.toThrow("过期");

    // asked again at once: a new code, counted once
    const { code } = await issueLoginCode(EMAIL);
    expect((await row()).sentToday).toBe(1);
    expect(await db.select().from(mailSends)).toHaveLength(1);
    // an old code takes back nothing
    await withdrawLoginCode(EMAIL, lost);
    expect((await row()).sentToday).toBe(1);
    await redeemLoginCode(EMAIL, code);
  });

  it("sends a code still working again as the same code, so whichever email arrives first signs in", async () => {
    const first = await issueLoginCode(EMAIL);
    expect(first.again).toBe(false);
    await rewind({ sent: 2 * MINUTE + 1000 });
    const second = await issueLoginCode(EMAIL);
    expect(second).toMatchObject({ code: first.code, again: true });
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime());
    expect((await row()).sentToday).toBe(2);
    expect(await db.$count(mailSends)).toBe(2);
    await redeemLoginCode(EMAIL, first.code);
  });

  it("keeps the tries of a code sent again, and makes a new code once one is tried too often, run out or used", async () => {
    const first = await issueLoginCode(EMAIL);
    await expect(redeemLoginCode(EMAIL, wrongFor(first.code))).rejects.toThrow("不对");
    await rewind({ sent: 2 * MINUTE + 1000 });
    expect((await issueLoginCode(EMAIL)).again).toBe(true);
    expect((await row()).attempts).toBe(1);

    for (let i = 1; i < LOGIN_CODE_MAX_ATTEMPTS; i++) await redeemLoginCode(EMAIL, wrongFor(first.code)).catch(() => {});
    await rewind({ sent: 2 * MINUTE + 1000 });
    const fresh = await issueLoginCode(EMAIL);
    expect(fresh.again).toBe(false);
    expect((await row()).attempts).toBe(0);

    await rewind({ sent: 2 * MINUTE + 1000, expiry: 11 * MINUTE });
    const later = await issueLoginCode(EMAIL);
    expect(later.again).toBe(false);

    await redeemLoginCode(EMAIL, later.code);
    await rewind({ sent: 2 * MINUTE + 1000 });
    expect((await issueLoginCode(EMAIL)).again).toBe(false);
  });

  it("takes back an email of a code sent before without voiding the code the earlier email carries", async () => {
    const first = await issueLoginCode(EMAIL);
    await rewind({ sent: 2 * MINUTE + 1000 });
    const again = await issueLoginCode(EMAIL);
    await withdrawLoginCode(EMAIL, again);
    expect((await row()).sentToday).toBe(1);
    expect(await db.$count(mailSends)).toBe(1);
    // asked again at once: the same code once more
    expect(await issueLoginCode(EMAIL)).toMatchObject({ code: first.code, again: true });
    await redeemLoginCode(EMAIL, first.code);
  });

  it("does not send again a code it cannot work out, such as one made before codes were worked out", async () => {
    await issueLoginCode(EMAIL);
    await db.update(loginCodes).set({ codeHash: "made-before" }).where(eq(loginCodes.email, EMAIL));
    await rewind({ sent: 2 * MINUTE + 1000 });
    expect((await issueLoginCode(EMAIL)).again).toBe(false);
  });

  it("calls a mail server never reached only when nothing can have been handed over", () => {
    const timeout = (timeoutType: string) => Object.assign(new Error("x"), { code: "ETIMEDOUT", command: "CONN", timeoutType });
    expect(neverReached(timeout("CONNECT_TIMEOUT"))).toBe(true);
    expect(neverReached(timeout("GREETING_TIMEOUT"))).toBe(true);
    expect(neverReached(Object.assign(new Error("x"), { code: "EDNS" }))).toBe(true);
    // the connection went quiet partway: the mail may have gone out
    expect(neverReached(timeout("SOCKET_TIMEOUT"))).toBe(false);
    expect(neverReached(Object.assign(new Error("x"), { code: "EAUTH" }))).toBe(false);
    expect(neverReached(null)).toBe(false);
  });

  it("caps the codes one address receives in a day, sign-ins included", async () => {
    let last = "";
    for (let i = 0; i < LOGIN_CODES_PER_DAY; i++) {
      last = (await issueLoginCode(EMAIL)).code;
      await rewind({ sent: PAST_ANY_WAIT });
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
    // one refused by its own cooldown gives its room back
    const [ok] = rs.flatMap((r, i) => (r.status === "fulfilled" ? [i] : []));
    await expect(issueLoginCode(`p${ok}@example.com`)).rejects.toThrow("后可以再发");
    await db.delete(mailSends).where(sql`${mailSends.id} = (select min(${mailSends.id}) from ${mailSends})`);
    forgetMailCount();
    expect((await issueLoginCode(EMAIL)).code).toMatch(/^\d{6}$/);

    // sends older than a day count no more, and the timed job drops them
    await db.update(mailSends).set({ sentAt: sql`${mailSends.sentAt} - interval '1 day 1 minute'` });
    forgetMailCount();
    await rewind({ sent: PAST_ANY_WAIT });
    await issueLoginCode(EMAIL);
    await pruneSignInMail();
    expect(await db.$count(mailSends)).toBe(1);
  });

  it("queues only codes to the slow services, one at a time, and never ordinary ones", async () => {
    let slowDone = false;
    await db.transaction(async (tx) => {
      // a code to Gmail being issued meanwhile
      await tx.execute(sql`select pg_advisory_xact_lock(${MAIL_SLOW_LOCK})`);
      // an ordinary address goes straight through
      expect((await issueLoginCode(EMAIL)).code).toMatch(/^\d{6}$/);
      // one in its cooldown is told so at once
      await expect(issueLoginCode(EMAIL)).rejects.toThrow("后可以再发");
      // a Gmail one waits for the other
      const slow = issueLoginCode("doctor@gmail.com").then(() => (slowDone = true));
      await new Promise((r) => setTimeout(r, 400));
      expect(slowDone).toBe(false);
      void slow;
    });
    // once the other is done, it goes
    for (let i = 0; i < 40 && !slowDone; i++) await new Promise((r) => setTimeout(r, 50));
    expect(slowDone).toBe(true);
  });

  it("sends one code to a new address however many ask at once", async () => {
    const rs = await Promise.allSettled(Array.from({ length: 20 }, () => issueLoginCode("new@example.com")));
    expect(fulfilled(rs)).toBe(1);
    expect(await db.$count(mailSends)).toBe(1);
    expect((await row("new@example.com")).sends).toBe(1);
  });

  it("sends again a mail turned away for coming too fast, and nothing else", async () => {
    const busy = Object.assign(new Error("x"), { responseCode: 550, response: "550 Too many requests. Please try again later." });
    const invalid = Object.assign(new Error("x"), { responseCode: 550, response: "550 Invalid `to` field." });
    expect(rateLimited(busy)).toBe(true);
    expect(rateLimited(invalid)).toBe(false);
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    // turned away once, then taken: one mail
    const sent: string[] = [];
    let first = true;
    await sendWith({ sendMail: async (m) => (first ? ((first = false), Promise.reject(busy)) : sent.push(String(m.to))) }, { to: "a@example.com" }, wait);
    expect(sent).toEqual(["a@example.com"]);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(1000);
    expect(waits[0]).toBeLessThan(2000);
    // turned away every time: three tries, then it says so
    let tries = 0;
    await expect(sendWith({ sendMail: async () => (tries++, Promise.reject(busy)) }, { to: "b@example.com" }, wait)).rejects.toBe(busy);
    expect(tries).toBe(3);
    // an address it will not send to: once, no more
    tries = 0;
    await expect(sendWith({ sendMail: async () => (tries++, Promise.reject(invalid)) }, { to: "c@example.com" }, wait)).rejects.toBe(invalid);
    expect(tries).toBe(1);
  });

  it("allows a fixed number of tries per code, even when guesses arrive at once", async () => {
    const { code } = await issueLoginCode(EMAIL);
    const rs = await Promise.allSettled(Array.from({ length: 20 }, () => redeemLoginCode(EMAIL, wrongFor(code))));
    expect(fulfilled(rs)).toBe(0);
    expect((await row()).attempts).toBe(LOGIN_CODE_MAX_ATTEMPTS);
    await expect(redeemLoginCode(EMAIL, code)).rejects.toThrow("错误次数太多");
  });

  it("signs in once when the right code arrives twice at the same time", async () => {
    const { code } = await issueLoginCode(EMAIL);
    const rs = await Promise.allSettled([redeemLoginCode(EMAIL, code), redeemLoginCode(EMAIL, code), redeemLoginCode(EMAIL, code)]);
    expect(fulfilled(rs)).toBe(1);
  });

  it("refuses an expired code, and a code sent to another address", async () => {
    const { code } = await issueLoginCode(EMAIL);
    await expect(redeemLoginCode("other@example.com", code)).rejects.toThrow("过期");
    await rewind({ expiry: 11 * MINUTE });
    await expect(redeemLoginCode(EMAIL, code)).rejects.toThrow("过期");
  });

  it("drops rows past their day and forgets an address on request", async () => {
    await issueLoginCode("old@example.com");
    await rewind({ sent: DAY + MINUTE, day: DAY + MINUTE, expiry: DAY + MINUTE }, "old@example.com");
    await issueLoginCode(EMAIL);
    // the timed job, which keeps a row still in its day
    await pruneSignInMail();
    expect(await row("old@example.com")).toBeUndefined();
    expect(await row()).toBeDefined();

    await forgetLoginCodes(EMAIL);
    expect(await row()).toBeUndefined();
  });
});

describe("codes to a mail service slow to take our mail", () => {
  it("sends one address there 3 codes a day, and any other address its 10", async () => {
    const G = "doctor@gmail.com";
    for (let i = 0; i < 3; i++) {
      await issueLoginCode(G);
      await rewind({ sent: PAST_ANY_WAIT }, G);
    }
    await expect(issueLoginCode(G)).rejects.toThrow("今天已经收了 3 次");
    for (let i = 0; i < 4; i++) {
      await issueLoginCode(EMAIL);
      await rewind({ sent: PAST_ANY_WAIT });
    }
  });

  it("caps the codes to slow services together, by the hour and by the day, and leaves the rest alone", async () => {
    for (let i = 0; i < 4; i++) await issueLoginCode(`g${i}@gmail.com`);
    await expect(issueLoginCode("g4@googlemail.com")).rejects.toThrow("这一小时发往 Gmail 的验证码名额用完了");
    await issueLoginCode(EMAIL);

    // an hour on, room again until the day's 6
    await db.update(mailSends).set({ sentAt: sql`${mailSends.sentAt} - interval '61 minutes'` });
    await issueLoginCode("g4@gmail.com");
    await issueLoginCode("g5@gmail.com");
    await expect(issueLoginCode("g6@gmail.com")).rejects.toThrow("今天发往 Gmail 的验证码名额用完了");
    // counted in the database, so every process sees the same number
    expect(await db.$count(mailSends, eq(mailSends.kind, "login-slow"))).toBe(6);
  });

  it("counts codes to slow services against the whole site's cap as well", async () => {
    await db.insert(mailSends).values(Array.from({ length: MAIL_DAILY_LIMIT - 1 }, () => ({ kind: "login-slow" })));
    await issueLoginCode(EMAIL);
    await expect(issueLoginCode("other@example.com")).rejects.toThrow("验证码邮件发完了");
  });
});
