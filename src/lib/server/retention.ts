import "server-only";
import { and, isNotNull, lt } from "drizzle-orm";
import { KEEP_ACTIVITY_DAYS, KEEP_REPORT_DAYS } from "../rules";
import { db } from "./db";
import { declarations, friendCuts, moves, radarScans, reports, touches } from "./schema";

const DAY_MS = 86_400_000;

/**
 * Delete activity older than KEEP_ACTIVITY_DAYS and handled reports older than
 * KEEP_REPORT_DAYS, as the privacy page promises. Deliveries and reactions go
 * with their declaration.
 */
export async function pruneOldActivity(now = Date.now()) {
  const cutoff = new Date(now - KEEP_ACTIVITY_DAYS * DAY_MS);
  await db.delete(touches).where(lt(touches.createdAt, cutoff));
  await db.delete(declarations).where(lt(declarations.createdAt, cutoff));
  await db.delete(moves).where(lt(moves.at, cutoff));
  // a cut only matters for touches made before it, which are gone by now
  await db.delete(friendCuts).where(lt(friendCuts.cutAt, cutoff));
  // only the last day of radar scans is ever used
  await db.delete(radarScans).where(lt(radarScans.createdAt, new Date(now - DAY_MS)));
  const reportCutoff = new Date(now - KEEP_REPORT_DAYS * DAY_MS);
  await db.delete(reports).where(and(isNotNull(reports.resolvedAt), lt(reports.resolvedAt, reportCutoff)));
}
