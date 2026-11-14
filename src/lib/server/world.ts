import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, not, or, sql, type AnyColumn } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { guideById, guideOfItem, GUIDES, type GuideId } from "../guides";
import { TICK_MISSING } from "../consent";
import { canReply, declarationText, FOODS, isStayTemplate, repliesFor, replyOf, SPOUSES, type Declaration, type Food, type Template } from "../declarations";
import { AWAY_DAYS, badgesOwned, seriesCovered } from "../badges";
import { beijingDate, beijingMidnight, daysBetween } from "../beijing";
import { findLine } from "../events";
import { nextMorning } from "../morning";
import { nextSiteDayAt, siteDay, siteDayStart } from "../siteDay";
import type { PassesDot } from "../passes";
import { checkSupport } from "../support";
import { isGame } from "../games";
import { fold } from "../nameFold";
import { displayName, type Profile, type PublicProfile } from "../profile";
import {
  DECLARATION_COOLDOWN_MIN,
  DECLARATION_RADIUS_KM,
  DECLARATIONS_PER_DAY,
  INBOX_DAYS,
  INBOX_DECLARATIONS,
  MAX_CLONES,
  MOVES_PER_DAY,
  NEWCOMER_DAYS,
  PLACEMENTS_PER_DAY,
  POKE_EVERY_DAYS,
  RADAR_RADIUS_KM,
  RADAR_REUSE_MIN,
  RADAR_SCANS_PER_DAY,
  TOUCHES_PER_DAY,
  TOUCHES_PER_PERSON_PER_DAY,
} from "../rules";
import { queueSpots, stopOf } from "../minghe";
import { INK_FROM, INK_PREFIX, INK_SLOT } from "../si";
import { INN_CENTER } from "../siInn";
import { INK_TILE_ZOOM, tapOf } from "../siTiles";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat } from "../types";
import { isBotId } from "../world/bots";
import { passerbyMoves, type Move } from "../world/cast";
import {
  buildRadar,
  checkDeclaration,
  checkSpot,
  DAY,
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
  type InkTap,
  type Me,
  type MingheItem,
  type OwnRoach,
  type PlaceTarget,
  type Radar,
  type RadarScan,
  type RideTarget,
  type TouchBackWaits,
  type TouchResult,
} from "../world/types";
import { amiyaFriend, amiyaInbox, greetAmiya, ignoreAmiya, replyAmiya, seeAmiya, touchAmiya, unfriendAmiya } from "./amiya";
import {
  ignorePerlica,
  perlicaFriend,
  perlicaInbox,
  perlicaOf,
  replyPerlica,
  seePerlica,
  touchPerlica,
  unfriendPerlica,
} from "./perlica";
import {
  ignoreMinghe,
  mingheFriend,
  mingheInbox,
  mingheOf,
  mingheToday,
  OFF_HORSE,
  replyMinghe,
  sayAboutRide,
  seeMinghe,
  standingNear,
  touchMinghe,
  unfriendMinghe,
} from "./minghe";
import {
  arrivedAt,
  birthdayDeclared,
  ignoreTalulah,
  lockFire,
  replyTalulah,
  seatByFire,
  seeTalulah,
  talulahFriend,
  talulahInbox,
  talulahOf,
  touchTalulah,
  unfriendTalulah,
} from "./talulah";
import { clonesOut, hasStayed, ignoreSi, inkOnMap, inkSeen, replySi, seeSi, siFriend, siInbox, siOf, touchSi, unfriendSi } from "./si";
import { inkTapped } from "./siInk";
import {
  award,
  declared,
  declaredFrom,
  drank,
  earnedBy,
  friendsMade,
  partied as partiedBadge,
  placed,
  reactedTo,
  respondersOf,
  responded,
  scannedRadar,
  shownBadges,
  sleptItOff,
  soberedUp,
  touchedSneakily,
  wakeUp,
  wishedHappyBirthday,
} from "./badges";
import { lastVisitOn } from "./away";
import {
  betweenOf,
  birthdayFriends,
  birthdayNames,
  closeHouse,
  friendlyInbox,
  friendshipEnded,
  roachMoved,
  seeFriendly,
  withVisits,
} from "./friendly";
import { blockedBetween, blockedBy, blockedWith } from "./blocks";
import { agreedPublicPlace, mustReconsent } from "./consent";
import { db } from "./db";
import { demoEnabled, secret } from "./env";
import { isUniqueViolation, type Exec } from "./guides";
import { helpCounts } from "./help";
import { radarRaw } from "./radarBlocks";
import { nudge } from "./live";
import { checkName } from "./nameWords";
import { didTask, passesMe, wornPasses } from "./passes";
import { studyMe } from "./study";
import { passwordNudge } from "./passwords";
import { seeStaff, staffItems } from "./staffNotes";
import { allow } from "./rateLimit";
import { canSeeDeclaration, seeDeclarations, spotRows, visibleDeclarations, type SeenDeclaration } from "./declarationInbox";
import { lookOf, roachByFeedId, roachesChanged, sleeping } from "./roachFeed";
import { countCapped, countDeclared, countGuide, countIgnored, countPlaced, countReply, countTouch } from "./stats";
import {
  clearedValues,
  declarations,
  declarationSpots,
  deliveries,
  reactions,
  friendCuts,
  friendships,
  friendStars,
  moves,
  pokes,
  radarScans,
  roaches,
  siInks,
  touches,
  users,
  type RoachRow,
  type UserRow,
} from "./schema";

/**
 * What the world asks of each guide (src/lib/guides.ts), each in their own module.
 * offsetMin is the device's time zone, for which day it is (佩丽卡监督's count of the day, and her asides).
 */
type GuideWorld = {
  touch: (userId: string, bold: boolean, offsetMin: unknown) => Promise<TouchResult>;
  reply: (userId: string, itemId: string, bold: boolean, offsetMin: unknown) => Promise<TouchResult>;
  ignore: (userId: string, itemId: string) => Promise<void>;
  see: (userId: string, itemIds: string[]) => Promise<void>;
  inbox: (userId: string) => Promise<InboxItem[]>;
  friend: (u: UserRow) => Friend | null;
  unfriend: (userId: string) => Promise<void>;
};

const GUIDE_WORLD: Record<GuideId, GuideWorld> = {
  amiya: {
    touch: touchAmiya,
    reply: replyAmiya,
    ignore: ignoreAmiya,
    see: seeAmiya,
    inbox: amiyaInbox,
    friend: (u) => (u.amiyaFriendSince ? amiyaFriend(u.amiyaFriendSince) : null),
    unfriend: unfriendAmiya,
  },
  perlica: {
    touch: touchPerlica,
    reply: replyPerlica,
    ignore: ignorePerlica,
    see: seePerlica,
    inbox: perlicaInbox,
    friend: (u) => (u.perlicaFriendSince ? perlicaFriend(u.perlicaFriendSince) : null),
    unfriend: unfriendPerlica,
  },
  talulah: {
    touch: (userId, bold, offsetMin) => touchTalulah(userId, bold, offsetMin),
    reply: (userId, itemId, bold, offsetMin) => replyTalulah(userId, itemId, bold, offsetMin),
    ignore: ignoreTalulah,
    see: seeTalulah,
    inbox: talulahInbox,
    friend: (u) => (u.talulahFriendSince ? talulahFriend(u.talulahFriendSince) : null),
    unfriend: unfriendTalulah,
  },
  minghe: {
    touch: (userId, bold, offsetMin) => touchMinghe(userId, bold, offsetMin),
    reply: (userId, itemId, bold, offsetMin) => replyMinghe(userId, itemId, bold, offsetMin),
    ignore: ignoreMinghe,
    see: seeMinghe,
    inbox: mingheInbox,
    friend: (u) => (u.mingheFriendSince ? mingheFriend(u.mingheFriendSince) : null),
    unfriend: unfriendMinghe,
  },
  si: {
    touch: (userId, bold, offsetMin) => touchSi(userId, bold, offsetMin),
    reply: (userId, itemId, bold, offsetMin) => replySi(userId, itemId, bold, offsetMin),
    ignore: ignoreSi,
    see: seeSi,
    inbox: siInbox,
    friend: (u) => (u.siFriendSince ? siFriend(u.siFriendSince) : null),
    unfriend: unfriendSi,
  },
};
/** In the order they are listed */
const GUIDE_IDS = Object.keys(GUIDES) as GuideId[];

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
    welcomeGuests: u.welcomeGuests,
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
    welcomeGuests: p.welcomeGuests,
    avatar: p.avatar,
    color: p.color,
    support: p.support,
  };
}

/**
 * Profile cards as the viewer sees them, badges included, and the pass each wears where the viewer may see passes
 * (src/lib/server/passes.ts wornPasses); viewer null: only the names are wanted.
 */
export async function cardsOf(people: UserRow[], viewerId: string | null) {
  const badges = await shownBadges(people);
  const worn = await wornPasses(people, viewerId);
  return new Map(
    people.map((u): [string, PublicProfile] => {
      const pass = worn.get(u.id);
      return [u.id, { ...publicProfileOf(profileOf(u)), ...badges.get(u.id), ...(pass ? { pass } : {}) }];
    }),
  );
}

export async function userById(id: string) {
  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

function own(r: RoachRow): OwnRoach {
  return { id: r.id, slot: r.slot, lng: r.lng, lat: r.lat, publicId: r.publicId };
}

/** Your roaches, with who visits them and whom your clones visit (串门) */
export async function ownRoaches(userId: string) {
  const rows = await db.select().from(roaches).where(eq(roaches.userId, userId)).orderBy(asc(roaches.slot));
  return withVisits(userId, rows.map(own));
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

/** offsetMin: the device's Date.getTimezoneOffset(), only to work out 阿米娅向导's greeting day and 佩丽卡监督's week; never stored */
export async function me(userId: string, offsetMin?: unknown): Promise<Me | null> {
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
  const now = Date.now();
  return {
    id: u.id,
    profile: profileOf(u),
    roaches: mine,
    movesLeft,
    touchesLeft: Math.max(0, TOUCHES_PER_DAY - (await touchesToday(u.id, now))),
    dayTurnsAt: nextSiteDayAt(now),
    isNew,
    joinedAt: u.createdAt.getTime(),
    hasDeclared: Boolean(declared),
    hasTouched: Boolean(touched),
    badges,
    wornBadge: badges.some((b) => b.id === u.wornBadge) ? u.wornBadge : null,
    counts: {
      friends: u.friendsEver,
      responders: await respondersOf(u.id),
      drinks: u.drinksTotal,
      declareDays: u.declareDays,
      reactDays: u.reactDays,
      declareLines: u.declaredLines.length,
      amiyaDays: u.amiyaDays,
      perlicaDays: u.perlicaDays,
      guideFriends: [u.amiyaFriendSince, u.perlicaFriendSince, u.talulahFriendSince, u.mingheFriendSince].filter(Boolean).length,
      radarDays: u.radarDays,
      fireNights: u.fireNights,
      sneakDays: u.sneakDays,
      birthdayWishes: u.birthdayWished.length,
      quilters: u.quiltedBy.length,
      farMoves: u.farMoves,
      badgesOwned: badgesOwned(badges),
      seriesCovered: seriesCovered(badges),
    },
    drunkUntil: u.drunkUntil && u.drunkUntil.getTime() > Date.now() ? u.drunkUntil.getTime() : null,
    onlyMains: u.onlyMains,
    // a whole day or more away, so not just back the next morning
    homecoming: daysAway >= 2 ? await homecoming(u.id, mine, lastSeen, daysAway) : null,
    mustReconsent: mustReconsent(u),
    agreedPublicPlace: agreedPublicPlace(u),
    // the first visit since the 04:00 batch flipped it over: the owner sees it stand up now, everyone else at the next batch
    wokeFromAway: Boolean(u.sleptAwayOn && (!u.lastSeenOn || u.lastSeenOn < u.sleptAwayOn)),
    amiya: { friend: Boolean(u.amiyaFriendSince), greeting: await greetAmiya(u, offsetMin) },
    perlica: await perlicaOf(u, offsetMin),
    talulah: talulahOf(u),
    minghe: await mingheOf(u),
    si: await siOf(u, offsetMin),
    help: await helpCounts(u),
    profileHeld: Boolean(u.profileHeldAt),
    suspendedUntil: u.suspendedUntil && u.suspendedUntil.getTime() > Date.now() ? u.suspendedUntil.getTime() : null,
    ageCheck: Boolean(u.ageCheckAt),
    passwordNudge: await passwordNudge(u),
    passes: await passesMe(u),
    study: studyMe(u),
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

/**
 * While reports hold a player's profile (src/lib/server/safety.ts holdProfile), the name, how it shows
 * and the UIDs and who sees them stay as they are until the admin looks; the rest saves as usual. A
 * game left out meanwhile keeps its UID, for the admin to see.
 */
function keepHeld(p: Profile, stored: Profile): Profile {
  const same =
    p.name === stored.name &&
    p.anonymous === stored.anonymous &&
    p.drPrefix === stored.drPrefix &&
    p.shareUid === stored.shareUid &&
    p.games.every((g) => p.uid[g] === stored.uid[g] && p.uidServer[g] === stored.uidServer[g]);
  if (!same) throw new WorldError(T.server.world.profileHeld);
  return { ...p, uid: stored.uid, uidServer: stored.uidServer };
}

/**
 * A name or UID the admin cleared from this account stays gone from it (anyone else may still use it);
 * a name written another way too, in traditional characters or with symbols between (src/lib/nameFold.ts)
 */
async function checkCleared(userId: string, p: Profile) {
  const gone = await db
    .select({ kind: clearedValues.kind, value: clearedValues.value })
    .from(clearedValues)
    .where(eq(clearedValues.userId, userId));
  if (!gone.length) return;
  const name = fold(p.name);
  if (name && gone.some((g) => g.kind === "name" && fold(g.value) === name)) throw new WorldError(T.server.world.nameCleared);
  const uids = Object.values(p.uid).map((u) => u.toLowerCase());
  if (gone.some((g) => g.kind === "uid" && uids.includes(g.value.toLowerCase()))) {
    throw new WorldError(T.server.world.uidCleared);
  }
}

export async function saveProfile(userId: string, input: Profile): Promise<Profile> {
  let profile = normalizeProfile(input);
  const [before] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  // held, the name cannot change, so it is not checked again (the admin may have just put it on the list)
  if (before?.profileHeldAt) profile = keepHeld(profile, profileOf(before));
  // checked even while anonymous: the name is kept, and shows again once they go by it
  else await checkName(profile.name);
  await checkCleared(userId, profile);
  // 触须之交 see 「换了助战」 for the latest change only
  const changed = (before?.support ?? []).join("|") !== profile.support.join("|");
  await db
    .update(users)
    .set({ ...profileColumns(profile), ...(changed ? { supportChangedAt: new Date() } : {}) })
    .where(eq(users.id, userId));
  // no more guests: those sitting by your roaches go home, and are told why
  if (before?.welcomeGuests && !profile.welcomeGuests) await closeHouse(userId);
  // the main roach wears the profile's look
  roachesChanged();
  return profile;
}

/**
 * Whether a roach may go down (or move) for this target: the slot it takes, and the
 * roach it moves if any. Agreeing that spots are public comes before a new one, and
 * new roaches and moves are rationed per day.
 */
export async function checkPlacement(userId: string, target: PlaceTarget) {
  const u = await userById(userId);
  if (!u) throw new WorldError(T.server.world.noAccount);
  const mine = await db.select().from(roaches).where(eq(roaches.userId, userId));
  const main = mine.find((r) => r.slot === 0);
  let slot: number;
  let existing: RoachRow | undefined;
  if (target?.kind === "main") {
    slot = 0;
    existing = main;
  } else if (target?.kind === "clone") {
    if (!main) throw new WorldError(T.server.world.mainBeforeClones);
    await checkCloneRoom(db, userId, mine.filter((r) => r.slot > 0).length);
    const used = new Set(mine.map((r) => r.slot));
    const free = Array.from({ length: MAX_CLONES }, (_, i) => i + 1).find((s) => !used.has(s));
    if (!free) throw new WorldError(fmt(T.server.world.clonesLimit, { max: MAX_CLONES }));
    slot = free;
  } else if (target?.kind === "move") {
    existing = mine.find((r) => r.id === target.roachId);
    if (!existing) throw new WorldError(T.server.common.noSuchRoach);
    slot = existing.slot;
  } else {
    throw new WorldError(T.server.world.whichRoach);
  }
  // A new roach shows its exact spot to everyone, which the player agrees to once, on a card before the first
  if (!existing && !agreedPublicPlace(u)) throw new WorldError(TICK_MISSING.acceptPublicPlace);
  // Each move is a row the radar reads, so they are rationed; taking a roach back and putting it down again counts too
  if (existing && (await recentMoves(userId, "move")) >= MOVES_PER_DAY) {
    throw new WorldError(fmt(T.server.world.movesUsedUp, { max: MOVES_PER_DAY }));
  }
  if (!existing && (await recentMoves(userId, "place")) >= PLACEMENTS_PER_DAY) {
    throw new WorldError(T.server.world.placedEnough);
  }
  return { slot, existing };
}

/**
 * Room for one more clone among their `clones`: MAX_CLONES at most, 墨小强 counted among them while it is on the map
 * (src/lib/server/si.ts). Those who had more before it counted keep them all, and place no more till they have fewer.
 */
async function checkCloneRoom(exec: Exec, userId: string, clones: number) {
  const ink = await inkOnMap(exec, userId);
  if (clones + (ink ? 1 : 0) >= MAX_CLONES) throw new WorldError(fmt(ink ? T.server.world.clonesLimitInk : T.server.world.clonesLimit, { max: MAX_CLONES }));
}

type RideColumns = Pick<RoachRow, "rideSince" | "rideStartDay" | "rideDay" | "rideFromLng" | "rideFromLat">;

/**
 * Put the roach down (or move it) with the move the radar reads. A fresh public id on
 * every move, so nobody can follow a roach between spots. ride: whether it rides with
 * 明河都尉 from here; any other move of a riding clone gets it off quietly.
 */
export async function writePlacement(
  tx: Exec,
  userId: string,
  { slot, existing }: { slot: number; existing?: RoachRow },
  at: LngLat,
  ride: RideColumns = OFF_HORSE,
) {
  const values = { lng: at.lng, lat: at.lat, publicId: randomUUID(), placedAt: new Date(), ...ride };
  if (existing) {
    await tx.update(roaches).set(values).where(eq(roaches.id, existing.id));
    // a visiting clone moved on ends its visit; guests of a roach that moved stay where they sit
    await roachMoved(tx, existing.id, "moved");
  } else {
    await tx.insert(roaches).values({ userId, slot, ...values });
    // counted again now it is written, the others with it: its foreign key holds the player's row, so a touch of
    // 祀掌柜's putting 墨小强 on the map (lockPlayer) waits till this is done, or this till that is, and sees it
    if (slot > 0) await checkCloneRoom(tx, userId, (await clonesOut(tx, userId)) - 1);
  }
  // a roach has to stand up to walk: moving the main roach sobers it up, and wakes it from staying away
  if (slot === 0) await tx.update(users).set({ drunkUntil: null, drunkAt: null, sleptAwayOn: null }).where(eq(users.id, userId));
  await tx.insert(moves).values({
    userId,
    slot,
    fromLng: existing?.lng ?? null,
    fromLat: existing?.lat ?? null,
    toLng: at.lng,
    toLat: at.lat,
  });
}

/** Whether a new roach's slot was taken a moment ago by another request of the player's (a double tap): its unique index says so */
function slotTaken(e: unknown): boolean {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown } | null;
  if (!err || typeof err !== "object") return false;
  return (err.code === "23505" && err.constraint_name === "roaches_user_slot_idx") || slotTaken(err.cause);
}

export async function placeRoach(userId: string, target: PlaceTarget, spot: LngLat): Promise<OwnRoach[]> {
  const at = checkSpot(spot);
  const placement = await checkPlacement(userId, target);
  try {
    await db.transaction((tx) => writePlacement(tx, userId, placement, at));
  } catch (e) {
    if (slotTaken(e)) throw new WorldError(T.server.world.slotTaken);
    throw e;
  }
  countPlaced(placement.slot, placement.existing);
  roachesChanged();
  // the first roach of theirs to sit by 塔露拉干员's fire is welcomed
  await arrivedAt(userId, at);
  await placed(userId, placement.slot, placement.existing ?? null, at);
  return ownRoaches(userId);
}

/**
 * 派一只克隆体去烤火: a new clone (a placement), or one already out (a move), to a free seat by
 * 塔露拉干员's fire, which the server picks from every roach sitting there, one at a time across the
 * site (lockFire), so two sent at once never share a seat. The rules of any placement hold.
 */
export async function sitByFire(userId: string, target: PlaceTarget): Promise<{ roaches: OwnRoach[]; seat: LngLat }> {
  const placement = await checkPlacement(userId, target);
  const seat = await db
    .transaction(async (tx) => {
      await lockFire(tx);
      // a roach moving there holds no seat for itself
      const at = await seatByFire(tx, placement.existing ? [placement.existing.id] : []);
      await writePlacement(tx, userId, placement, at);
      return at;
    })
    .catch((e) => {
      throw slotTaken(e) ? new WorldError(T.server.world.slotTaken) : e;
    });
  countPlaced(placement.slot, placement.existing);
  roachesChanged();
  // the first roach of theirs to sit by her fire is welcomed, and the songs counted
  await arrivedAt(userId, seat);
  await placed(userId, placement.slot, placement.existing ?? null, seat);
  return { roaches: await ownRoaches(userId), seat };
}

const riderOf = async (exec: Exec, userId: string) =>
  (
    await exec
      .select()
      .from(roaches)
      .where(and(eq(roaches.userId, userId), isNotNull(roaches.rideSince)))
      .limit(1)
  )[0];

/**
 * 派一只克隆体跟他走: a new clone (a placement), or one already out (a move), takes the
 * next free spot in 明河都尉's queue at today's station and rides with him for 7 stations
 * (the 04:00 batch, src/lib/server/minghe.ts). One clone at a time, never the main roach.
 */
export async function rideMinghe(userId: string, target: RideTarget): Promise<{ roaches: OwnRoach[]; item: MingheItem }> {
  if (target?.kind !== "clone" && target?.kind !== "move") throw new WorldError(T.server.world.sendACloneWithHim);
  const placement = await checkPlacement(userId, target);
  if (placement.slot === 0) throw new WorldError(T.server.world.mainCannotFollow);
  const day = mingheToday();
  const item = await db
    .transaction(async (tx) => {
      // one ride at a time across the site, so two clones never take the same spot, nor one player two
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('minghe-queue'))`);
      if (await riderOf(tx, userId)) throw new WorldError(T.server.world.alreadyFollowing);
      const [spot] = queueSpots(day, 1, await standingNear(tx, day, placement.existing ? [placement.existing.id] : []));
      await writePlacement(tx, userId, placement, spot, {
        rideSince: new Date(),
        rideStartDay: day,
        rideDay: day,
        rideFromLng: placement.existing?.lng ?? null,
        rideFromLat: placement.existing?.lat ?? null,
      });
      return { said: await sayAboutRide(tx, userId, "ride", stopOf(day)), spot };
    })
    .catch((e) => {
      throw slotTaken(e) ? new WorldError(T.server.world.slotTaken) : e;
    });
  countPlaced(placement.slot, placement.existing);
  roachesChanged();
  await placed(userId, placement.slot, placement.existing ?? null, item.spot);
  return { roaches: await ownRoaches(userId), item: item.said };
}

/** 在这一站下马: the clone stays where it stands, off his horse, and he says so. */
export async function dismountMinghe(userId: string): Promise<{ roaches: OwnRoach[]; item: MingheItem }> {
  const item = await db.transaction(async (tx) => {
    const rider = await riderOf(tx, userId);
    if (!rider) throw new WorldError(T.server.world.notFollowing);
    await tx.update(roaches).set(OFF_HORSE).where(eq(roaches.id, rider.id));
    return sayAboutRide(tx, userId, "dismount", stopOf(rider.rideDay ?? mingheToday()));
  });
  roachesChanged();
  return { roaches: await ownRoaches(userId), item };
}

/** Taking back the main roach takes back the clones too. */
export async function removeRoach(userId: string, roachId: string): Promise<OwnRoach[]> {
  if (!UUID.test(String(roachId))) throw new WorldError(T.server.common.noSuchRoach);
  const mine = await db.select().from(roaches).where(eq(roaches.userId, userId));
  const roach = mine.find((r) => r.id === roachId);
  if (!roach) throw new WorldError(T.server.common.noSuchRoach);
  const gone = roach.slot === 0 ? mine : [roach];
  await db.transaction(async (tx) => {
    for (const r of gone) await roachMoved(tx, r.id, "removed");
    await tx.delete(roaches).where(inArray(roaches.id, gone.map((r) => r.id)));
    await tx.insert(moves).values(gone.map((r) => ({ userId, slot: r.slot, fromLng: r.lng, fromLat: r.lat })));
    if (roach.slot === 0) await tx.update(users).set({ drunkUntil: null, drunkAt: null, sleptAwayOn: null }).where(eq(users.id, userId));
  });
  roachesChanged();
  return ownRoaches(userId);
}

/** At least this long between two drinks, so a script cannot churn the shared roach list. */
const DRINK_GAP_MS = 10_000;

/** 摄入酒精: the main roach falls asleep drunk until the next morning where it lies. Every real drink counts for the 酒神 badges. */
export async function drink(userId: string): Promise<{ until: number }> {
  const u = await userById(userId);
  if (!u) throw new WorldError(T.server.world.noAccount);
  // test players never lie down
  if (u.demoKey) throw new WorldError(T.server.world.testPlayersDontDrink);
  const [main] = await db.select().from(roaches).where(and(eq(roaches.userId, userId), eq(roaches.slot, 0))).limit(1);
  if (!main) throw new WorldError(T.server.world.mainBeforeDrinking);
  const now = new Date();
  const drunk = T.server.world.stillDrunk;
  if (u.drunkUntil && u.drunkUntil > now) throw new WorldError(drunk);
  if (!allow(`drink:${userId}`, 1, DRINK_GAP_MS)) throw new WorldError(T.server.world.justDrank);
  const until = nextMorning(main, now.getTime());
  // the last sleep ran out by itself before 二次呼吸's round came by: given now, before drunkAt is the new one's
  if (u.drunkAt) await sleptItOff(now.getTime());
  const [row] = await db
    .update(users)
    .set({ drunkUntil: new Date(until), drunkAt: now, drinksTotal: sql`${users.drinksTotal} + 1` })
    .where(and(eq(users.id, userId), or(isNull(users.drunkUntil), lt(users.drunkUntil, now))))
    .returning({ total: users.drinksTotal });
  if (!row) throw new WorldError(drunk);
  await drank(userId, row.total);
  roachesChanged();
  return { until };
}

/** ⚡舟友的酒⚡ opened: 将进酒 if their main roach really lies drunk */
export async function partied(userId: string) {
  await partiedBadge(userId);
}

/** 只看本体 on or off, kept on the account; no one else is told (nothing public has it) */
export async function setOnlyMains(userId: string, on: boolean) {
  await db.update(users).set({ onlyMains: on }).where(eq(users.id, userId));
}

/** 醒酒: the main roach stands up at once. */
export async function sober(userId: string) {
  const [before] = await db.select({ drunkAt: users.drunkAt }).from(users).where(eq(users.id, userId));
  const woke = await db
    .update(users)
    .set({ drunkUntil: null, drunkAt: null })
    .where(and(eq(users.id, userId), isNotNull(users.drunkUntil)))
    .returning({ id: users.id });
  if (!woke.length) return;
  roachesChanged();
  await soberedUp(userId, before?.drunkAt ?? null);
}

/**
 * When the day began that what a player may do so many times a day is counted in: 04:00 Beijing time, as the
 * games turn theirs (src/lib/siteDay.ts). Moving, putting roaches down and the radar still count the last 24 hours.
 */
const dayBegan = (now = Date.now()) => new Date(siteDayStart(siteDay(now)));

/** The touches a player sent today: on players' roaches and touching back; the guides count their own */
async function touchesToday(userId: string, now = Date.now()) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), gte(touches.createdAt, dayBegan(now))));
  return n;
}

/** Throws when today's touches are used up; otherwise how many are left after this one */
async function checkTouchQuota(userId: string) {
  const n = await touchesToday(userId);
  if (n >= TOUCHES_PER_DAY) throw new WorldError(T.server.world.touchesUsedUp);
  return TOUCHES_PER_DAY - n - 1;
}

/** offsetMin: the device's Date.getTimezoneOffset(), only for 佩丽卡监督's count of the day; never stored */
export async function touch(userId: string, publicId: string, bold: boolean, offsetMin?: unknown): Promise<TouchResult> {
  const guide = guideById(String(publicId));
  if (guide) {
    const done = await GUIDE_WORLD[guide.id].touch(userId, Boolean(bold), offsetMin);
    countGuide(guide.id);
    return { ...done, ...(await didTask(userId, "npc")) };
  }
  if (isBotId(String(publicId))) throw new WorldError(T.server.world.demoNoTouch);
  // by the id the feed gave the page, short or whole; or an ink roach at 缘缘庄, by the id its tap gave (tapInk)
  const roach = String(publicId).startsWith(INK_PREFIX) ? await inkToTouch(String(publicId).slice(INK_PREFIX.length)) : await roachByFeedId(String(publicId));
  if (!roach) throw new WorldError(T.server.common.roachGone);
  if (roach.userId === userId) throw new WorldError(T.server.common.yourOwnRoach);
  const left = await checkTouchQuota(userId);
  // One roach once a day, keyed by the public id, not the owner, so the answer cannot tell you two roaches
  // share an owner; but a sneaky touch may be followed by a bold one, to say who it was (Breeze, 2026-11-12).
  const earlier = await db
    .select({ bold: touches.bold })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), eq(touches.toPublicId, roach.publicId), gte(touches.createdAt, dayBegan())));
  if (earlier.some((t) => t.bold)) throw new WorldError(T.server.world.touchedToday);
  if (earlier.length && !bold) throw new WorldError(T.server.world.touchedSneakilyToday);
  // a few touches a day on one player's roaches, main and clones together, touching back included; saying so
  // may tell that two roaches share an owner, which Breeze accepted. The bold touch that makes the two
  // 触须之交 always goes: it comes once.
  const onOwner = (await touchedToday(userId, roach.userId)).n;
  if (onOwner >= TOUCHES_PER_PERSON_PER_DAY && !(bold && (await wouldBefriend(userId, roach.userId)))) {
    throw new WorldError(fmt(T.server.world.ownerTouchedToday, { max: TOUCHES_PER_PERSON_PER_DAY }));
  }
  const wereFriends = (await friendIdsOf(userId)).has(roach.userId);
  // Between a blocked pair the touch looks sent, but never arrives
  const withheld = await blockedBetween(userId, roach.userId);
  await db.insert(touches).values({
    fromUserId: userId,
    toUserId: roach.userId,
    bold: Boolean(bold),
    toSlot: roach.slot,
    toPublicId: roach.publicId,
    withheld,
  });
  countTouch(Boolean(bold));
  // how many more today on TA, told only to 触须之交: to anyone else it would tell which roaches share an owner
  const onFriend = wereFriends ? Math.max(0, TOUCHES_PER_PERSON_PER_DAY - onOwner - 1) : undefined;
  countCapped(left, onFriend);
  // 惊霆无声 is the toucher's own, so it counts whether or not the touch arrives; so does 每日任务
  if (!bold) await touchedSneakily(userId);
  const task = await didTask(userId, "touch");
  if (withheld) return { newFriend: null, touchesLeft: left, friendTouchesLeft: onFriend, ...task };
  const newFriend = bold ? await befriendIfMutual(userId, roach.userId) : null;
  nudge([roach.userId]);
  return {
    newFriend,
    touchesLeft: left,
    friendTouchesLeft: newFriend ? Math.max(0, TOUCHES_PER_PERSON_PER_DAY - onOwner - 1) : onFriend,
    ...task,
  };
}

/**
 * An ink roach to touch as one of its owner's clones (INK_SLOT): by its public id, on the map and somebody's.
 * Touched, it counts as their clones do: a day's touches, once a day each, a few a day on one player's.
 */
async function inkToTouch(publicId: string) {
  const ink = UUID.test(publicId) ? await inkSeen({ publicId }) : null;
  if (!ink) throw new WorldError(T.server.world.inkRecalled);
  if (!ink.userId) throw new WorldError(T.server.world.inkOwnerGone);
  return { userId: ink.userId, slot: INK_SLOT, publicId: ink.publicId };
}

/**
 * An ink roach tapped on the map (3.4), by what its tile gave the page (src/lib/siTiles.ts InkPoint): the one with
 * that tap number now, the nearest should two share it (src/lib/server/siInk.ts inkTapped). What its card may say:
 * where it is, whether it is yours, a 触须之交's (and who), or nobody's now, and how to touch it; never its number,
 * nor whose it is to anyone else.
 */
export async function tapInk(userId: string, x: unknown, y: unknown, tap: unknown, fx: unknown, fy: unknown): Promise<InkTap> {
  const n = 2 ** INK_TILE_ZOOM;
  const whole = (v: unknown, below: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < below;
  const part = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;
  if (!whole(x, n) || !whole(y, n) || !whole(tap, 2 ** 32) || !part(fx) || !part(fy)) throw new WorldError(T.server.common.badRequest);
  const no = await inkTapped(x, y, tap, fx, fy);
  const ink = no === null ? null : await inkSeen({ no });
  if (!ink) throw new WorldError(T.server.world.inkRecalled);
  const mine = ink.userId === userId;
  const gone = ink.userId === null;
  let friend: InkTap["friend"] = null;
  if (ink.userId && !mine && (await friendIdsOf(userId)).has(ink.userId)) {
    const u = await userById(ink.userId);
    if (u) friend = { id: friendKey(userId, u.id), name: (await cardsOf([u], null)).get(u.id)!.displayName };
  }
  return { state: ink.state, mine, friend, gone, id: mine || gone ? null : INK_PREFIX + ink.publicId };
}

/** How many touches one player made on another today, and whether any was bold */
type TouchedToday = { n: number; bold: boolean };

/**
 * Touches from a to b today (since dayBegan): on b's roaches on the map, main and clones together, and
 * touching back; the ones that never arrived too, so that a blocked player sees what anyone would.
 */
async function touchedToday(a: string, b: string): Promise<TouchedToday> {
  const [sent] = await db
    .select({ n: count(), bold: sql<boolean | null>`bool_or(${touches.bold})` })
    .from(touches)
    .where(and(eq(touches.fromUserId, a), eq(touches.toUserId, b), gte(touches.createdAt, dayBegan())));
  return { n: sent?.n ?? 0, bold: Boolean(sent?.bold) };
}

/**
 * Whether a bold touch from a to b now makes them 触须之交: they are not, and b touched a boldly
 * since they last stopped being 触须之交 (or ever).
 */
async function wouldBefriend(a: string, b: string) {
  const p = pair(a, b);
  const [friends] = await db.select({ a: friendships.a }).from(friendships).where(and(eq(friendships.a, p.a), eq(friendships.b, p.b))).limit(1);
  if (friends) return false;
  const [cut] = await db.select({ at: friendCuts.cutAt }).from(friendCuts).where(and(eq(friendCuts.a, p.a), eq(friendCuts.b, p.b))).limit(1);
  const [bold] = await db
    .select({ id: touches.id })
    .from(touches)
    .where(and(eq(touches.fromUserId, b), eq(touches.toUserId, a), eq(touches.bold, true), eq(touches.withheld, false), gt(touches.createdAt, cut?.at ?? new Date(0))))
    .limit(1);
  return Boolean(bold);
}

/**
 * No touching back and forth: what of touching TA back waits till tomorrow, after your touches on TA
 * today; null when you made none. A bold touch back still goes while it makes you 触须之交
 * ("sneaky"), or while you touched TA only sneakily so far, fewer than the day's few times, so that it
 * says who that was ("reveal", Breeze 2026-11-12); otherwise "all" waits.
 */
async function touchBackWait(from: string, to: string, today: TouchedToday): Promise<TouchBackWaits | null> {
  if (!today.n) return null;
  if (await wouldBefriend(from, to)) return "sneaky";
  return !today.bold && today.n < TOUCHES_PER_PERSON_PER_DAY ? "reveal" : "all";
}

/** The players among these you touched today, with what of touching them back waits (touchBackWait()) */
async function touchBackWaits(userId: string, others: string[]) {
  const waits = new Map<string, TouchBackWaits>();
  const ids = [...new Set(others)];
  if (!ids.length) return waits;
  const touched = await db
    .select({ to: touches.toUserId, n: count(), bold: sql<boolean | null>`bool_or(${touches.bold})` })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), inArray(touches.toUserId, ids), gte(touches.createdAt, dayBegan())))
    .groupBy(touches.toUserId);
  for (const { to, n, bold } of touched) {
    const wait = await touchBackWait(userId, to, { n, bold: Boolean(bold) });
    if (wait) waits.set(to, wait);
  }
  return waits;
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
export async function reply(userId: string, itemId: string, bold: boolean, offsetMin?: unknown): Promise<TouchResult> {
  const guide = guideOfItem(String(itemId));
  if (guide) {
    const done = await GUIDE_WORLD[guide.id].reply(userId, String(itemId), Boolean(bold), offsetMin);
    countGuide(guide.id);
    return { ...done, ...(await didTask(userId, "npc")) };
  }
  const [kind, raw] = String(itemId).split(":");
  // one spelling per item, so an item is answered once however its id is written
  const id = (raw ?? "").toLowerCase();
  itemId = `${kind}:${id}`;
  let to: string | undefined;
  if (UUID.test(id)) {
    if (kind === "t") {
      const [t] = await db
        .select({ from: touches.fromUserId, ignoredAt: touches.ignoredAt })
        .from(touches)
        .where(and(eq(touches.id, id), eq(touches.toUserId, userId)))
        .limit(1);
      if (t?.ignoredAt) throw new WorldError(T.server.common.crawledAway);
      to = t?.from;
    } else if (kind === "d") {
      // one the player sees now (src/lib/server/declarationInbox.ts)
      to = (await canSeeDeclaration(userId, id))?.senderId;
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
  if (!to) throw new WorldError(T.server.world.noNoteSender);
  if ((await replied(userId, [itemId])).size) throw new WorldError(T.server.common.touched);
  // no touching back and forth: whoever touched TA today waits till tomorrow to touch back, but
  // for a bold touch back that makes them 触须之交, or says who touched TA sneakily (touchBackWait())
  const wait = await touchBackWait(userId, to, await touchedToday(userId, to));
  if (wait === "all") throw new WorldError(T.server.world.touchBackTomorrow);
  if (wait && !bold) throw new WorldError(T.server.world.touchBackBoldly);
  const left = await checkTouchQuota(userId);
  const withheld = await blockedBetween(userId, to);
  try {
    await db.insert(touches).values({ fromUserId: userId, toUserId: to, bold: Boolean(bold), replyTo: itemId, withheld });
  } catch (e) {
    // two taps at once: reply_to is unique for each player, so the second is the same answer again
    if (isUniqueViolation(e)) throw new WorldError(T.server.common.touched);
    throw e;
  }
  // touching back a touch, as against the sender of a declaration or a reply
  countTouch(Boolean(bold), kind === "t");
  countCapped(left);
  // a touch back is a touch of 每日任务, whatever it answers, and counts as one whether or not it arrives
  const task = await didTask(userId, "touch");
  if (withheld) return { newFriend: null, touchesLeft: left, ...task };
  const newFriend = bold ? await befriendIfMutual(userId, to) : null;
  nudge([to]);
  return { newFriend, touchesLeft: left, ...task };
}

/** The latest poke from one player to another that still keeps them waiting, if any. */
async function lastPoke(from: string, to: string) {
  const [p] = await db
    .select({ at: pokes.createdAt })
    .from(pokes)
    .where(and(eq(pokes.fromUserId, from), eq(pokes.toUserId, to), gt(pokes.createdAt, ago(POKE_EVERY_DAYS * DAY))))
    .orderBy(desc(pokes.createdAt))
    .limit(1);
  return p ? p.at.getTime() + POKE_EVERY_DAYS * DAY : null;
}

/**
 * 戳一戳: a 触须之交 pokes your sleeping main roach, once a week each. It sleeps on,
 * so a poke can never tell drunk from away. You see who once you are awake.
 */
export async function poke(userId: string, publicId: string): Promise<{ againAt: number }> {
  const guide = guideById(String(publicId));
  if (guide) throw new WorldError(fmt(T.server.world.guideAwake, { name: guide.name, them: guide.pronoun }));
  if (isBotId(String(publicId))) throw new WorldError(T.server.world.demoNoPoke);
  // by the id the feed gave the page, short or whole
  const roach = await roachByFeedId(String(publicId));
  const [row] = roach
    ? await db
        .select({ slot: roaches.slot, owner: users })
        .from(roaches)
        .innerJoin(users, eq(users.id, roaches.userId))
        .where(eq(roaches.id, roach.id))
        .limit(1)
    : [];
  if (!row) throw new WorldError(T.server.common.roachGone);
  const { owner } = row;
  if (owner.id === userId) throw new WorldError(T.server.common.yourOwnRoach);
  if (!(await friendIdsOf(userId)).has(owner.id) || (await blockedBetween(userId, owner.id))) {
    throw new WorldError(T.server.world.pokeFriendsOnly);
  }
  const now = Date.now();
  if (row.slot !== 0 || !sleeping(owner, now)) throw new WorldError(T.server.world.awakeTouchInstead);
  const again = await lastPoke(userId, owner.id);
  if (again) throw new WorldError(fmt(T.server.world.pokedWait, { days: Math.ceil((again - now) / DAY) }));
  const [made] = await db
    .insert(pokes)
    .values({ fromUserId: userId, toUserId: owner.id, day: beijingDate(now), createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ id: pokes.id });
  if (!made) throw new WorldError(T.server.world.pokedToday);
  // an awake owner sees it now; a sleeping one's inbox keeps it until they wake
  nudge([owner.id]);
  return { againAt: now + POKE_EVERY_DAYS * DAY };
}

/** Of the replies to your declarations too, only the newest (rules.ts INBOX_DECLARATIONS) */
const INBOX_REACTIONS = INBOX_DECLARATIONS;

/** Declarations as the inbox shows them (which ones: src/lib/server/declarationInbox.ts) */
async function declarationItems(userId: string, ds: SeenDeclaration[]): Promise<InboxItem[]> {
  if (!ds.length) return [];
  const mine = await db
    .select({ declarationId: reactions.declarationId, reaction: reactions.reaction })
    .from(reactions)
    .where(and(eq(reactions.fromUserId, userId), inArray(reactions.declarationId, ds.map((x) => x.d.id))));
  const myReaction = new Map(mine.map((r) => [r.declarationId, r.reaction]));
  // a 触须之交's birthday sent to you as one says who
  const asFriend = await birthdayNames(
    userId,
    ds.filter((x) => x.toFriend).map((x) => x.d.senderId),
    [],
  );
  const done = await replied(userId, ds.map((x) => `d:${x.d.id}`));
  // touching back waits for whoever you touched in the last day (reply())
  const waits = await touchBackWaits(userId, ds.filter((x) => !done.has(`d:${x.d.id}`)).map((x) => x.d.senderId));
  return ds.map(({ d, seen, toFriend }) => {
    const id = `d:${d.id}`;
    const stored = storedDeclaration(d);
    return {
      kind: "declaration",
      id,
      at: d.createdAt.getTime(),
      seen,
      text: declarationText(stored),
      replied: done.has(id),
      reaction: replyOf(stored, myReaction.get(d.id)),
      options: repliesFor(stored),
      ...asFriend.sender(d.senderId, toFriend),
      ...(!done.has(id) && waits.has(d.senderId) ? { waits: waits.get(d.senderId)! } : {}),
    };
  });
}

/**
 * Only the declarations sent after `after` (the newest declaration's `at` in the inbox a page holds),
 * as the inbox gives them: what the page asks when declarations alone came in.
 */
export async function newDeclarations(userId: string, after: unknown): Promise<InboxItem[]> {
  const since = ago(INBOX_DAYS * DAY);
  // a second's overlap for two declared in the same moment; the page leaves out the ones it has
  const from = typeof after === "number" && Number.isFinite(after) && after - 1000 > since.getTime() ? new Date(after - 1000) : since;
  return declarationItems(userId, await visibleDeclarations(userId, { after: from }));
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
  const ds = await visibleDeclarations(userId);
  const rs = (
    await db
      .select({ r: reactions, d: declarations })
      .from(reactions)
      .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
      .where(and(eq(declarations.senderId, userId), eq(reactions.withheld, false), gt(reactions.createdAt, since)))
      .orderBy(desc(reactions.createdAt))
      .limit(INBOX_REACTIONS + 20)
  )
    .filter((x) => !blocked.has(x.r.fromUserId))
    .slice(0, INBOX_REACTIONS);
  const fs = await db
    .select()
    .from(friendships)
    .where(and(or(eq(friendships.a, userId), eq(friendships.b, userId)), gt(friendships.createdAt, since)));
  // who poked you stays hidden while you sleep it off, and shows once you are up
  const self = await userById(userId);
  const drunk = Boolean(self?.drunkUntil && self.drunkUntil.getTime() > Date.now());
  const ps = (
    await db
      .select({ p: pokes, from: users })
      .from(pokes)
      .innerJoin(users, eq(users.id, pokes.fromUserId))
      .where(and(eq(pokes.toUserId, userId), gt(pokes.createdAt, since)))
  ).filter((x) => !blocked.has(x.p.fromUserId) && !(drunk && !x.p.seenAt));
  // 「醒啦」 only while you are still 触须之交
  const friendIds = await friendIdsOf(userId);
  const ws = (
    await db
      .select({ p: pokes, to: users })
      .from(pokes)
      .innerJoin(users, eq(users.id, pokes.toUserId))
      .where(and(eq(pokes.fromUserId, userId), gt(pokes.wokeToldAt, since)))
  ).filter((x) => friendIds.has(x.p.toUserId));
  const pokers = await cardsOf([...ps.map((x) => x.from), ...ws.map((x) => x.to)], userId);
  // a 触须之交's reactions to your birthday say who
  const asFriend = await birthdayNames(
    userId,
    [],
    rs.map((x) => ({ declarationId: x.r.declarationId, from: x.r.fromUserId })),
  );
  const cards = await cardsOf(ts.filter((x) => x.t.bold).map((x) => x.from), userId);
  const done = await replied(userId, [...ts.map((x) => `t:${x.t.id}`), ...rs.map((x) => `x:${x.r.id}`)]);
  // touching back waits for whoever you touched in the last day (reply())
  const waits = await touchBackWaits(userId, [
    ...ts.filter((x) => !done.has(`t:${x.t.id}`)).map((x) => x.t.fromUserId),
    ...rs.filter((x) => !done.has(`x:${x.r.id}`)).map((x) => x.r.fromUserId),
  ]);
  const waitsFor = (id: string, from: string) => (!done.has(id) && waits.has(from) ? { waits: waits.get(from)! } : {});

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
        : t.toSlot === INK_SLOT
          ? "ink"
          : t.toSlot
            ? "clone"
            : "main",
      from: t.bold ? cards.get(from.id)! : null,
      replied: done.has(id),
      ignored: Boolean(t.ignoredAt),
      ...waitsFor(id, t.fromUserId),
    });
  }
  items.push(...(await declarationItems(userId, ds)));
  for (const { r, d } of rs) {
    const declared = storedDeclaration(d);
    const reply = replyOf(declared, r.reaction);
    if (!reply) continue;
    const id = `x:${r.id}`;
    items.push({
      kind: "reaction",
      id,
      at: r.createdAt.getTime(),
      seen: Boolean(r.seenAt),
      text: declarationText(declared),
      reaction: reply,
      replied: done.has(id),
      ...asFriend.reactor(r.declarationId, r.fromUserId),
      ...waitsFor(id, r.fromUserId),
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
      from: (await cardsOf([u], userId)).get(u.id)!,
      friendId: friendKey(userId, other),
      replied: true,
    });
  }
  for (const { p, from } of ps) {
    items.push({
      kind: "poke",
      id: `p:${p.id}`,
      at: p.createdAt.getTime(),
      seen: Boolean(p.seenAt),
      from: pokers.get(from.id)!,
      friendId: friendKey(userId, from.id),
      replied: true,
    });
  }
  for (const { p, to } of ws) {
    items.push({
      kind: "pokeWoke",
      id: `w:${p.id}`,
      at: p.wokeToldAt!.getTime(),
      seen: Boolean(p.wokeSeenAt),
      from: pokers.get(to.id)!,
      friendId: friendKey(userId, to.id),
      replied: true,
    });
  }
  if (self) items.push(...(await friendlyInbox(self, blocked)));
  for (const id of GUIDE_IDS) items.push(...(await GUIDE_WORLD[id].inbox(userId)));
  items.push(...(await staffItems(userId, since)));
  return items.sort((x, y) => y.at - x.at);
}

/** A declaration as its row keeps it (declare()), for everyone who reads it: receivers, its sender, the admin */
export function storedDeclaration(d: typeof declarations.$inferSelect): Declaration {
  const game = isGame(d.game) ? d.game : "arknights";
  const character = d.character ?? "";
  // one of the sentences this code knows, unless newer code wrote the row (the default below)
  const template = d.template as Template;
  switch (template) {
    case "launch":
      return { template: "launch", game };
    case "iam":
      return { template: "iam", character, title: d.title ?? "" };
    case "love":
    case "buff":
    case "canyou":
      return { template, character };
    case "eat":
      return { template: "eat", character, food: FOODS.find((f) => f === d.food) ?? (FOODS[0] as Food) };
    case "myname":
      return { template: "myname", game, name: d.name ?? "" };
    case "welcome":
    case "alsoplay":
      return { template, game };
    case "birthday":
      return { template: "birthday" };
    case "event":
      return { template: "event", line: d.line ?? "" };
    case "stronghold":
    case "water":
    case "radar":
    case "roguelike":
    case "xianshu":
    case "rental":
    case "sihouse":
    case "simine":
      return { template };
    case "drunklove":
      return { template: "drunklove", character };
    case "kr168":
      return { template: "kr168", character, spouse: SPOUSES.find((s) => s === d.title) ?? SPOUSES[0] };
    default: {
      // Every sentence needs its case above, or it reads as 「明日方舟，启动！」 to all (as 缘缘庄's two did):
      // tsc fails here when one has none
      const unknown: never = template;
      void unknown;
      return { template: "launch", game };
    }
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
  if (d.length) await seeDeclarations(userId, d, now.getTime());
  const x = ids("x:");
  if (x.length) {
    const myDeclarations = db.select({ id: declarations.id }).from(declarations).where(eq(declarations.senderId, userId));
    await db
      .update(reactions)
      .set({ seenAt: now })
      .where(and(inArray(reactions.id, x), inArray(reactions.declarationId, myDeclarations), isNull(reactions.seenAt)));
  }
  for (const id of GUIDE_IDS) await GUIDE_WORLD[id].see(userId, itemIds);
  await seeFriendly(userId, itemIds);
  await seeStaff(userId, itemIds);
  const p = ids("p:");
  if (p.length) {
    await db
      .update(pokes)
      .set({ seenAt: now })
      .where(and(inArray(pokes.id, p), eq(pokes.toUserId, userId), isNull(pokes.seenAt)));
  }
  const w = ids("w:");
  if (w.length) {
    await db
      .update(pokes)
      .set({ wokeSeenAt: now })
      .where(and(inArray(pokes.id, w), eq(pokes.fromUserId, userId), isNotNull(pokes.wokeToldAt), isNull(pokes.wokeSeenAt)));
  }
  for (const f of itemIds.filter((i) => typeof i === "string" && i.startsWith("f:"))) {
    const [a, b] = f.slice(2).split("~");
    if (!UUID.test(a ?? "") || !UUID.test(b ?? "")) continue;
    if (userId === a) await db.update(friendships).set({ seenByA: true }).where(and(eq(friendships.a, a), eq(friendships.b, b)));
    if (userId === b) await db.update(friendships).set({ seenByB: true }).where(and(eq(friendships.a, a), eq(friendships.b, b)));
  }
}

/**
 * Shout from the sender's chosen roaches (the main roach unless `from` says otherwise): kept once, with
 * their spots, it shows to everyone with a roach within DECLARATION_RADIUS_KM of any of them for
 * DECLARATION_DAYS (src/lib/server/declarationInbox.ts). Those near now are nudged and counted, for the
 * sender's rough count; a 「祝我生日快乐」 also goes to every 触须之交 as theirs, one row each.
 */
export async function declare(userId: string, input: Declaration, from?: string[]): Promise<{ reach: string } & PassesDot> {
  const u = await userById(userId);
  if (!u) throw new WorldError(T.server.common.signIn);
  // held, a player is anonymous, which checkDeclaration refuses 「我是…」 for; this says why
  if (u.profileHeldAt && input?.template === "myname") throw new WorldError(T.server.world.nameHeldNoSaying);
  const drunk = Boolean(u.drunkUntil && u.drunkUntil.getTime() > Date.now());
  // 缘缘庄's two only once their ink roach has had a room (src/lib/server/si.ts)
  const stayed = isStayTemplate(input?.template) ? await hasStayed(u.id, u.siStayedAt) : false;
  const d = checkDeclaration(profileOf(u), input, Date.now(), drunk, stayed);
  const mine = await db.select().from(roaches).where(eq(roaches.userId, userId));
  if (!mine.some((r) => r.slot === 0)) throw new WorldError(T.server.world.mainBeforeDeclaring);
  const wanted = Array.isArray(from) ? [...new Set(from.map(String))] : null;
  const chosen = wanted ? mine.filter((r) => wanted.includes(r.id)) : mine.filter((r) => r.slot === 0);
  // 墨小强 too, from 缘缘庄 wherever it is there, while it is on the map; only those near the spots by their own
  // roaches are counted and told, never every player whose ink roach is there (src/lib/server/declarationInbox.ts)
  const fromInk = Boolean(wanted?.includes(INK_FROM)) && (await inkOnMap(db, userId));
  if (wanted && chosen.length + (fromInk ? 1 : 0) < wanted.length) throw new WorldError(T.server.world.roachLostRefresh);
  const spots: LngLat[] = [...chosen.map((c) => ({ lng: c.lng, lat: c.lat })), ...(fromInk ? [INN_CENTER] : [])];
  if (!spots.length) throw new WorldError(T.server.world.pickRoachToDeclare);

  // the last day's, for the minute's wait across 04:00 too; today's twenty since the day turned
  const recent = await db
    .select({ at: declarations.createdAt })
    .from(declarations)
    .where(and(eq(declarations.senderId, userId), gt(declarations.createdAt, ago(DAY))));
  const began = dayBegan().getTime();
  if (recent.filter((r) => r.at.getTime() >= began).length >= DECLARATIONS_PER_DAY) throw new WorldError(T.server.world.declaredEnough);
  if (recent.some((r) => Date.now() - r.at.getTime() < DECLARATION_COOLDOWN_MIN * MINUTE)) {
    throw new WorldError(T.server.world.declaredJustNow);
  }

  // The sender only learns a rough count
  const near = spots.map(
    (c) =>
      sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography, ${DECLARATION_RADIUS_KM * 1000})`,
  );
  const blocked = await blockedWith(userId);
  // a player with 只看本体 on hears only near their main roach (src/lib/server/declarationInbox.ts): not counted, nor
  // nudged, for clones alone
  const rows = (
    await db
      .selectDistinct({ id: roaches.userId })
      .from(roaches)
      .innerJoin(users, eq(users.id, roaches.userId))
      .where(and(ne(roaches.userId, userId), or(...near), or(eq(roaches.slot, 0), eq(users.onlyMains, false))))
  ).filter((r) => !blocked.has(r.id));
  // 「祝我生日快乐」 also reaches every 触须之交 however far, as theirs (once in FRIEND_BIRTHDAY_DAYS); one each
  const friendsToo = new Set(d.template === "birthday" ? await birthdayFriends(userId, blocked) : []);
  const nearby = new Set(rows.map((r) => r.id));
  const everyone = [...rows.map((r) => r.id), ...[...friendsToo].filter((f) => !nearby.has(f))];
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(declarations)
      .values({
        senderId: userId,
        template: d.template,
        game: "game" in d ? d.game : null,
        character: "character" in d ? d.character : null,
        // the title column also keeps 老婆/老公 of 氪了168
        title: d.template === "iam" ? d.title : d.template === "kr168" ? d.spouse : null,
        food: d.template === "eat" ? d.food : null,
        name: d.template === "myname" ? (d.name ?? null) : null,
        line: d.template === "event" ? d.line : null,
        recipients: everyone.length,
      })
      .returning({ id: declarations.id, createdAt: declarations.createdAt });
    // where it was sent from, by which it is found (src/lib/server/declarationInbox.ts)
    await tx.insert(declarationSpots).values(spotRows({ id: row.id, senderId: userId, createdAt: row.createdAt }, spots));
    // only a birthday's 触须之交 are written down: they see who sent it (the rest find it by its spots)
    const friends = [...friendsToo];
    for (let i = 0; i < friends.length; i += 1000) {
      await tx
        .insert(deliveries)
        .values(friends.slice(i, i + 1000).map((id) => ({ declarationId: row.id, recipientId: id, toFriend: true })));
    }
  });
  countDeclared(d.template, everyone.length);
  const task = await didTask(userId, "declare");
  nudge(everyone, "declare");
  // 塔露拉干员 answers her 触须之交's birthday, never among the recipients
  if (d.template === "birthday") await birthdayDeclared(userId);
  const event = d.template === "event" ? findLine(d.line)?.event : null;
  if (event?.badge) await award(userId, [event.badge]);
  await declared(userId, d.template);
  await declaredFrom(userId, chosen.map((r) => r.slot));
  const told = friendsToo.size ? fmt(T.server.world.friendsToo, { n: friendsToo.size }) : "";
  return { reach: reachText(rows.length) + told, ...task };
}

/** 默默爬走: leave a touch you received unanswered for good. Only the receiver ever knows. */
export async function ignore(userId: string, itemId: string) {
  const guide = guideOfItem(String(itemId));
  if (guide) return GUIDE_WORLD[guide.id].ignore(userId, String(itemId));
  const [kind, id] = String(itemId).split(":");
  if (kind !== "t" || !UUID.test(id ?? "")) throw new WorldError(T.server.common.noSuchNote);
  if ((await replied(userId, [itemId])).size) throw new WorldError(T.server.common.touched);
  const now = new Date();
  const mine = and(eq(touches.id, id), eq(touches.toUserId, userId));
  // counted the first time; crawling away again changes nothing
  const [first] = await db
    .update(touches)
    .set({ ignoredAt: now, seenAt: sql`coalesce(${touches.seenAt}, ${now.toISOString()})` })
    .where(and(mine, isNull(touches.ignoredAt)))
    .returning({ id: touches.id });
  if (first) {
    countIgnored();
    return;
  }
  const [done] = await db.select({ id: touches.id }).from(touches).where(mine).limit(1);
  if (!done) throw new WorldError(T.server.common.noSuchNote);
}

/** Leave one of the fixed reactions on a declaration you received. The sender is not told who. */
export async function react(userId: string, itemId: string, reaction: string): Promise<PassesDot> {
  const [kind, id] = String(itemId).split(":");
  if (kind !== "d" || !UUID.test(id ?? "")) throw new WorldError(T.server.world.noDeclaration);
  // one the player sees now: near one of their roaches, or answered before
  const row = await canSeeDeclaration(userId, id);
  if (!row) throw new WorldError(T.server.world.noDeclaration);
  // its own four or the five every declaration has, never another sentence's
  if (!canReply(storedDeclaration(row), reaction)) throw new WorldError(T.server.world.cannotReplyThisWay);
  const withheld = await blockedBetween(userId, row.senderId);
  const [made] = await db
    .insert(reactions)
    .values({ declarationId: id, fromUserId: userId, reaction, withheld })
    .onConflictDoNothing()
    .returning({ id: reactions.id });
  if (!made) throw new WorldError(T.server.world.alreadyReplied);
  countReply(reaction);
  // counted whether or not it arrives, as a touch is
  const task = await didTask(userId, "reply");
  if (withheld) return task;
  nudge([row.senderId]);
  await reactedTo(row.senderId);
  await responded(userId, id, row.senderId);
  // 罗德岛信使: 生日快乐！ to a 触须之交's birthday
  if (reaction === "birthday" && row.template === "birthday" && (await friendIdsOf(userId)).has(row.senderId)) {
    await wishedHappyBirthday(userId, row.senderId);
  }
  return task;
}

export async function friends(userId: string): Promise<Friend[]> {
  const since = ago(INBOX_DAYS * DAY);
  const self = await userById(userId);
  const fs = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.a, userId), eq(friendships.b, userId)))
    .orderBy(desc(friendships.createdAt));
  const out: Friend[] = [];
  const met: { user: UserRow; since: Date; at: number }[] = [];
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
      profile: (await cardsOf([u], userId)).get(u.id)!,
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
      pokeAgainAt: await lastPoke(userId, other),
      star: null,
    });
    met.push({ user: u, since: f.createdAt, at: out.length - 1 });
  }
  // what the two of you can do for each other, all of them at once
  if (self) {
    const between = await betweenOf(self, met);
    for (const m of met) out[m.at].between = between.get(m.user.id);
  }
  // their ink roaches on the map (not held), by tap number: 只看本体 draws them as their other clones
  if (met.length) {
    const inks = await db
      .select({ userId: siInks.userId, publicId: siInks.publicId })
      .from(siInks)
      .where(and(inArray(siInks.userId, met.map((m) => m.user.id)), isNotNull(siInks.ticket), isNull(siInks.recalledAt)));
    const taps = new Map(inks.map((i) => [i.userId, tapOf(i.publicId)]));
    for (const m of met) {
      const tap = taps.get(m.user.id);
      if (tap !== undefined) out[m.at].inkTap = tap;
    }
  }
  // 特别关注 first, in the order starred; then the guides, in their order; then everyone else, newest first
  const stars = new Map(
    (await db.select().from(friendStars).where(eq(friendStars.userId, userId))).map((s) => [s.other, s.createdAt.getTime()]),
  );
  for (const m of met) out[m.at].star = stars.get(m.user.id) ?? null;
  const guides = self ? GUIDE_IDS.flatMap((id) => GUIDE_WORLD[id].friend(self) ?? []).map((g) => ({ ...g, star: stars.get(g.id) ?? null })) : [];
  const all = [...guides, ...out];
  const starred = all.filter((f) => f.star !== null).sort((x, y) => x.star! - y.star!);
  return [...starred, ...all.filter((f) => f.star === null)];
}

/** 特别关注 one of your 触须之交 (a guide too), or not; only you know */
export async function starFriend(userId: string, friendId: unknown, on: unknown) {
  const self = await userById(userId);
  const id = String(friendId);
  const guide = guideById(id);
  const other = guide
    ? self && GUIDE_WORLD[guide.id].friend(self)
      ? guide.id
      : null
    : ([...(await friendIdsOf(userId))].find((o) => friendKey(userId, o) === id) ?? null);
  if (!other) throw new WorldError(T.server.common.notFriends);
  if (on === true) await db.insert(friendStars).values({ userId, other }).onConflictDoNothing();
  else await db.delete(friendStars).where(and(eq(friendStars.userId, userId), eq(friendStars.other, other)));
}

export async function unfriend(userId: string, friendId: string) {
  const guide = guideById(String(friendId));
  if (guide) {
    await db.delete(friendStars).where(and(eq(friendStars.userId, userId), eq(friendStars.other, guide.id)));
    return GUIDE_WORLD[guide.id].unfriend(userId);
  }
  const others = await friendIdsOf(userId);
  const other = [...others].find((o) => friendKey(userId, o) === friendId);
  if (!other) throw new WorldError(T.server.common.notFriends);
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
    // visiting clones both ways go home, quietly
    await friendshipEnded(tx, x, y);
  });
  roachesChanged();
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
  await scannedRadar(userId);
  return { ...scan, scannedAt: now, scansLeft: left - 1, nextScanAt: null };
}

/**
 * Count what is around your main roach, from the radar's squares (radarBlocks.ts): what each square holds is
 * read from the database at most every few minutes for everyone scanning near it, and counted here round
 * the main roach's exact place, the scanner's own roaches and moves left out.
 */
async function scanRadar(userId: string, main: RoachRow, now: number): Promise<RadarScan> {
  const center = { lng: main.lng, lat: main.lat };
  const raw = await radarRaw(center, userId, now);
  const demo = demoEnabled ? await demoMoves(now) : [];
  return buildRadar({
    center,
    now,
    roaches: raw.roaches,
    moves: [...demo.filter((m) => m.owner !== userId), ...raw.moves],
    touchedPlayers: raw.touchedPlayers,
    declaringPlayers: raw.declaringPlayers,
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
