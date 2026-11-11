import "server-only";
import { and, asc, eq, gt, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import { INBOX_DAYS, KEEP_ACTIVITY_DAYS, KEEP_MOD_ACTION_DAYS, KEEP_REPORT_DAYS } from "../rules";
import { db } from "./db";
import { pruneFriendly } from "./friendly";
import { pruneHelp } from "./help";
import {
  amiyaTouches,
  declarations,
  deliveries,
  friendCuts,
  moves,
  mingheTouches,
  modActions,
  perlicaTouches,
  pokes,
  radarScans,
  reports,
  sessions,
  staffNotes,
  talulahTouches,
  touches,
  watchIncidents,
  watchMails,
} from "./schema";

const DAY_MS = 86_400_000;
/** Deleting deliveries a few hundred declarations at a time, with a pause, so the database never stalls */
const DELIVERY_BATCH = 500;
const DELIVERY_PAUSE_MS = 200;

/**
 * Delete activity older than KEEP_ACTIVITY_DAYS and handled reports older than
 * KEEP_REPORT_DAYS, as the privacy page promises. Deliveries and reactions go
 * with their declaration. The site's own checks keep as long.
 */
export async function pruneOldActivity(now = Date.now()) {
  const cutoff = new Date(now - KEEP_ACTIVITY_DAYS * DAY_MS);
  await db.delete(touches).where(lt(touches.createdAt, cutoff));
  await db.delete(pokes).where(lt(pokes.createdAt, cutoff));
  await db.delete(amiyaTouches).where(lt(amiyaTouches.createdAt, cutoff));
  await db.delete(perlicaTouches).where(lt(perlicaTouches.createdAt, cutoff));
  await db.delete(talulahTouches).where(lt(talulahTouches.createdAt, cutoff));
  await db.delete(mingheTouches).where(lt(mingheTouches.createdAt, cutoff));
  await db.delete(declarations).where(lt(declarations.createdAt, cutoff));
  await db.delete(moves).where(lt(moves.at, cutoff));
  // a cut only matters for touches made before it, which are gone by now
  await db.delete(friendCuts).where(lt(friendCuts.cutAt, cutoff));
  await pruneFriendly(cutoff, now);
  await pruneHelp(now);
  await pruneDeliveries(now);
  // only the last day of radar scans is ever used
  await db.delete(radarScans).where(lt(radarScans.createdAt, new Date(now - DAY_MS)));
  const reportCutoff = new Date(now - KEEP_REPORT_DAYS * DAY_MS);
  await db.delete(reports).where(and(isNotNull(reports.resolvedAt), lt(reports.resolvedAt, reportCutoff)));
  // 站长通知 like any message; what the admin did, a year
  await db.delete(staffNotes).where(lt(staffNotes.createdAt, cutoff));
  await db.delete(modActions).where(lt(modActions.createdAt, new Date(now - KEEP_MOD_ACTION_DAYS * DAY_MS)));
  // the site's own checks: what they found and emailed, for 网站状态
  await db.delete(watchIncidents).where(lt(watchIncidents.endedAt, cutoff));
  await db.delete(watchMails).where(lt(watchMails.at, cutoff));
  // sign-ins that ran out (nothing removed them before 11/11)
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now - DAY_MS)));
}

/**
 * A declaration's deliveries (who it reached) are read only while it can show in an inbox (INBOX_DAYS),
 * but a busy day writes millions of them. So they go once a declaration is older than that, except a
 * 触须之交's birthday sent as one (to_friend), whose sender is named; the declarations themselves stay
 * KEEP_ACTIVITY_DAYS. A few hundred declarations at a time, only those of the week before the cutoff
 * (anything older went on an earlier day).
 */
async function pruneDeliveries(now: number) {
  const cutoff = new Date(now - INBOX_DAYS * DAY_MS);
  const from = new Date(cutoff.getTime() - 7 * DAY_MS);
  let after: { at: Date; id: string } | null = null;
  for (;;) {
    const page: { at: Date; id: string }[] = await db
      .select({ at: declarations.createdAt, id: declarations.id })
      .from(declarations)
      .where(
        and(
          gte(declarations.createdAt, from),
          lt(declarations.createdAt, cutoff),
          after ? or(gt(declarations.createdAt, after.at), and(eq(declarations.createdAt, after.at), gt(declarations.id, after.id))) : undefined,
        ),
      )
      .orderBy(asc(declarations.createdAt), asc(declarations.id))
      .limit(DELIVERY_BATCH);
    if (!page.length) return;
    await db.delete(deliveries).where(and(inArray(deliveries.declarationId, page.map((d) => d.id)), eq(deliveries.toFriend, false)));
    if (page.length < DELIVERY_BATCH) return;
    after = page[page.length - 1];
    await new Promise((r) => setTimeout(r, DELIVERY_PAUSE_MS));
  }
}
