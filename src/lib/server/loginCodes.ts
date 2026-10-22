import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { LOGIN_CODE_COOLDOWN_S, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_MIN, LOGIN_CODES_PER_DAY } from "../rules";
import { db } from "./db";
import { secret } from "./env";
import { HttpError } from "./http";
import { loginCodes } from "./schema";

/**
 * The 6-digit codes emailed for sign-in. Every limit is checked inside the
 * same statement that changes the row, so a burst of parallel requests cannot
 * slip past the cooldown, the daily cap or the number of tries.
 */

const DAY_MS = 86_400_000;

const hashCode = (email: string, code: string) =>
  createHmac("sha256", secret("AUTH_SECRET")).update(`code|${email}|${code}`).digest("base64url");

function codeMatches(email: string, code: string, hash: string) {
  const a = Buffer.from(hashCode(email, code));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A fresh code for this address, or an HttpError saying when the next one can be sent. */
export async function issueLoginCode(email: string): Promise<string> {
  const now = new Date();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const fresh = {
    codeHash: hashCode(email, code),
    sentAt: now,
    expiresAt: new Date(now.getTime() + LOGIN_CODE_TTL_MIN * 60_000),
    attempts: 0,
  };
  const dayAgo = new Date(now.getTime() - DAY_MS);
  // Rows past both the cooldown and their day only hold an address, so drop them
  await db.delete(loginCodes).where(and(lt(loginCodes.dayStart, dayAgo), lt(loginCodes.expiresAt, now)));

  // postgres.js wants Dates inside raw SQL as strings
  const sameDay = sql`${loginCodes.dayStart} > ${dayAgo.toISOString()}`;
  const [issued] = await db
    .insert(loginCodes)
    .values({ email, ...fresh, dayStart: now, sentToday: 1 })
    .onConflictDoUpdate({
      target: loginCodes.email,
      set: {
        ...fresh,
        dayStart: sql`case when ${sameDay} then ${loginCodes.dayStart} else ${now.toISOString()} end`,
        sentToday: sql`case when ${sameDay} then ${loginCodes.sentToday} + 1 else 1 end`,
      },
      setWhere: and(
        lt(loginCodes.sentAt, new Date(now.getTime() - LOGIN_CODE_COOLDOWN_S * 1000)),
        sql`not (${sameDay} and ${loginCodes.sentToday} >= ${LOGIN_CODES_PER_DAY})`,
      ),
    })
    .returning({ email: loginCodes.email });
  if (issued) return code;

  const [last] = await db.select().from(loginCodes).where(eq(loginCodes.email, email)).limit(1);
  const wait = last ? LOGIN_CODE_COOLDOWN_S - Math.floor((now.getTime() - last.sentAt.getTime()) / 1000) : 0;
  if (wait > 0) throw new HttpError(429, `验证码刚发过，${wait} 秒后可以再发。`);
  throw new HttpError(429, `这个邮箱今天已经收了 ${LOGIN_CODES_PER_DAY} 次验证码，明天再试吧。`);
}

/** Spend one try on the code sent to this address. Resolves only for the right code, which is then used up. */
export async function redeemLoginCode(email: string, code: string): Promise<void> {
  const now = new Date();
  // The try is counted before the code is compared
  const [row] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(and(eq(loginCodes.email, email), gt(loginCodes.expiresAt, now), lt(loginCodes.attempts, LOGIN_CODE_MAX_ATTEMPTS)))
    .returning({ codeHash: loginCodes.codeHash });
  if (!row) {
    const [r] = await db.select().from(loginCodes).where(eq(loginCodes.email, email)).limit(1);
    if (r && r.expiresAt > now) throw new HttpError(429, "错误次数太多，请重新获取验证码。");
    throw new HttpError(400, "验证码过期了，请重新获取。");
  }
  if (!/^\d{6}$/.test(code) || !codeMatches(email, code, row.codeHash)) throw new HttpError(400, "验证码不对，再看看邮件。");

  // Of two requests carrying the right code, only the one that clears it signs in.
  // The row stays, so the cooldown and the daily count still apply.
  const [used] = await db
    .update(loginCodes)
    .set({ codeHash: "", expiresAt: now })
    .where(and(eq(loginCodes.email, email), eq(loginCodes.codeHash, row.codeHash)))
    .returning({ email: loginCodes.email });
  if (!used) throw new HttpError(400, "验证码过期了，请重新获取。");
}

/** Forget an address entirely, for account deletion. */
export async function forgetLoginCodes(email: string) {
  await db.delete(loginCodes).where(eq(loginCodes.email, email));
}
