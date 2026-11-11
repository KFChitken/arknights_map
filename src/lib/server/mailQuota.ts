import "server-only";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { MAIL_DAILY_LIMIT, MAIL_SLOW_DAILY_LIMIT, MAIL_SLOW_DOMAINS, MAIL_SLOW_HOURLY_LIMIT } from "./env";
import { mailSends } from "./schema";

/** Advisory lock taken while counting the site's mail, so parallel senders are counted one at a time */
export const MAIL_LOCK = 7_316_001;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** mail_sends kinds that are sign-in codes: "login-slow" to a service slow just now (MAIL_SLOW_DOMAINS), "login" to any other */
export const LOGIN_KINDS = ["login", "login-slow"];

/** Whether an address is at a mail service slow to take our mail just now (MAIL_SLOW_DOMAINS) */
export const isSlowMail = (email: string) => MAIL_SLOW_DOMAINS.includes(email.slice(email.lastIndexOf("@") + 1).toLowerCase());

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Inside a transaction: hold the mail lock until it ends, and say whether one more sign-in code
 * (LOGIN_KINDS) fits under MAIL_DAILY_LIMIT for the last 24 hours. Only login codes count: the
 * admin's report reminders have rules of their own (src/lib/server/safety.ts). The caller records its
 * send in mail_sends before committing. One ask at a time holds the lock site-wide, so it covers as
 * little as it can: older sends are dropped by a timed job (loginCodes.ts pruneSignInMail), not here.
 */
export async function mailRoom(tx: Tx, now: Date) {
  await tx.execute(sql`select pg_advisory_xact_lock(${MAIL_LOCK})`);
  const [sent] = await tx
    .select({ n: count() })
    .from(mailSends)
    .where(and(inArray(mailSends.kind, LOGIN_KINDS), gt(mailSends.sentAt, new Date(now.getTime() - DAY_MS))));
  return sent.n < MAIL_DAILY_LIMIT;
}

/**
 * Inside mailRoom's transaction: which of the slow services' caps one more code to them would pass
 * (the last 24 hours' or the last hour's), or null when it fits. All three processes count the same rows.
 */
export async function slowRoomFull(tx: Tx, now: Date): Promise<"day" | "hour" | null> {
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
  const [sent] = await tx
    .select({ day: count(), hour: sql<number>`count(*) filter (where ${mailSends.sentAt} > ${hourAgo})`.mapWith(Number) })
    .from(mailSends)
    .where(and(eq(mailSends.kind, "login-slow"), gt(mailSends.sentAt, new Date(now.getTime() - DAY_MS))));
  if (sent.day >= MAIL_SLOW_DAILY_LIMIT) return "day";
  if (sent.hour >= MAIL_SLOW_HOURLY_LIMIT) return "hour";
  return null;
}
