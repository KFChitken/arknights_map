import "server-only";
import { eq, sql } from "drizzle-orm";
import type { MainlandMap } from "../types";
import { beijingMonth } from "./amapLoads";
import { db } from "./db";
import { MAINLAND_MAP } from "./env";
import { watchState } from "./schema";
import { errorCode } from "./signals";

/**
 * Which map visitors from mainland China start with (src/app/page.tsx): 高德's, but 腾讯's for the rest of a Beijing
 * month in which 高德's map loads ran out, unless MAINLAND_MAP holds one. The site's checks see the pages saying so and
 * keep the month as amapOut in watch_state (src/lib/server/watch.ts); a new month needs nothing done. On the page each
 * map still gives way to the next when it cannot load (src/components/MapApp.tsx). Kept in memory by every process and
 * read again every minute, on globalThis because Next.js can load this module once per route bundle.
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

/** The Beijing month (as 2026-11) 高德's map loads ran out in, when that is this month: from memory */
export const amapOutNow = (now = Date.now()) => (held.amapOut !== null && held.amapOut === beijingMonth(now) ? held.amapOut : null);

/** The map a visitor from mainland China starts with now: from memory, never the database */
export function mainlandMap(now = Date.now(), setting: typeof MAINLAND_MAP = MAINLAND_MAP): MainlandMap {
  if (setting !== "auto") return setting;
  return amapOutNow(now) ? "tencent" : "amap";
}

/**
 * 高德's map loads ran out this Beijing month: 腾讯's map first for the rest of it, in this process at once and in the
 * others within the minute. Says whether that is news, false when the month was kept already.
 */
export async function recordAmapOut(now = Date.now()): Promise<boolean> {
  const month = beijingMonth(now);
  if (held.amapOut === month) return false;
  const at = new Date(now);
  const rows = await db
    .insert(watchState)
    .values({ key: KEY, value: month, updatedAt: at })
    .onConflictDoUpdate({
      target: watchState.key,
      set: { value: month, updatedAt: at },
      setWhere: sql`${watchState.value} is distinct from ${month}`,
    })
    .returning({ key: watchState.key });
  held.amapOut = month;
  return rows.length > 0;
}

/** For the tests: as a process that has read nothing yet */
export function forgetMainlandMap() {
  held.amapOut = null;
}
