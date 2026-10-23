import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db } from "./db";
import { blocks } from "./schema";

/** Whether either player has blocked the other; then nothing new passes between them. */
export async function blockedBetween(a: string, b: string) {
  const [row] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))),
    )
    .limit(1);
  return Boolean(row);
}

/** Everyone this player has blocked or been blocked by. */
export async function blockedWith(userId: string) {
  const rows = await db
    .select({ blocker: blocks.blockerId, blocked: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blocker === userId ? r.blocked : r.blocker)));
}

/** Players this player has blocked: nothing they sent shows any more, old or new. */
export async function blockedBy(userId: string) {
  const rows = await db.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.blockerId, userId));
  return new Set(rows.map((r) => r.id));
}
