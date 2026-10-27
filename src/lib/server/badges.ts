import "server-only";
import { and, countDistinct, eq, inArray, isNull, sql } from "drizzle-orm";
import { BADGES, badgeById, FAR_FRIEND_KM, FIRST_BATCH, type BadgeCount, type EarnedBadge, type ShownBadge } from "../badges";
import { distanceKm } from "../geo";
import { db } from "./db";
import { nudge } from "./live";
import { declarations, reactions, roaches, userBadges, users, type UserRow } from "./schema";

/**
 * Earning badges. Each is written down the moment it is earned, because what
 * earned it (touches, declarations, reactions) is deleted after 90 days.
 * Only an admin, or deleting the account, ever takes one away.
 */

/** Give a player the badges they lack; a page they have open hears about it. Returns the new ones. */
export async function award(userId: string, badges: string[]) {
  if (!badges.length) return [];
  const made = await db
    .insert(userBadges)
    .values(badges.map((badge) => ({ userId, badge })))
    .onConflictDoNothing()
    .returning({ badge: userBadges.badge });
  if (made.length) nudge([userId]);
  return made.map((m) => m.badge);
}

const reached = (count: BadgeCount, n: number) => BADGES.filter((b) => b.goal?.count === count && n >= b.goal.n).map((b) => b.id);

/** Different players who reacted to any of a player's declarations still kept; reactions withheld by a block do not count. */
export async function respondersOf(userId: string) {
  const [row] = await db
    .select({ n: countDistinct(reactions.fromUserId) })
    .from(reactions)
    .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
    .where(and(eq(declarations.senderId, userId), eq(reactions.withheld, false)));
  return row.n;
}

/**
 * Two players just became 触须之交. It counts towards their diplomacy badges
 * unless they had been before; 千里传须 goes by where their main roaches are now.
 */
export async function friendsMade(a: string, b: string, firstTime: boolean) {
  if (firstTime) {
    const counts = await db
      .update(users)
      .set({ friendsEver: sql`${users.friendsEver} + 1` })
      .where(inArray(users.id, [a, b]))
      .returning({ id: users.id, friendsEver: users.friendsEver });
    for (const c of counts) await award(c.id, reached("friends", c.friendsEver));
  }
  const mains = await db
    .select({ lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(and(inArray(roaches.userId, [a, b]), eq(roaches.slot, 0)));
  if (mains.length === 2 && distanceKm(mains[0], mains[1]) >= FAR_FRIEND_KM) {
    await award(a, ["farwhisker"]);
    await award(b, ["farwhisker"]);
  }
}

/** Someone reacted to a player's declaration. */
export async function reactedTo(senderId: string) {
  await award(senderId, reached("responders", await respondersOf(senderId)));
}

/** A new account: the first players get 首批蟑螂 and their number, which is never given out twice. */
export async function signedUp(userId: string) {
  const [row] = await db.execute<{ n: string }>(sql`select nextval('first_batch_serial') as n`);
  const serial = Number(row.n);
  if (serial > FIRST_BATCH) return;
  await db.insert(userBadges).values({ userId, badge: "firstbatch", serial }).onConflictDoNothing();
}

/**
 * At every start: anyone whose counts already reach a badge they lack gets it.
 * This hands out what players did before badges existed (see migration 0010),
 * and anything an earlier award missed.
 */
export async function catchUpBadges() {
  for (const b of BADGES) {
    if (!b.goal) continue;
    const due =
      b.goal.count === "friends"
        ? sql`select ${users.id} from ${users} where ${users.friendsEver} >= ${b.goal.n}`
        : sql`select ${declarations.senderId} from ${reactions}
            join ${declarations} on ${declarations.id} = ${reactions.declarationId}
            where not ${reactions.withheld}
            group by ${declarations.senderId} having count(distinct ${reactions.fromUserId}) >= ${b.goal.n}`;
    await db.execute(
      sql`insert into ${userBadges} (user_id, badge) select due.id, ${b.id}::text from (${due}) as due(id) on conflict do nothing`,
    );
  }
}

/** The badges a player has, in the order the wall lists them; ids this code does not know are left out. */
export async function earnedBy(userId: string): Promise<EarnedBadge[]> {
  const rows = await db.select().from(userBadges).where(eq(userBadges.userId, userId));
  return BADGES.flatMap((b) => {
    const r = rows.find((x) => x.badge === b.id);
    return r ? [{ id: b.id, serial: r.serial ?? undefined, at: r.earnedAt.getTime(), seen: Boolean(r.seenAt) }] : [];
  });
}

/** What profile cards show of each player: their badges, the one they wear first. */
export async function shownBadges(people: UserRow[]) {
  const ids = [...new Set(people.map((u) => u.id))];
  const rows = ids.length ? await db.select().from(userBadges).where(inArray(userBadges.userId, ids)) : [];
  const shown = new Map<string, { badges: ShownBadge[]; worn: string | null }>();
  for (const u of people) {
    const theirs = BADGES.flatMap((b) => {
      const r = rows.find((x) => x.userId === u.id && x.badge === b.id);
      return r ? [r.serial ? { id: b.id, serial: r.serial } : { id: b.id }] : [];
    });
    const worn = theirs.some((b) => b.id === u.wornBadge) ? u.wornBadge : null;
    shown.set(u.id, { badges: theirs.sort((x, y) => Number(y.id === worn) - Number(x.id === worn)), worn });
  }
  return shown;
}

/** Wear one of your badges under your name, or none. */
export async function wear(userId: string, badge: string | null) {
  if (badge !== null) {
    const [has] = await db
      .select({ badge: userBadges.badge })
      .from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badge, String(badge))))
      .limit(1);
    if (!has || !badgeById(has.badge)) return false;
  }
  await db.update(users).set({ wornBadge: badge }).where(eq(users.id, userId));
  return true;
}

/** The player has been shown these, so they do not pop up again. */
export async function markBadgesSeen(userId: string, badges: string[]) {
  const ids = badges.filter((b) => typeof b === "string");
  if (!ids.length) return;
  await db
    .update(userBadges)
    .set({ seenAt: new Date() })
    .where(and(eq(userBadges.userId, userId), inArray(userBadges.badge, ids), isNull(userBadges.seenAt)));
}
