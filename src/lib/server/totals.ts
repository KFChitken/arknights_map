import "server-only";
import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import { beijingDate, beijingMidnight } from "../beijing";
import { db } from "./db";
import { dailyTotals, friendships, users } from "./schema";

const DAY_MS = 86_400_000;

/**
 * Bring today's row of sitewide totals up to date. It runs every few minutes,
 * so each day's row ends up holding that day's numbers. After midnight,
 * yesterday's signups and friendships are counted once more to take in its
 * last minutes; its week of visitors cannot be, as visit days only move on.
 */
export async function recordDailyTotals(now = Date.now()) {
  const today = beijingDate(now);
  const yesterday = beijingDate(now - DAY_MS);
  const [{ n: activeWeek }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(isNull(users.demoKey), gte(users.lastSeenOn, beijingDate(now - 6 * DAY_MS))));
  const counts = await dayCounts(today);
  await db
    .insert(dailyTotals)
    .values({ day: today, activeWeek, ...counts })
    .onConflictDoUpdate({ target: dailyTotals.day, set: { activeWeek, ...counts } });
  await db.update(dailyTotals).set(await dayCounts(yesterday)).where(eq(dailyTotals.day, yesterday));
}

/** Accounts made and 触须之交 formed on a Beijing day. */
async function dayCounts(day: string) {
  const from = new Date(beijingMidnight(day));
  const to = new Date(from.getTime() + DAY_MS);
  const [{ n: signups }] = await db
    .select({ n: count() })
    .from(users)
    .where(and(isNull(users.demoKey), gte(users.createdAt, from), lt(users.createdAt, to)));
  const [{ n: friends }] = await db
    .select({ n: count() })
    .from(friendships)
    .where(and(gte(friendships.createdAt, from), lt(friendships.createdAt, to)));
  return { signups, friendships: friends };
}
