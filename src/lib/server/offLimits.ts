import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isOffLimits, OFF_LIMITS_REACH, outsideOffLimits } from "../offLimits";
import { db } from "./db";
import { roachMoved, sendBack } from "./friendly";
import type { Exec } from "./guides";
import { roachesChanged } from "./roachFeed";
import { roaches, visits } from "./schema";
import { addNotes } from "./staffNotes";

/**
 * Roaches standing where no roach may (src/lib/offLimits.ts), there from before the place was
 * listed: run once as the server starts, and with none there it changes nothing. A clone
 * visiting there goes home as if asked to (just outside its home, if that is in such a place
 * too); any other roach moves just outside, under a new public id, its own guests left where
 * they sit as when a host moves. A clone riding with 明河都尉 is left to the 04:00 batch, which
 * takes it on to his next station or home, never into one. None of it counts as the player's
 * own move (no moves rows, the day's moves untouched), and each owner hears once in 站长通知
 * what came of theirs, with no yellow card: it was not their doing.
 */
export async function moveOutOfOffLimits(random: () => number = Math.random) {
  const near = await db
    .select()
    .from(roaches)
    .where(
      or(
        ...OFF_LIMITS_REACH.map(
          ({ at, m }) => sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${at.lng}, ${at.lat}), 4326)::geography, ${m * 1.05 + 10})`,
        ),
      ),
    );
  const inside = near.filter((r) => isOffLimits(r) && !r.rideSince);
  if (!inside.length) return { moved: 0, home: 0 };

  const visiting = await db
    .select()
    .from(visits)
    .where(inArray(visits.roachId, inside.map((r) => r.id)));
  const told = new Set<string>();
  const tell = async (tx: Exec, userId: string, reason: "moved" | "home") => {
    if (told.has(`${userId}:${reason}`)) return;
    await addNotes([{ userId, kind: "offLimits", reason }], tx);
    told.add(`${userId}:${reason}`);
  };

  // the guests first, so that none of them is told their host moved on the way
  let home = 0;
  for (const v of visiting) {
    const sent = await db.transaction(async (tx) => {
      // still visiting, and still sitting where it may not
      const [still] = await tx.select().from(visits).where(eq(visits.roachId, v.roachId)).for("update");
      const [r] = await tx.select({ lng: roaches.lng, lat: roaches.lat }).from(roaches).where(eq(roaches.id, v.roachId));
      if (!still || !r || !isOffLimits(r)) return false;
      await sendBack(tx, still);
      await tell(tx, still.guestId, "home");
      return true;
    });
    if (sent) home++;
  }

  let moved = 0;
  const guests = new Set(visiting.map((v) => v.roachId));
  for (const r of inside.filter((r) => !guests.has(r.id))) {
    const to = outsideOffLimits(r, random);
    const done = await db.transaction(async (tx) => {
      // unless its owner moved it, or it set off on a visit or a ride, meanwhile
      const [still] = await tx
        .update(roaches)
        .set({ lng: to.lng, lat: to.lat, publicId: randomUUID() })
        .where(and(eq(roaches.id, r.id), eq(roaches.lng, r.lng), eq(roaches.lat, r.lat), isNull(roaches.rideSince)))
        .returning({ id: roaches.id });
      if (!still) return false;
      await roachMoved(tx, r.id, "moved");
      await tell(tx, r.userId, "moved");
      return true;
    });
    if (done) moved++;
  }

  if (moved || home) {
    roachesChanged();
    console.info(`Moved ${moved} roaches out of off-limits places and sent ${home} visiting clones home`);
  }
  return { moved, home };
}
