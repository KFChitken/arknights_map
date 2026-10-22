import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { declarationText, FOODS, isReaction, reactionsFor, type Declaration, type Food } from "../declarations";
import { isGame } from "../games";
import { displayName, type Profile } from "../profile";
import {
  DECLARATION_COOLDOWN_MIN,
  DECLARATION_RADIUS_KM,
  DECLARATIONS_PER_DAY,
  INBOX_DAYS,
  MAX_CLONES,
  RADAR_RADIUS_KM,
  TOUCH_SAME_ROACH_HOURS,
  TOUCHES_PER_DAY,
} from "../rules";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat } from "../types";
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
  type InboxItem,
  type Me,
  type OwnRoach,
  type PlaceTarget,
  type PublicRoach,
  type Radar,
  type TouchResult,
} from "../world/types";
import { db } from "./db";
import { demoEnabled, secret } from "./env";
import { nudge } from "./live";
import {
  declarations,
  deliveries,
  reactions,
  friendCuts,
  friendships,
  moves,
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

const CLONE_COLOR = "white" as const;
const CLONE_AVATAR = "hood" as const;
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
    shareUid: u.shareUid,
    avatar: ROACH_AVATARS.find((a) => a === u.avatar) ?? "hood",
    color: ROACH_COLORS.find((c) => c === u.color) ?? "cyan",
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
    shareUid: p.shareUid,
    avatar: p.avatar,
    color: p.color,
  };
}

async function userById(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

function own(r: RoachRow): OwnRoach {
  return { id: r.id, slot: r.slot, lng: r.lng, lat: r.lat };
}

async function ownRoaches(userId: string) {
  const rows = await db.select().from(roaches).where(eq(roaches.userId, userId)).orderBy(asc(roaches.slot));
  return rows.map(own);
}

// ---- friendships ----

const pair = (x: string, y: string) => (x < y ? { a: x, b: y } : { a: y, b: x });

async function friendIdsOf(userId: string) {
  const rows = await db
    .select({ a: friendships.a, b: friendships.b })
    .from(friendships)
    .where(or(eq(friendships.a, userId), eq(friendships.b, userId)));
  return new Set(rows.map((r) => (r.a === userId ? r.b : r.a)));
}

const friendKey = (me: string, other: string) =>
  createHmac("sha256", secret("AUTH_SECRET")).update(`friend|${me}|${other}`).digest("base64url").slice(0, 16);

/** After a bold touch from a to b: if b has also touched a boldly, they become 触须之交. */
async function befriendIfMutual(a: string, b: string): Promise<string | null> {
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
        .where(and(eq(touches.fromUserId, x), eq(touches.toUserId, y), eq(touches.bold, true), gt(touches.createdAt, since)))
        .limit(1)
    ).length > 0;
  if (!(await bold(a, b)) || !(await bold(b, a))) return null;
  await db
    .insert(friendships)
    .values({ ...p, seenByA: p.a === a, seenByB: p.b === a })
    .onConflictDoNothing();
  const other = await userById(b);
  return other ? displayName(profileOf(other)) : null;
}

// ---- the world, for one player ----

export async function me(userId: string): Promise<Me | null> {
  const u = await userById(userId);
  if (!u) return null;
  return { id: u.id, profile: profileOf(u), roaches: await ownRoaches(u.id) };
}

/** Everyone else's roaches where they were placed, in random order. */
export async function publicRoaches(viewerId: string | null): Promise<PublicRoach[]> {
  const rows = await db
    .select({
      userId: roaches.userId,
      slot: roaches.slot,
      publicId: roaches.publicId,
      lng: roaches.lng,
      lat: roaches.lat,
      avatar: users.avatar,
      color: users.color,
    })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    .where(viewerId ? ne(roaches.userId, viewerId) : undefined)
    // ordering by the random public id keeps a player's roaches from sitting next to each other
    .orderBy(asc(roaches.publicId));
  const friends = viewerId ? await friendIdsOf(viewerId) : new Set<string>();
  return rows.map((r) => {
    const clone = r.slot > 0;
    // clones all look alike, so a clone's look cannot point at its main roach
    return {
      id: r.publicId,
      clone,
      avatar: clone ? CLONE_AVATAR : (ROACH_AVATARS.find((a) => a === r.avatar) ?? "hood"),
      color: clone ? CLONE_COLOR : (ROACH_COLORS.find((c) => c === r.color) ?? "cyan"),
      friend: friends.has(r.userId),
      lng: r.lng,
      lat: r.lat,
    };
  });
}

export async function saveProfile(userId: string, input: Profile): Promise<Profile> {
  const profile = normalizeProfile(input);
  await db.update(users).set(profileColumns(profile)).where(eq(users.id, userId));
  return profile;
}

export async function placeRoach(userId: string, target: PlaceTarget, spot: LngLat): Promise<OwnRoach[]> {
  const at = checkSpot(spot);
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
  // A fresh public id on every move, so nobody can follow a roach between spots
  const values = { lng: at.lng, lat: at.lat, publicId: randomUUID(), placedAt: new Date() };
  await db.transaction(async (tx) => {
    if (existing) await tx.update(roaches).set(values).where(eq(roaches.id, existing.id));
    else await tx.insert(roaches).values({ userId, slot, ...values });
    await tx.insert(moves).values({
      userId,
      slot,
      fromLng: existing?.lng ?? null,
      fromLat: existing?.lat ?? null,
      toLng: at.lng,
      toLat: at.lat,
    });
  });
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
  });
  return ownRoaches(userId);
}

async function checkTouchQuota(userId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), gt(touches.createdAt, ago(DAY))));
  if (n >= TOUCHES_PER_DAY) throw new WorldError("今天的触须用完啦，明天再来吧。");
}

export async function touch(userId: string, publicId: string, bold: boolean): Promise<TouchResult> {
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
  await db.insert(touches).values({
    fromUserId: userId,
    toUserId: roach.userId,
    bold: Boolean(bold),
    toSlot: roach.slot,
    toPublicId: publicId,
  });
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
  await db.insert(touches).values({ fromUserId: userId, toUserId: to, bold: Boolean(bold), replyTo: itemId });
  const newFriend = bold ? await befriendIfMutual(userId, to) : null;
  nudge([to]);
  return { newFriend };
}

export async function inbox(userId: string): Promise<InboxItem[]> {
  const since = ago(INBOX_DAYS * DAY);
  const items: InboxItem[] = [];

  const ts = await db
    .select({ t: touches, from: users })
    .from(touches)
    .innerJoin(users, eq(users.id, touches.fromUserId))
    .where(and(eq(touches.toUserId, userId), gt(touches.createdAt, since)));
  const ds = await db
    .select({ d: declarations, seenAt: deliveries.seenAt })
    .from(deliveries)
    .innerJoin(declarations, eq(declarations.id, deliveries.declarationId))
    .where(and(eq(deliveries.recipientId, userId), gt(declarations.createdAt, since)));
  const mine = ds.length
    ? await db
        .select({ declarationId: reactions.declarationId, reaction: reactions.reaction })
        .from(reactions)
        .where(and(eq(reactions.fromUserId, userId), inArray(reactions.declarationId, ds.map((x) => x.d.id))))
    : [];
  const myReaction = new Map(mine.map((r) => [r.declarationId, r.reaction]));
  const rs = await db
    .select({ r: reactions, d: declarations })
    .from(reactions)
    .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
    .where(and(eq(declarations.senderId, userId), gt(reactions.createdAt, since)));
  const fs = await db
    .select()
    .from(friendships)
    .where(and(or(eq(friendships.a, userId), eq(friendships.b, userId)), gt(friendships.createdAt, since)));
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
      from: t.bold ? publicProfileOf(profileOf(from)) : null,
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
      from: publicProfileOf(profileOf(u)),
      friendId: friendKey(userId, other),
      replied: true,
    });
  }
  return items.sort((x, y) => y.at - x.at);
}

function storedDeclaration(d: typeof declarations.$inferSelect): Declaration {
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
  const rows = await db
    .selectDistinct({ id: roaches.userId })
    .from(roaches)
    .where(and(ne(roaches.userId, userId), or(...near)));
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
  const [made] = await db
    .insert(reactions)
    .values({ declarationId: id, fromUserId: userId, reaction })
    .onConflictDoNothing()
    .returning({ id: reactions.id });
  if (!made) throw new WorldError("已经回应过这条宣言了。");
  nudge([row.senderId]);
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
    out.push({
      id: friendKey(userId, other),
      since: f.createdAt.getTime(),
      profile: publicProfileOf(profileOf(u)),
      roaches: theirRoaches.map((r) => ({
        id: r.publicId,
        clone: r.slot > 0,
        avatar: r.slot > 0 ? CLONE_AVATAR : (ROACH_AVATARS.find((a) => a === u.avatar) ?? "hood"),
        color: r.slot > 0 ? CLONE_COLOR : (ROACH_COLORS.find((c) => c === u.color) ?? "cyan"),
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
  const p = pair(userId, other);
  await db.transaction(async (tx) => {
    await tx.delete(friendships).where(and(eq(friendships.a, p.a), eq(friendships.b, p.b)));
    await tx
      .insert(friendCuts)
      .values({ ...p, cutAt: new Date() })
      .onConflictDoUpdate({ target: [friendCuts.a, friendCuts.b], set: { cutAt: new Date() } });
  });
}

export async function radar(userId: string): Promise<Radar | null> {
  const [main] = await db
    .select()
    .from(roaches)
    .where(and(eq(roaches.userId, userId), eq(roaches.slot, 0)))
    .limit(1);
  if (!main) return null;
  const now = Date.now();
  // A box a little bigger than the circle; buildRadar does the exact distance
  const dLat = (RADAR_RADIUS_KM * 1.2) / 111;
  const dLng = dLat / Math.max(0.1, Math.cos((main.lat * Math.PI) / 180));
  const near = await db
    .select({ owner: roaches.userId, slot: roaches.slot, lng: roaches.lng, lat: roaches.lat })
    .from(roaches)
    .where(
      and(
        ne(roaches.userId, userId),
        sql`${roaches.lat} between ${main.lat - dLat} and ${main.lat + dLat}`,
        sql`${roaches.lng} between ${main.lng - dLng} and ${main.lng + dLng}`,
      ),
    );
  const moveRows = await db
    .select()
    .from(moves)
    .where(and(ne(moves.userId, userId), gt(moves.at, ago(7 * DAY))));
  const recentMoves: Move[] = moveRows.map((m) => ({
    owner: m.userId,
    slot: m.slot,
    from: m.fromLng === null || m.fromLat === null ? null : { lng: m.fromLng, lat: m.fromLat },
    to: m.toLng === null || m.toLat === null ? null : { lng: m.toLng, lat: m.toLat },
    at: m.at.getTime(),
  }));
  const demo = demoEnabled ? await demoMoves(now) : [];
  const touchedPlayers = (
    await db.select({ to: touches.toUserId }).from(touches).where(gt(touches.createdAt, ago(DAY)))
  ).map((t) => t.to);
  const declaringPlayers = (
    await db.select({ from: declarations.senderId }).from(declarations).where(gt(declarations.createdAt, ago(DAY)))
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
