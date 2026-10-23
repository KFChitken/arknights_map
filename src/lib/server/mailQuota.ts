import "server-only";
import { count, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { MAIL_DAILY_LIMIT } from "./env";
import { mailSends } from "./schema";

/** Advisory lock taken while counting the site's mail, so parallel senders are counted one at a time */
const MAIL_LOCK = 7_316_001;
const DAY_MS = 86_400_000;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Inside a transaction: hold the mail lock until it ends, forget sends older
 * than a day, and say whether one more email fits under MAIL_DAILY_LIMIT. The
 * caller records its send in mail_sends before committing.
 */
export async function mailRoom(tx: Tx, now: Date) {
  await tx.execute(sql`select pg_advisory_xact_lock(${MAIL_LOCK})`);
  await tx.delete(mailSends).where(lt(mailSends.sentAt, new Date(now.getTime() - DAY_MS)));
  const [sent] = await tx.select({ n: count() }).from(mailSends);
  return sent.n < MAIL_DAILY_LIMIT;
}
