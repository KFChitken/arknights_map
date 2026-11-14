import gcoord from "gcoord";
import { and, eq, or, sql, type AnyColumn } from "drizzle-orm";
import before from "@/data/china-gcj-before-2026-11-15.json";
import { shifted } from "../coords";
import { distanceKm } from "../geo";
import { area, inArea, type Box, type Ring } from "../shapes";
import type { LngLat } from "../types";
import { db } from "./db";
import { borderFixes, roaches } from "./schema";

/**
 * The borders that decide where Amap shifts a spot (src/lib/coords.ts) were drawn anew on 2026-11-15: finely
 * around the towns on China's land borders (Natural Earth's were off by up to a few km there), and as China draws
 * them (藏南 is China's). Where the answer changed, a roach put there on Amap would now show a few hundred metres
 * off on it. People by China's borders put theirs on Amap, so each such roach is put where Amap shows it where it
 * did, once (border_fixes keeps where each was, to check and put back, and that it ran). Its public id stays, and
 * its owner is not told: on Amap nothing moved. The moves and the other records stay as they were.
 */
export const BORDER_FIX = "2026-11-15";

const BEFORE_BOX = before.box as Box;
const BEFORE_FOREIGN = area(before.foreign as Ring[]);

/** Whether Amap drew a spot shifted, by the borders before this fix */
export function shiftedBefore(p: LngLat) {
  return p.lng >= BEFORE_BOX[0] && p.lng <= BEFORE_BOX[2] && p.lat >= BEFORE_BOX[1] && p.lat <= BEFORE_BOX[3] && !inArea(p, BEFORE_FOREIGN);
}

const gcjOf = (p: LngLat): LngLat => {
  const [lng, lat] = gcoord.transform([p.lng, p.lat], gcoord.WGS84, gcoord.GCJ02);
  return { lng, lat };
};
const wgsOf = (p: LngLat): LngLat => {
  const [lng, lat] = gcoord.transform([p.lng, p.lat], gcoord.GCJ02, gcoord.WGS84);
  return { lng, lat };
};
/** Where Amap draws a spot, by a rule of where it shifts */
const shown = (p: LngLat, rule: (p: LngLat) => boolean) => (rule(p) ? gcjOf(p) : p);

/**
 * Where a spot kept by the borders before goes, so that Amap shows it where it showed it: undone where it was shown
 * as kept and is shifted now, shifted where it was shown shifted and is not now. Null when nothing changed for it, or
 * right at the border, where the spot moved would be on the other side again: none does it, and it stays.
 */
export function fixedSpot(p: LngLat): LngLat | null {
  const was = shiftedBefore(p);
  if (was === shifted(p)) return null;
  const to = was ? gcjOf(p) : wgsOf(p);
  return distanceKm(shown(to, shifted), shown(p, shiftedBefore)) * 1000 < 1 ? to : null;
}

export type BorderFixReport = { places: number; rideFroms: number; atBorder: number; dry: boolean };

/**
 * Once: every roach whose spot (where it stands, or where a rider of 明河都尉 goes back to) Amap would show elsewhere
 * now is put right (fixedSpot), each kept in border_fixes, with a row saying it ran. A roach moved meanwhile is left
 * to its owner. dry (BORDER_FIX=dry): only counted, nothing written. Null once it has run.
 */
export async function fixBorders(dry = process.env.BORDER_FIX === "dry"): Promise<BorderFixReport | null> {
  const ran = await db
    .select({ id: borderFixes.id })
    .from(borderFixes)
    .where(and(eq(borderFixes.run, BORDER_FIX), eq(borderFixes.field, "done")))
    .limit(1);
  if (ran.length) return null;
  const [w, s, e, n] = BEFORE_BOX;
  const inBox = (lng: AnyColumn, lat: AnyColumn) => sql`(${lng} between ${w} and ${e} and ${lat} between ${s} and ${n})`;
  const rows = await db
    .select({ id: roaches.id, lng: roaches.lng, lat: roaches.lat, rideFromLng: roaches.rideFromLng, rideFromLat: roaches.rideFromLat })
    .from(roaches)
    .where(or(inBox(roaches.lng, roaches.lat), inBox(roaches.rideFromLng, roaches.rideFromLat)));
  const changes: { roachId: string; field: "place" | "ride_from"; from: LngLat; to: LngLat }[] = [];
  let atBorder = 0;
  const look = (roachId: string, field: "place" | "ride_from", from: LngLat) => {
    if (shiftedBefore(from) === shifted(from)) return;
    const to = fixedSpot(from);
    if (to) changes.push({ roachId, field, from, to });
    else atBorder++;
  };
  for (const r of rows) {
    look(r.id, "place", { lng: r.lng, lat: r.lat });
    if (r.rideFromLng !== null && r.rideFromLat !== null) look(r.id, "ride_from", { lng: r.rideFromLng, lat: r.rideFromLat });
  }
  const count = (field: "place" | "ride_from", of: typeof changes) => of.filter((c) => c.field === field).length;
  if (dry) return { places: count("place", changes), rideFroms: count("ride_from", changes), atBorder, dry };

  const made: typeof changes = [];
  await db.transaction(async (tx) => {
    for (const c of changes) {
      // only if it is still where it was read: a roach moved meanwhile is where its owner put it
      const put =
        c.field === "place"
          ? await tx
              .update(roaches)
              .set({ lng: c.to.lng, lat: c.to.lat })
              .where(and(eq(roaches.id, c.roachId), eq(roaches.lng, c.from.lng), eq(roaches.lat, c.from.lat)))
              .returning({ id: roaches.id })
          : await tx
              .update(roaches)
              .set({ rideFromLng: c.to.lng, rideFromLat: c.to.lat })
              .where(and(eq(roaches.id, c.roachId), eq(roaches.rideFromLng, c.from.lng), eq(roaches.rideFromLat, c.from.lat)))
              .returning({ id: roaches.id });
      if (!put.length) continue;
      made.push(c);
      await tx.insert(borderFixes).values({
        run: BORDER_FIX,
        roachId: c.roachId,
        field: c.field,
        fromLng: c.from.lng,
        fromLat: c.from.lat,
        toLng: c.to.lng,
        toLat: c.to.lat,
      });
    }
    await tx.insert(borderFixes).values({ run: BORDER_FIX, field: "done" }).onConflictDoNothing();
  });
  return { places: count("place", made), rideFroms: count("ride_from", made), atBorder, dry };
}
