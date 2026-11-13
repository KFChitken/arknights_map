import "server-only";
import { eq, gte, isNull, sql } from "drizzle-orm";
import { beijingDate, beijingMidnight } from "../beijing";
import { db } from "./db";
import { dailyTotals, friendships, users } from "./schema";

const DAY_MS = 86_400_000;

/** count(*) of the rows for which `cond` holds, as a number */
const countWhere = (cond: ReturnType<typeof sql>) => sql<number>`count(*) filter (where ${cond})`.mapWith(Number);
const ts = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`;

/**
 * Bring today's row of sitewide totals up to date. It runs every few minutes, so each day's row ends up
 * holding that day's numbers, in one pass over the accounts and one over the 触须之交 begun since yesterday.
 * After midnight, yesterday's signups, friendships and players are counted once more to take in its last
 * minutes; its week of visitors and its visitors cannot be, as visit days only move on: a player who came
 * yesterday and again today carries today's date now, so the last count before midnight stands.
 */
export async function recordDailyTotals(now = Date.now()) {
  const today = beijingDate(now);
  const yesterday = beijingDate(now - DAY_MS);
  const midnight = beijingMidnight(today);
  const before = beijingMidnight(yesterday);
  const [u] = await db
    .select({
      activeWeek: countWhere(sql`${users.lastSeenOn} >= ${beijingDate(now - 6 * DAY_MS)}::date`),
      players: sql<number>`count(*)`.mapWith(Number),
      visitors: countWhere(sql`${users.lastSeenOn} = ${today}::date`),
      signups: countWhere(sql`${users.createdAt} >= ${ts(midnight)}`),
      playersBefore: countWhere(sql`${users.createdAt} < ${ts(midnight)}`),
      signupsBefore: countWhere(sql`${users.createdAt} >= ${ts(before)} and ${users.createdAt} < ${ts(midnight)}`),
    })
    .from(users)
    .where(isNull(users.demoKey));
  const [f] = await db
    .select({
      today: countWhere(sql`${friendships.createdAt} >= ${ts(midnight)}`),
      yesterday: countWhere(sql`${friendships.createdAt} < ${ts(midnight)}`),
    })
    .from(friendships)
    .where(gte(friendships.createdAt, new Date(before)));
  const row = { activeWeek: u.activeWeek, signups: u.signups, friendships: f.today, players: u.players, visitors: u.visitors };
  await db.insert(dailyTotals).values({ day: today, ...row }).onConflictDoUpdate({ target: dailyTotals.day, set: row });
  await db
    .update(dailyTotals)
    .set({ signups: u.signupsBefore, friendships: f.yesterday, players: u.playersBefore })
    .where(eq(dailyTotals.day, yesterday));
}
