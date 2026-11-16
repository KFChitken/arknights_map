import "server-only";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { ROACH_AVATARS, type RoachAvatar } from "../types";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { ADMIN_EMAILS, duckMode } from "./env";
import { admins, roaches, userBadges, users, type UserRow } from "./schema";

/**
 * Who wears which look. 鸭爵 is the thanks for sponsoring (SPONSOR_AVATARS, src/lib/sponsor.ts), and DUCK (env.ts)
 * decides who sees him. On, a 服务器饲养员 (the badge given with 「?!电电!?」) may pick him, and the 站长 and the
 * admins, and everyone sees him. Admins, only the 站长 and the admins may pick him, and they alone see him, on
 * themselves and on one another (duckShownBetween): on their cards, in their lists of 触须之交, and on the map, where
 * the feed, the same for all, draws him as the plain hood and the 站长 and the admins are told which main roaches are
 * him (ducksOnMapFor). Everyone else sees the plain hood, on the map, on cards, in lists and in the moves. Off, nobody
 * may pick him, and he is the plain hood everywhere. Whichever it is, the database keeps him, so he is back as he was
 * once he shows again.
 */

/** A player as far as their looks go: their id and sign-in email */
type Who = Pick<UserRow, "id" | "email">;

/** The badge that lets a player wear the sponsors' thanks */
export const SPONSOR_BADGE = "feeder";

/** The 站长 (ADMIN_EMAILS) or an admin */
const isStaff = (who: Who) => isOwnerEmail(who.email) || isModHere(who.id);

/** Whether 鸭爵 is a player's to wear, whatever DUCK says: a 服务器饲养员's, the 站长's or an admin's */
export const mayWearDuck = (who: Who, badges: readonly string[]) => badges.includes(SPONSOR_BADGE) || isStaff(who);

/** Whether he is drawn as himself for this player (null: a visitor): for all while on, the 站长 and the admins while admins */
export function duckShownTo(who: Who | null) {
  const mode = duckMode();
  return mode === "on" || (mode === "admins" && who !== null && isStaff(who));
}

/**
 * Whether one player's 鸭爵 is drawn as himself for another (viewer null: a visitor): for all while on; while admins,
 * only where both are the 站长 or admins (a 服务器饲养员 who kept him from before is the plain hood to all meanwhile,
 * as to themselves); never while off
 */
export function duckShownBetween(viewer: Who | null, wearer: Who) {
  const mode = duckMode();
  return mode === "on" || (mode === "admins" && viewer !== null && isStaff(viewer) && isStaff(wearer));
}

/** Whether the player with this id (null: a visitor) is the 站长 or an admin, asking the database for their email only if no admin has it */
async function staffById(id: string | null) {
  if (!id) return false;
  if (isModHere(id)) return true;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return isOwnerEmail(u?.email);
}

/**
 * Of these players, those a viewer (by id; null: a visitor) sees in 鸭爵, by id (duckShownBetween): asking the
 * database who the viewer is only while DUCK is admins and the 站长 or an admin among them wears him
 */
export async function ducksSeenAmong(viewerId: string | null, people: readonly (Who & { avatar: string | null })[]) {
  const mode = duckMode();
  const wearing = mode === "off" ? [] : people.filter((u) => u.avatar === "duck" && (mode === "on" || isStaff(u)));
  const seen = mode === "on" || (wearing.length > 0 && (await staffById(viewerId)));
  return new Set(seen ? wearing.map((u) => u.id) : []);
}

/**
 * For the 站长 or an admin while DUCK is admins: the main roaches (public ids) of the others among them wearing 鸭爵,
 * whom they see as him though the map's feed, the same for all, draws them as the plain hood. Nothing for anyone
 * else, nor while DUCK is on (the feed draws him then) or off. Never a clone: those are the plain white hood to all
 * but their 触须之交 (world/friendLooks.ts), and so they stay.
 */
export async function ducksOnMapFor(viewer: Who): Promise<string[] | undefined> {
  if (duckMode() !== "admins" || !isStaff(viewer)) return undefined;
  const staff = ADMIN_EMAILS.length
    ? or(inArray(users.id, db.select({ id: admins.userId }).from(admins)), inArray(users.email, ADMIN_EMAILS))
    : inArray(users.id, db.select({ id: admins.userId }).from(admins));
  const rows = await db
    .select({ id: users.id, email: users.email, publicId: roaches.publicId })
    .from(users)
    .innerJoin(roaches, and(eq(roaches.userId, users.id), eq(roaches.slot, 0)))
    .where(and(eq(users.avatar, "duck"), ne(users.id, viewer.id), staff));
  // the 站长 and the admins as this process knows them, as for everything else here
  return rows.filter((r) => isStaff(r)).map((r) => r.publicId);
}

/**
 * The look a stored one is drawn in: their pick, else the plain hood; 鸭爵 only where he is shown (by default where
 * he is shown to everyone, DUCK=on), else the plain hood too
 */
export function drawnLook(avatar: string | null | undefined, shown = duckMode() === "on"): RoachAvatar {
  const look = ROACH_AVATARS.find((a) => a === avatar) ?? "hood";
  return look === "duck" && !shown ? "hood" : look;
}

/** A player's look as they see it themselves (我的资料, their own roaches and moves): 鸭爵 while he is shown to them */
export const ownLook = (u: Who & { avatar: string | null }) => drawnLook(u.avatar, duckShownTo(u));

/** The looks a player may pick, in the list's order: 鸭爵 while DUCK lets them */
export function pickableLooks(who: Who, badges: readonly string[]): RoachAvatar[] {
  const mode = duckMode();
  const duck = mode === "on" ? mayWearDuck(who, badges) : mode === "admins" && isStaff(who);
  return ROACH_AVATARS.filter((a) => a !== "duck" || duck);
}

/** The badges a player holds, by id, for the looks they may wear */
export async function badgeIdsOf(userId: string) {
  return (await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, userId))).map((r) => r.badge);
}

/** Whether this player holds the badge that lets them wear the sponsors' thanks */
export async function hasSponsorBadge(userId: string) {
  const [row] = await db
    .select({ badge: userBadges.badge })
    .from(userBadges)
    .where(and(eq(userBadges.userId, userId), eq(userBadges.badge, SPONSOR_BADGE)))
    .limit(1);
  return Boolean(row);
}

/**
 * The look a saved profile keeps: the one asked for if they may pick it; else the one they had if they still may,
 * else the plain hood. While 鸭爵 is theirs but not shown to them (DUCK off, or admins and they are no admin) they see
 * him as the hood, so a profile saved in it (or in him, from a page opened before) keeps him.
 */
export function lookToSave(wanted: RoachAvatar, had: string | null | undefined, who: Who, badges: readonly string[]) {
  const was = ROACH_AVATARS.find((a) => a === had) ?? "hood";
  if (was === "duck" && !duckShownTo(who) && (wanted === "hood" || wanted === "duck") && mayWearDuck(who, badges)) return was;
  const may = pickableLooks(who, badges);
  if (may.includes(wanted)) return wanted;
  return may.includes(was) ? was : "hood";
}

/**
 * 鸭爵 taken off one he is no longer for (their 服务器饲养员 taken back, or no longer an admin): back to the plain
 * hood. mod: whether they are still an admin (as this process knows the admins only once it has read them again).
 * Whether he went, so the map is told.
 */
export async function takeOffDuck(userId: string, mod: boolean): Promise<boolean> {
  const [u] = await db.select({ email: users.email, avatar: users.avatar }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.avatar !== "duck" || mod || isOwnerEmail(u.email) || (await hasSponsorBadge(userId))) return false;
  await db.update(users).set({ avatar: "hood" }).where(eq(users.id, userId));
  return true;
}
