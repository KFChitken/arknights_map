import "server-only";
import { eq } from "drizzle-orm";
import { GRAY_MAX_DAYS, type GrayState } from "../adminConsole";
import { beijingDate } from "../beijing";
import { nextMemorial } from "../memorials";
import { db } from "./db";
import { HttpError } from "./http";
import { onReload, reloadEverywhere } from "./live";
import { siteSettings } from "./schema";
import { errorCode } from "./signals";

/**
 * Settings for the whole site that the owner changes in the 管理台 (site_settings), kept in memory by every process
 * and read before the first page asks (src/instrumentation-node.ts): a change reaches every process at once
 * (reloadEverywhere), and each reads them again every RELOAD_MS anyway. For now only 全站变灰: until when everyone
 * sees the site in gray, for a national day of mourning. It lives on globalThis because Next.js can load this module
 * once per route bundle.
 */

type Held = { grayUntil: number | null; loading: Promise<void> | null; again: boolean; started: boolean };
const g = globalThis as unknown as { siteSettingsHeld?: Held };
const held = (g.siteSettingsHeld ??= { grayUntil: null, loading: null, again: false, started: false });
const RELOAD_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const GRAY = "gray";

/** gray's value: { until } as an ISO time; anything else is no gray at all */
function untilOf(value: unknown) {
  const until = value && typeof value === "object" ? Date.parse(String((value as { until?: unknown }).until)) : NaN;
  return Number.isFinite(until) ? until : null;
}

/** Read the settings again. Asked again meanwhile, it reads once more after, so the last change is never missed. */
export function loadSettings(): Promise<void> {
  if (held.loading) {
    held.again = true;
    return held.loading;
  }
  const loading = (async () => {
    try {
      do {
        held.again = false;
        const rows = await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings);
        held.grayUntil = untilOf(rows.find((r) => r.key === GRAY)?.value);
      } while (held.again);
    } finally {
      held.loading = null;
    }
  })();
  held.loading = loading;
  return loading;
}

// wherever this module is loaded, so the word from another process reaches it
onReload("settings", loadSettings);

/** At the start of every process (src/instrumentation-node.ts). Never throws: until they can be read, there is no gray. */
export async function startSettings() {
  if (held.started) return;
  held.started = true;
  setInterval(() => loadSettings().catch((e) => console.error("settings: reading them again failed", errorCode(e))), RELOAD_MS).unref();
  await loadSettings().catch((e) => console.error("settings: reading them failed, so there is no gray for now", errorCode(e)));
}

/** Until when the whole site is gray, or null when it is not (never set, ended, or past): from memory, never the database */
export const grayUntil = (now = Date.now()) => (held.grayUntil !== null && held.grayUntil > now ? held.grayUntil : null);

/** What 全站变灰 shows: whether the site is gray now and until when, and the next day of remembrance */
export const grayState = (now = Date.now()): GrayState => ({ until: grayUntil(now), memorial: nextMemorial(beijingDate(now)) });

const GRAY_WHEN = `恢复时间要在现在到 ${GRAY_MAX_DAYS} 天以内。`;

/**
 * Gray for everyone until a moment (ms) between now and GRAY_MAX_DAYS ahead, set by byId: on every process at once,
 * and on the pages open within 2 minutes. Says until when, as kept.
 */
export async function setGray(byId: string, until: unknown, now = Date.now()) {
  const t = typeof until === "number" ? Math.floor(until) : NaN;
  if (!Number.isFinite(t) || t <= now || t > now + GRAY_MAX_DAYS * DAY_MS) throw new HttpError(400, GRAY_WHEN);
  const set = { value: { until: new Date(t).toISOString() }, updatedAt: new Date(now), updatedBy: byId };
  await db
    .insert(siteSettings)
    .values({ key: GRAY, ...set })
    .onConflictDoUpdate({ target: siteSettings.key, set });
  await reloadEverywhere("settings");
  return t;
}

/** Colour again for everyone, before the time set. Says whether the site was gray till then. */
export async function endGray(now = Date.now()) {
  const gone = await db.delete(siteSettings).where(eq(siteSettings.key, GRAY)).returning({ value: siteSettings.value });
  await reloadEverywhere("settings");
  return gone.some((r) => (untilOf(r.value) ?? 0) > now);
}
