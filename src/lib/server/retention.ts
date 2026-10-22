import "server-only";
import { lt } from "drizzle-orm";
import { KEEP_ACTIVITY_DAYS } from "../rules";
import { db } from "./db";
import { declarations, friendCuts, moves, touches } from "./schema";

const DAY_MS = 86_400_000;

/**
 * Delete activity older than KEEP_ACTIVITY_DAYS, as the privacy page promises.
 * Deliveries and reactions go with their declaration.
 */
export async function pruneOldActivity(now = Date.now()) {
  const cutoff = new Date(now - KEEP_ACTIVITY_DAYS * DAY_MS);
  await db.delete(touches).where(lt(touches.createdAt, cutoff));
  await db.delete(declarations).where(lt(declarations.createdAt, cutoff));
  await db.delete(moves).where(lt(moves.at, cutoff));
  // a cut only matters for touches made before it, which are gone by now
  await db.delete(friendCuts).where(lt(friendCuts.cutAt, cutoff));
}
