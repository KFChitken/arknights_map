import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { BADGES } from "../badges";
import { addDays, beijingDate, beijingMidnight } from "../beijing";
import { inChina } from "../chinaView";
import {
  CITIES,
  CITY_KM,
  COUNTED,
  declName,
  guideName,
  MILESTONES,
  NOTE_KINDS,
  noteName,
  OPEN_DAY,
  replyName,
  type BestDay,
  type Count,
  type DashboardData,
  type DashDay,
  type StatSnapshot,
} from "../dashboard";
import { distanceKm } from "../geo";
import { GUIDES, type GuideId } from "../guides";
import { isCharacter, isOperator } from "../operators";
import { MAX_CLONES } from "../rules";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { retentionStats } from "./admin";
import { appCountDays } from "./appCounts";
import { db } from "./db";
import { connectedPlayers } from "./live";
import { mainSpots, roachKinds } from "./roachFeed";
import {
  amiyaTouches,
  dailyTotals,
  declarations,
  friendNotes,
  friendships,
  mingheTouches,
  moves,
  onlineHours,
  onlineNow,
  perlicaTouches,
  reactions,
  roaches,
  siInks,
  siTickets,
  siTouches,
  statCounts,
  statSnapshots,
  talulahTouches,
  touches,
  userBadges,
  users,
} from "./schema";

/**
 * 数据看板 on the server (src/components/admin/Dashboard.tsx): who is online, counted every minute; the 05:00
 * snapshot of how players and their roaches are spread; the one-time backfill of the counters (src/lib/server/stats.ts)
 * for the days before them; and the board's answer, which reads only small rows and the map's copy in memory. Counts
 * and codes only: no id, email, name or place of anyone ever leaves this module.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** online_now rows newer than this are processes still up */
const FRESH_MS = 2 * MINUTE;
/** The 05:00 snapshot from this Beijing hour on; the backfill only before the next */
const MORNING_HOUR = 5;
const GUIDE_IDS = Object.keys(GUIDES) as GuideId[];
const GUIDE_TABLES = { amiya: amiyaTouches, perlica: perlicaTouches, talulah: talulahTouches, minghe: mingheTouches, si: siTouches };
/** Each guide's 触须之交 as the snapshot counts them: holders of her badge (祀掌柜's: her inn's, 塔卫二最好的客栈) */
const GUIDE_BADGES: Record<GuideId, string> = { amiya: "amiya", perlica: "perlica", talulah: "talulah", minghe: "minghe", si: "siinn" };
/** The players' rankings show this many */
const TOP = 10;

/** A moment as a timestamptz parameter */
const ts = (ms: number) => sql`${new Date(ms).toISOString()}::timestamptz`;
/** The Beijing date of a timestamptz column, as YYYY-MM-DD */
const dayOf = (col: AnyPgColumn | SQL) => sql<string>`(((${col}) at time zone 'UTC') + interval '8 hours')::date::text`;
/** The hour (0–23) of a moment in Beijing */
const beijingHour = (now: number) => new Date(now + 8 * HOUR).getUTCHours();
const num = (v: unknown) => Number(v ?? 0) || 0;
const counts = (rows: Iterable<{ key: unknown; n: unknown }>): Count[] =>
  [...rows].map((r) => ({ key: String(r.key), n: num(r.n) })).sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));

// ---- online ----

/** Every process, once a minute: how many signed-in players have a page open on it */
export async function reportOnline(processName: string, now = Date.now()) {
  const row = { n: connectedPlayers(), at: new Date(now) };
  await db
    .insert(onlineNow)
    .values({ process: processName, ...row })
    .onConflictDoUpdate({ target: onlineNow.process, set: row });
}

/** Online now: the processes' counts that are fresh, added up (a stopped process's last count is left out) */
async function onlineSum(now: number) {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${onlineNow.n}), 0)::int`.mapWith(Number) })
    .from(onlineNow)
    .where(gte(onlineNow.at, new Date(now - FRESH_MS)));
  return row?.n ?? 0;
}

/**
 * The main process, once a minute after its own reportOnline: the processes' fresh counts added up, kept as the hour's
 * peak (Beijing time) when higher, with when; the rows of processes gone a day are let go. Returns online now.
 */
export async function recordOnlinePeak(now = Date.now()) {
  const n = await onlineSum(now);
  await db
    .insert(onlineHours)
    .values({ day: beijingDate(now), hour: beijingHour(now), peak: n, peakAt: new Date(now) })
    .onConflictDoUpdate({
      target: [onlineHours.day, onlineHours.hour],
      // both read the row as it was
      set: {
        peak: sql`greatest(${onlineHours.peak}, excluded.peak)`,
        peakAt: sql`case when excluded.peak > ${onlineHours.peak} then excluded.peak_at else ${onlineHours.peakAt} end`,
      },
    });
  await db.delete(onlineNow).where(lt(onlineNow.at, new Date(now - DAY)));
  return n;
}

// ---- the one-time backfill ----

/** Whether the counters' days before the board have been filled in */
async function backfilled() {
  const [row] = await db
    .select({ n: statCounts.n })
    .from(statCounts)
    .where(and(eq(statCounts.day, OPEN_DAY), eq(statCounts.name, COUNTED.backfilled)))
    .limit(1);
  return Boolean(row);
}

type DayRow = { day: string; name: string; n: number };

/**
 * Every counter of every whole day from OPEN_DAY up to today (not today), counted from the tables, as the counters
 * would have counted them (src/lib/server/stats.ts): one grouped read of each table over all the days, none of which
 * takes a lock a write waits for. For the days daily_totals did not keep yet, their signups and new 触须之交 too.
 */
export async function countedFromTables(now = Date.now()): Promise<DayRow[]> {
  const today = beijingDate(now);
  const from = ts(beijingMidnight(OPEN_DAY));
  const to = ts(beijingMidnight(today));
  const out = new Map<string, number>();
  const add = (day: unknown, name: string, n: unknown) => {
    const v = num(n);
    if (v > 0) out.set(`${day}|${name}`, (out.get(`${day}|${name}`) ?? 0) + v);
  };
  const within = (col: AnyPgColumn) => sql`${col} >= ${from} and ${col} < ${to}`;

  const touched = await db.execute<{ d: string; sneaky: number; bold: number; back: number }>(sql`
    select ${dayOf(touches.createdAt)} as d,
      count(*) filter (where not ${touches.bold})::int as sneaky,
      count(*) filter (where ${touches.bold})::int as bold,
      count(*) filter (where ${touches.replyTo} like 't:%')::int as back
    from ${touches} where ${within(touches.createdAt)} group by 1`);
  for (const r of touched) {
    add(r.d, COUNTED.sneaky, r.sneaky);
    add(r.d, COUNTED.bold, r.bold);
    add(r.d, COUNTED.back, r.back);
  }
  // by the day it was crawled away from, as it was counted
  const ignored = await db.execute<{ d: string; n: number }>(sql`
    select ${dayOf(touches.ignoredAt)} as d, count(*)::int as n from ${touches} where ${within(touches.ignoredAt)} group by 1`);
  for (const r of ignored) add(r.d, COUNTED.ignored, r.n);

  const declared = await db.execute<{ d: string; template: string; n: number; reach: number }>(sql`
    select ${dayOf(declarations.createdAt)} as d, ${declarations.template} as template, count(*)::int as n,
      coalesce(sum(${declarations.recipients}), 0)::bigint as reach
    from ${declarations} where ${within(declarations.createdAt)} group by 1, 2`);
  for (const r of declared) {
    add(r.d, COUNTED.decl, r.n);
    add(r.d, declName(r.template), r.n);
    add(r.d, COUNTED.reach, r.reach);
  }

  const replied = await db.execute<{ d: string; reaction: string; n: number }>(sql`
    select ${dayOf(reactions.createdAt)} as d, ${reactions.reaction} as reaction, count(*)::int as n
    from ${reactions} where ${within(reactions.createdAt)} group by 1, 2`);
  for (const r of replied) {
    add(r.d, COUNTED.reply, r.n);
    add(r.d, replyName(r.reaction), r.n);
  }

  const noted = await db.execute<{ d: string; kind: (typeof NOTE_KINDS)[number]; n: number }>(sql`
    select ${dayOf(friendNotes.createdAt)} as d, ${friendNotes.kind} as kind, count(*)::int as n
    from ${friendNotes} where ${within(friendNotes.createdAt)} and ${inArray(friendNotes.kind, [...NOTE_KINDS])} group by 1, 2`);
  for (const r of noted) add(r.d, noteName(r.kind), r.n);

  // a placement is a move from nowhere to somewhere (src/lib/server/world.ts writePlacement)
  const placed = await db.execute<{ d: string; main: number; clone: number }>(sql`
    select ${dayOf(moves.at)} as d, count(*) filter (where ${moves.slot} = 0)::int as main, count(*) filter (where ${moves.slot} > 0)::int as clone
    from ${moves} where ${within(moves.at)} and ${moves.fromLng} is null and ${moves.toLng} is not null group by 1`);
  for (const r of placed) {
    add(r.d, COUNTED.main, r.main);
    add(r.d, COUNTED.clone, r.clone);
  }
  const drawn = await db.execute<{ d: string; n: number }>(sql`
    select ${dayOf(siInks.drawnAt)} as d, count(*)::int as n from ${siInks} where ${within(siInks.drawnAt)} group by 1`);
  for (const r of drawn) add(r.d, COUNTED.ink, r.n);

  for (const id of GUIDE_IDS) {
    const t = GUIDE_TABLES[id];
    const guided = await db.execute<{ d: string; n: number }>(sql`
      select ${dayOf(t.createdAt)} as d, count(*)::int as n from ${t} where ${within(t.createdAt)} and ${t.direction} = ${`to_${id}`} group by 1`);
    for (const r of guided) add(r.d, guideName(id), r.n);
  }

  // daily_totals began a few days after the opening: its days before, from the accounts and pairs still there
  const kept = new Set((await db.select({ day: dailyTotals.day }).from(dailyTotals).where(gte(dailyTotals.day, OPEN_DAY))).map((r) => r.day));
  const signups = await db.execute<{ d: string; n: number }>(sql`
    select ${dayOf(users.createdAt)} as d, count(*)::int as n from ${users} where ${within(users.createdAt)} and ${users.demoKey} is null group by 1`);
  for (const r of signups) if (!kept.has(r.d)) add(r.d, COUNTED.signups, r.n);
  const paired = await db.execute<{ d: string; n: number }>(sql`
    select ${dayOf(friendships.createdAt)} as d, count(*)::int as n from ${friendships} where ${within(friendships.createdAt)} group by 1`);
  for (const r of paired) if (!kept.has(r.d)) add(r.d, COUNTED.friendships, r.n);

  return [...out].map(([key, n]) => {
    const bar = key.indexOf("|");
    return { day: key.slice(0, bar), name: key.slice(bar + 1), n };
  });
}

/**
 * Once ever: the counters of every whole day before today, set (never added) from the tables, so the days before the
 * board, and the release day's part before it, hold exact numbers; then marked done. Counts from the processes are
 * only ever added to today's rows, so nothing written meanwhile is lost.
 */
export async function backfillStats(now = Date.now()) {
  if (await backfilled()) return false;
  const today = beijingDate(now);
  const rows = await countedFromTables(now);
  await db.transaction(async (tx) => {
    await tx.delete(statCounts).where(and(gte(statCounts.day, OPEN_DAY), lt(statCounts.day, today), ne(statCounts.name, COUNTED.backfilled)));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(statCounts).values(rows.slice(i, i + 1000));
    await tx.insert(statCounts).values({ day: OPEN_DAY, name: COUNTED.backfilled, n: now }).onConflictDoNothing();
  });
  return true;
}

// ---- the 05:00 snapshot ----

/** The most players one declaration reached between two moments, and on which Beijing day */
async function bestReach(fromMs: number, toMs: number): Promise<BestDay | null> {
  const [row] = await db
    .select({ n: declarations.recipients, day: dayOf(declarations.createdAt) })
    .from(declarations)
    .where(and(gte(declarations.createdAt, new Date(fromMs)), lt(declarations.createdAt, new Date(toMs))))
    .orderBy(desc(declarations.recipients), asc(declarations.createdAt))
    .limit(1);
  return row && row.n > 0 ? { n: row.n, day: row.day } : null;
}

/** Which of a few cities each main roach is nearest, within CITY_KM; and how many are in China */
function placesOf(spots: { lng: number; lat: number }[]) {
  const near = new Map<string, number>();
  let china = 0;
  // a degree of latitude is about 111 km: cities farther than that in latitude are skipped at once
  const reach = CITY_KM / 111 + 0.01;
  for (const p of spots) {
    if (inChina(p)) china++;
    let best: string | null = null;
    let bestKm = CITY_KM;
    for (const c of CITIES) {
      if (Math.abs(c.lat - p.lat) > reach) continue;
      const km = distanceKm(p, c);
      if (km <= bestKm) {
        bestKm = km;
        best = c.id;
      }
    }
    if (best) near.set(best, (near.get(best) ?? 0) + 1);
  }
  const cities = counts([...near].map(([key, n]) => ({ key, n }))).slice(0, TOP);
  return { china, abroad: spots.length - china, cities };
}

/**
 * How the players and their roaches are spread now (StatSnapshot): grouped reads of the accounts, roaches, 触须之交,
 * badges and 缘缘庄's tickets, and the map's copy in memory for where the main roaches stand. Counts and codes only.
 */
export async function snapshotNow(now = Date.now()): Promise<StatSnapshot> {
  const real = isNull(users.demoKey);
  const [who] = await db
    .select({
      players: sql<number>`count(*)::int`.mapWith(Number),
      hood: sql<number>`count(*) filter (where ${users.avatar} = 'hood')::int`.mapWith(Number),
      arknights: sql<number>`count(*) filter (where 'arknights' = any(${users.games}) and not ('endfield' = any(${users.games})))::int`.mapWith(Number),
      endfield: sql<number>`count(*) filter (where 'endfield' = any(${users.games}) and not ('arknights' = any(${users.games})))::int`.mapWith(Number),
      both: sql<number>`count(*) filter (where 'arknights' = any(${users.games}) and 'endfield' = any(${users.games}))::int`.mapWith(Number),
    })
    .from(users)
    .where(real);
  const looks = await db.select({ key: users.avatar, n: sql<number>`count(*)::int` }).from(users).where(real).groupBy(users.avatar);
  // the colour shows only on the hood (src/lib/roachSvg.ts)
  const colours = await db
    .select({ key: users.color, n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(real, eq(users.avatar, "hood")))
    .groupBy(users.color);
  const favourite = async (col: AnyPgColumn, keep: (name: string) => boolean) => {
    const rows = await db.execute<{ key: string; n: number }>(sql`
      select f as key, count(*)::int as n from ${users}, unnest(${col}) as f where ${users.demoKey} is null
      group by f order by n desc, f limit ${TOP * 2}`);
    return counts(rows.filter((r) => keep(r.key))).slice(0, TOP);
  };

  // the n-th account of those there are now, for each milestone reached
  const reached = MILESTONES.filter((m) => m <= who.players);
  const milestones = reached.length
    ? (
        await db.execute<{ n: number; at: string }>(sql`
          select rn::int as n, created_at as at from (
            select ${users.createdAt} as created_at, row_number() over (order by ${users.createdAt}, ${users.id}) as rn
            from ${users} where ${users.demoKey} is null) t
          where rn in (${sql.join(
            reached.map((m) => sql`${m}`),
            sql`, `,
          )}) order by rn`)
      ).map((r) => ({ n: num(r.n), at: new Date(r.at).getTime() }))
    : [];

  const [clones] = await db.execute<{ players: number; total: number; filled: number }>(sql`
    select count(*)::int as players, coalesce(sum(k), 0)::int as total, count(*) filter (where k >= ${MAX_CLONES})::int as filled
    from (select ${roaches.userId}, count(*) as k from ${roaches} where ${roaches.slot} > 0 group by 1) t`);

  const [pairs] = await db
    .select({ pairs: sql<number>`count(*)::int`.mapWith(Number), oldest: sql<string | null>`min(${friendships.createdAt})` })
    .from(friendships);
  const [ends] = await db.execute<{ with_some: number; most: number }>(sql`
    select count(*)::int as with_some, coalesce(max(k), 0)::int as most from (
      select u, count(*) as k from (select ${friendships.a} as u from ${friendships} union all select ${friendships.b} from ${friendships}) e
      group by u) t`);

  // a badge held only some days counts only while it is held, as the wall shows it
  const timed = BADGES.filter((b) => b.days);
  const held = timed.length
    ? sql`${userBadges.earnedAt} > case ${userBadges.badge} ${sql.join(
        timed.map((b) => sql`when ${b.id} then ${ts(now - b.days! * DAY)}`),
        sql` `,
      )} else '-infinity'::timestamptz end`
    : sql`true`;
  const badgeRows = await db
    .select({ key: userBadges.badge, n: sql<number>`count(*) filter (where ${held})::int` })
    .from(userBadges)
    .groupBy(userBadges.badge);
  const known = new Set(BADGES.map((b) => b.id));
  const badges = counts(badgeRows.filter((r) => known.has(r.key) && num(r.n) > 0));
  const holders = new Map(badges.map((b) => [b.key, b.n]));

  const [inn] = await db
    .select({
      stayed: sql<number>`count(distinct ${siTickets.inkNo}) filter (where ${siTickets.checkinAt} <= ${ts(now)} and (${siTickets.recalledAt} is null or ${siTickets.recalledAt} > ${siTickets.checkinAt}))::int`.mapWith(Number),
      queued: sql<number>`count(*) filter (where ${siTickets.checkinAt} > ${ts(now)} and ${siTickets.recalledAt} is null)::int`.mapWith(Number),
    })
    .from(siTickets);

  const kinds = await roachKinds(now);
  const where = placesOf(await mainSpots(now));

  // the record: the best of the last snapshot's and of every declaration since the day before it (all, the first time)
  const today = beijingDate(now);
  const [last] = await db
    .select({ day: statSnapshots.day, data: statSnapshots.data })
    .from(statSnapshots)
    .where(lt(statSnapshots.day, today))
    .orderBy(desc(statSnapshots.day))
    .limit(1);
  const since = last ? beijingMidnight(addDays(last.day, -1)) : beijingMidnight(OPEN_DAY);
  const fresh = await bestReach(since, beijingMidnight(today));
  const before = last?.data.reach ?? null;
  const reach = !before || (fresh && fresh.n > before.n) ? fresh : before;

  return {
    players: who.players,
    milestones,
    avatars: counts(looks.filter((r) => (ROACH_AVATARS as readonly string[]).includes(r.key))),
    colors: counts(colours.filter((r) => (ROACH_COLORS as readonly string[]).includes(r.key))),
    hood: who.hood,
    games: { arknights: who.arknights, endfield: who.endfield, both: who.both, none: who.players - who.arknights - who.endfield - who.both },
    clones: { players: num(clones?.players), all: num(clones?.total), full: num(clones?.filled), riders: kinds.riders },
    favourites: {
      arknights: await favourite(users.favArknights, (n) => isCharacter("arknights", n)),
      endfield: await favourite(users.favEndfield, (n) => isCharacter("endfield", n)),
      support: await favourite(users.support, (n) => isOperator("arknights", n)),
    },
    friendships: {
      pairs: pairs.pairs,
      withSome: num(ends?.with_some),
      most: num(ends?.most),
      oldestDays: pairs.oldest ? Math.floor((now - new Date(pairs.oldest).getTime()) / DAY) : null,
    },
    badges: { total: badges.reduce((s, b) => s + b.n, 0), by: badges },
    guides: {
      friends: Object.fromEntries(GUIDE_IDS.map((id) => [id, holders.get(GUIDE_BADGES[id]) ?? 0])) as Record<GuideId, number>,
      inksStayed: inn?.stayed ?? 0,
      inksQueued: inn?.queued ?? 0,
    },
    where,
    reach,
  };
}

/** Today's snapshot, written (again, should a restart take it twice) */
export async function takeSnapshot(now = Date.now()) {
  const data = await snapshotNow(now);
  const day = beijingDate(now);
  await db
    .insert(statSnapshots)
    .values({ day, at: new Date(now), data })
    .onConflictDoUpdate({ target: statSnapshots.day, set: { at: new Date(now), data } });
  return data;
}

/**
 * The main process, every few minutes: from 05:00 Beijing time, the backfill once ever (only before 06:00, when the
 * site is quietest), then the day's snapshot unless there is one. Says what it did.
 */
export async function morningStats(now = Date.now()) {
  const day = beijingDate(now);
  if (beijingDate(now - MORNING_HOUR * HOUR) !== day) return { backfilled: false, snapshot: false };
  const early = beijingDate(now - (MORNING_HOUR + 1) * HOUR) !== day;
  const filled = early ? await backfillStats(now) : false;
  const [had] = await db.select({ day: statSnapshots.day }).from(statSnapshots).where(eq(statSnapshots.day, day)).limit(1);
  if (had) return { backfilled: filled, snapshot: false };
  await takeSnapshot(now);
  return { backfilled: filled, snapshot: true };
}

// ---- the board's answer ----

/** The names whose every day the board draws or adds up */
const DAILY_NAMES = [
  COUNTED.sneaky,
  COUNTED.bold,
  COUNTED.decl,
  COUNTED.reply,
  COUNTED.main,
  COUNTED.clone,
  COUNTED.ink,
  COUNTED.signups,
  COUNTED.friendships,
  ...GUIDE_IDS.map(guideName),
];

/** The best day of a series, or null when there is none above 0 (the earlier of two equal) */
function best(days: DashDay[], of: (d: DashDay) => number | null): BestDay | null {
  let top: BestDay | null = null;
  for (const d of days) {
    const n = of(d) ?? 0;
    if (n > 0 && (!top || n > top.n)) top = { n, day: d.day };
  }
  return top;
}

/**
 * What the board shows (DashboardData), asked every minute while it is open: only small rows (the days' totals and
 * counters, the online hours, the latest snapshot), the map's copy in memory, and 这周的人's two reads as before.
 */
export async function dashboard(now = Date.now()): Promise<DashboardData> {
  const today = beijingDate(now);
  const yesterday = addDays(today, -1);
  const weekFrom = addDays(today, -7);
  const [totalRows, dailyRows, todayRows, weekRows, hourRows, dayPeaks, topHour, latest, online, filled, roachesNow, retention, desk] =
    await Promise.all([
      db.select().from(dailyTotals).where(gte(dailyTotals.day, OPEN_DAY)),
      db
        .select({ day: statCounts.day, name: statCounts.name, n: statCounts.n })
        .from(statCounts)
        .where(and(gte(statCounts.day, OPEN_DAY), inArray(statCounts.name, DAILY_NAMES))),
      db.select({ name: statCounts.name, n: statCounts.n }).from(statCounts).where(eq(statCounts.day, today)),
      db
        .select({ name: statCounts.name, n: sql<number>`sum(${statCounts.n})::bigint`.mapWith(Number) })
        .from(statCounts)
        .where(and(gte(statCounts.day, weekFrom), lt(statCounts.day, today)))
        .groupBy(statCounts.name),
      db.select().from(onlineHours).where(inArray(onlineHours.day, [today, yesterday])),
      db
        .select({ day: onlineHours.day, peak: sql<number>`max(${onlineHours.peak})::int`.mapWith(Number) })
        .from(onlineHours)
        .groupBy(onlineHours.day),
      db.select().from(onlineHours).orderBy(desc(onlineHours.peak), asc(onlineHours.peakAt)).limit(1),
      db.select().from(statSnapshots).orderBy(desc(statSnapshots.day)).limit(1),
      onlineSum(now),
      backfilled(),
      roachKinds(now),
      retentionStats(now),
      appCountDays(14, now),
    ]);

  const totals = new Map(totalRows.map((r) => [r.day, r]));
  const byDay = new Map<string, Map<string, number>>();
  for (const r of dailyRows) {
    let m = byDay.get(r.day);
    if (!m) byDay.set(r.day, (m = new Map()));
    m.set(r.name, num(r.n));
  }
  const peaks = new Map(dayPeaks.map((r) => [r.day, r.peak]));
  const firstVisitors = totalRows
    .filter((r) => r.visitors > 0)
    .map((r) => r.day)
    .sort()[0];
  const firstOnline = [...peaks.keys()].sort()[0];

  const days: DashDay[] = [];
  for (let day = OPEN_DAY; day <= today; day = addDays(day, 1)) {
    const t = totals.get(day);
    const c = byDay.get(day) ?? new Map<string, number>();
    const n = (name: string) => c.get(name) ?? 0;
    days.push({
      day,
      signups: t ? t.signups : n(COUNTED.signups),
      friendships: t ? t.friendships : n(COUNTED.friendships),
      players: t && t.players > 0 ? t.players : null,
      placed: n(COUNTED.main) + n(COUNTED.clone) + n(COUNTED.ink),
      sneaky: n(COUNTED.sneaky),
      bold: n(COUNTED.bold),
      decl: n(COUNTED.decl),
      replies: n(COUNTED.reply),
      visitors: firstVisitors && day >= firstVisitors ? (t?.visitors ?? 0) : null,
      peakOnline: firstOnline && day >= firstOnline ? (peaks.get(day) ?? 0) : null,
    });
  }
  // the days before the board kept the players: worked back from the first day it did, by each day's signups
  const known = days.findIndex((d) => d.players !== null);
  if (known > 0) {
    for (let i = known - 1; i >= 0; i--) days[i].players = Math.max(0, days[i + 1].players! - days[i + 1].signups);
  }

  const sum = (of: (d: DashDay) => number) => days.reduce((s, d) => s + of(d), 0);
  const guides = Object.fromEntries(
    GUIDE_IDS.map((id) => [id, [...byDay.values()].reduce((s, m) => s + (m.get(guideName(id)) ?? 0), 0)]),
  ) as Record<GuideId, number>;

  const hours = (day: string) => {
    const out: (number | null)[] = Array(24).fill(null);
    for (const r of hourRows) if (r.day === day) out[r.hour] = r.peak;
    return out;
  };
  const todayPeak = hourRows
    .filter((r) => r.day === today)
    .reduce<{ n: number; at: number } | null>((top, r) => (!top || r.peak > top.n ? { n: r.peak, at: r.peakAt.getTime() } : top), null);
  const snap = latest[0];
  const last = days[days.length - 1];

  return {
    asOf: now,
    backfilled: filled,
    since: { visitors: firstVisitors ?? null, online: firstOnline ?? null },
    totals: {
      players: last.players ?? snap?.data.players ?? 0,
      roaches: roachesNow,
      friendships: sum((d) => d.friendships),
      touches: { sneaky: sum((d) => d.sneaky), bold: sum((d) => d.bold) },
      decl: sum((d) => d.decl),
      replies: sum((d) => d.replies),
      guides,
    },
    today: {
      day: today,
      counts: Object.fromEntries(todayRows.map((r) => [r.name, num(r.n)])),
      online: firstOnline ? online : null,
      peak: todayPeak,
    },
    days,
    hours: { today: hours(today), yesterday: hours(yesterday) },
    week: { from: weekFrom, to: yesterday, counts: Object.fromEntries(weekRows.filter((r) => r.name !== COUNTED.backfilled).map((r) => [r.name, num(r.n)])) },
    snapshot: snap ? { ...snap.data, day: snap.day, at: snap.at.getTime() } : null,
    records: {
      online: topHour[0] ? { n: topHour[0].peak, at: topHour[0].peakAt.getTime() } : null,
      signups: best(days, (d) => d.signups),
      friendships: best(days, (d) => d.friendships),
      touches: best(days, (d) => d.sneaky + d.bold),
      placed: best(days, (d) => d.placed),
      reach: snap?.data.reach ?? null,
    },
    people: { retention, desk },
  };
}
