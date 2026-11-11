import "server-only";
import { desc, gte, sql } from "drizzle-orm";
import type { AppCountDay, AppCountName } from "../appCounts";
import { beijingDate } from "../beijing";
import { db } from "./db";
import { appCounts } from "./schema";

/**
 * 存到桌面's counts (src/lib/appCounts.ts), per Beijing day: kept in memory and added to the database
 * once a minute by each process, and once more when it is told to stop (src/instrumentation-node.ts),
 * so opening the site costs no write of its own.
 */

const g = globalThis as { __appCounts?: Map<string, number> };
const pending = () => (g.__appCounts ??= new Map());

/** One more of these today (Beijing time) */
export function countApp(name: AppCountName, now = Date.now()) {
  const key = `${beijingDate(now)}|${name}`;
  pending().set(key, (pending().get(key) ?? 0) + 1);
}

/** What was counted since last time, added to the days' rows in one statement; kept for next time when that fails */
export async function saveAppCounts() {
  const taken = pending();
  if (!taken.size) return;
  g.__appCounts = new Map();
  const rows = [...taken].map(([key, n]) => {
    const [day, name] = key.split("|");
    return { day, name, n };
  });
  try {
    await db
      .insert(appCounts)
      .values(rows)
      .onConflictDoUpdate({ target: [appCounts.day, appCounts.name], set: { n: sql`${appCounts.n} + excluded.n` } });
  } catch (e) {
    for (const [key, n] of taken) pending().set(key, (pending().get(key) ?? 0) + n);
    throw e;
  }
}

/** The last days' counts for the admin page, newest first; days without any are left out */
export async function appCountDays(days = 14, now = Date.now()): Promise<AppCountDay[]> {
  const since = beijingDate(now - (days - 1) * 86_400_000);
  const rows = await db.select().from(appCounts).where(gte(appCounts.day, since)).orderBy(desc(appCounts.day));
  const out = new Map<string, AppCountDay>();
  for (const r of rows) {
    const day = out.get(r.day) ?? { day: r.day, counts: {} };
    day.counts[r.name as AppCountName] = r.n;
    out.set(r.day, day);
  }
  return [...out.values()];
}

/** For the tests */
export function forgetAppCounts() {
  g.__appCounts = new Map();
}
