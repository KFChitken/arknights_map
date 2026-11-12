import "server-only";
import { and, count, countDistinct, eq, inArray, isNotNull, isNull, lt, lte, sql, type AnyColumn } from "drizzle-orm";
import {
  BADGES,
  badgeById,
  badgesOwned,
  COMRADE_DAYS,
  ECHO_REACTIONS,
  ELITE_SERIES,
  FAR_FRIEND_KM,
  FIRE_SONG_ROACHES,
  FIRST_BATCH,
  FLUENT_TEMPLATES,
  heldUntil,
  LOUDHORN_CLONES,
  MOVING_CITY_KM,
  NO_MORE_SECONDS,
  ROWDY_REACTIONS,
  seriesCovered,
  stillHeld,
  type BadgeCount,
  type EarnedBadge,
  type ShownBadge,
} from "../badges";
import { beijingDate } from "../beijing";
import { distanceKm } from "../geo";
import { FIRE_AT, FIRE_RADIUS_M } from "../talulah";
import { db } from "./db";
import { nudge } from "./live";
import { declarations, friendNotes, friendships, moves, reactions, roaches, touches, userBadges, users, visits, type UserRow } from "./schema";

/**
 * Earning badges. Each is written down the moment it is earned, because what
 * earned it (touches, declarations, reactions) is deleted after 90 days.
 * Only an admin, or deleting the account, ever takes one away; a timed one
 * (石棺里的苏醒) just stops counting once its days are over.
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
  // 罗德岛正式干员 and 精英干员 go by what they hold, so they are looked at after anything else is given
  if (made.some((m) => !MEMORIAL_BY_HELD.includes(m.badge))) await memorialBadges(userId);
  return made.map((m) => m.badge);
}

/** The two given by the badges a player holds */
const MEMORIAL_BY_HELD = ["regular", "elite"];

/** 罗德岛正式干员 with five others held, 精英干员 with one of each of ELITE_SERIES */
async function memorialBadges(userId: string) {
  const held = await earnedBy(userId);
  const due = [...reached("badgesOwned", badgesOwned(held)), ...reached("seriesCovered", seriesCovered(held))];
  const missing = due.filter((id) => !held.some((h) => h.id === id));
  if (missing.length) await award(userId, missing);
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
  if (await metByDeclaration(a, b)) {
    await award(a, ["declfriend"]);
    await award(b, ["declfriend"]);
  }
}

/**
 * 以宣会友: whether the back-and-forth that just made two players 触须之交 began with a declaration:
 * followed back from the latest bold touch each way, answer by answer, to where it started, which
 * answered a declaration (d:) or someone's reaction to one (x:).
 */
async function metByDeclaration(a: string, b: string) {
  const latest = (from: string, to: string) =>
    sql`(select id from ${touches} where from_user_id = ${from} and to_user_id = ${to} and bold and not withheld order by created_at desc limit 1)`;
  const rows = await db.execute(sql`
    with recursive chain as (
      select id, reply_to from ${touches} where id in (${latest(a, b)}, ${latest(b, a)})
      union all
      select t.id, t.reply_to from chain c join ${touches} t
        on t.id = case when c.reply_to ~ '^t:[0-9a-f-]{36}$' then substring(c.reply_to from 3)::uuid end
    )
    select 1 from chain where reply_to ~ '^(d|x):' limit 1`);
  return rows.length > 0;
}

/** Counts a Beijing day once: the column goes up only on the first time today */
const oncePerDay = (days: AnyColumn, on: AnyColumn, today: string) =>
  sql`case when ${on} = ${today}::date then ${days} else ${days} + 1 end`;

/**
 * A player sent a declaration (whether anyone got it or not): a day of declaring, the everyday
 * sentence among those 满嘴舟语 asks for, and the 宣言 badges they reach.
 */
export async function declared(userId: string, template: string) {
  const today = beijingDate();
  const fluent = (FLUENT_TEMPLATES as readonly string[]).includes(template);
  const [u] = await db
    .update(users)
    .set({
      declareDays: oncePerDay(users.declareDays, users.declaredOn, today),
      declaredOn: today,
      ...(fluent
        ? { declaredLines: sql`case when ${template} = any(${users.declaredLines}) then ${users.declaredLines} else array_append(${users.declaredLines}, ${template}::text) end` }
        : {}),
    })
    .where(eq(users.id, userId))
    .returning({ days: users.declareDays, lines: users.declaredLines });
  if (u) await award(userId, [...reached("declareDays", u.days), ...reached("declareLines", u.lines.length)]);
}

/**
 * A player responded to a declaration (one a block withheld does not count): a day of responding,
 * by days and never by whom, as declarations are anonymous; and 一呼百舟应 for its sender once it
 * has ECHO_REACTIONS responses.
 */
export async function responded(userId: string, declarationId: string, senderId: string) {
  const today = beijingDate();
  const [u] = await db
    .update(users)
    .set({ reactDays: oncePerDay(users.reactDays, users.reactedOn, today), reactedOn: today })
    .where(eq(users.id, userId))
    .returning({ days: users.reactDays });
  if (u) await award(userId, reached("reactDays", u.days));
  const [{ n }] = await db
    .select({ n: count() })
    .from(reactions)
    .where(and(eq(reactions.declarationId, declarationId), eq(reactions.withheld, false)));
  if (n >= ECHO_REACTIONS) await award(senderId, ["echo"]);
  if (n >= ROWDY_REACTIONS) await award(senderId, ["rowdy"]);
}

export type GuideBadge = "amiya" | "perlica" | "talulah" | "minghe";

/** A guide just became their 触须之交 (塔露拉干员: the handshake): her badge, and 满编小队 with all four. */
export async function guideFriendMade(userId: string, guide: GuideBadge) {
  await award(userId, [guide]);
  const [u] = await db
    .select({ a: users.amiyaFriendSince, p: users.perlicaFriendSince, t: users.talulahFriendSince, m: users.mingheFriendSince })
    .from(users)
    .where(eq(users.id, userId));
  if (u) await award(userId, reached("guideFriends", [u.a, u.p, u.t, u.m].filter(Boolean).length));
}

/** A player touched 阿米娅向导 or 佩丽卡监督: a day of touching her, for the 30-day badges. */
export async function guideTouched(userId: string, guide: "amiya" | "perlica") {
  const today = beijingDate();
  const [u] =
    guide === "amiya"
      ? await db
          .update(users)
          .set({ amiyaDays: oncePerDay(users.amiyaDays, users.amiyaTouchedOn, today), amiyaTouchedOn: today })
          .where(eq(users.id, userId))
          .returning({ days: users.amiyaDays })
      : await db
          .update(users)
          .set({ perlicaDays: oncePerDay(users.perlicaDays, users.perlicaTouchedOn, today), perlicaTouchedOn: today })
          .where(eq(users.id, userId))
          .returning({ days: users.perlicaDays });
  if (u) await award(userId, reached(guide === "amiya" ? "amiyaDays" : "perlicaDays", u.days));
}

/**
 * 火边的歌声: with FIRE_SONG_ROACHES or more roaches by 塔露拉干员's fire (her third level; test
 * players' roaches do not count), everyone with a roach there gets it. Counted whenever a roach
 * arrives there, and at 04:00.
 */
export async function fireSongs() {
  const by = await db
    .select({ userId: roaches.userId })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    .where(
      and(
        isNull(users.demoKey),
        sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${FIRE_AT.lng}, ${FIRE_AT.lat}), 4326)::geography, ${FIRE_RADIUS_M})`,
      ),
    );
  if (by.length < FIRE_SONG_ROACHES) return;
  for (const id of new Set(by.map((r) => r.userId))) await award(id, ["fireside"]);
}

// ---- the third round (2026-11-12) ----

/** 狂响的声筒: a declaration sent from the main roach (slot 0) and at least LOUDHORN_CLONES clones at once */
export async function declaredFrom(userId: string, slots: number[]) {
  if (slots.includes(0) && slots.filter((s) => s > 0).length >= LOUDHORN_CLONES) await award(userId, ["loudhorn"]);
}

/** 罗德岛信使: 生日快乐！ to a 触须之交's birthday declaration; each friend counts once */
export async function wishedHappyBirthday(userId: string, friendId: string) {
  const [u] = await db
    .update(users)
    .set({
      birthdayWished: sql`case when ${friendId}::uuid = any(${users.birthdayWished}) then ${users.birthdayWished} else array_append(${users.birthdayWished}, ${friendId}::uuid) end`,
    })
    .where(eq(users.id, userId))
    .returning({ n: sql<number>`cardinality(${users.birthdayWished})` });
  if (u) await award(userId, reached("birthdayWishes", Number(u.n)));
}

/** 眠于树影之中: a 触须之交 covered a sleeping player with a quilt; each one counts once */
export async function quilted(userId: string, byId: string) {
  const [u] = await db
    .update(users)
    .set({ quiltedBy: sql`case when ${byId}::uuid = any(${users.quiltedBy}) then ${users.quiltedBy} else array_append(${users.quiltedBy}, ${byId}::uuid) end` })
    .where(eq(users.id, userId))
    .returning({ n: sql<number>`cardinality(${users.quiltedBy})` });
  if (u) await award(userId, reached("quilters", Number(u.n)));
}

/** 相见欢: two 触须之交 added each other in a game; both get it */
export async function addedInGame(a: string, b: string) {
  await award(a, ["ingame"]);
  await award(b, ["ingame"]);
}

/**
 * A roach was put down or moved (after the move is written): 异卵同生 for a clone put out the first time;
 * 移动城市 counts a main roach's move of MOVING_CITY_KM or more, which only compares its own two places
 */
export async function placed(userId: string, slot: number, from: { lng: number; lat: number } | null, to: { lng: number; lat: number }) {
  if (slot > 0 && !from) await award(userId, ["twins"]);
  if (slot === 0 && from && distanceKm(from, to) >= MOVING_CITY_KM) {
    const [u] = await db
      .update(users)
      .set({ farMoves: sql`${users.farMoves} + 1` })
      .where(eq(users.id, userId))
      .returning({ n: users.farMoves });
    if (u) await award(userId, reached("farMoves", u.n));
  }
}

/** 天灾信使: a day of scanning the radar */
export async function scannedRadar(userId: string) {
  const today = beijingDate();
  const [u] = await db
    .update(users)
    .set({ radarDays: oncePerDay(users.radarDays, users.radarOn, today), radarOn: today })
    .where(eq(users.id, userId))
    .returning({ days: users.radarDays });
  if (u) await award(userId, reached("radarDays", u.days));
}

/** 惊霆无声: a day of touching a player's roach sneakily (the guides do not count) */
export async function touchedSneakily(userId: string) {
  const today = beijingDate();
  const [u] = await db
    .update(users)
    .set({ sneakDays: oncePerDay(users.sneakDays, users.sneakOn, today), sneakOn: today })
    .where(eq(users.id, userId))
    .returning({ days: users.sneakDays });
  if (u) await award(userId, reached("sneakDays", u.days));
}

/** 我真的不能再喝了: 醒酒 within NO_MORE_SECONDS of getting drunk (drunkAt: when the drinking began) */
export async function soberedUp(userId: string, drunkAt: Date | null, now = Date.now()) {
  if (drunkAt && now - drunkAt.getTime() < NO_MORE_SECONDS * 1000) await award(userId, ["nomore"]);
}

/** 将进酒: ⚡舟友的酒⚡ opened while their main roach lies drunk */
export async function partied(userId: string, now = Date.now()) {
  const [u] = await db.select({ drunkUntil: users.drunkUntil }).from(users).where(eq(users.id, userId));
  if (u?.drunkUntil && u.drunkUntil.getTime() > now) await award(userId, ["drinkup"]);
}

/**
 * 二次呼吸: drunk and left to sleep until the morning: for everyone whose drinking (drunkAt) has run out by
 * itself, never sobered up (which clears drunkAt), and drunkAt cleared so it is given once a sleep. Every few
 * minutes, and as someone drinks again.
 */
export async function sleptItOff(now = Date.now()) {
  const woke = await db
    .update(users)
    .set({ drunkAt: null })
    .where(and(isNotNull(users.drunkAt), isNotNull(users.drunkUntil), lte(users.drunkUntil, new Date(now))))
    .returning({ id: users.id });
  for (const w of woke) await award(w.id, ["secondwind"]);
  return woke.length;
}

/**
 * 温暖你的战友: at 04:00, a night by 塔露拉干员's fire for everyone with a roach there (test players' do not count),
 * once a day each
 */
export async function nightByTheFire(now = Date.now()) {
  const today = beijingDate(now);
  const by = await db
    .selectDistinct({ userId: roaches.userId })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    .where(
      and(
        isNull(users.demoKey),
        sql`ST_DWithin(${roaches.geog}, ST_SetSRID(ST_MakePoint(${FIRE_AT.lng}, ${FIRE_AT.lat}), 4326)::geography, ${FIRE_RADIUS_M})`,
      ),
    );
  if (!by.length) return 0;
  const counted = await db
    .update(users)
    .set({ fireNights: oncePerDay(users.fireNights, users.fireNightOn, today), fireNightOn: today })
    .where(inArray(users.id, by.map((b) => b.userId)))
    .returning({ id: users.id, nights: users.fireNights });
  for (const c of counted) await award(c.id, reached("fireNights", c.nights));
  return counted.length;
}

/**
 * 共患难的战友: 触须之交 COMRADE_DAYS days or more without a break (a 解除 deletes the pair); both get it. At 04:00,
 * in one statement however many pairs there are; only those just given it are told, and looked at for the two
 * that go by the badges held.
 */
export async function comrades(now = Date.now(), memorial = true) {
  const since = new Date(now - COMRADE_DAYS * 86_400_000).toISOString();
  const given = await db.execute<{ user_id: string }>(sql`
    insert into ${userBadges} (user_id, badge)
    select p.id, 'comrade' from (
      select ${friendships.a} as id from ${friendships} where ${friendships.createdAt} <= ${since}::timestamptz
      union select ${friendships.b} from ${friendships} where ${friendships.createdAt} <= ${since}::timestamptz
    ) p
    on conflict do nothing
    returning user_id`);
  const ids = given.map((g) => g.user_id);
  if (ids.length) nudge(ids);
  // at start (catchUpBadges) the two come for everyone at once, after
  if (memorial) for (const id of ids) await memorialBadges(id);
  return ids.length;
}

/** A player really got drunk; total is how many times so far. */
export async function drank(userId: string, total: number) {
  return award(userId, reached("drinks", total));
}

/** Someone reacted to a player's declaration. */
export async function reactedTo(senderId: string) {
  await award(senderId, reached("responders", await respondersOf(senderId)));
}

/** 石棺里的苏醒 given again within this long stays as it was given */
const WOKE_AGAIN_MS = 86_400_000;

/**
 * 石棺里的苏醒 from now for SURVIVOR_DAYS: on signing up, or back after AWAY_DAYS
 * away. Given again, it starts over and pops up again; but not within a day of the
 * last time (two pages opening at once both find the player back), so once seen it
 * stays seen.
 */
export async function wakeUp(userId: string) {
  const now = new Date();
  const woke = await db
    .insert(userBadges)
    .values({ userId, badge: "survivor", earnedAt: now })
    .onConflictDoUpdate({
      target: [userBadges.userId, userBadges.badge],
      set: { earnedAt: now, seenAt: null },
      setWhere: lt(userBadges.earnedAt, new Date(now.getTime() - WOKE_AGAIN_MS)),
    })
    .returning({ badge: userBadges.badge });
  if (woke.length) nudge([userId]);
}

/** A new account wakes up; the first players also get 首批蟑螂 and their number, which is never given out twice. */
export async function signedUp(userId: string) {
  await wakeUp(userId);
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
  const give = (badge: string, due: ReturnType<typeof sql>) =>
    db.execute(sql`insert into ${userBadges} (user_id, badge) select due.id, ${badge}::text from (${due}) as due(id) on conflict do nothing`);
  const column: Partial<Record<BadgeCount, ReturnType<typeof sql>>> = {
    friends: sql`${users.friendsEver}`,
    drinks: sql`${users.drinksTotal}`,
    declareDays: sql`${users.declareDays}`,
    reactDays: sql`${users.reactDays}`,
    declareLines: sql`cardinality(${users.declaredLines})`,
    amiyaDays: sql`${users.amiyaDays}`,
    perlicaDays: sql`${users.perlicaDays}`,
    guideFriends: sql`((${users.amiyaFriendSince} is not null)::int + (${users.perlicaFriendSince} is not null)::int
      + (${users.talulahFriendSince} is not null)::int + (${users.mingheFriendSince} is not null)::int)`,
    radarDays: sql`${users.radarDays}`,
    fireNights: sql`${users.fireNights}`,
    sneakDays: sql`${users.sneakDays}`,
    birthdayWishes: sql`cardinality(${users.birthdayWished})`,
    quilters: sql`cardinality(${users.quiltedBy})`,
    farMoves: sql`${users.farMoves}`,
  };
  for (const b of BADGES) {
    // the two that go by the badges held come last, below
    if (!b.goal || b.goal.count === "badgesOwned" || b.goal.count === "seriesCovered") continue;
    const n = column[b.goal.count];
    await give(
      b.id,
      n
        ? sql`select ${users.id} from ${users} where ${n} >= ${b.goal.n}`
        : sql`select ${declarations.senderId} from ${reactions}
            join ${declarations} on ${declarations.id} = ${reactions.declarationId}
            where not ${reactions.withheld}
            group by ${declarations.senderId} having count(distinct ${reactions.fromUserId}) >= ${b.goal.n}`,
    );
  }
  // the guides already 触须之交, and the declarations already answered ECHO_REACTIONS times
  await give("amiya", sql`select ${users.id} from ${users} where ${users.amiyaFriendSince} is not null`);
  await give("perlica", sql`select ${users.id} from ${users} where ${users.perlicaFriendSince} is not null`);
  await give("talulah", sql`select ${users.id} from ${users} where ${users.talulahFriendSince} is not null`);
  await give("minghe", sql`select ${users.id} from ${users} where ${users.mingheFriendSince} is not null`);
  await give(
    "echo",
    sql`select ${declarations.senderId} from ${reactions}
      join ${declarations} on ${declarations.id} = ${reactions.declarationId}
      where not ${reactions.withheld}
      group by ${reactions.declarationId}, ${declarations.senderId} having count(*) >= ${ECHO_REACTIONS}`,
  );
  // the third round, from what is still on record: 喧闹法则 from the reactions kept, 异卵同生 from clones out now or
  // moved in the moves kept, 相见欢 from the game friends' notes, 使命必达 from the visits, and 共患难的战友
  await give(
    "rowdy",
    sql`select ${declarations.senderId} from ${reactions}
      join ${declarations} on ${declarations.id} = ${reactions.declarationId}
      where not ${reactions.withheld}
      group by ${reactions.declarationId}, ${declarations.senderId} having count(*) >= ${ROWDY_REACTIONS}`,
  );
  await give("twins", sql`select ${roaches.userId} from ${roaches} where ${roaches.slot} > 0 union select ${moves.userId} from ${moves} where ${moves.slot} > 0`);
  await give(
    "ingame",
    sql`select ${friendNotes.fromUserId} from ${friendNotes} where ${friendNotes.kind} = 'gameAsk' and ${friendNotes.answer} = 'added'
      union select ${friendNotes.toUserId} from ${friendNotes} where ${friendNotes.kind} = 'gameAsk' and ${friendNotes.answer} = 'added'`,
  );
  await give("delivery", sql`select ${visits.guestId} from ${visits}`);
  await comrades(Date.now(), false);
  // last, by the badges held now: five besides 罗德岛正式干员 itself (石棺里的苏醒 left out, as it may have run out),
  // and one of each of ELITE_SERIES
  await give(
    "regular",
    sql`select ${userBadges.userId} from ${userBadges} where ${userBadges.badge} not in ('regular', 'survivor')
      group by ${userBadges.userId} having count(*) >= 5`,
  );
  const series = BADGES.filter((b) => ELITE_SERIES.includes(b.series));
  await give(
    "elite",
    sql`select ${userBadges.userId} from ${userBadges}
      join (values ${sql.join(
        series.map((b) => sql`(${b.id}::text, ${b.series}::text)`),
        sql`, `,
      )}) as s(badge, series) on s.badge = ${userBadges.badge}
      group by ${userBadges.userId} having count(distinct s.series) >= ${ELITE_SERIES.length}`,
  );
}

/** The badges a player holds, in the order the wall lists them; ids this code does not know, and timed ones run out, are left out. */
export async function earnedBy(userId: string): Promise<EarnedBadge[]> {
  const rows = await db.select().from(userBadges).where(eq(userBadges.userId, userId));
  return BADGES.flatMap((b) => {
    const r = rows.find((x) => x.badge === b.id);
    if (!r || !stillHeld(b, r.earnedAt.getTime())) return [];
    const at = r.earnedAt.getTime();
    return [{ id: b.id, serial: r.serial ?? undefined, at, seen: Boolean(r.seenAt), until: heldUntil(b, at) }];
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
      if (!r || !stillHeld(b, r.earnedAt.getTime())) return [];
      return [r.serial ? { id: b.id, serial: r.serial } : { id: b.id }];
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
      .select({ badge: userBadges.badge, earnedAt: userBadges.earnedAt })
      .from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badge, String(badge))))
      .limit(1);
    const b = has && badgeById(has.badge);
    if (!b || !stillHeld(b, has.earnedAt.getTime())) return false;
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
