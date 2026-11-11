import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, countDistinct, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import { badgeById } from "../badges";
import { beijingDate, beijingMidnight } from "../beijing";
import { declarationText } from "../declarations";
import { serverName } from "../games";
import {
  BLOCKS_TO_REVIEW,
  BLOCKS_WINDOW_DAYS,
  RELIABLE_AFTER_DAYS,
  SUSPEND_DAYS,
  UNRELIABLE_DISMISSED_MIN,
  UNRELIABLE_DISMISSED_RATIO,
  YELLOW_DAYS,
} from "../rules";
import {
  ALL_REASONS,
  asReason,
  BATCH_ACTIONS,
  BLOCKS_LEVEL,
  CASE_LEVELS,
  CASES_PER_PAGE,
  FIND_PLAYERS_MAX,
  isRoachReportReason,
  isRuleCode,
  REPORT_LEVEL,
  REPORT_REASONS,
  ROACH_REPORT_REASONS,
  RULE_OF_REASON,
  URGENT_REASONS,
  type AdminAction,
  type AdminAppeal,
  type AdminCase,
  type AdminPerson,
  type AdminPlayer,
  type BanInfo,
  type CaseLevel,
  type CasePage,
  type CaseQuery,
  type FoundPlayers,
  type ReportCounts,
  type ReporterInfo,
  type RetentionStats,
  type RuleCode,
} from "../safety";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { DAY } from "../world/logic";
import { banAccount, banOf } from "./account";
import { award } from "./badges";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { nameJudgeNow } from "./nameWords";
import { roachByFeedId, roachesChanged } from "./roachFeed";
import { clearBoth, clearName, clearUid, releaseProfile, reliableReporter, ROACH_KEYS } from "./safety";
import {
  blocks,
  clearedValues,
  dailyTotals,
  declarations,
  friendships,
  modActions,
  reports,
  roaches,
  touches,
  userBadges,
  users,
  type UserRow,
} from "./schema";
import { addNotes, type NewNote } from "./staffNotes";
import { profileOf, removeRoach, storedDeclaration } from "./world";

/** The admin page's rules: who may open it, what it shows and the ways to settle a report. */

export const isAdmin = (u: UserRow | null) => Boolean(u?.email && ADMIN_EMAILS.includes(u.email));

const waitingAppeal = and(isNotNull(modActions.appealedAt), isNull(modActions.answeredAt));

/** Open reports (of players and roaches), how many of them are for URGENT_REASONS, and appeals waiting: the admin's corner of the map */
export async function reportCounts(): Promise<ReportCounts> {
  const [[row], [appeals]] = await Promise.all([
    db
      .select({
        open: count(),
        urgent: sql<number>`count(*) filter (where ${inArray(reports.reason, [...URGENT_REASONS])})`.mapWith(Number),
      })
      .from(reports)
      .where(isNull(reports.resolvedAt)),
    db.select({ n: count() }).from(modActions).where(waitingAppeal),
  ]);
  return { open: row.open, urgent: row.urgent, appeals: appeals.n };
}

/** What the map adds to an admin's me(); nothing for anyone else. */
export const adminCounts = async (u: UserRow | null) => (isAdmin(u) ? await reportCounts() : undefined);

const MS_DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The resolution each way of settling writes on the reports it closes */
const RESOLUTION: Record<Exclude<AdminAction, "ban">, string> = {
  dismiss: "dismissed",
  clearName: "name_cleared",
  clearUid: "uid_cleared",
  clearBoth: "both_cleared",
  warn: "warned",
  suspend: "suspended",
  ageCheck: "age_check",
  removeRoach: "roach_removed",
};

/** The ways of settling a roach's case */
const ROACH_ACTIONS: readonly AdminAction[] = ["dismiss", "warn", "removeRoach", "ban"];

/** Before mod_actions (2026-11), a case's settling was only on its reports: once per moment it was settled */
const LEGACY: Record<string, keyof AdminPerson["settled"]> = { dismissed: "dismissed", name_cleared: "nameCleared", uid_cleared: "uidCleared" };

/** Whether a case id names a roach's case rather than a player's */
const isRoachCase = (caseId: string) => caseId.startsWith("roach:") || caseId.startsWith("report:");

/** The case an open report is part of, as the queue's SQL (caseTable) works it out */
function caseOf(r: typeof reports.$inferSelect) {
  if (!isRoachReportReason(r.reason)) return r.targetId;
  return r.roachId ? `roach:${r.roachId}` : `report:${r.id}`;
}

/** The rule an action goes under unless the admin picks another: the name's or the UID's, else the case's most frequent reason's */
function autoRule(action: AdminAction | null, reasons: string[]): RuleCode {
  if (action === "clearName") return "name";
  if (action === "clearUid") return "contact";
  if (action === "ageCheck") return "age";
  const tally = new Map<RuleCode, number>();
  for (const r of reasons) {
    const rule = RULE_OF_REASON[asReason(r)];
    tally.set(rule, (tally.get(rule) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "harass";
}

const rank = (l: CaseLevel) => CASE_LEVELS.indexOf(l);
const reasonsOfLevel = (l: CaseLevel) => ALL_REASONS.filter((r) => REPORT_LEVEL[r] === l);

/**
 * Every case open now, worked out in SQL so the queue pages at any size: one per player with open reports
 * about them (or blocked by BLOCKS_TO_REVIEW different players lately, since the admin last looked), and
 * one per roach with open reports about it (per report once the roach is gone). For each: its most
 * pressing level (0 red, 1 yellow, 2 green), how many reporters and how many reliable ones (as
 * reliableReporter() has it), the oldest open report, whether it is only about a name, and its reasons.
 */
function caseTable(now: number) {
  const oldEnough = new Date(now - RELIABLE_AFTER_DAYS * MS_DAY).toISOString();
  const lately = new Date(now - BLOCKS_WINDOW_DAYS * MS_DAY).toISOString();
  const roachy = inArray(reports.reason, ROACH_KEYS);
  return sql`
    with r as (
      select
        case when ${roachy} then coalesce('roach:' || ${reports.roachId}::text, 'report:' || ${reports.id}::text)
          else ${reports.targetId}::text end as key,
        ${reports.targetId}::text as target,
        ${roachy} as roachy,
        ${reports.reporterId} as reporter,
        ${reports.reason} as reason,
        ${reports.createdAt} as at,
        case when ${inArray(reports.reason, reasonsOfLevel("red"))} then 0
          when ${inArray(reports.reason, reasonsOfLevel("yellow"))} then 1 else 2 end as lvl,
        coalesce(
          ${users.createdAt} <= ${oldEnough}::timestamptz
          and not (${users.reportsDismissed} >= ${UNRELIABLE_DISMISSED_MIN}::int
            and ${users.reportsDismissed} >= ${UNRELIABLE_DISMISSED_RATIO}::int * ${users.reportsUpheld}),
          false
        ) as reliable
      from ${reports} left join ${users} on ${users.id} = ${reports.reporterId}
      where ${reports.resolvedAt} is null
    ),
    many as (
      select ${blocks.blockedId}::text as target
      from ${blocks} join ${users} on ${users.id} = ${blocks.blockedId}
      where ${blocks.createdAt} > ${lately}::timestamptz
        and (${users.blocksReviewedAt} is null or ${blocks.createdAt} > ${users.blocksReviewedAt})
      group by ${blocks.blockedId}
      having count(distinct ${blocks.blockerId}) >= ${BLOCKS_TO_REVIEW}::int
    ),
    c as (
      select key, min(target) as target, bool_or(roachy) as roachy, min(lvl) as lvl,
        count(distinct reporter)::int as reporters,
        (count(distinct reporter) filter (where reliable))::int as reliable,
        min(at) as since,
        bool_and(reason = 'name') and not bool_or(roachy) as name_only,
        array_agg(distinct reason) as reasons
      from r group by key
      union all
      select target, target, false, ${rank(BLOCKS_LEVEL)}::int, 0, 0, null::timestamptz, false, '{}'::text[]
      from many where not exists (select 1 from r where r.key = many.target)
    )`;
}

/** The query's filters on caseTable's rows */
function caseFilter(q: CaseQuery): SQL {
  const parts: SQL[] = [];
  if (q.level && q.level !== "all" && CASE_LEVELS.includes(q.level)) parts.push(sql`lvl = ${rank(q.level)}::int`);
  if (q.reason === "blocks") parts.push(sql`cardinality(reasons) = 0`);
  else if (q.reason && q.reason !== "all" && ALL_REASONS.includes(q.reason)) parts.push(sql`${q.reason}::text = any(reasons)`);
  if (q.nameOnly) parts.push(sql`name_only`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/**
 * The info box of each of these players, read for all of them at once: who they are, what they wrote
 * about themselves, what they did in the last day, how cases about them went before. Never where their
 * roaches are or when they came by.
 */
async function people(ids: string[], now: number): Promise<Map<string, AdminPerson>> {
  if (!ids.length) return new Map();
  const dayAgo = new Date(now - MS_DAY);
  const lately = new Date(now - BLOCKS_WINDOW_DAYS * MS_DAY);
  const ranked = db
    .select({
      id: declarations.id,
      n: sql<number>`row_number() over (partition by ${declarations.senderId} order by ${declarations.createdAt} desc)`.as("n"),
    })
    .from(declarations)
    .where(inArray(declarations.senderId, ids))
    .as("ranked");
  const [rows, recent, declared, sent, slots, friendsA, friendsB, blockers, blockedLately, badges, actions, legacy] = await Promise.all([
    db.select().from(users).where(inArray(users.id, ids)),
    db
      .select({ d: declarations })
      .from(declarations)
      .innerJoin(ranked, eq(ranked.id, declarations.id))
      .where(lte(ranked.n, 5))
      .orderBy(desc(declarations.createdAt)),
    db
      .select({ id: declarations.senderId, n: count() })
      .from(declarations)
      .where(and(inArray(declarations.senderId, ids), gt(declarations.createdAt, dayAgo)))
      .groupBy(declarations.senderId),
    db
      .select({ id: touches.fromUserId, n: count() })
      .from(touches)
      .where(and(inArray(touches.fromUserId, ids), gt(touches.createdAt, dayAgo)))
      .groupBy(touches.fromUserId),
    db.select({ id: roaches.userId, slot: roaches.slot }).from(roaches).where(inArray(roaches.userId, ids)),
    db.select({ id: friendships.a, n: count() }).from(friendships).where(inArray(friendships.a, ids)).groupBy(friendships.a),
    db.select({ id: friendships.b, n: count() }).from(friendships).where(inArray(friendships.b, ids)).groupBy(friendships.b),
    db.select({ id: blocks.blockedId, n: count() }).from(blocks).where(inArray(blocks.blockedId, ids)).groupBy(blocks.blockedId),
    db
      .select({ id: blocks.blockedId, n: countDistinct(blocks.blockerId) })
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .where(
        and(
          inArray(blocks.blockedId, ids),
          gt(blocks.createdAt, lately),
          or(isNull(users.blocksReviewedAt), gt(blocks.createdAt, users.blocksReviewedAt)),
        ),
      )
      .groupBy(blocks.blockedId),
    db.select({ id: userBadges.userId, badge: userBadges.badge }).from(userBadges).where(inArray(userBadges.userId, ids)),
    db.select().from(modActions).where(inArray(modActions.userId, ids)),
    db
      .selectDistinct({ id: reports.targetId, resolution: reports.resolution, at: reports.resolvedAt })
      .from(reports)
      .where(and(inArray(reports.targetId, ids), isNotNull(reports.resolvedAt))),
  ]);
  const tally = (list: { id: string; n: number }[]) => new Map(list.map((x) => [x.id, x.n]));
  const declaredBy = tally(declared);
  const sentBy = tally(sent);
  const blockersOf = tally(blockers);
  const lateBlockersOf = tally(blockedLately);
  const friendsOf = (id: string) => (tally(friendsA).get(id) ?? 0) + (tally(friendsB).get(id) ?? 0);

  const out = new Map<string, AdminPerson>();
  for (const u of rows) {
    const theirActions = actions.filter((a) => a.userId === u.id);
    const firstAction = Math.min(...theirActions.map((a) => a.createdAt.getTime()));
    const settled = { dismissed: 0, nameCleared: 0, uidCleared: 0, warned: 0, suspended: 0, ageChecks: 0, roachesRemoved: 0 };
    for (const a of theirActions.filter((x) => !x.auto)) {
      if (a.action === "dismiss") settled.dismissed++;
      if (a.action === "clearName" || a.action === "clearBoth") settled.nameCleared++;
      if (a.action === "clearUid" || a.action === "clearBoth") settled.uidCleared++;
      if (a.action === "warn") settled.warned++;
      if (a.action === "suspend") settled.suspended++;
      if (a.action === "ageCheck") settled.ageChecks++;
      if (a.action === "removeRoach") settled.roachesRemoved++;
    }
    for (const l of legacy.filter((x) => x.id === u.id)) {
      if (!l.at || l.at.getTime() >= firstAction) continue;
      const kind = l.resolution ? LEGACY[l.resolution] : undefined;
      if (kind) settled[kind]++;
      if (l.resolution === "both_cleared") {
        settled.nameCleared++;
        settled.uidCleared++;
      }
    }
    const theirSlots = slots.filter((r) => r.id === u.id);
    const profile = profileOf(u);
    // while held, anonymous and shareUid are the hold's doing; the admin sees what the player had chosen
    const heldAt = u.profileHeldAt;
    out.set(u.id, {
      targetId: u.id,
      name: u.name,
      anonymous: heldAt ? (u.heldAnonymous ?? u.anonymous) : u.anonymous,
      heldAt: heldAt?.getTime() ?? null,
      drPrefix: u.drPrefix,
      avatar: ROACH_AVATARS.find((a) => a === u.avatar) ?? "hood",
      color: ROACH_COLORS.find((c) => c === u.color) ?? "cyan",
      joinedAt: u.createdAt.getTime(),
      email: u.email ?? "",
      games: profile.games.map((game) => ({
        game,
        uid: profile.uid[game],
        server: serverName(game, profile.uidServer[game]) ?? "",
        favourites: profile.favourites[game],
      })),
      shareUid: heldAt ? (u.heldShareUid ?? u.shareUid) : u.shareUid,
      support: profile.support,
      badges: badges.filter((b) => b.id === u.id).flatMap((b) => badgeById(b.badge)?.name ?? []),
      worn: (u.wornBadge && badgeById(u.wornBadge)?.name) || null,
      roaches: { main: theirSlots.some((r) => r.slot === 0), clones: theirSlots.filter((r) => r.slot > 0).length },
      friends: friendsOf(u.id),
      blockedBy: blockersOf.get(u.id) ?? 0,
      settled,
      yellow: theirActions.filter((a) => a.yellow && a.appealResult !== "reverted" && now - a.createdAt.getTime() < YELLOW_DAYS * MS_DAY).length,
      suspendedUntil: u.suspendedUntil && u.suspendedUntil.getTime() > now ? u.suspendedUntil.getTime() : null,
      suspendedAuto: Boolean(u.suspendedAuto && u.suspendedUntil && u.suspendedUntil.getTime() > now),
      ageCheckAt: u.ageCheckAt?.getTime() ?? null,
      ageConfirmedAt: u.ageConfirmedAt?.getTime() ?? null,
      blockedRecently: lateBlockersOf.get(u.id) ?? 0,
      last24h: { touches: sentBy.get(u.id) ?? 0, declarations: declaredBy.get(u.id) ?? 0 },
      declarations: recent
        .filter(({ d }) => d.senderId === u.id)
        .map(({ d }) => ({ text: declarationText(storedDeclaration(d)), at: d.createdAt.getTime() })),
    });
  }
  return out;
}

type CaseRow = { key: string; target: string; roachy: boolean; lvl: number; reporters: number; reliable: number; since: Date | string | null };

/**
 * A page of the admin's queue: red cases first, then yellow, then green; within a colour, the more
 * reliable reporters first, then the one waiting longest. The grouping and order are SQL's (caseTable);
 * only the page's cases are read in full, all at once. Never where a player's roaches are or when they
 * came by, nor who reported them; a roach's case shows only that roach's spot, which is public anyway.
 */
export async function openCases(query: CaseQuery = {}, now = Date.now()): Promise<CasePage> {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const filter = caseFilter(query);
  const table = caseTable(now);
  const [[sum], rows] = await Promise.all([
    db.execute<{ red: number; yellow: number; green: number; name_only: number; total: number }>(sql`${table}
      select (count(*) filter (where lvl = 0))::int as red, (count(*) filter (where lvl = 1))::int as yellow,
        (count(*) filter (where lvl = 2))::int as green, (count(*) filter (where name_only))::int as name_only,
        (count(*) filter (where ${filter}))::int as total
      from c`),
    db.execute<CaseRow>(sql`${table}
      select key, target, roachy, lvl, reporters, reliable, since from c where ${filter}
      order by lvl, reliable desc, since asc nulls last, key
      limit ${CASES_PER_PAGE}::int offset ${(page - 1) * CASES_PER_PAGE}::int`),
  ]);
  const summary = { cases: [] as AdminCase[], total: sum.total, levels: { red: sum.red, yellow: sum.yellow, green: sum.green }, nameOnly: sum.name_only, page };
  if (!rows.length) return summary;

  const targets = [...new Set(rows.map((r) => r.target))];
  const keys = new Set(rows.map((r) => r.key));
  const roachIds = rows.filter((r) => r.key.startsWith("roach:")).map((r) => r.key.slice("roach:".length));
  const [who, open, spots] = await Promise.all([
    people(targets, now),
    db
      .select()
      .from(reports)
      .where(and(isNull(reports.resolvedAt), inArray(reports.targetId, targets)))
      .orderBy(asc(reports.createdAt)),
    roachIds.length ? db.select({ id: roaches.id, lng: roaches.lng, lat: roaches.lat }).from(roaches).where(inArray(roaches.id, roachIds)) : [],
  ]);
  const inPage = open.filter((r) => keys.has(caseOf(r)));
  const reporterIds = [...new Set(inPage.flatMap((r) => (r.reporterId ? [r.reporterId] : [])))];
  const reporters = new Map(
    (reporterIds.length ? await db.select().from(users).where(inArray(users.id, reporterIds)) : []).map((u) => [u.id, u]),
  );
  const reporterOf = (id: string | null): ReporterInfo | null => {
    const r = id ? reporters.get(id) : undefined;
    if (!r) return null;
    return {
      days: Math.floor((now - r.createdAt.getTime()) / MS_DAY),
      upheld: r.reportsUpheld,
      dismissed: r.reportsDismissed,
      reliable: reliableReporter(r, now),
    };
  };

  summary.cases = rows.flatMap((row): AdminCase[] => {
    const person = who.get(row.target);
    if (!person) return [];
    const theirs = inPage.filter((r) => caseOf(r) === row.key);
    // two or more new accounts reporting within any hour: a pile-on, maybe
    const young = theirs.filter((r) => {
      const by = r.reporterId ? reporters.get(r.reporterId) : undefined;
      return by && r.createdAt.getTime() - by.createdAt.getTime() < RELIABLE_AFTER_DAYS * MS_DAY;
    });
    const brigade = young.some(
      (r) =>
        new Set(
          young
            .filter((x) => x.createdAt.getTime() >= r.createdAt.getTime() && x.createdAt.getTime() - r.createdAt.getTime() <= 60 * 60_000)
            .map((x) => x.reporterId),
        ).size >= 2,
    );
    const latest = theirs.at(-1);
    let roach: AdminCase["roach"];
    if (row.roachy && latest && latest.placeLng !== null && latest.placeLat !== null) {
      const current = spots.find((s) => s.id === latest.roachId);
      roach = {
        main: latest.roachSlot === 0,
        lng: latest.placeLng,
        lat: latest.placeLat,
        state: !current ? "gone" : current.lng !== latest.placeLng || current.lat !== latest.placeLat ? "moved" : "here",
      };
    }
    return [
      {
        ...person,
        kind: row.roachy ? "roach" : "person",
        caseId: row.key,
        level: CASE_LEVELS[row.lvl] ?? "green",
        reporters: row.reporters,
        reliable: row.reliable,
        brigade,
        rule: row.roachy ? "roach" : theirs.length ? autoRule(null, theirs.map((r) => r.reason)) : "harass",
        since: row.since ? new Date(row.since).getTime() : now,
        reports: theirs.map((r) => ({
          reason: asReason(r.reason),
          note: r.note,
          context: r.context,
          name: r.targetName,
          at: r.createdAt.getTime(),
          reporter: reporterOf(r.reporterId),
          ...(r.placeLng !== null && r.placeLat !== null ? { place: { lng: r.placeLng, lat: r.placeLat }, nearM: r.nearM } : {}),
        })),
        ...(roach ? { roach } : {}),
      },
    ];
  });
  return summary;
}

/** Count a case once to each of its reporters, upheld or dismissed, and tell each what came of their own earliest report in it */
async function tellReporters(tx: Pick<typeof db, "update" | "insert">, open: (typeof reports.$inferSelect)[], dismissed: boolean) {
  const first = new Map<string, (typeof open)[number]>();
  for (const r of open) if (r.reporterId && !first.has(r.reporterId)) first.set(r.reporterId, r);
  const reporterIds = [...first.keys()];
  if (reporterIds.length) {
    await tx
      .update(users)
      .set(dismissed ? { reportsDismissed: sql`${users.reportsDismissed} + 1` } : { reportsUpheld: sql`${users.reportsUpheld} + 1` })
      .where(inArray(users.id, reporterIds));
  }
  return [...first.values()].map(
    (r): NewNote => ({
      userId: r.reporterId!,
      kind: dismissed ? "reportDismissed" : "reportUpheld",
      reason: r.reason,
      reportedOn: beijingDate(r.createdAt.getTime()),
    }),
  );
}

/**
 * Settle a case in one of the admin's ways, all in one place: do it, keep it in mod_actions (never who
 * reported), close the case's reports, count it to each reporter once (upheld or dismissed, for telling
 * reliable reporters), and tell both sides (staffNotes.ts). A player's case and a roach's are settled
 * apart, so a reporter is never told of both at once and cannot tell whose roach it was. A ban deletes
 * the account, all its reports with it, and keeps why with the banned address.
 */
export async function settleCase(caseId: string, action: AdminAction, opts: { rule?: unknown } = {}, now = Date.now()) {
  const id = String(caseId);
  return isRoachCase(id) ? settleRoach(id, action, opts, now) : settlePerson(id, action, opts, now);
}

/**
 * A player's case: every open report about them but their roaches'. A suspension the reports made by
 * themselves is lifted first, then the admin's choice applies.
 */
async function settlePerson(targetId: string, action: AdminAction, opts: { rule?: unknown }, now: number) {
  const [u] = UUID.test(targetId) ? await db.select().from(users).where(eq(users.id, targetId)).limit(1) : [];
  if (!u) throw new HttpError(400, "这个账号已经不在了。");
  if (action !== "ban" && !Object.hasOwn(RESOLUTION, action)) throw new HttpError(400, "不知道要怎么处理。");
  if (action === "removeRoach") throw new HttpError(400, "移走蟑螂只用在地图上蟑螂的举报。");
  const open = await db
    .select()
    .from(reports)
    .where(and(eq(reports.targetId, u.id), isNull(reports.resolvedAt), notInArray(reports.reason, ROACH_KEYS)))
    .orderBy(asc(reports.createdAt));
  const rule = isRuleCode(opts.rule) ? opts.rule : autoRule(action, open.map((r) => r.reason));
  if (action === "ban") {
    if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
    await banAccount(u, rule);
    return;
  }
  const at = new Date(now);
  const autoSuspended = Boolean(u.suspendedAuto && u.suspendedUntil && u.suspendedUntil.getTime() > now);
  const wasHeld = Boolean(u.profileHeldAt);
  // known ahead, so what a clearing clears remembers it (for undoing it on appeal)
  const actionId = randomUUID();

  // 1. the action itself (clearing and letting out also end a hold)
  if (autoSuspended) await db.update(users).set({ suspendedUntil: null, suspendedAuto: false }).where(eq(users.id, u.id));
  const until = action === "suspend" ? new Date(now + SUSPEND_DAYS * MS_DAY) : null;
  if (action === "dismiss") await releaseProfile(u.id);
  else if (action === "clearName") await clearName(u.id, actionId);
  else if (action === "clearUid") await clearUid(u.id, actionId);
  else if (action === "clearBoth") await clearBoth(u.id, actionId);
  else if (action === "suspend") await db.update(users).set({ suspendedUntil: until, suspendedAuto: false }).where(eq(users.id, u.id));
  else if (action === "ageCheck") await db.update(users).set({ ageCheckAt: at }).where(eq(users.id, u.id));
  // the admin has looked at their being blocked by many, whatever was done
  await db.update(users).set({ blocksReviewedAt: at }).where(eq(users.id, u.id));

  await db.transaction(async (tx) => {
    // 2. the record
    await tx.insert(modActions).values({ id: actionId, userId: u.id, action, rule, yellow: action === "warn", until, createdAt: at });
    // 3. the reports
    if (open.length) {
      await tx
        .update(reports)
        .set({ resolvedAt: at, resolution: RESOLUTION[action] })
        .where(inArray(reports.id, open.map((r) => r.id)));
    }
    // 4. once to each reporter, and 5. both sides
    const notes = await tellReporters(tx, open, action === "dismiss");
    if (action === "warn" || action === "suspend" || action === "clearName" || action === "clearUid" || action === "clearBoth") {
      notes.push({ userId: u.id, kind: "action", actionId, rule, until });
    } else if (action === "dismiss") {
      if (wasHeld) notes.push({ userId: u.id, kind: "released" });
      if (autoSuspended) notes.push({ userId: u.id, kind: "unsuspended" });
    }
    await addNotes(notes, tx);
  });
  // a cleared or released name changes what others see
  roachesChanged();
}

/**
 * A roach's case (roach:<id>, or report:<id> once the roach is gone): nothing wrong, a warning, taking
 * it back (as its owner would: the main roach takes its clones with it; a yellow card), or a ban. Its
 * owner hears only of a warning or the roach taken back; a dismissal leaves them none the wiser.
 */
async function settleRoach(caseId: string, action: AdminAction, opts: { rule?: unknown }, now: number) {
  const [kind, id] = caseId.split(":");
  if (!UUID.test(id ?? "")) throw new HttpError(400, "找不到这个案子了。");
  if (!ROACH_ACTIONS.includes(action)) throw new HttpError(400, "蟑螂的举报只能：没问题、警告、移走这只蟑螂或者封号。");
  const open = await db
    .select()
    .from(reports)
    .where(and(isNull(reports.resolvedAt), inArray(reports.reason, ROACH_KEYS), kind === "roach" ? eq(reports.roachId, id) : eq(reports.id, id)))
    .orderBy(asc(reports.createdAt));
  if (!open.length) throw new HttpError(400, "这些举报已经处理过了。");
  const [u] = await db.select().from(users).where(eq(users.id, open[0].targetId)).limit(1);
  if (!u) throw new HttpError(400, "这个账号已经不在了。");
  const rule = isRuleCode(opts.rule) ? opts.rule : "roach";
  if (action === "ban") {
    if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
    await banAccount(u, rule);
    return;
  }
  let slot: number | null = null;
  if (action === "removeRoach") {
    const [roach] =
      kind === "roach"
        ? await db
            .select()
            .from(roaches)
            .where(and(eq(roaches.id, id), eq(roaches.userId, u.id)))
            .limit(1)
        : [];
    if (!roach) throw new HttpError(400, "这只蟑螂已经收回了。");
    slot = roach.slot;
    // the very code its owner's 收回 runs
    await removeRoach(u.id, roach.id);
  }
  const at = new Date(now);
  await db.transaction(async (tx) => {
    const [record] = await tx
      .insert(modActions)
      .values({ userId: u.id, action, rule, yellow: action !== "dismiss", roachSlot: slot, createdAt: at })
      .returning({ id: modActions.id });
    // by id: taking the roach back emptied their roach_id
    await tx
      .update(reports)
      .set({ resolvedAt: at, resolution: RESOLUTION[action] })
      .where(inArray(reports.id, open.map((r) => r.id)));
    const notes = await tellReporters(tx, open, action === "dismiss");
    if (action !== "dismiss") notes.push({ userId: u.id, kind: "action", actionId: record.id, rule });
    await addNotes(notes, tx);
  });
}

/** Several cases at once, each settled on its own; never a ban. A way that does not fit a case (清名字 on a roach) passes it by. */
export async function settleCases(caseIds: unknown, action: AdminAction) {
  if (!BATCH_ACTIONS.includes(action)) throw new HttpError(400, "这个处理不能批量做。");
  const ids = Array.isArray(caseIds) ? [...new Set(caseIds.map(String))].slice(0, 200) : [];
  let done = 0;
  for (const id of ids) {
    if (isRoachCase(id) && !ROACH_ACTIONS.includes(action)) continue;
    try {
      await settleCase(id, action);
      done++;
    } catch (e) {
      // settled meanwhile (another tab), or gone: the rest still go
      if (!(e instanceof HttpError)) throw e;
    }
  }
  return done;
}

/** Names 名字黑名单 clears at once, at most */
export const CLEAR_NAMES_MAX = 500;

/**
 * 名字黑名单's 清掉: names the list blocks now, cleared the way a case's 清名字 clears one (the account is
 * anonymous, its 「我是…」 declarations lose the name, and it cannot take the name again), under the rule on
 * names, with a 站长通知 that says so and lets them appeal. No yellow card, and reports about them stay open
 * for the queue. Left alone: a name changed meanwhile to one the list lets through, and one held while a
 * report waits (clearing would end the hold on the UIDs too; the case settles it). Returns how many.
 */
export async function clearBlockedNames(ids: unknown, now = Date.now()) {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))].filter((id) => UUID.test(id)).slice(0, CLEAR_NAMES_MAX) : [];
  if (!list.length) return 0;
  const judge = await nameJudgeNow();
  const named = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, list), isNull(users.demoKey), isNull(users.profileHeldAt)));
  let cleared = 0;
  for (const u of named) {
    if (!u.name.trim() || !judge(u.name)) continue;
    const actionId = randomUUID();
    await clearName(u.id, actionId);
    await db.transaction(async (tx) => {
      await tx.insert(modActions).values({ id: actionId, userId: u.id, action: "clearName", rule: "name", createdAt: new Date(now) });
      await addNotes([{ userId: u.id, kind: "action", actionId, rule: "name" }], tx);
    });
    cleared++;
  }
  if (cleared) roachesChanged();
  return cleared;
}

/** 申诉: appeals waiting for the admin, the oldest first, each with the player's info box as it is now */
export async function openAppeals(now = Date.now()): Promise<AdminAppeal[]> {
  const rows = await db.select().from(modActions).where(waitingAppeal).orderBy(asc(modActions.appealedAt)).limit(100);
  const who = await people([...new Set(rows.map((a) => a.userId))], now);
  return rows.flatMap((a): AdminAppeal[] => {
    const person = who.get(a.userId);
    if (!person || !a.appealedAt) return [];
    return [
      {
        actionId: a.id,
        action: a.action as AdminAction,
        rule: isRuleCode(a.rule) ? a.rule : null,
        at: a.createdAt.getTime(),
        until: a.until?.getTime() ?? null,
        main: a.roachSlot === 0,
        appeal: a.appeal ?? "",
        appealedAt: a.appealedAt.getTime(),
        who: person,
      },
    ];
  });
}

/**
 * The admin's answer to an appeal: keep the action, or undo it as far as it can be: a yellow card
 * (a warning, a roach taken back) stops counting, a pause still on ends, what a clearing cleared may be
 * taken again (the old name itself is gone: the player fills it in again), an age question goes. The
 * player is told either way.
 */
export async function answerAppeal(actionId: unknown, keep: boolean, now = Date.now()) {
  const id = String(actionId);
  if (!UUID.test(id)) throw new HttpError(400, "找不到这条申诉了。");
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(modActions).where(eq(modActions.id, id)).for("update");
    if (!a?.appealedAt) throw new HttpError(400, "找不到这条申诉了。");
    if (a.answeredAt) throw new HttpError(400, "这条申诉已经处理过了。");
    if (!keep) {
      if (a.action === "suspend" && a.until) {
        // only this pause: a later one of its own stays
        await tx
          .update(users)
          .set({ suspendedUntil: null, suspendedAuto: false })
          .where(and(eq(users.id, a.userId), eq(users.suspendedUntil, a.until)));
      }
      if (a.action === "clearName" || a.action === "clearUid" || a.action === "clearBoth") {
        await tx.delete(clearedValues).where(and(eq(clearedValues.userId, a.userId), eq(clearedValues.actionId, a.id)));
      }
      if (a.action === "ageCheck") await tx.update(users).set({ ageCheckAt: null }).where(eq(users.id, a.userId));
    }
    await tx
      .update(modActions)
      .set({ appealResult: keep ? "kept" : "reverted", answeredAt: new Date(now) })
      .where(eq(modActions.id, a.id));
    await addNotes([{ userId: a.userId, kind: keep ? "appealKept" : "appealReverted", actionId: a.id }], tx);
  });
}

/** Hand out 内测功臣, or take any badge back (from someone gaming them), by the player's login email. */
export async function setBadge(email: string, badge: string, give: boolean) {
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.email, String(email).trim().toLowerCase()))
    .limit(1);
  if (!u) throw new HttpError(400, "没有用这个邮箱登录的账号。");
  if (!badgeById(badge)) throw new HttpError(400, "没有这个称号。");
  if (give) {
    if (badge !== "beta") throw new HttpError(400, "这个称号只能自己拿，不能发。");
    if (!(await award(u.id, [badge])).length) throw new HttpError(400, "TA 已经有这个称号了。");
    return;
  }
  const gone = await db
    .delete(userBadges)
    .where(and(eq(userBadges.userId, u.id), eq(userBadges.badge, badge)))
    .returning({ badge: userBadges.badge });
  if (!gone.length) throw new HttpError(400, "TA 没有这个称号。");
  if (u.wornBadge === badge) await db.update(users).set({ wornBadge: null }).where(eq(users.id, u.id));
}

const playerOf = (u: Pick<UserRow, "id" | "email" | "name" | "anonymous" | "createdAt">): AdminPlayer => ({
  id: u.id,
  email: u.email ?? "",
  name: u.name,
  anonymous: u.anonymous,
  joinedAt: u.createdAt.getTime(),
});

/** In a LIKE pattern, what stands for itself */
const literal = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * 所有玩家, searched: real accounts whose login email or name contains q, or whose id starts with it,
 * newest first, at most FIND_PLAYERS_MAX of them, and how many matched. Nothing without a q.
 */
export async function findPlayers(q: unknown): Promise<FoundPlayers> {
  const needle = String(q ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 100);
  if (!needle) return { players: [], total: 0 };
  const like = literal(needle);
  const match = and(
    isNull(users.demoKey),
    or(ilike(users.email, `%${like}%`), ilike(users.name, `%${like}%`), sql`${users.id}::text like ${`${like}%`}`),
  );
  const columns = { id: users.id, email: users.email, name: users.name, anonymous: users.anonymous, createdAt: users.createdAt };
  const [rows, [n]] = await Promise.all([
    db.select(columns).from(users).where(match).orderBy(desc(users.createdAt)).limit(FIND_PLAYERS_MAX),
    db.select({ n: count() }).from(users).where(match),
  ]);
  return { players: rows.map(playerOf), total: n.n };
}

/** 查邮箱: whether this mailbox was banned, however it is written, when and why; and the accounts signed in with this very address */
export async function banInfo(email: unknown): Promise<BanInfo> {
  const given = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(given)) throw new HttpError(400, "输入一个完整的邮箱。");
  const [banned, rows] = await Promise.all([
    banOf(given),
    db
      .select({ id: users.id, email: users.email, name: users.name, anonymous: users.anonymous, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.email, given)),
  ]);
  return { banned, accounts: rows.map(playerOf) };
}

/** This week against the last, from visit days and the nightly totals. */
export async function retentionStats(now = Date.now()): Promise<RetentionStats> {
  const daysAgo = (n: number) => beijingDate(now - n * DAY);
  const real = isNull(users.demoKey);
  const thisWeek = gte(users.lastSeenOn, daysAgo(6));
  const [active] = await db.select({ n: count() }).from(users).where(and(real, thisWeek));
  const [before] = await db.select({ n: dailyTotals.activeWeek }).from(dailyTotals).where(eq(dailyTotals.day, daysAgo(7)));
  const joinedLastWeek = and(
    real,
    gte(users.createdAt, new Date(beijingMidnight(daysAgo(13)))),
    lt(users.createdAt, new Date(beijingMidnight(daysAgo(6)))),
  );
  const [signups] = await db.select({ n: count() }).from(users).where(joinedLastWeek);
  const [back] = await db.select({ n: count() }).from(users).where(and(joinedLastWeek, thisWeek));
  const [friends] = await db
    .select({ n: count() })
    .from(friendships)
    .where(gte(friendships.createdAt, new Date(beijingMidnight(daysAgo(6)))));
  return {
    activeWeek: active.n,
    activeWeekBefore: before?.n ?? null,
    lastWeekSignups: signups.n,
    lastWeekSignupsBack: back.n,
    friendshipsWeek: friends.n,
  };
}

// ---- 站长清理: taking roaches back straight from the map ----

/** A roach near a point, for the admin's 「收回附近一片」 */
export type NearRoach = { id: string; slot: number; ownerId: string; meters: number };

/** How far 「收回附近一片」 may reach, and how many roaches one cleaning takes back at most */
const NEAR_MAX_M = 3000;
const TAKE_BACK_MAX = 300;

/**
 * The roaches within radiusM of a point (the map's own coordinates), the nearest first and at most
 * TAKE_BACK_MAX, never the admin's own: what 「收回附近一片」 would take back, shown before it does.
 */
export async function roachesNear(adminId: string, lng: unknown, lat: unknown, radiusM: unknown): Promise<NearRoach[]> {
  const x = Number(lng);
  const y = Number(lat);
  const r = Math.min(Math.max(Math.round(Number(radiusM) || 0), 1), NEAR_MAX_M);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90) throw new HttpError(400, "位置不对。");
  const point = sql`ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326)::geography`;
  const meters = sql<number>`ST_Distance(${roaches.geog}, ${point})`.mapWith(Number);
  const rows = await db
    .select({ id: roaches.publicId, slot: roaches.slot, ownerId: roaches.userId, meters })
    .from(roaches)
    .where(and(sql`ST_DWithin(${roaches.geog}, ${point}, ${r})`, sql`${roaches.userId} <> ${adminId}`))
    .orderBy(meters)
    .limit(TAKE_BACK_MAX);
  return rows.map((row) => ({ ...row, meters: Math.round(row.meters) }));
}

/**
 * 站长收回: take these roaches back (the map's ids) as their owners would, a main roach with its clones,
 * and give each owner one yellow card and one 站长通知 for the rule (roach: 摆成字或图案、贴着别人放…),
 * however many of theirs went. Never the admin's own. Returns how many roaches went, of how many players.
 */
export async function takeBackRoaches(adminId: string, ids: unknown, rule: unknown, now = Date.now()) {
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))].slice(0, TAKE_BACK_MAX) : [];
  const code = isRuleCode(rule) ? rule : "roach";
  const whole = list.filter((id) => UUID.test(id));
  const found = whole.length ? await db.select().from(roaches).where(inArray(roaches.publicId, whole)) : [];
  for (const id of list.filter((id) => !UUID.test(id))) {
    const r = await roachByFeedId(id);
    if (r) found.push(r);
  }
  const byOwner = new Map<string, (typeof found)[number][]>();
  for (const r of found) if (r.userId !== adminId) byOwner.set(r.userId, [...(byOwner.get(r.userId) ?? []), r]);

  let gone = 0;
  let players = 0;
  for (const [userId, theirs] of byOwner) {
    const [before] = await db.select({ n: count() }).from(roaches).where(eq(roaches.userId, userId));
    // the main roach takes its clones with it, as when its owner takes it back
    const main = theirs.find((r) => r.slot === 0);
    for (const r of main ? [main] : theirs) {
      try {
        await removeRoach(userId, r.id);
      } catch {
        // taken back meanwhile, by its owner or another tab
      }
    }
    const [after] = await db.select({ n: count() }).from(roaches).where(eq(roaches.userId, userId));
    if (after.n >= before.n) continue;
    gone += before.n - after.n;
    players++;
    const at = new Date(now);
    await db.transaction(async (tx) => {
      const [record] = await tx
        .insert(modActions)
        .values({ userId, action: "removeRoach", rule: code, yellow: true, roachSlot: Math.min(...theirs.map((r) => r.slot)), createdAt: at })
        .returning({ id: modActions.id });
      await addNotes([{ userId, kind: "action", actionId: record.id, rule: code }], tx);
    });
  }
  return { roaches: gone, players };
}

/** A roach of a player with open reports, for the admin's map: where, main or clone, whose and why */
export type ReportedRoach = { id: string; lng: number; lat: number; main: boolean; owner: string; reasons: string[] };

/** How many reported players' roaches the admin's map marks at most */
const REPORTED_MAX = 3000;

/**
 * 站长地图: every roach of the players with open reports (any reason, a roach of theirs reported
 * included), each with its owner's name as the admin sees it and the reasons reported. Breeze asked for
 * it (2026-11-11): the one place the admin sees where someone's roaches are, only while reports are open.
 */
export async function reportedRoaches(): Promise<ReportedRoach[]> {
  const open = await db.select({ targetId: reports.targetId, reason: reports.reason }).from(reports).where(isNull(reports.resolvedAt));
  const why = new Map<string, Set<string>>();
  for (const r of open) why.set(r.targetId, (why.get(r.targetId) ?? new Set()).add(r.reason));
  if (!why.size) return [];
  const label = (reason: string) =>
    (REPORT_REASONS as Record<string, string>)[reason] ?? (ROACH_REPORT_REASONS as Record<string, string>)[reason] ?? reason;
  const rows = await db
    .select({ id: roaches.publicId, lng: roaches.lng, lat: roaches.lat, slot: roaches.slot, userId: roaches.userId, name: users.name, anonymous: users.anonymous })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    .where(inArray(roaches.userId, [...why.keys()]))
    .limit(REPORTED_MAX);
  return rows.map((r) => ({
    id: r.id,
    lng: r.lng,
    lat: r.lat,
    main: r.slot === 0,
    owner: r.name ? `${r.name}${r.anonymous ? "（匿名）" : ""}` : "（没有名字）",
    reasons: [...(why.get(r.userId) ?? [])].map(label),
  }));
}

