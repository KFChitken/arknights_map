import "server-only";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { after } from "next/server";
import { distanceKm } from "../geo";
import type { LngLat } from "../types";
import { db } from "./db";
import { nameThen, tellAdmin } from "./safety";
import { reports, roaches, users } from "./schema";
import { errorCode } from "./signals";

/**
 * 提醒区, drawn by the owner like 禁放区 (off_limits_areas with watch): a roach put in one stands as anywhere else, and
 * nothing the player sees changes, but the site reports it to the owner and the admins, as the place reason with no
 * reporter (reports.watch_area_id), which emails them as an urgent report does. Once a roach and a place while that is
 * open, nor again within WATCH_QUIET_DAYS of it being handled, so living next door is not reported at every move.
 * The list stays on the server (src/lib/server/zones.ts reads it): never in src/lib/offLimits.ts, which pages hold too.
 */

export type WatchArea = { id: string; at: LngLat; radiusM: number; label: string };
type Held = { areas: WatchArea[]; marking: Set<Promise<unknown>> };
// on globalThis: Next.js can load this module once per route bundle
const g = globalThis as unknown as { watchHeld?: Held };
const held = (g.watchHeld ??= { areas: [], marking: new Set() });

/** Not reported again for the same place this long after the last report of it was handled */
export const WATCH_QUIET_DAYS = 30;
const DAY_MS = 86_400_000;

/** The 提醒区 in force, as src/lib/server/zones.ts reads them */
export function setWatchAreas(areas: WatchArea[]) {
  held.areas = areas;
}

/** The 提醒区 a spot lies in */
export function watchAreasAt(p: LngLat): WatchArea[] {
  return held.areas.filter((a) => distanceKm(p, a.at) * 1000 <= a.radiusM);
}

/** A label as a report's context shows it: its first 20 characters */
const short = (label: string) => {
  const chars = [...label];
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}…` : label;
};

type Standing = { id: string; userId: string; slot: number; lng: number; lat: number };

/**
 * Report a roach standing in a 提醒区, unless it is already, or was handled within WATCH_QUIET_DAYS. Whether it was
 * reported now.
 */
export async function markWatched(roach: Standing, area: Pick<WatchArea, "id" | "label">, now = Date.now()): Promise<boolean> {
  const [already] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.roachId, roach.id),
        eq(reports.watchAreaId, area.id),
        or(isNull(reports.resolvedAt), gt(reports.resolvedAt, new Date(now - WATCH_QUIET_DAYS * DAY_MS))),
      ),
    )
    .limit(1);
  if (already) return false;
  const [owner] = await db.select().from(users).where(eq(users.id, roach.userId)).limit(1);
  if (!owner) return false;
  await db.insert(reports).values({
    reporterId: null,
    targetId: roach.userId,
    reason: "place",
    context: `自动标记：放进了提醒区「${short(area.label)}」（${roach.slot === 0 ? "本体" : "克隆体"}）`,
    targetName: nameThen(owner),
    roachId: roach.id,
    placeLng: roach.lng,
    placeLat: roach.lat,
    roachSlot: roach.slot,
    watchAreaId: area.id,
    createdAt: new Date(now),
  });
  return true;
}

/** Report the roaches standing in a 提醒区 just drawn (none is moved); how many were reported */
export async function markInside(area: WatchArea, now = Date.now()) {
  const inside = await db
    .select({ id: roaches.id, userId: roaches.userId, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${area.at.lng}, ${area.at.lat}), 4326)::geography, ${area.radiusM})`);
  let marked = 0;
  for (const r of inside) if (await markWatched(r, area, now)) marked++;
  if (marked) tellAdmin();
  return marked;
}

/**
 * A player put a roach of theirs down or moved it (src/lib/server/world.ts placeRoach): if it is in a 提醒区, it is
 * reported after the answer. Never fails the placing, nor slows it.
 */
export function markIfWatched(userId: string, slot: number, at: LngLat) {
  const areas = watchAreasAt(at);
  if (!areas.length) return;
  const marking = (async () => {
    const [r] = await db
      .select({ id: roaches.id, userId: roaches.userId, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat })
      .from(roaches)
      .where(and(eq(roaches.userId, userId), eq(roaches.slot, slot)))
      .limit(1);
    // moved again meanwhile: that move is looked at by itself
    if (!r || r.lng !== at.lng || r.lat !== at.lat) return;
    let marked = 0;
    for (const a of areas) if (await markWatched(r, a)) marked++;
    if (marked) tellAdmin();
  })().catch((e) => console.error("watch places: reporting a roach put in a 提醒区 failed", errorCode(e)));
  held.marking.add(marking);
  void marking.finally(() => held.marking.delete(marking));
  // after the answer: Next.js keeps it (outside a request, as in the tests, it simply goes on)
  try {
    after(marking);
  } catch {}
}

/** Every report of a roach put in a 提醒区 still under way, settled (for the tests) */
export const watchMarksDone = () => Promise.allSettled([...held.marking]);
