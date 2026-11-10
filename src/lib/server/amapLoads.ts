import "server-only";
import { sql } from "drizzle-orm";
import { beijingDate, beijingMidnight } from "../beijing";
import { db } from "./db";
import { watchState } from "./schema";

/**
 * 高德's map loads this month, as near as the site can tell: a personal account may make
 * AMAP_MAP_LOADS maps a month, and each visit from mainland China makes one (src/app/page.tsx
 * counts the visit). An estimate: a visit that starts abroad makes no 高德 map, a reload makes
 * another. Counted per Beijing month, with nothing about the visitor; kept in memory and added
 * to the database's count when the site's checks look (every ten minutes), so a restart loses
 * at most those minutes.
 */
export const amapMapLoads = () => Number(process.env.AMAP_MAP_LOADS) || 1_500_000;

const KEY = "amapLoads";
const g = globalThis as { __amapLoadsPending?: number };

/** One more visit from mainland China */
export function countAmapLoad() {
  g.__amapLoadsPending = (g.__amapLoadsPending ?? 0) + 1;
}

/** The Beijing month a moment falls in, as 2026-11 */
export const beijingMonth = (now: number) => beijingDate(now).slice(0, 7);

/**
 * This month's count so far, the visits counted since last time added in. One statement, as every
 * process of the live site adds its own visits (src/instrumentation-node.ts) and the checks read it.
 */
export async function saveAmapLoads(now = Date.now()): Promise<{ month: string; count: number }> {
  const month = beijingMonth(now);
  const add = g.__amapLoadsPending ?? 0;
  g.__amapLoadsPending = 0;
  try {
    const at = new Date(now);
    const fresh = JSON.stringify({ month, count: add });
    const rows = await db
      .insert(watchState)
      .values({ key: KEY, value: fresh, updatedAt: at })
      .onConflictDoUpdate({
        target: watchState.key,
        set: {
          // the same month: add to it; a new month: start again from this process's visits
          value: sql`case when (${watchState.value}::json->>'month') = ${month}
            then json_build_object('month', ${month}::text, 'count', coalesce((${watchState.value}::json->>'count')::bigint, 0) + ${add})::text
            else ${fresh} end`,
          updatedAt: at,
        },
      })
      .returning({ value: watchState.value });
    const kept = JSON.parse(rows[0]?.value ?? fresh) as { month: string; count: number };
    return { month: kept.month, count: Number(kept.count) };
  } catch (e) {
    // counted again next time
    g.__amapLoadsPending = (g.__amapLoadsPending ?? 0) + add;
    throw e;
  }
}

/** Days of the month gone by (Beijing time, with the part of today), and days in it */
export function monthProgress(now: number) {
  const month = beijingMonth(now);
  const start = beijingMidnight(`${month}-01`);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { gone: (now - start) / 86_400_000, days };
}

/** For the tests */
export function forgetAmapLoads() {
  g.__amapLoadsPending = 0;
}
