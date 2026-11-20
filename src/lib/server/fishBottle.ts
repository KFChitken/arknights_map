import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, eq, gt, inArray, lt, ne, notExists, or, sql } from "drizzle-orm";
import { T } from "@/i18n";
import { isSay, NOTE_DAYS, noteKm, type FishBottle } from "../fish/rules";
import { distanceKm } from "../geo";
import { siteDay } from "../siteDay";
import { db } from "./db";
import { HttpError } from "./http";
import { drawnOf, passesOpen, passFromBottle } from "./passes";
import { blocks, fishBottles, fishDays, fishNotes, roaches, type UserRow } from "./schema";

/**
 * 漂流瓶 (钓鳞; caught by the pull, src/lib/server/fish.ts reelIn): kept (fish_bottles) till the player opens it, then
 * the pass in it (passes.ts passFromBottle: as a draw of one brings it, though it is none) and, when the sea has one for
 * them, a 纸条 someone else threw back (fish_notes): the oldest first, never their own, never between two who blocked
 * each other, each to one player, gone after NOTE_DAYS. It is told with how far its writer's main roach is from theirs
 * as it is tucked in (to 10 km, 附近 under 10, far when either has none), never who; nothing of where they are is kept.
 * From each bottle opened, one of the 17 lines may be thrown back for someone else's. All of it while PASSES lets the
 * player draw.
 */

const DAY = 86_400_000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Bottle = typeof fishBottles.$inferSelect;

const refuse = (status: number, message: string) => new HttpError(status, message);

/** A bottle's id as the page sends it */
const idOf = (id: unknown): number => {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw refuse(400, T.server.fish.noBottle);
  return id;
};

/** The player's own bottle, locked till the transaction ends */
async function bottleOf(tx: Tx, userId: string, id: number): Promise<Bottle> {
  const [b] = await tx
    .select()
    .from(fishBottles)
    .where(and(eq(fishBottles.id, id), eq(fishBottles.userId, userId)))
    .for("update");
  if (!b) throw refuse(404, T.server.fish.noBottle);
  return b;
}

/** Bottles caught today, for the page's 今天 n / 1 */
async function caughtToday(tx: Tx, userId: string, now: number): Promise<number> {
  const [d] = await tx
    .select({ n: fishDays.bottles })
    .from(fishDays)
    .where(and(eq(fishDays.userId, userId), eq(fishDays.day, siteDay(now))));
  return d?.n ?? 0;
}

/** An opened bottle as the page is told it */
async function viewOf(tx: Tx, b: Bottle, now: number): Promise<FishBottle> {
  const pass = b.passId === null ? null : await drawnOf(tx, b.userId, b.passId);
  if (!pass) throw refuse(404, T.server.fish.noBottle);
  return {
    id: b.id,
    pass,
    note: b.noteSay === null ? null : { say: b.noteSay, km: b.noteKm },
    thrown: b.thrown,
    today: await caughtToday(tx, b.userId, now),
  };
}

/**
 * A 纸条 for this player out of the sea, if there is one they may have: the oldest, not their own, not from or to
 * anyone they blocked or who blocked them, not older than NOTE_DAYS; taken out of it (two bottles opened at once never
 * take the same one), with how far its writer's main roach is from theirs now
 */
async function takeNote(tx: Tx, userId: string, now: number): Promise<{ say: number; km: number | null } | null> {
  const [note] = await tx
    .select({ id: fishNotes.id, fromId: fishNotes.fromId, say: fishNotes.say })
    .from(fishNotes)
    .where(
      and(
        ne(fishNotes.fromId, userId),
        gt(fishNotes.at, new Date(now - NOTE_DAYS * DAY)),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(blocks)
            .where(
              or(
                and(eq(blocks.blockerId, userId), eq(blocks.blockedId, fishNotes.fromId)),
                and(eq(blocks.blockerId, fishNotes.fromId), eq(blocks.blockedId, userId)),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(fishNotes.id))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!note) return null;
  await tx.delete(fishNotes).where(eq(fishNotes.id, note.id));
  const mains = await tx
    .select({ lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(and(inArray(roaches.userId, [userId, note.fromId]), eq(roaches.slot, 0)));
  return { say: note.say, km: mains.length === 2 ? noteKm(distanceKm(mains[0], mains[1])) : null };
}

/**
 * 拔开瓶塞: the pass in the bottle drawn now, and a 纸条 tucked in if the sea has one for the player, in one
 * transaction. A bottle opened already is told again as it was (its answer lost on the way, a second tab).
 */
export async function openBottle(user: UserRow, id: unknown, now = Date.now(), rand: (n: number) => number = randomInt): Promise<FishBottle> {
  if (!passesOpen(user)) throw refuse(404, T.server.routes.fish.notHere);
  const bid = idOf(id);
  return db.transaction(async (tx) => {
    const b = await bottleOf(tx, user.id, bid);
    if (b.openedAt) return viewOf(tx, b, now);
    const { passId, drawn } = await passFromBottle(tx, user, now, rand);
    const note = await takeNote(tx, user.id, now);
    await tx
      .update(fishBottles)
      .set({ openedAt: new Date(now), passId, noteSay: note?.say ?? null, noteKm: note?.km ?? null })
      .where(eq(fishBottles.id, b.id));
    return { id: b.id, pass: drawn, note, thrown: null, today: await caughtToday(tx, user.id, now) };
  });
}

/**
 * 扔回海里: one of the 17 lines (by number) from an opened bottle, once a bottle, into the sea for someone else's;
 * notes left there past NOTE_DAYS go as one is thrown
 */
export async function throwNote(user: UserRow, id: unknown, say: unknown, now = Date.now()): Promise<FishBottle> {
  if (!passesOpen(user)) throw refuse(404, T.server.routes.fish.notHere);
  const bid = idOf(id);
  if (!isSay(say)) throw refuse(400, T.server.fish.badSay);
  return db.transaction(async (tx) => {
    const b = await bottleOf(tx, user.id, bid);
    if (!b.openedAt) throw refuse(409, T.server.fish.notOpened);
    if (b.thrown !== null) throw refuse(409, T.server.fish.thrownAlready);
    const [after] = await tx.update(fishBottles).set({ thrown: say }).where(eq(fishBottles.id, b.id)).returning();
    await tx.insert(fishNotes).values({ fromId: user.id, say, at: new Date(now) });
    await tx.delete(fishNotes).where(lt(fishNotes.at, new Date(now - NOTE_DAYS * DAY)));
    return viewOf(tx, after, now);
  });
}
