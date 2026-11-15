import "server-only";
import { eq, sql } from "drizzle-orm";
import type { MainlandMap } from "../types";
import { beijingDate } from "../beijing";
import { db } from "./db";
import { MAINLAND_MAP } from "./env";
import { watchState } from "./schema";
import { errorCode } from "./signals";

/**
 * Which map visitors from mainland China start with (src/app/page.tsx): 高德's, but 腾讯's for the rest of a Beijing
 * day on which 高德 would not give its map loads, unless MAINLAND_MAP holds one. The site's checks see the pages saying
 * so and keep the day as amapOut in watch_state (src/lib/server/watch.ts); a new day needs nothing done: 高德's comes
 * first again, and is kept off again if it still will not. A day, not the month: on 2026-11-14 that was its daily
 * allowance, back the next morning, and 腾讯's had been kept to the month's end. On the page each map still gives way
 * to the next when it cannot load (src/components/MapApp.tsx). Kept in memory by every process and read again every
 * minute, on globalThis because Next.js can load this module once per route bundle.
 */

type Held = { amapOut: string | null; started: boolean };
const g = globalThis as unknown as { mainlandMapHeld?: Held };
const held = (g.mainlandMapHeld ??= { amapOut: null, started: false });
const KEY = "amapOut";
const RELOAD_MS = 60_000;

/** Read again the month 高德's map loads ran out in */
export async function loadAmapOut() {
  const [row] = await db.select({ value: watchState.value }).from(watchState).where(eq(watchState.key, KEY)).limit(1);
  held.amapOut = row?.value ?? null;
}

/** At the start of every process (src/instrumentation-node.ts). Never throws: until it can be read, 高德's comes first. */
export async function startMainlandMap() {
  if (held.started) return;
  held.started = true;
  setInterval(() => loadAmapOut().catch((e) => console.error("mainland map: reading it again failed", errorCode(e))), RELOAD_MS).unref();
  await loadAmapOut().catch((e) => console.error("mainland map: reading it failed, so Amap's comes first for now", errorCode(e)));
}

/** The Beijing day (as 2026-11-14) 高德 would not give its map loads on, when that is today: from memory */
export const amapOutNow = (now = Date.now()) => (held.amapOut !== null && held.amapOut === beijingDate(now) ? held.amapOut : null);

/** The map a visitor from mainland China starts with now: from memory, never the database */
export function mainlandMap(now = Date.now(), setting: typeof MAINLAND_MAP = MAINLAND_MAP): MainlandMap {
  if (setting !== "auto") return setting;
  return amapOutNow(now) ? "tencent" : "amap";
}

/**
 * 高德 would not give its map loads this Beijing day: 腾讯's map first for the rest of it, in this process at once and
 * in the others within the minute. Says whether that is news, false when the day was kept already.
 */
export async function recordAmapOut(now = Date.now()): Promise<boolean> {
  const day = beijingDate(now);
  if (held.amapOut === day) return false;
  const at = new Date(now);
  const rows = await db
    .insert(watchState)
    .values({ key: KEY, value: day, updatedAt: at })
    .onConflictDoUpdate({
      target: watchState.key,
      set: { value: day, updatedAt: at },
      setWhere: sql`${watchState.value} is distinct from ${day}`,
    })
    .returning({ key: watchState.key });
  held.amapOut = day;
  return rows.length > 0;
}

/** For the tests: as a process that has read nothing yet */
export function forgetMainlandMap() {
  held.amapOut = null;
}
