import "server-only";
import { and, asc, eq, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { T } from "@/i18n";
import { FIRE_AT, FIRE_RADIUS_M, isNearFire, pickSeat, TALULAH, talulahRoach, unstack } from "../talulah";
import type { LngLat } from "../types";
import { WorldError, type TalulahItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, lockPlayer, type Exec, type GuideRow, type GuideTable } from "./guides";
import { fireSongs, guideFriendMade } from "./badges";
import { roachesChanged } from "./roachFeed";
import { roaches, talulahTouches, users } from "./schema";

/**
 * 塔露拉干员 on the server (src/lib/talulah.ts): her answers to each player's
 * touches, her handshake, her welcome at the fire and her birthday answer, kept
 * in talulah_touches. She never starts anything: each comes from something the
 * player did. The seats round her fire are picked here, one at a time; her fire
 * and how big it burns are the page's.
 */

const YEAR_MS = 365 * 86_400_000;

// her table has exactly the columns every guide's has (schema.ts)
const her = guideTouches(TALULAH, talulahTouches as unknown as GuideTable);

function toItem(r: GuideRow, replied: boolean): TalulahItem {
  const line = r.kind === "handshake" || r.kind === "welcome" || r.kind === "birthday" ? r.kind : "touch";
  return {
    kind: "talulah",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    line,
    bold: r.bold,
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

/**
 * The player touches her, maybe answering one of hers: the first touch of their day she
 * answers at once, openly whichever way they touched (bold keeps how they did, which picks
 * her line), the rest of the day not. Their first bold touch is a handshake that makes them
 * 触须之交, answered whenever it comes.
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin?: unknown): Promise<TouchResult> {
  await her.allow(userId);
  let done: { id: string | null; friend: boolean };
  try {
    done = await db.transaction(async (tx) => {
      await lockPlayer(tx, userId);
      const made = bold
        ? await tx
            .update(users)
            .set({ talulahFriendSince: new Date() })
            .where(and(eq(users.id, userId), isNull(users.talulahFriendSince)))
            .returning({ id: users.id })
        : [];
      const friend = made.length > 0;
      const dayStart = new Date(deviceDay(offsetMin).start);
      const answer = await her.pair(tx, userId, { bold, replyTo, dayStart, kind: friend ? "handshake" : "touch" });
      return { id: answer?.id ?? null, friend };
    });
  } catch (e) {
    // two answers to the same one of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError(T.server.common.touched);
    throw e;
  }
  if (done.friend) await guideFriendMade(userId, "talulah");
  return {
    newFriend: done.friend ? TALULAH.name : null,
    guide: {
      id: TALULAH.id,
      itemId: done.id && her.itemId(done.id),
      bold,
      kind: done.friend ? "friend" : "touch",
      times: null,
      others: null,
      line: null,
    },
  };
}

export const touchTalulah = (userId: string, bold: boolean, offsetMin?: unknown) => touchBack(userId, bold, null, offsetMin);

/** Touch back one of hers, once; it counts towards her 20 like any touch. */
export async function replyTalulah(userId: string, itemId: string, bold: boolean, offsetMin?: unknown) {
  const item = await her.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id, offsetMin);
}

export const ignoreTalulah = (userId: string, itemId: string) => her.ignore(userId, itemId);

export const seeTalulah = (userId: string, itemIds: string[]) => her.see(userId, itemIds);

/** Her latest to the player, for the inbox. */
export async function talulahInbox(userId: string): Promise<TalulahItem[]> {
  return (await her.latest(userId)).map(({ row, replied }) => toItem(row, replied));
}

// ---- the seats round her fire ----

/**
 * One seat at a time by her fire, across the site: whatever picks a seat there (sitByFire in
 * world.ts, a guest of a roach by the fire in friendly.ts, spreadFireStacks) takes this first in
 * its transaction, and only then reads who sits there, so two never pick the same seat. Held until
 * the transaction ends, as 明河都尉's queue (rideMinghe).
 */
export const lockFire = (tx: Exec) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('talulah-fire'))`);

const fireGeog = sql`ST_SetSRID(ST_MakePoint(${FIRE_AT.lng}, ${FIRE_AT.lat}), 4326)::geography`;

/**
 * Every roach within FIRE_RADIUS_M * 2 of her fire, as far as pickSeat looks, but those listed (a
 * roach moving there holds no seat for itself). With some 5,000 by the fire the rings within reach
 * fill up, and pickSeat would take the next ones for free: by then read further, and let pickSeat
 * look as far.
 */
async function roachesByFire(exec: Exec, except: string[] = []) {
  return exec
    .select({ id: roaches.id, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat, rideSince: roaches.rideSince })
    .from(roaches)
    .where(
      and(
        sql`ST_DWithin(${roaches.geog}, ${fireGeog}, ${FIRE_RADIUS_M * 2})`,
        except.length ? notInArray(roaches.id, except) : undefined,
      ),
    )
    .orderBy(asc(roaches.placedAt), asc(roaches.id));
}

/** A free seat by her fire, after lockFire: in the innermost ring that has one, or (nearest) the free one closest to a spot */
export async function seatByFire(tx: Exec, except: string[] = [], nearest?: LngLat): Promise<LngLat> {
  return pickSeat(await roachesByFire(tx, except), Math.random, nearest ? { nearest } : {});
}

/**
 * Roaches sitting on one another by her fire, from when every page picked a seat for itself and
 * some picked from a list that was out of date, or empty: the later ones on a seat each move to the
 * free seat nearest them (unstack in src/lib/talulah.ts), in the order they came. Main roaches and
 * clones riding with 明河都尉 stay where they are: the server never seated one. Run once as the server
 * starts; with nobody stacked it changes nothing. Only the spot changes: the same public id, no moves
 * row (the radar and 欢迎回家 never see it), and nobody is told. With more than about 1,270 by the fire,
 * those it moves past the last free seat within FIRE_RADIUS_M sit beyond it, and no longer count
 * towards it, as for anyone seated there.
 */
export async function spreadFireStacks() {
  const moved = await db.transaction(async (tx) => {
    await lockFire(tx);
    const by = await roachesByFire(tx);
    const to = unstack(by.map((r) => ({ id: r.id, lng: r.lng, lat: r.lat, stays: r.slot === 0 || r.rideSince !== null })));
    let n = 0;
    for (const r of by) {
      const at = to.get(r.id);
      if (!at) continue;
      // unless its owner moved it meanwhile: a roach put down by hand takes no lock
      const [still] = await tx
        .update(roaches)
        .set({ lng: at.lng, lat: at.lat })
        .where(and(eq(roaches.id, r.id), eq(roaches.lng, r.lng), eq(roaches.lat, r.lat)))
        .returning({ id: roaches.id });
      if (still) n++;
    }
    return n;
  });
  if (moved) {
    roachesChanged();
    console.info(`Spread ${moved} roaches stacked by 塔露拉干员's fire`);
  }
  return moved;
}

/**
 * A roach of theirs was just put down or moved to spot: the first time one sits
 * within FIRE_RADIUS_M of her fire (main roach or clone, by hand or sent from her
 * card), she welcomes them, once for good. One conditional update claims it, so
 * two roaches arriving at once still bring one welcome.
 */
export async function arrivedAt(userId: string, spot: LngLat) {
  if (!isNearFire(spot)) return;
  const [first] = await db
    .update(users)
    .set({ talulahWelcomedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.talulahWelcomedAt)))
    .returning({ id: users.id });
  if (first) await db.insert(talulahTouches).values({ userId, direction: her.from, kind: "welcome", bold: false });
  await fireSongs();
}

/**
 * A birthday declaration (「祝我生日快乐」) from one of her 触须之交, wherever they
 * are: she answers it, at most once a year. The declaration itself goes out as
 * ever; she is never among its recipients.
 */
export async function birthdayDeclared(userId: string) {
  const [claimed] = await db
    .update(users)
    .set({ talulahBirthdayAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        isNotNull(users.talulahFriendSince),
        or(isNull(users.talulahBirthdayAt), lt(users.talulahBirthdayAt, new Date(Date.now() - YEAR_MS))),
      ),
    )
    .returning({ id: users.id });
  if (claimed) await db.insert(talulahTouches).values({ userId, direction: her.from, kind: "birthday", bold: false });
}

/** Her place among the 触须之交, after 阿米娅向导 and 佩丽卡监督. */
export const talulahFriend = (since: Date) => guideFriend(TALULAH, since, [talulahRoach(true)]);

/** 解除: she stays by her fire; a bold touch shakes hands again. */
export async function unfriendTalulah(userId: string) {
  await db.update(users).set({ talulahFriendSince: null }).where(eq(users.id, userId));
}

/** What me() says about her. */
export const talulahOf = (u: { talulahFriendSince: Date | null; talulahWelcomedAt: Date | null }) => ({
  friend: Boolean(u.talulahFriendSince),
  visited: Boolean(u.talulahWelcomedAt),
});

/** 清掉我和塔露拉的记录 (local testing only): as if they had never met her. */
export async function forgetTalulah(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ talulahFriendSince: null, talulahWelcomedAt: null, talulahBirthdayAt: null })
      .where(eq(users.id, userId));
    await tx.delete(talulahTouches).where(eq(talulahTouches.userId, userId));
  });
}
