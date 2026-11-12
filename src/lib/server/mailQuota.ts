import "server-only";
import { and, count, gt, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { MAIL_DAILY_LIMIT, MAIL_SLOW_DAILY_LIMIT, MAIL_SLOW_DOMAINS, MAIL_SLOW_HOURLY_LIMIT, MAIL_SLOW_NEW_SHARE } from "./env";
import { mailSends } from "./schema";

/**
 * Advisory lock taken while counting the mail to the slow services (MAIL_SLOW_DOMAINS), whose small caps
 * must hold to the code: their asks are counted one at a time. (7_316_001 was the lock every code took.)
 */
export const MAIL_SLOW_LOCK = 7_316_003;
/** How often each process counts the site's sign-in mail of the last 24 hours again */
export const COUNT_EVERY_MS = 15_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * mail_sends kinds that are sign-in codes: to a service slow just now (MAIL_SLOW_DOMAINS) "login-slow" for an
 * address with an account and "login-slow-new" for one without, "login" to any other
 */
export const LOGIN_KINDS = ["login", "login-slow", "login-slow-new"];
const SLOW_KINDS = ["login-slow", "login-slow-new"];

/** Whether an address is at a mail service slow to take our mail just now (MAIL_SLOW_DOMAINS) */
export const isSlowMail = (email: string) => MAIL_SLOW_DOMAINS.includes(email.slice(email.lastIndexOf("@") + 1).toLowerCase());

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// this process's count of the last 24 hours' sign-in mail (at most COUNT_EVERY_MS old), and the codes it
// has let through since
let counted: { at: number; n: number } | null = null;
let counting: Promise<void> | null = null;
let since = 0;

async function countAgain(now: Date) {
  const [sent] = await db
    .select({ n: count() })
    .from(mailSends)
    .where(and(inArray(mailSends.kind, LOGIN_KINDS), gt(mailSends.sentAt, new Date(now.getTime() - DAY_MS))));
  counted = { at: now.getTime(), n: sent.n };
  since = 0;
}

/**
 * Whether one more sign-in code (LOGIN_KINDS) fits under MAIL_DAILY_LIMIT for the last 24 hours, and if
 * so, room for it taken (give it back with mailRoomBack when no code goes after all). Counted by each
 * process from the database at most every COUNT_EVERY_MS, plus what it let through since, with no lock:
 * codes are no longer issued one at a time site-wide (the peak of 11/11 spent 409 ms on average waiting
 * for that lock). The limit is a fuse, so passing it by what three processes send in 15 seconds is
 * nothing to it. Only login codes count: the admin's report reminders have rules of their own
 * (src/lib/server/safety.ts). Older sends are dropped by a timed job (loginCodes.ts pruneSignInMail).
 */
export async function mailRoom(now: Date) {
  if (!counted || now.getTime() - counted.at >= COUNT_EVERY_MS || now.getTime() < counted.at) {
    counting ??= countAgain(now).finally(() => (counting = null));
    await counting;
  }
  if (counted!.n + since >= MAIL_DAILY_LIMIT) return false;
  since++;
  return true;
}

/** Room taken by mailRoom that no code used after all */
export function mailRoomBack() {
  since = Math.max(0, since - 1);
}

/** Tests: count the site's mail again on the next ask */
export function forgetMailCount() {
  counted = null;
  since = 0;
}

/**
 * Inside a transaction holding MAIL_SLOW_LOCK: which of the slow services' caps one more code to them would
 * pass (the last 24 hours' or the last hour's), or null when it fits. All three processes count the same rows.
 * Codes to an address with no account (known false) also keep within MAIL_SLOW_NEW_SHARE of each cap
 * ("new-day", "new-hour"), so the rest is left for the players who have one.
 */
export async function slowRoomFull(tx: Tx, now: Date, known: boolean): Promise<"day" | "hour" | "new-day" | "new-hour" | null> {
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
  const isNew = sql`${mailSends.kind} = 'login-slow-new'`;
  const [sent] = await tx
    .select({
      day: count(),
      hour: sql<number>`count(*) filter (where ${mailSends.sentAt} > ${hourAgo})`.mapWith(Number),
      newDay: sql<number>`count(*) filter (where ${isNew})`.mapWith(Number),
      newHour: sql<number>`count(*) filter (where ${isNew} and ${mailSends.sentAt} > ${hourAgo})`.mapWith(Number),
    })
    .from(mailSends)
    .where(and(inArray(mailSends.kind, SLOW_KINDS), gt(mailSends.sentAt, new Date(now.getTime() - DAY_MS))));
  if (sent.day >= MAIL_SLOW_DAILY_LIMIT) return "day";
  if (sent.hour >= MAIL_SLOW_HOURLY_LIMIT) return "hour";
  if (known) return null;
  if (sent.newDay >= newShareOf(MAIL_SLOW_DAILY_LIMIT)) return "new-day";
  if (sent.newHour >= newShareOf(MAIL_SLOW_HOURLY_LIMIT)) return "new-hour";
  return null;
}

/** MAIL_SLOW_NEW_SHARE of a cap, rounded down (past the float's error: 100 × 0.57 is 56.99999999999999) */
const newShareOf = (cap: number) => Math.floor(cap * MAIL_SLOW_NEW_SHARE + 1e-9);
