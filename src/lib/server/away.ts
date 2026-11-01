import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { AWAY_DAYS } from "../badges";
import { beijingDate, beijingMidnight } from "../beijing";
import { db } from "./db";
import { nudge } from "./live";
import { roachesChanged } from "./roachFeed";
import { pokes, roaches, users, type UserRow } from "./schema";

/**
 * 好久没来自动翻: once a day at 04:00 Beijing time, the main roach of a player who
 * has stayed away flips belly up, and that of one who has come back stands up
 * again. Only this batch changes it, so the shared roach list never tells the
 * hour anyone left or came back. The owner sees their own stand up at once.
 * The same batch tells pokers 「醒啦」.
 */

const DAY_MS = 86_400_000;
/** The first day visits were recorded (users.last_seen_on) */
const VISITS_SINCE = "2026-10-28";

/**
 * The day of a player's last visit. With none recorded, away since visits were first
 * recorded or since signing up, whichever is later, so a brand-new account is not away.
 */
export function lastVisitOn(u: Pick<UserRow, "lastSeenOn" | "createdAt">) {
  if (u.lastSeenOn) return u.lastSeenOn;
  const signedUpOn = beijingDate(u.createdAt.getTime());
  return signedUpOn > VISITS_SINCE ? signedUpOn : VISITS_SINCE;
}

export const daysBetween = (from: string, to: string) => Math.round((beijingMidnight(to) - beijingMidnight(from)) / DAY_MS);

/** A fixed 0–3 more days per player, so the day a roach flips does not give away the day its owner left. */
export const awayExtraDays = (userId: string) => createHash("sha256").update(userId).digest()[0] % 4;

/**
 * 「你戳过的 TA 醒啦」 for every poke whose roach stands again in everyone's eyes. Run
 * before this batch wakes anyone, so those it wakes are told at the next: the poker
 * always hears at the first batch after it stood up, drunk or away alike.
 */
async function tellPokers(now: number) {
  const awake = db
    .select({ id: users.id })
    .from(users)
    .where(and(or(isNull(users.drunkUntil), lte(users.drunkUntil, new Date(now))), isNull(users.sleptAwayOn)));
  const told = await db
    .update(pokes)
    .set({ wokeToldAt: new Date(now) })
    .where(and(isNull(pokes.wokeToldAt), inArray(pokes.toUserId, awake)))
    .returning({ from: pokes.fromUserId });
  if (told.length) nudge([...new Set(told.map((t) => t.from))]);
  return told.length;
}

/** The 04:00 batch. Returns how many flipped and how many stood up, and how many pokers were told. */
export async function flipTheAway(now = Date.now()) {
  const told = await tellPokers(now);
  const today = beijingDate(now);
  const rows = await db
    .select({
      id: users.id,
      lastSeenOn: users.lastSeenOn,
      createdAt: users.createdAt,
      flipWhenAway: users.flipWhenAway,
      sleptAwayOn: users.sleptAwayOn,
      main: roaches.id,
    })
    .from(users)
    .leftJoin(roaches, and(eq(roaches.userId, users.id), eq(roaches.slot, 0)))
    .where(isNull(users.demoKey));
  const flip: string[] = [];
  const wake: string[] = [];
  for (const u of rows) {
    if (u.sleptAwayOn) {
      // back since it flipped, the switch turned off, or no main roach any more
      if (!u.flipWhenAway || !u.main || (u.lastSeenOn && u.lastSeenOn >= u.sleptAwayOn)) wake.push(u.id);
    } else if (u.flipWhenAway && u.main && daysBetween(lastVisitOn(u), today) >= AWAY_DAYS + awayExtraDays(u.id)) {
      flip.push(u.id);
    }
  }
  if (flip.length) await db.update(users).set({ sleptAwayOn: today }).where(inArray(users.id, flip));
  if (wake.length) await db.update(users).set({ sleptAwayOn: null }).where(inArray(users.id, wake));
  if (flip.length || wake.length) roachesChanged();
  return { flipped: flip.length, woke: wake.length, told };
}
