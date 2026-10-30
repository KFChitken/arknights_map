import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql, type AnyColumn } from "drizzle-orm";
import { TICK_MISSING } from "../consent";
import { declarationText, FOODS, isReaction, reactionsFor, type Declaration, type Food } from "../declarations";
import { AWAY_DAYS } from "../badges";
import { beijingDate, beijingMidnight } from "../beijing";
import { findLine } from "../events";
import { nextMorning } from "../morning";
import { checkSupport } from "../support";
import { isGame } from "../games";
import { displayName, type Profile, type PublicProfile } from "../profile";
import {
  DECLARATION_COOLDOWN_MIN,
  DECLARATION_RADIUS_KM,
  DECLARATIONS_PER_DAY,
  INBOX_DAYS,
  MAX_CLONES,
  MOVES_PER_DAY,
  NEWCOMER_DAYS,
  PLACEMENTS_PER_DAY,
  RADAR_RADIUS_KM,
  RADAR_REUSE_MIN,
  RADAR_SCANS_PER_DAY,
  TOUCH_SAME_ROACH_HOURS,
  TOUCHES_PER_DAY,
} from "../rules";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat } from "../types";
import { isBotId } from "../world/bots";
import { passerbyMoves, type Move } from "../world/cast";
import {
  buildRadar,
  checkDeclaration,
  checkSpot,
  DAY,
  HOUR,
  MINUTE,
  normalizeProfile,
  publicProfileOf,
  reachText,
} from "../world/logic";
import {
  WorldError,
  type Friend,
  type FriendEvent,
  type Homecoming,
  type InboxItem,
  type Me,
  type OwnRoach,
  type PlaceTarget,
  type Radar,
  type RadarScan,
  type TouchResult,
} from "../world/types";
import { award, drank, earnedBy, friendsMade, reactedTo, respondersOf, shownBadges, wakeUp } from "./badges";
import { daysBetween, lastVisitOn } from "./away";
import { blockedBetween, blockedBy, blockedWith } from "./blocks";
import { agreedPublicPlace, mustReconsent } from "./consent";
import { db } from "./db";
import { demoEnabled, secret } from "./env";
import { nudge } from "./live";
import { checkName } from "./nameWords";
import { allow } from "./rateLimit";
import { lookOf, roachesChanged } from "./roachFeed";
import {
  declarations,
  deliveries,
  reactions,
  friendCuts,
  friendships,
  moves,
  radarScans,
  roaches,
  touches,
  users,
  type RoachRow,
  type UserRow,
} from "./schema";

/**
 * The world kept in Postgres: every rule about who sees what. The pure parts
 * (validation, radar counting) are in world/logic.ts.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ago = (ms: number) => new Date(Date.now() - ms);

// ---- profiles ----

export function profileOf(u: UserRow): Profile {
  return {
    anonymous: u.anonymous,
    name: u.name,
    drPrefix: u.drPrefix,
    games: u.games.filter(isGame),
    favourites: { arknights: u.favArknights, endfield: u.favEndfield },
    uid: { arknights: u.uidArknights, endfield: u.uidEndfield },
    uidServer: { arknights: u.uidServerArknights, endfield: u.uidServerEndfield },
    shareUid: u.shareUid,
    flipWhenAway: u.flipWhenAway,
    avatar: ROACH_AVATARS.find((a) => a === u.avatar) ?? "hood",
    color: ROACH_COLORS.find((c) => c === u.color) ?? "cyan",
    support: checkSupport(u.support),
  };
}

export function profileColumns(p: Profile) {
  return {
    anonymous: p.anonymous,
    name: p.name,
    drPrefix: p.drPrefix,
    games: p.games,
    favArknights: p.favourites.arknights,
    favEndfield: p.favourites.endfield,
    uidArknights: p.uid.arknights,
    uidEndfield: p.uid.endfield,
    uidServerArknights: p.uidServer.arknights,
    uidServerEndfield: p.uidServer.endfield,
    shareUid: p.shareUid,
    flipWhenAway: p.flipWhenAway,
    avatar: p.avatar,
    color: p.color,
    support: p.support,
  };
}

/** Profile cards as other players see them, badges included. */
async function cardsOf(people: UserRow[]) {
  const badges = await shownBadges(people);
  return new Map(people.map((u): [string, PublicProfile] => [u.id, { ...publicProfileOf(profileOf(u)), ...badges.get(u.id) }]));
}

async function userById(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

function own(r: RoachRow): OwnRoach {
  return { id: r.id, slot: r.slot, lng: r.lng, lat: r.lat, publicId: r.publicId };
}

async function ownRoaches(userId: string) {
  const rows = await db.select().from(roaches).where(eq(roaches.userId, userId)).orderBy(asc(roaches.slot));
  return rows.map(own);
}

// ---- friendships ----

const pair = (x: string, y: string) => (x < y ? { a: x, b: y } : { a: y, b: x });

export async function friendIdsOf(userId: string) {
  const rows = await db
    .select({ a: friendships.a, b: friendships.b })
    .from(friendships)
    .where(or(eq(friendships.a, userId), eq(friendships.b, userId)));
  return new Set(rows.map((r) => (r.a === userId ? r.b : r.a)));
}

export const friendKey = (me: string, other: string) =>
  createHmac("sha256", secret("AUTH_SECRET")).update(`friend|${me}|${other}`).digest("base64url").slice(0, 16);

/** After a bold touch from a to b: if b has also touched a boldly, they become 触须之交. */
async function befriendIfMutual(a: string, b: string): Promise<string | null> {
  if (await blockedBetween(a, b)) return null;
  const p = pair(a, b);
  const [existing] = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.a, p.a), eq(friendships.b, p.b)))
    .limit(1);
  if (existing) return null;
  const [cut] = await db
    .select()
    .from(friendCuts)
    .where(and(eq(friendCuts.a, p.a), eq(friendCuts.b, p.b)))
    .limit(1);
  const since = cut?.cutAt ?? new Date(0);
  const bold = async (x: string, y: string) =>
    (
      await db
        .select({ id: touches.id })
        .from(touches)
        .where(
          and(
            eq(touches.fromUserId, x),
            eq(touches.toUserId, y),
            eq(touches.bold, true),
            eq(touches.withheld, false),
            gt(touches.createdAt, since),
          ),
        )
        .limit(1)
    ).length > 0;
  if (!(await bold(a, b)) || !(await bold(b, a))) return null;
  const [made] = await db
    .insert(friendships)
    .values({ ...p, seenByA: p.a === a, seenByB: p.b === a })
    .onConflictDoNothing()
    .returning({ a: friendships.a });
  if (made) await friendsMade(a, b, !cut);
  const other = await userById(b);
  return other ? displayName(profileOf(other)) : null;
}

// ---- the world, for one player ----

export async function me(userId: string): Promise<Me | null> {
  const u = await userById(userId);
  if (!u) return null;
  // u still holds the day of the visit before this one
  const today = beijingDate();
  const lastSeen = lastVisitOn(u);
  const daysAway = daysBetween(lastSeen, today);
  if (u.lastSeenOn !== today) await db.update(users).set({ lastSeenOn: today }).where(eq(users.id, u.id));
  if (daysAway >= AWAY_DAYS) await wakeUp(u.id);
  const mine = await ownRoaches(u.id);
  const badges = await earnedBy(u.id);
  const movesLeft = Math.max(0, MOVES_PER_DAY - (await recentMoves(u.id, "move")));
  const isNew = Date.now() - u.createdAt.getTime() < NEWCOMER_DAYS * DAY;
  // only asked for while the tutorial can still show; a young account's records are far from the 90-day clean-up
  const [declared] = isNew
    ? await db.select({ id: declarations.id }).from(declarations).where(eq(declarations.senderId, u.id)).limit(1)
    : [];
  const [touched] = isNew ? await db.select({ id: touches.id }).from(touches).where(eq(touches.fromUserId, u.id)).limit(1) : [];
  return {
    id: u.id,
    profile: profileOf(u),
    roaches: mine,
    movesLeft,
    isNew,
    hasDeclared: Boolean(declared),
    hasTouched: Boolean(touched),
    badges,
    wornBadge: badges.some((b) => b.id === u.wornBadge) ? u.wornBadge : null,
    counts: { friends: u.friendsEver, responders: await respondersOf(u.id), drinks: u.drinksTotal },
    drunkUntil: u.drunkUntil && u.drunkUntil.getTime() > Date.now() ? u.drunkUntil.getTime() : null,
    // a whole day or more away, so not just back the next morning
    homecoming: daysAway >= 2 ? await homecoming(u.id, mine, lastSeen, daysAway) : null,
    mustReconsent: mustReconsent(u),
    agreedPublicPlace: agreedPublicPlace(u),
    // the first visit since the 04:00 batch flipped it over: the owner sees it stand up now, everyone else at the next batch
    wokeFromAway: Boolean(u.sleptAwayOn && (!u.lastSeenOn || u.lastSeenOn < u.sleptAwayOn)),
  };
}

/** 欢迎回家: roaches others put down or moved into the radar's circle around the main roach since the day of the last visit. */
async function homecoming(userId: string, mine: OwnRoach[], lastSeenOn: string, daysAway: number): Promise<Homecoming> {
  const main = mine.find((r) => r.slot === 0);
  if (!main) return { daysAway, arrivals: 0 };
  const center = sql`ST_SetSRID(ST_MakePoint(${main.lng}, ${main.lat}), 4326)::geography`;
  const within = (geog: AnyColumn) => sql`ST_DWithin(${geog}, ${center}, ${RADAR_RADIUS_KM * 1000})`;
  const [row] = await db
    .select({ n: count() })
    .from(moves)
    .where(
      and(
        ne(moves.userId, userId),
        gte(moves.at, new Date(beijingMidnight(lastSeenOn))),
        within(moves.toGeog),
        or(isNull(moves.fromLng), not(within(moves.fromGeog))),
      ),
    );
  return { daysAway, arrivals: row.n };
}

/** A player's moves of roaches already on the map, or new roaches put down, in the last 24 hours. */
async function recentMoves(userId: string, kind: "move" | "place") {
  const which =
    kind === "move" ? and(isNotNull(moves.fromLng), isNotNull(moves.toLng)) : and(isNull(moves.fromLng), isNotNull(moves.toLng));
  const [row] = await db
    .select({ n: count() })
    .from(moves)
    .where(and(eq(moves.userId, userId), gt(moves.at, ago(DAY)), which));
  return row.n;
}

export async function saveProfile(userId: string, input: Profile): Promise<Profile> {
  const profile = normalizeProfile(input);
  // checked even while anonymous: the name is kept, and shows again once they go by it
  await checkName(profile.name);
  const [before] = await db.select({ support: users.support }).from(users).where(eq(users.id, userId)).limit(1);
  // 触须之交 see 「换了助战」 for the latest change only
  const changed = (before?.support ?? []).join("|") !== profile.support.join("|");
  await db
    .update(users)
    .set({ ...profileColumns(profile), ...(changed ? { supportChangedAt: new Date() } : {}) })
    .where(eq(users.id, userId));
  // the main roach wears the profile's look
  roachesChanged();
  return profile;
}

export async function placeRoach(userId: string, target: PlaceTarget, spot: LngLat): Promise<OwnRoach[]> {
  const at = checkSpot(spot);
  const u = await userById(userId);
  if (!u) throw new WorldError("找不到这个账号了。");
  const mine = await db.select().from(roaches).where(eq(roaches.userId, userId));
  const main = mine.find((r) => r.slot === 0);
  let slot: number;
  let existing: RoachRow | undefined;
  if (target?.kind === "main") {
    slot = 0;
    existing = main;
  } else if (target?.kind === "clone") {
    if (!main) throw new WorldError("先放下蟑螂本体，才能放克隆体。");
    const used = new Set(mine.map((r) => r.slot));
    const free = Array.from({ length: MAX_CLONES }, (_, i) => i + 1).find((s) => !used.has(s));
    if (!free) throw new WorldError(`最多只能放 ${MAX_CLONES} 只克隆体。`);
    slot = free;
  } else if (target?.kind === "move") {
    existing = mine.find((r) => r.id === target.roachId);
    if (!existing) throw new WorldError("找不到这只蟑螂了。");
    slot = existing.slot;
  } else {
    throw new WorldError("不知道要放哪只蟑螂。");
  }
  // A new roach shows its exact spot to everyone, which the player agrees to once, on a card before the first
  if (!existing && !agreedPublicPlace(u)) throw new WorldError(TICK_MISSING.acceptPublicPlace);
  // Each move is a row the radar reads, so they are rationed; taking a roach back and putting it down again counts too
  if (existing && (await recentMoves(userId, "move")) >= MOVES_PER_DAY) {
    throw new WorldError(`每天最多挪 ${MOVES_PER_DAY} 次窝，今天的用完了，明天再挪吧。`);
  }
  if (!existing && (await recentMoves(userId, "place")) >= PLACEMENTS_PER_DAY) {
    throw new WorldError("今天放下的蟑螂太多了，明天再放吧。");
  }
  // A fresh public id on every move, so nobody can follow a roach between spots
  const values = { lng: at.lng, lat: at.lat, publicId: randomUUID(), placedAt: new Date() };
  await db.transaction(async (tx) => {
    if (existing) await tx.update(roaches).set(values).where(eq(roaches.id, existing.id));
    else await tx.insert(roaches).values({ userId, slot, ...values });
    // a roach has to stand up to walk: moving the main roach sobers it up, and wakes it from staying away
    if (slot === 0) await tx.update(users).set({ drunkUntil: null, sleptAwayOn: null }).where(eq(users.id, userId));
    await tx.insert(moves).values({
      userId,
      slot,
      fromLng: existing?.lng ?? null,
      fromLat: existing?.lat ?? null,
      toLng: at.lng,
      toLat: at.lat,
    });
  });
  roachesChanged();
  return ownRoaches(userId);
}

/** Taking back the main roach takes back the clones too. */
export async function removeRoach(userId: string, roachId: string): Promise<OwnRoach[]> {
  if (!UUID.test(String(roachId))) throw new WorldError("找不到这只蟑螂了。");
  const mine = await db.select().from(roaches).where(eq(roaches.userId, userId));
  const roach = mine.find((r) => r.id === roachId);
  if (!roach) throw new WorldError("找不到这只蟑螂了。");
  const gone = roach.slot === 0 ? mine : [roach];
  await db.transaction(async (tx) => {
    await tx.delete(roaches).where(inArray(roaches.id, gone.map((r) => r.id)));
    await tx.insert(moves).values(gone.map((r) => ({ userId, slot: r.slot, fromLng: r.lng, fromLat: r.lat })));
    if (roach.slot === 0) await tx.update(users).set({ drunkUntil: null, sleptAwayOn: null }).where(eq(users.id, userId));
  });
  roachesChanged();
  return ownRoaches(userId);
}

/** At least this long between two drinks, so a script cannot churn the shared roach list. */
const DRINK_GAP_MS = 10_000;

/** 摄入酒精: the main roach falls asleep drunk until the next morning where it lies. Every real drink counts for the 酒神 badges. */
export async function drink(userId: string): Promise<{ until: number }> {
  const u = await userById(userId);
  if (!u) throw new WorldError("找不到这个账号了。");
  // test players never lie down
  if (u.demoKey) throw new WorldError("测试玩家不喝酒。");
  const [main] = await db.select().from(roaches).where(and(eq(roaches.userId, userId), eq(roaches.slot, 0))).limit(1);
  if (!main) throw new WorldError("先放下蟑螂本体，才能摄入酒精。");
  const now = new Date();
  const drunk = "已经醉倒了，醒了才能再喝。";
  if (u.drunkUntil && u.drunkUntil > now) throw new WorldError(drunk);
  if (!allow(`drink:${userId}`, 1, DRINK_GAP_MS)) throw new WorldError("刚喝过一回，缓一缓再喝。");
  const until = nextMorning(main, now.getTime());
  const [row] = await db
    .update(users)
    .set({ drunkUntil: new Date(until), drinksTotal: sql`${users.drinksTotal} + 1` })
    .where(and(eq(users.id, userId), or(isNull(users.drunkUntil), lt(users.drunkUntil, now))))
    .returning({ total: users.drinksTotal });
  if (!row) throw new WorldError(drunk);
  await drank(userId, row.total);
  roachesChanged();
  return { until };
}

/** 醒酒: the main roach stands up at once. */
export async function sober(userId: string) {
  const woke = await db
    .update(users)
    .set({ drunkUntil: null })
    .where(and(eq(users.id, userId), isNotNull(users.drunkUntil)))
    .returning({ id: users.id });
  if (woke.length) roachesChanged();
}

async function checkTouchQuota(userId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), gt(touches.createdAt, ago(DAY))));
  if (n >= TOUCHES_PER_DAY) throw new WorldError("今天的触须用完啦，明天再来吧。");
}

export async function touch(userId: string, publicId: string, bold: boolean): Promise<TouchResult> {
  if (isBotId(String(publicId))) throw new WorldError("这是网站放的演示蟑螂，不是真人，碰不到 TA。");
  if (!UUID.test(String(publicId))) throw new WorldError("这只蟑螂已经爬走了。");
  const [roach] = await db.select().from(roaches).where(eq(roaches.publicId, publicId)).limit(1);
  if (!roach) throw new WorldError("这只蟑螂已经爬走了。");
  if (roach.userId === userId) throw new WorldError("这是你自己的蟑螂。");
  await checkTouchQuota(userId);
  // keyed by the public id, not the owner, so the answer cannot tell you two roaches share an owner
  const [again] = await db
    .select({ id: touches.id })
    .from(touches)
    .where(
      and(
        eq(touches.fromUserId, userId),
        eq(touches.toPublicId, publicId),
        gt(touches.createdAt, ago(TOUCH_SAME_ROACH_HOURS * HOUR)),
      ),
    )
    .limit(1);
  if (again) throw new WorldError("今天已经碰过这只蟑螂了，明天再来吧。");
  // Between a blocked pair the touch looks sent, but never arrives
  const withheld = await blockedBetween(userId, roach.userId);
  await db.insert(touches).values({
    fromUserId: userId,
    toUserId: roach.userId,
    bold: Boolean(bold),
    toSlot: roach.slot,
    toPublicId: publicId,
    withheld,
  });
  if (withheld) return { newFriend: null };
  const newFriend = bold ? await befriendIfMutual(userId, roach.userId) : null;
  nudge([roach.userId]);
  return { newFriend };
}

async function replied(userId: string, itemIds: string[]) {
  if (!itemIds.length) return new Set<string>();
  const rows = await db
    .select({ re: touches.replyTo })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), inArray(touches.replyTo, itemIds)));
  return new Set(rows.map((r) => r.re));
}

/** Touch back whoever sent an inbox item. */
export async function reply(userId: string, itemId: string, bold: boolean): Promise<TouchResult> {
  const [kind, id] = String(itemId).split(":");
  let to: string | undefined;
  if (UUID.test(id ?? "")) {
    if (kind === "t") {
      const [t] = await db
        .select({ from: touches.fromUserId, ignoredAt: touches.ignoredAt })
        .from(touches)
        .where(and(eq(touches.id, id), eq(touches.toUserId, userId)))
        .limit(1);
      if (t?.ignoredAt) throw new WorldError("你已经默默爬走了。");
      to = t?.from;
    } else if (kind === "d") {
      const [d] = await db
        .select({ from: declarations.senderId })
        .from(deliveries)
        .innerJoin(declarations, eq(declarations.id, deliveries.declarationId))
        .where(and(eq(deliveries.declarationId, id), eq(deliveries.recipientId, userId)))
        .limit(1);
      to = d?.from;
    } else if (kind === "x") {
      const [r] = await db
        .select({ from: reactions.fromUserId })
        .from(reactions)
        .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
        .where(and(eq(reactions.id, id), eq(declarations.senderId, userId)))
        .limit(1);
      to = r?.from;
    }
  }
  if (!to) throw new WorldError("找不到这条消息的主人了。");
  if ((await replied(userId, [itemId])).size) throw new WorldError("已经碰过 TA 了。");
  await checkTouchQuota(userId);
  const withheld = await blockedBetween(userId, to);
  await db.insert(touches).values({ fromUserId: userId, toUserId: to, bold: Boolean(bold), replyTo: itemId, withheld });
  if (withheld) return { newFriend: null };
  const newFriend = bold ? await befriendIfMutual(userId, to) : null;
  nudge([to]);
  return { newFriend };
}

export async function inbox(userId: string): Promise<InboxItem[]> {
  const since = ago(INBOX_DAYS * DAY);
  const items: InboxItem[] = [];
  const blocked = await blockedBy(userId);

  const ts = (
    await db
      .select({ t: touches, from: users })
      .from(touches)
      .innerJoin(users, eq(users.id, touches.fromUserId))
      .where(and(eq(touches.toUserId, userId), eq(touches.withheld, false), gt(touches.createdAt, since)))
  ).filter((x) => !blocked.has(x.t.fromUserId));
  const ds = (
    await db
      .select({ d: declarations, seenAt: deliveries.seenAt })
      .from(deliveries)
      .innerJoin(declarations, eq(declarations.id, deliveries.declarationId))
      .where(and(eq(deliveries.recipientId, userId), gt(declarations.createdAt, since)))
  ).filter((x) => !blocked.has(x.d.senderId));
  const mine = ds.length
    ? await db
        .select({ declarationId: reactions.declarationId, reaction: reactions.reaction })
        .from(reactions)
        .where(and(eq(reactions.fromUserId, userId), inArray(reactions.declarationId, ds.map((x) => x.d.id))))
    : [];
  const myReaction = new Map(mine.map((r) => [r.declarationId, r.reaction]));
  const rs = (
    await db
      .select({ r: reactions, d: declarations })
      .from(reactions)
      .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
      .where(and(eq(declarations.senderId, userId), eq(reactions.withheld, false), gt(reactions.createdAt, since)))
  ).filter((x) => !blocked.has(x.r.fromUserId));
  const fs = await db
    .select()
    .from(friendships)
    .where(and(or(eq(friendships.a, userId), eq(friendships.b, userId)), gt(friendships.createdAt, since)));
  const cards = await cardsOf(ts.filter((x) => x.t.bold).map((x) => x.from));
  const done = await replied(userId, [
    ...ts.map((x) => `t:${x.t.id}`),
    ...ds.map((x) => `d:${x.d.id}`),
    ...rs.map((x) => `x:${x.r.id}`),
  ]);

  for (const { t, from } of ts) {
    const id = `t:${t.id}`;
    items.push({
      kind: "touch",
      id,
      at: t.createdAt.getTime(),
      seen: Boolean(t.seenAt),
      bold: t.bold,
      target: t.replyTo
        ? t.replyTo.startsWith("d:")
          ? "declaration"
          : t.replyTo.startsWith("x:")
            ? "reaction"
            : "touch"
        : t.toSlot
          ? "clone"
          : "main",
      from: t.bold ? cards.get(from.id)! : null,
      replied: done.has(id),
      ignored: Boolean(t.ignoredAt),
    });
  }
  for (const { d, seenAt } of ds) {
    const id = `d:${d.id}`;
    const reacted = myReaction.get(d.id);
    items.push({
      kind: "declaration",
      id,
      at: d.createdAt.getTime(),
      seen: Boolean(seenAt),
      text: declarationText(storedDeclaration(d)),
      replied: done.has(id),
      reaction: isReaction(reacted) ? reacted : null,
      options: reactionsFor(d.template),
    });
  }
  for (const { r, d } of rs) {
    if (!isReaction(r.reaction)) continue;
    const id = `x:${r.id}`;
    items.push({
      kind: "reaction",
      id,
      at: r.createdAt.getTime(),
      seen: Boolean(r.seenAt),
      text: declarationText(storedDeclaration(d)),
      reaction: r.reaction,
      replied: done.has(id),
    });
  }
  for (const f of fs) {
    const other = f.a === userId ? f.b : f.a;
    const u = await userById(other);
    if (!u) continue;
    items.push({
      kind: "friend",
      id: `f:${f.a}~${f.b}`,
      at: f.createdAt.getTime(),
      seen: f.a === userId ? f.seenByA : f.seenByB,
      from: (await cardsOf([u])).get(u.id)!,
      friendId: friendKey(userId, other),
      replied: true,
    });
  }
  return items.sort((x, y) => y.at - x.at);
}

export function storedDeclaration(d: typeof declarations.$inferSelect): Declaration {
  const game = isGame(d.game) ? d.game : "arknights";
  const character = d.character ?? "";
  switch (d.template) {
    case "iam":
      return { template: "iam", character, title: d.title ?? "" };
    case "love":
    case "buff":
    case "canyou":
      return { template: d.template, character };
    case "eat":
      return { template: "eat", character, food: FOODS.find((f) => f === d.food) ?? (FOODS[0] as Food) };
    case "myname":
      return { template: "myname", game, name: d.name ?? "" };
    case "welcome":
    case "alsoplay":
      return { template: d.template, game };
    case "birthday":
      return { template: "birthday" };
    case "event":
      return { template: "event", line: d.line ?? "" };
    default:
      return { template: "launch", game };
  }
}

export async function markSeen(userId: string, itemIds: string[]) {
  const now = new Date();
  const ids = (prefix: string) =>
    itemIds
      .filter((i) => typeof i === "string" && i.startsWith(prefix))
      .map((i) => i.slice(prefix.length))
      .filter((i) => UUID.test(i));
  const t = ids("t:");
  if (t.length) {
    await db
      .update(touches)
      .set({ seenAt: now })
      .where(and(inArray(touches.id, t), eq(touches.toUserId, userId), isNull(touches.seenAt)));
  }
  const d = ids("d:");
  if (d.length) {
    await db
      .update(deliveries)
      .set({ seenAt: now })
      .where(and(inArray(deliveries.declarationId, d), eq(deliveries.recipientId, userId), isNull(deliveries.seenAt)));
  }
  const x = ids("x:");
  if (x.length) {
    const myDeclarations = db.select({ id: declarations.id }).from(declarations).where(eq(declarations.senderId, userId));
    await db
      .update(reactions)
      .set({ seenAt: now })
      .where(and(inArray(reactions.id, x), inArray(reactions.declarationId, myDeclarations), isNull(reactions.seenAt)));
  }
  for (const f of itemIds.filter((i) => typeof i === "string" && i.startsWith("f:"))) {
    const [a, b] = f.slice(2).split("~");
    if (!UUID.test(a ?? "") || !UUID.test(b ?? "")) continue;
    if (userId === a) await db.update(friendships).set({ seenByA: true }).where(and(eq(friendships.a, a), eq(friendships.b, b)));
    if (userId === b) await db.update(friendships).set({ seenByB: true }).where(and(eq(friendships.a, a), eq(friendships.b, b)));
  }
}

/**
 * Shout to everyone with a roach within DECLARATION_RADIUS_KM of any of the
 * sender's chosen roaches (the main roach unless `from` says otherwise).
 * Each player gets it once, however many of those roaches they are near.
 */
export async function declare(userId: string, input: Declaration, from?: string[]): Promise<{ reach: string }> {
  const u = await userById(userId);
  if (!u) throw new WorldError("请先登录。");
  const d = checkDeclaration(profileOf(u), input);
  const mine = await db.select().from(roaches).where(eq(roaches.userId, userId));
  if (!mine.some((r) => r.slot === 0)) throw new WorldError("先放下蟑螂本体，才能发表独立宣言。");
  const wanted = Array.isArray(from) ? [...new Set(from.map(String))] : null;
  const chosen = wanted ? mine.filter((r) => wanted.includes(r.id)) : mine.filter((r) => r.slot === 0);
  if (wanted && chosen.length < wanted.length) throw new WorldError("有只蟑螂找不到了，刷新一下再试。");
  if (!chosen.length) throw new WorldError("选一只蟑螂来发宣言吧。");

  const recent = await db
    .select({ at: declarations.createdAt })
    .from(declarations)
    .where(and(eq(declarations.senderId, userId), gt(declarations.createdAt, ago(DAY))));
  if (recent.length >= DECLARATIONS_PER_DAY) throw new WorldError("今天的宣言发得够多啦，明天再来吧。");
  if (recent.some((r) => Date.now() - r.at.getTime() < DECLARATION_COOLDOWN_MIN * MINUTE)) {
    throw new WorldError("刚刚才发过宣言，歇一会儿再发吧。");
  }

  // The sender only learns a rough count
  const near = chosen.map(
    (c) =>
      sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography, ${DECLARATION_RADIUS_KM * 1000})`,
  );
  const blocked = await blockedWith(userId);
  const rows = (
    await db
      .selectDistinct({ id: roaches.userId })
      .from(roaches)
      .where(and(ne(roaches.userId, userId), or(...near)))
  ).filter((r) => !blocked.has(r.id));
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(declarations)
      .values({
        senderId: userId,
        template: d.template,
        game: "game" in d ? d.game : null,
        character: "character" in d ? d.character : null,
        title: d.template === "iam" ? d.title : null,
        food: d.template === "eat" ? d.food : null,
        name: d.template === "myname" ? (d.name ?? null) : null,
        line: d.template === "event" ? d.line : null,
        recipients: rows.length,
      })
      .returning({ id: declarations.id });
    for (let i = 0; i < rows.length; i += 1000) {
      await tx
        .insert(deliveries)
        .values(rows.slice(i, i + 1000).map((r) => ({ declarationId: row.id, recipientId: r.id })));
    }
  });
  nudge(rows.map((r) => r.id));
  const event = d.template === "event" ? findLine(d.line)?.event : null;
  if (event) await award(userId, [event.badge]);
  return { reach: reachText(rows.length) };
}

/** 默默爬走: leave a touch you received unanswered for good. Only the receiver ever knows. */
export async function ignore(userId: string, itemId: string) {
  const [kind, id] = String(itemId).split(":");
  if (kind !== "t" || !UUID.test(id ?? "")) throw new WorldError("找不到这条消息了。");
  if ((await replied(userId, [itemId])).size) throw new WorldError("已经碰过 TA 了。");
  const now = new Date();
  const [done] = await db
    .update(touches)
    .set({ ignoredAt: now, seenAt: sql`coalesce(${touches.seenAt}, ${now.toISOString()})` })
    .where(and(eq(touches.id, id), eq(touches.toUserId, userId)))
    .returning({ id: touches.id });
  if (!done) throw new WorldError("找不到这条消息了。");
}

/** Leave one of the fixed reactions on a declaration you received. The sender is not told who. */
export async function react(userId: string, itemId: string, reaction: string) {
  const [kind, id] = String(itemId).split(":");
  if (kind !== "d" || !UUID.test(id ?? "")) throw new WorldError("找不到这条宣言了。");
  const [row] = await db
    .select({ senderId: declarations.senderId, template: declarations.template })
    .from(deliveries)
    .innerJoin(declarations, eq(declarations.id, deliveries.declarationId))
    .where(and(eq(deliveries.declarationId, id), eq(deliveries.recipientId, userId)))
    .limit(1);
  if (!row) throw new WorldError("找不到这条宣言了。");
  if (!isReaction(reaction) || !reactionsFor(row.template).includes(reaction)) throw new WorldError("这条宣言不能这样回应。");
  const withheld = await blockedBetween(userId, row.senderId);
  const [made] = await db
    .insert(reactions)
    .values({ declarationId: id, fromUserId: userId, reaction, withheld })
    .onConflictDoNothing()
    .returning({ id: reactions.id });
  if (!made) throw new WorldError("已经回应过这条宣言了。");
  if (withheld) return;
  nudge([row.senderId]);
  await reactedTo(row.senderId);
}

export async function friends(userId: string): Promise<Friend[]> {
  const since = ago(INBOX_DAYS * DAY);
  const fs = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.a, userId), eq(friendships.b, userId)))
    .orderBy(desc(friendships.createdAt));
  const out: Friend[] = [];
  for (const f of fs) {
    const other = f.a === userId ? f.b : f.a;
    const u = await userById(other);
    if (!u) continue;
    const theirRoaches = await db.select().from(roaches).where(eq(roaches.userId, other)).orderBy(asc(roaches.slot));
    const history: FriendEvent[] = [];
    const ts = await db
      .select()
      .from(touches)
      .where(and(or(eq(touches.fromUserId, other), eq(touches.toUserId, other)), gt(touches.createdAt, since)));
    for (const t of ts) {
      const at = t.createdAt.getTime();
      if (t.fromUserId === other) history.push({ kind: "touched", at, bold: t.bold, you: t.toUserId === userId });
      if (t.toUserId === other) history.push({ kind: "touchedBy", at, bold: t.bold, you: t.fromUserId === userId });
    }
    const ds = await db
      .select()
      .from(declarations)
      .where(and(eq(declarations.senderId, other), gt(declarations.createdAt, since)));
    for (const d of ds) history.push({ kind: "declared", at: d.createdAt.getTime(), text: declarationText(storedDeclaration(d)) });
    const gs = await db
      .select()
      .from(friendships)
      .where(or(eq(friendships.a, other), eq(friendships.b, other)));
    for (const g of gs) {
      const third = g.a === other ? g.b : g.a;
      history.push({ kind: "befriended", at: g.createdAt.getTime(), you: third === userId });
    }
    if (u.supportChangedAt && u.supportChangedAt > since && u.games.includes("arknights")) {
      history.push({ kind: "support", at: u.supportChangedAt.getTime() });
    }
    out.push({
      id: friendKey(userId, other),
      since: f.createdAt.getTime(),
      profile: (await cardsOf([u])).get(u.id)!,
      roaches: theirRoaches.map((r) => ({
        id: r.publicId,
        clone: r.slot > 0,
        ...lookOf(r.slot, u.avatar, u.color),
        friend: true,
        lng: r.lng,
        lat: r.lat,
      })),
      declarations: ds.length,
      history: history.sort((x, y) => y.at - x.at).slice(0, 30),
    });
  }
  return out;
}

export async function unfriend(userId: string, friendId: string) {
  const others = await friendIdsOf(userId);
  const other = [...others].find((o) => friendKey(userId, o) === friendId);
  if (!other) throw new WorldError("你们已经不是触须之交了。");
  await endFriendship(userId, other);
}

/** Stop being 触须之交; only bold touches from now on count towards becoming friends again. */
export async function endFriendship(x: string, y: string) {
  const p = pair(x, y);
  await db.transaction(async (tx) => {
    await tx.delete(friendships).where(and(eq(friendships.a, p.a), eq(friendships.b, p.b)));
    await tx
      .insert(friendCuts)
      .values({ ...p, cutAt: new Date() })
      .onConflictDoUpdate({ target: [friendCuts.a, friendCuts.b], set: { cutAt: new Date() } });
  });
}

/**
 * 方舟雷达, rationed to RADAR_SCANS_PER_DAY a day. Reopening it within
 * RADAR_REUSE_MIN, with the main roach still in the same spot, shows the same
 * scan for free; once the scans run out the last one is shown again with when
 * the next frees up.
 */
export async function radar(userId: string): Promise<Radar | null> {
  const now = Date.now();
  const [main] = await db
    .select()
    .from(roaches)
    .where(and(eq(roaches.userId, userId), eq(roaches.slot, 0)))
    .limit(1);
  if (!main) return null;
  const recent = await db
    .select()
    .from(radarScans)
    .where(and(eq(radarScans.userId, userId), gt(radarScans.createdAt, ago(DAY))))
    .orderBy(desc(radarScans.createdAt));
  const left = RADAR_SCANS_PER_DAY - recent.length;
  const last = recent[0];
  const sameSpot = last && last.lng === main.lng && last.lat === main.lat;
  if (last && (left <= 0 || (sameSpot && now - last.createdAt.getTime() < RADAR_REUSE_MIN * MINUTE))) {
    const oldest = recent[recent.length - 1];
    return {
      ...last.result,
      scannedAt: last.createdAt.getTime(),
      scansLeft: Math.max(0, left),
      nextScanAt: left <= 0 ? oldest.createdAt.getTime() + DAY : null,
    };
  }
  const scan = await scanRadar(userId, main, now);
  await db.insert(radarScans).values({ userId, result: scan, lng: main.lng, lat: main.lat, createdAt: new Date(now) });
  await db.delete(radarScans).where(and(eq(radarScans.userId, userId), lt(radarScans.createdAt, ago(DAY))));
  return { ...scan, scannedAt: now, scansLeft: left - 1, nextScanAt: null };
}

/**
 * Count what is around your main roach. Every query goes through a spatial
 * index and reads only rows near it, so a scan costs the same however big the
 * map gets.
 */
async function scanRadar(userId: string, main: RoachRow, now: number): Promise<RadarScan> {
  const center = sql`ST_SetSRID(ST_MakePoint(${main.lng}, ${main.lat}), 4326)::geography`;
  // a hair wider than the circle; buildRadar decides exactly who is inside
  const reach = RADAR_RADIUS_KM * 1010;
  const within = (geog: AnyColumn) => sql`ST_DWithin(${geog}, ${center}, ${reach})`;
  const near = await db
    .select({ owner: roaches.userId, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(and(ne(roaches.userId, userId), within(roaches.geog)));
  // a move matters only if it starts or ends inside the circle
  const moveRows = await db
    .select({
      userId: moves.userId,
      slot: moves.slot,
      fromLng: moves.fromLng,
      fromLat: moves.fromLat,
      toLng: moves.toLng,
      toLat: moves.toLat,
      at: moves.at,
    })
    .from(moves)
    .where(and(ne(moves.userId, userId), gt(moves.at, ago(7 * DAY)), or(within(moves.fromGeog), within(moves.toGeog))));
  const recentMoves: Move[] = moveRows.map((m) => ({
    owner: m.userId,
    slot: m.slot,
    from: m.fromLng === null || m.fromLat === null ? null : { lng: m.fromLng, lat: m.fromLat },
    to: m.toLng === null || m.toLat === null ? null : { lng: m.toLng, lat: m.toLat },
    at: m.at.getTime(),
  }));
  const demo = demoEnabled ? await demoMoves(now) : [];
  // players with a roach nearby, for counting their touches and declarations through the per-player indexes
  const nearPlayers = sql`(select ${roaches.userId} from ${roaches} where ${within(roaches.geog)})`;
  const touchedPlayers = (
    await db
      .select({ to: touches.toUserId })
      .from(touches)
      .where(and(gt(touches.createdAt, ago(DAY)), sql`${touches.toUserId} in ${nearPlayers}`))
  ).map((t) => t.to);
  const declaringPlayers = (
    await db
      .select({ from: declarations.senderId })
      .from(declarations)
      .where(and(gt(declarations.createdAt, ago(DAY)), sql`${declarations.senderId} in ${nearPlayers}`))
  ).map((d) => d.from);
  return buildRadar({
    center: { lng: main.lng, lat: main.lat },
    now,
    roaches: near.map((r) => ({ owner: r.owner, slot: r.slot, at: { lng: r.lng, lat: r.lat } })),
    moves: [...demo.filter((m) => m.owner !== userId), ...recentMoves],
    touchedPlayers,
    declaringPlayers,
    friends: await friendIdsOf(userId),
    demo: demo.length > 0,
  });
}

/** The demo passers-by's made-up week of comings and goings, keyed to their user ids. */
async function demoMoves(now: number): Promise<Move[]> {
  const rows = await db
    .select({ id: users.id, key: users.demoKey })
    .from(users)
    .where(and(isNotNull(users.demoKey), sql`${users.demoKey} like 'n%'`));
  if (!rows.length) return [];
  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  return passerbyMoves(now).flatMap((m) => {
    const id = byKey.get(m.owner);
    return id ? [{ ...m, owner: id }] : [];
  });
}
