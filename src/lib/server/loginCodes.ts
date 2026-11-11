import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { LOGIN_CODE_COOLDOWN_S, LOGIN_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_MIN, LOGIN_CODES_PER_DAY } from "../rules";
import { db } from "./db";
import { MAIL_SLOW_DAILY_LIMIT, MAIL_SLOW_PER_ADDRESS, secret } from "./env";
import { HttpError } from "./http";
import { isSlowMail, mailRoom, slowRoomFull } from "./mailQuota";
import { note } from "./signals";
import { loginCodes, mailSends } from "./schema";

/**
 * The 6-digit codes emailed for sign-in. Codes are issued one at a time under the
 * site's mail lock (mailQuota.ts), and every try is counted inside the statement
 * that checks it, so a burst of parallel requests cannot slip past the cooldown,
 * the daily cap or the number of tries.
 */

const DAY_MS = 86_400_000;

const hashCode = (email: string, code: string) =>
  createHmac("sha256", secret("AUTH_SECRET")).update(`code|${email}|${code}`).digest("base64url");

/**
 * The code for an address and the moment it runs out. It is worked out again rather than stored, so
 * a code asked for again while it still works goes out as the same code: whichever of the emails
 * arrives first signs in (2026-11-11, Gmail holding some back for minutes). Only AUTH_SECRET makes it.
 */
const codeFor = (email: string, expiresAt: Date) =>
  String(
    createHmac("sha256", secret("AUTH_SECRET")).update(`code-of|${email}|${expiresAt.toISOString()}`).digest().readUInt32BE(0) % 1_000_000,
  ).padStart(6, "0");

/** A code on its way: again when it is one already sent, still working, sent once more */
export type IssuedCode = { code: string; again: boolean; expiresAt: Date };

function codeMatches(email: string, code: string, hash: string) {
  const a = Buffer.from(hashCode(email, code));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A code for this address, or an HttpError saying when the next one can be sent. A code still
 * working (not used, run out or tried too often) goes out again as it is, its tries and its time
 * unchanged; otherwise a new one. Each email counts toward the address's day and the site's mail for
 * the last 24 hours, and none goes out once that reaches MAIL_DAILY_LIMIT.
 */
export async function issueLoginCode(email: string): Promise<IssuedCode> {
  const now = new Date();
  // a mail service slow to take our mail just now has caps of its own (mailQuota.ts), and fewer codes per address
  const slow = isSlowMail(email);
  const perDay = slow ? MAIL_SLOW_PER_ADDRESS : LOGIN_CODES_PER_DAY;
  const dayAgo = new Date(now.getTime() - DAY_MS);

  // a slow service paused altogether (MAIL_SLOW_DAILY_LIMIT below 1, e.g. -1: 0 reads as the default) gets
  // no code, and the ask does not wait for the lock only to hear so
  if (slow && MAIL_SLOW_DAILY_LIMIT < 1) refuse("day", email, perDay);

  // The address's own limits first, outside the site-wide lock, so an ask its cooldown or its day refuses
  // never waits in that queue (11/11: some 20 asks were waiting for the lock at a time, holding the
  // database's connections). Asked again under the lock below, which decides.
  const [seen] = await db
    .select({ sentAt: loginCodes.sentAt, dayStart: loginCodes.dayStart, sentToday: loginCodes.sentToday })
    .from(loginCodes)
    .where(eq(loginCodes.email, email));
  const early = seen ? addressWait(seen, now, dayAgo, perDay) : null;
  if (early !== null) refuse(early, email, perDay);

  // a code on its way, or (refused) the seconds until the next may go, 0 when the address's day is used up,
  // or which of the slow service's caps it would pass
  const issued = await db.transaction(async (tx): Promise<IssuedCode | number | "day" | "hour"> => {
    // holds the mail lock until the end: codes are issued one at a time, site-wide
    if (!(await mailRoom(tx, now))) {
      note("codeRefused", "quota");
      throw new HttpError(503, "今天的验证码邮件发完了，明天再试吧。");
    }
    // locked against a try being counted meanwhile
    const [row] = await tx.select().from(loginCodes).where(eq(loginCodes.email, email)).for("update");
    const sameDay = Boolean(row && row.dayStart > dayAgo);
    const wait = row ? addressWait(row, now, dayAgo, perDay) : null;
    if (wait !== null) return wait;
    if (slow) {
      const full = await slowRoomFull(tx, now);
      if (full) return full;
    }

    // a code made before codes were worked out (or by another secret) is not sent again: it could not be
    const again = Boolean(
      row &&
        row.codeHash &&
        row.expiresAt > now &&
        row.attempts < LOGIN_CODE_MAX_ATTEMPTS &&
        row.codeHash === hashCode(email, codeFor(email, row.expiresAt)),
    );
    const expiresAt = again && row ? row.expiresAt : new Date(now.getTime() + LOGIN_CODE_TTL_MIN * 60_000);
    const code = codeFor(email, expiresAt);
    const day = { dayStart: sameDay && row ? row.dayStart : now, sentToday: sameDay && row ? row.sentToday + 1 : 1 };
    if (row) {
      await tx
        .update(loginCodes)
        .set(again ? { sentAt: now, ...day } : { codeHash: hashCode(email, code), expiresAt, attempts: 0, sentAt: now, ...day })
        .where(eq(loginCodes.email, email));
    } else {
      await tx.insert(loginCodes).values({ email, codeHash: hashCode(email, code), expiresAt, attempts: 0, sentAt: now, ...day });
    }
    await tx.insert(mailSends).values({ sentAt: now, kind: slow ? "login-slow" : "login" });
    return { code, again, expiresAt };
  });
  if (typeof issued === "object") return issued;
  refuse(issued, email, perDay);
}

/** Seconds until this address may have its next code (its cooldown), 0 when its day's codes are used up, or null when one may go now */
function addressWait(row: { sentAt: Date; dayStart: Date; sentToday: number }, now: Date, dayAgo: Date, perDay: number): number | null {
  if (row.sentAt.getTime() > now.getTime() - LOGIN_CODE_COOLDOWN_S * 1000) {
    return Math.max(1, LOGIN_CODE_COOLDOWN_S - Math.floor((now.getTime() - row.sentAt.getTime()) / 1000));
  }
  if (row.dayStart > dayAgo && row.sentToday >= perDay) return 0;
  return null;
}

/** No code: the address's cooldown (seconds to wait), its day used up (0), or a slow service's cap for the day or the hour */
function refuse(why: number | "day" | "hour", email: string, perDay: number): never {
  if (why === "day" || why === "hour") {
    note("codeRefused", `slow-${why}`);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const service = /^(gmail|googlemail)\.com$/.test(domain) ? "Gmail" : domain;
    throw new HttpError(
      429,
      why === "day"
        ? `${service} 现在限制我们的发信，今天发往 ${service} 的验证码名额用完了。可以换 QQ 或 163 邮箱，或者明天再来。`
        : `${service} 现在限制我们的发信，这一小时发往 ${service} 的验证码名额用完了。可以过一会儿再试，或者换 QQ 或 163 邮箱。`,
    );
  }
  note("codeRefused", why > 0 ? "cooldown" : "address-day");
  if (why > 0) throw new HttpError(429, `验证码刚发过，${why} 秒后可以再发。`);
  throw new HttpError(429, `这个邮箱今天已经收了 ${perDay} 次验证码，明天再试吧。`);
}

/**
 * Every few minutes from the main process (src/instrumentation-node.ts), not on every ask: rows past both
 * their cooldown and their day only hold an address, and sends counted for more than a day count no more
 * (mailQuota.ts counts the last 24 hours itself).
 */
export async function pruneSignInMail(now = new Date()) {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  await db.delete(loginCodes).where(and(lt(loginCodes.dayStart, dayAgo), lt(loginCodes.expiresAt, now)));
  await db.delete(mailSends).where(lt(mailSends.sentAt, dayAgo));
}

/**
 * The email just made never reached the address (neverReached in mail.ts), so it counts as never
 * sent: the address may ask again at once, and neither its day nor the site's mail for the day
 * counts it. A new code is void with it; a code sent before stays, as the earlier email carries it.
 */
export async function withdrawLoginCode(email: string, issued: IssuedCode) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ sentAt: loginCodes.sentAt })
      .from(loginCodes)
      .where(and(eq(loginCodes.email, email), eq(loginCodes.codeHash, hashCode(email, issued.code))))
      .for("update");
    if (!row) return;
    const uncount = { sentAt: new Date(0), sentToday: sql`greatest(${loginCodes.sentToday} - 1, 0)` };
    await tx
      .update(loginCodes)
      .set(issued.again ? uncount : { ...uncount, codeHash: "", expiresAt: row.sentAt })
      .where(eq(loginCodes.email, email));
    // the one row it added to the site's count, written at the same moment
    await tx.execute(
      sql`delete from ${mailSends} where ${mailSends.id} = (select ${mailSends.id} from ${mailSends} where ${mailSends.kind} in ('login', 'login-slow') and ${mailSends.sentAt} = ${row.sentAt.toISOString()}::timestamptz order by ${mailSends.id} desc limit 1)`,
    );
  });
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
