import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, countDistinct, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import {
  ACCOUNT_ACTIONS,
  maskEmail,
  MOD_UNDO_HOURS,
  OWNER_ALIAS,
  ROACH_REASON_SHORT,
  UNDOABLE,
  type AdminAccount,
  type AdminAccountReport,
  type AdminHistoryItem,
  type AdminLogFilter,
  type AdminLogPage,
  type AdminNote,
  type AdminRole,
  type DoneToday,
  type FoundAccounts,
  type ReportedPlace,
  type ReportedRoachAll,
} from "../adminConsole";
import { badgeById } from "../badges";
import { beijingDate, beijingMidnight } from "../beijing";
import { declarationText } from "../declarations";
import { serverName } from "../games";
import {
  BLOCKS_TO_REVIEW,
  BLOCKS_WINDOW_DAYS,
  KEEP_REPORT_DAYS,
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
  RULES,
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
  type RoachReportReason,
  type RuleCode,
} from "../safety";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { DAY } from "../world/logic";
import { banAccount, banOf } from "./account";
import { logAdmin, staffRoles, type Actor } from "./admins";
import { award } from "./badges";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { nameJudgeNow } from "./nameWords";
import { roachByFeedId, roachesChanged } from "./roachFeed";
import { clearBoth, clearName, clearUid, releaseProfile, reliableReporter, ROACH_KEYS } from "./safety";
import {
  adminLog,
  adminNotes,
  adminRequests,
  admins,
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
  type ModActionRow,
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
const MS_HOUR = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who is looking (or doing), for what the 管理台 shows them: the owner sees everything; a moderator nothing about
 * anyone who may come into the 管理台 (staffRoles), no case they reported, only their own 操作记录, and may undo only
 * their own steps of the last MOD_UNDO_HOURS. Nobody given (the server's own steps, the tests) sees what the owner does.
 */
export type Viewer = Pick<Actor, "id" | "role">;
const isMod = (v: Viewer | null | undefined): v is Viewer => v?.role === "mod";

/** What a moderator is answered when they would ban: only the owner bans, so they ask for it (adminRequests.ts) */
export const MOD_NO_BAN = "封号要站长确认，请用「提请封号」。";
/** What a moderator is answered about an account they reported (and whose report is still open) */
export const THEIR_OWN_REPORT = "你举报过 TA，这件交给站长或别的管理员。";

/** Whether this account is kept from the one doing something: a moderator, and the account someone of the 管理台's */
async function hiddenFrom(by: Viewer | null | undefined, userId: string) {
  return isMod(by) && (await staffRoles()).has(userId);
}

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

/** Each way of settling (and lifting a pause) in the 管理台's words */
const ACTION_WORDS: Record<AdminAction | "unsuspend", string> = {
  dismiss: "没问题",
  clearName: "清掉名字",
  clearUid: "清掉 UID",
  clearBoth: "名字和 UID 都清掉",
  warn: "警告",
  suspend: `暂停互动 ${SUSPEND_DAYS} 天`,
  ageCheck: "请 TA 确认年龄",
  removeRoach: "收回蟑螂",
  ban: "封号",
  unsuspend: "解除暂停",
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

/** A yellow card that counts: within YELLOW_DAYS, and neither undone on appeal nor in the 管理台 */
const countsYellow = (a: Pick<ModActionRow, "yellow" | "appealResult" | "undoneAt" | "createdAt">, now: number) =>
  a.yellow && a.appealResult !== "reverted" && !a.undoneAt && now - a.createdAt.getTime() < YELLOW_DAYS * MS_DAY;

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
  if (typeof q.caseId === "string") parts.push(sql`key = ${q.caseId}`);
  return parts.length ? sql.join(parts, sql` and `) : sql`true`;
}

/**
 * The info box of each of these players, read for all of them at once: who they are, what they wrote
 * about themselves, what they did in the last day, how cases about them went before. Never where their
 * roaches are or when they came by.
 */
async function people(ids: string[], now: number, staff?: Map<string, AdminRole>): Promise<Map<string, AdminPerson>> {
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
  const [rows, recent, declared, sent, slots, friendsA, friendsB, blockers, blockedLately, badges, actions, legacy, roles] = await Promise.all([
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
    staff ?? staffRoles(),
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
    // what was undone in the 管理台 counts no more
    for (const a of theirActions.filter((x) => !x.auto && !x.undoneAt)) {
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
      yellow: theirActions.filter((a) => countsYellow(a, now)).length,
      suspendedUntil: u.suspendedUntil && u.suspendedUntil.getTime() > now ? u.suspendedUntil.getTime() : null,
      suspendedAuto: Boolean(u.suspendedAuto && u.suspendedUntil && u.suspendedUntil.getTime() > now),
      ageCheckAt: u.ageCheckAt?.getTime() ?? null,
      ageConfirmedAt: u.ageConfirmedAt?.getTime() ?? null,
      blockedRecently: lateBlockersOf.get(u.id) ?? 0,
      last24h: { touches: sentBy.get(u.id) ?? 0, declarations: declaredBy.get(u.id) ?? 0 },
      declarations: recent
        .filter(({ d }) => d.senderId === u.id)
        .map(({ d }) => ({ text: declarationText(storedDeclaration(d)), at: d.createdAt.getTime() })),
      staff: roles.get(u.id) ?? null,
    });
  }
  return out;
}

/** The info boxes of these players (people), for the 管理台's other parts */
export const peopleOf = (ids: string[], now = Date.now()) => people(ids, now);

/**
 * caseTable's cases this viewer sees: a moderator none about the 管理台's people, none they reported, and none about
 * an account whose ban was asked for and waits for the owner (handed over: the owner sees them, and the request)
 */
function casesSeenBy(viewer: Viewer | null | undefined, staff: Map<string, AdminRole>): SQL {
  if (!isMod(viewer)) return sql`true`;
  return sql`${notInArray(sql`target`, [...staff.keys()])}
    and not exists (select 1 from r where r.key = c.key and r.reporter = ${viewer.id}::uuid)
    and not exists (select 1 from ${adminRequests} where ${adminRequests.userId}::text = target and ${adminRequests.answeredAt} is null)`;
}

type CaseRow = { key: string; target: string; roachy: boolean; lvl: number; reporters: number; reliable: number; since: Date | string | null };

/** How a reporter's reports went before, for the 管理台: never who they are */
const reporterInfo = (r: UserRow, now: number): ReporterInfo => ({
  days: Math.floor((now - r.createdAt.getTime()) / MS_DAY),
  upheld: r.reportsUpheld,
  dismissed: r.reportsDismissed,
  reliable: reliableReporter(r, now),
});

/** Where a roach reported is now against where it was at the latest report: still there, moved since, or gone */
const roachState = (current: { lng: number; lat: number } | undefined, was: { lng: number; lat: number }) =>
  !current ? ("gone" as const) : current.lng !== was.lng || current.lat !== was.lat ? ("moved" as const) : ("here" as const);

/** A player's name as the 管理台 shows it */
const ownerName = (u: { name: string; anonymous: boolean } | undefined) => (u?.name ? `${u.name}${u.anonymous ? "（匿名）" : ""}` : "（没有名字）");

/**
 * A page of the admin's queue: red cases first, then yellow, then green; within a colour, the more
 * reliable reporters first, then the one waiting longest. The grouping and order are SQL's (caseTable);
 * only the page's cases are read in full, all at once. Never where a player's roaches are or when they
 * came by, nor who reported them; a roach's case shows only that roach's spot, which is public anyway.
 */
export async function openCases(query: CaseQuery = {}, now = Date.now(), viewer: Viewer | null = null): Promise<CasePage> {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const filter = caseFilter(query);
  const table = caseTable(now);
  const staff = await staffRoles();
  const seen = casesSeenBy(viewer, staff);
  const [[sum], rows] = await Promise.all([
    db.execute<{ red: number; yellow: number; green: number; name_only: number; total: number }>(sql`${table}
      select (count(*) filter (where lvl = 0))::int as red, (count(*) filter (where lvl = 1))::int as yellow,
        (count(*) filter (where lvl = 2))::int as green, (count(*) filter (where name_only))::int as name_only,
        (count(*) filter (where ${filter}))::int as total
      from c where ${seen}`),
    db.execute<CaseRow>(sql`${table}
      select key, target, roachy, lvl, reporters, reliable, since from c where ${seen} and ${filter}
      order by lvl, reliable desc, since asc nulls last, key
      limit ${CASES_PER_PAGE}::int offset ${(page - 1) * CASES_PER_PAGE}::int`),
  ]);
  const summary = { cases: [] as AdminCase[], total: sum.total, levels: { red: sum.red, yellow: sum.yellow, green: sum.green }, nameOnly: sum.name_only, page };
  if (!rows.length) return summary;

  const targets = [...new Set(rows.map((r) => r.target))];
  const keys = new Set(rows.map((r) => r.key));
  const roachIds = rows.filter((r) => r.key.startsWith("roach:")).map((r) => r.key.slice("roach:".length));
  const [who, open, spots] = await Promise.all([
    people(targets, now, staff),
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
    return r ? reporterInfo(r, now) : null;
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
        state: roachState(current, { lng: latest.placeLng, lat: latest.placeLat }),
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
export async function settleCase(caseId: string, action: AdminAction, opts: SettleOptions = {}, now = Date.now()): Promise<Settled> {
  const id = String(caseId);
  if (action === "ban" && isMod(opts.by)) throw new HttpError(403, MOD_NO_BAN);
  const done = await (isRoachCase(id) ? settleRoach(id, action, opts, now) : settlePerson(id, action, opts, now));
  if (opts.by) {
    const detail = done.action === "dismiss" ? `没问题，关掉了 ${done.closed} 条举报` : `违反：${RULES[done.rule]}`;
    await logAdmin(opts.by, "act", `act.${done.action}`, { targetId: done.targetId, actionId: done.actionId, detail }, now);
  }
  return done;
}

/** How a case is settled: under which rule (else the one its reports point to), and by whom in the 管理台 (kept, and logged) */
export type SettleOptions = { rule?: unknown; by?: Actor | null };

/** What settling did: whose account, the action's record (none for a ban), the rule, and how many reports it closed */
export type Settled = { targetId: string; actionId: string | null; action: AdminAction; rule: RuleCode; closed: number };

/** Who did it, as mod_actions keeps it; nobody for the reports' own steps */
const byColumns = (by: Actor | null | undefined) => ({ byUserId: by?.id ?? null, byAlias: by?.alias ?? null });

/**
 * A player's case: every open report about them but their roaches'. A suspension the reports made by
 * themselves is lifted first, then the admin's choice applies.
 */
async function settlePerson(targetId: string, action: AdminAction, opts: SettleOptions, now: number): Promise<Settled> {
  const [u] = UUID.test(targetId) ? await db.select().from(users).where(eq(users.id, targetId)).limit(1) : [];
  if (!u || (await hiddenFrom(opts.by, u.id))) throw new HttpError(400, "这个账号已经不在了。");
  if (action !== "ban" && !Object.hasOwn(RESOLUTION, action)) throw new HttpError(400, "不知道要怎么处理。");
  if (action === "removeRoach") throw new HttpError(400, "移走蟑螂只用在地图上蟑螂的举报。");
  const open = await db
    .select()
    .from(reports)
    .where(and(eq(reports.targetId, u.id), isNull(reports.resolvedAt), notInArray(reports.reason, ROACH_KEYS)))
    .orderBy(asc(reports.createdAt));
  if (isMod(opts.by) && open.some((r) => r.reporterId === opts.by!.id)) throw new HttpError(403, THEIR_OWN_REPORT);
  const rule = isRuleCode(opts.rule) ? opts.rule : autoRule(action, open.map((r) => r.reason));
  if (action === "ban") {
    if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
    await banAccount(u, rule);
    return { targetId: u.id, actionId: null, action, rule, closed: open.length };
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
    await tx.insert(modActions).values({ id: actionId, userId: u.id, action, rule, yellow: action === "warn", until, createdAt: at, ...byColumns(opts.by) });
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
  return { targetId: u.id, actionId, action, rule, closed: open.length };
}

/**
 * A roach's case (roach:<id>, or report:<id> once the roach is gone): nothing wrong, a warning, taking
 * it back (as its owner would: the main roach takes its clones with it; a yellow card), or a ban. Its
 * owner hears only of a warning or the roach taken back; a dismissal leaves them none the wiser.
 */
async function settleRoach(caseId: string, action: AdminAction, opts: SettleOptions, now: number): Promise<Settled> {
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
  if (await hiddenFrom(opts.by, u.id)) throw new HttpError(400, "找不到这个案子了。");
  if (isMod(opts.by) && open.some((r) => r.reporterId === opts.by!.id)) throw new HttpError(403, THEIR_OWN_REPORT);
  const rule = isRuleCode(opts.rule) ? opts.rule : "roach";
  if (action === "ban") {
    if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
    await banAccount(u, rule);
    return { targetId: u.id, actionId: null, action, rule, closed: open.length };
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
  const actionId = await db.transaction(async (tx) => {
    const [record] = await tx
      .insert(modActions)
      .values({ userId: u.id, action, rule, yellow: action !== "dismiss", roachSlot: slot, createdAt: at, ...byColumns(opts.by) })
      .returning({ id: modActions.id });
    // by id: taking the roach back emptied their roach_id
    await tx
      .update(reports)
      .set({ resolvedAt: at, resolution: RESOLUTION[action] })
      .where(inArray(reports.id, open.map((r) => r.id)));
    const notes = await tellReporters(tx, open, action === "dismiss");
    if (action !== "dismiss") notes.push({ userId: u.id, kind: "action", actionId: record.id, rule });
    await addNotes(notes, tx);
    return record.id;
  });
  return { targetId: u.id, actionId, action, rule, closed: open.length };
}

/** Several cases at once, each settled on its own; never a ban. A way that does not fit a case (清名字 on a roach) passes it by. */
export async function settleCases(caseIds: unknown, action: AdminAction, by: Actor | null = null) {
  if (!BATCH_ACTIONS.includes(action)) throw new HttpError(400, "这个处理不能批量做。");
  const ids = Array.isArray(caseIds) ? [...new Set(caseIds.map(String))].slice(0, 200) : [];
  let done = 0;
  for (const id of ids) {
    if (isRoachCase(id) && !ROACH_ACTIONS.includes(action)) continue;
    try {
      await settleCase(id, action, { by });
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
export async function clearBlockedNames(ids: unknown, now = Date.now(), by: Actor | null = null) {
  let list = Array.isArray(ids) ? [...new Set(ids.map(String))].filter((id) => UUID.test(id)).slice(0, CLEAR_NAMES_MAX) : [];
  if (isMod(by)) {
    const staff = await staffRoles();
    list = list.filter((id) => !staff.has(id));
  }
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
      await tx.insert(modActions).values({ id: actionId, userId: u.id, action: "clearName", rule: "name", createdAt: new Date(now), ...byColumns(by) });
      await addNotes([{ userId: u.id, kind: "action", actionId, rule: "name" }], tx);
    });
    if (by) await logAdmin(by, "act", "act.clearName", { targetId: u.id, actionId, detail: `名字黑名单命中，违反：${RULES.name}` }, now);
    cleared++;
  }
  if (cleared) roachesChanged();
  return cleared;
}

/**
 * 申诉: appeals waiting for the admin, the oldest first, each with the player's info box as it is now. A moderator
 * sees none from the 管理台's people, and those against their own steps only to read (mine).
 */
export async function openAppeals(now = Date.now(), viewer: Viewer | null = null): Promise<AdminAppeal[]> {
  const rows = await db.select().from(modActions).where(waitingAppeal).orderBy(asc(modActions.appealedAt)).limit(100);
  const staff = await staffRoles();
  const shown = isMod(viewer) ? rows.filter((a) => !staff.has(a.userId)) : rows;
  const who = await people([...new Set(shown.map((a) => a.userId))], now, staff);
  return shown.flatMap((a): AdminAppeal[] => {
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
        by: a.byAlias ?? OWNER_ALIAS,
        mine: isMod(viewer) && a.byUserId === viewer.id,
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
export async function answerAppeal(actionId: unknown, keep: boolean, now = Date.now(), by: Actor | null = null) {
  const id = String(actionId);
  if (!UUID.test(id)) throw new HttpError(400, "找不到这条申诉了。");
  const a = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(modActions).where(eq(modActions.id, id)).for("update");
    if (!a?.appealedAt || (await hiddenFrom(by, a.userId))) throw new HttpError(400, "找不到这条申诉了。");
    if (isMod(by) && a.byUserId === by.id) throw new HttpError(403, "这件是你处理的，交给站长或别的管理员。");
    if (a.answeredAt) throw new HttpError(400, "这条申诉已经处理过了。");
    if (!keep) await revertAction(tx, a);
    await tx
      .update(modActions)
      .set({ appealResult: keep ? "kept" : "reverted", answeredAt: new Date(now) })
      .where(eq(modActions.id, a.id));
    await addNotes([{ userId: a.userId, kind: keep ? "appealKept" : "appealReverted", actionId: a.id }], tx);
    return a;
  });
  if (by) {
    const detail = `${keep ? "维持" : "撤销"}「${ACTION_WORDS[a.action as AdminAction] ?? a.action}」`;
    await logAdmin(by, "act", keep ? "act.appealKept" : "act.appealReverted", { targetId: a.userId, actionId: a.id, detail }, now);
  }
}

/**
 * Undo an action as far as it can be, on appeal or in the 管理台: a yellow card (a warning, a roach taken back)
 * stops counting by the action's being marked so, a pause still on ends (only this one: a later one of its own
 * stays), what a clearing cleared may be taken again (the old name itself is gone: the player fills it in again),
 * an age question goes.
 */
async function revertAction(tx: Pick<typeof db, "update" | "delete">, a: ModActionRow) {
  if (a.action === "suspend" && a.until) {
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

/** Hand out 内测功臣, or take any badge back (from someone gaming them), by the player's login email. */
export async function setBadge(email: string, badge: string, give: boolean, by: Actor | null = null) {
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
    if (by) await logAdmin(by, "act", "act.badge", { targetId: u.id, detail: `发了称号「${badgeById(badge)?.name ?? badge}」` });
    return;
  }
  const gone = await db
    .delete(userBadges)
    .where(and(eq(userBadges.userId, u.id), eq(userBadges.badge, badge)))
    .returning({ badge: userBadges.badge });
  if (!gone.length) throw new HttpError(400, "TA 没有这个称号。");
  if (u.wornBadge === badge) await db.update(users).set({ wornBadge: null }).where(eq(users.id, u.id));
  if (by) await logAdmin(by, "act", "act.badge", { targetId: u.id, detail: `收回了称号「${badgeById(badge)?.name ?? badge}」` });
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

/** A search as typed: trimmed, lower case, at most 100 characters */
const searchNeedle = (q: unknown) =>
  String(q ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 100);

/**
 * Real accounts whose login email or name contains the needle, whose id starts with it, or whose game UID is it or
 * starts with it (spaces left out). byEmail false: not by email (a moderator's search).
 */
function playersMatching(needle: string, byEmail = true) {
  const like = literal(needle);
  const uid = literal(needle.replace(/\s/g, ""));
  return and(
    isNull(users.demoKey),
    or(
      ...(byEmail ? [ilike(users.email, `%${like}%`)] : []),
      ilike(users.name, `%${like}%`),
      sql`${users.id}::text like ${`${like}%`}`,
      ...(uid ? [sql`${users.uidArknights} like ${`${uid}%`}`, sql`${users.uidEndfield} like ${`${uid}%`}`] : []),
    ),
  );
}

/**
 * 所有玩家, searched: real accounts whose login email or name contains q, whose id starts with it, or whose game
 * UID is it or starts with it, newest first, at most FIND_PLAYERS_MAX of them, and how many matched. Nothing
 * without a q.
 */
export async function findPlayers(q: unknown): Promise<FoundPlayers> {
  const needle = searchNeedle(q);
  if (!needle) return { players: [], total: 0 };
  const match = playersMatching(needle);
  const columns = { id: users.id, email: users.email, name: users.name, anonymous: users.anonymous, createdAt: users.createdAt };
  const [rows, [n]] = await Promise.all([
    db.select(columns).from(users).where(match).orderBy(desc(users.createdAt)).limit(FIND_PLAYERS_MAX),
    db.select({ n: count() }).from(users).where(match),
  ]);
  return { players: rows.map(playerOf), total: n.n };
}

/** Per account, the cases about them waiting in 待处理 (a roach's case for each roach, as the queue counts them) */
async function openCaseCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const roachy = inArray(reports.reason, ROACH_KEYS);
  const rows = await db
    .select({
      id: reports.targetId,
      n: sql<number>`count(distinct case when ${roachy} then coalesce('roach:' || ${reports.roachId}::text, 'report:' || ${reports.id}::text) else 'person' end)`.mapWith(
        Number,
      ),
    })
    .from(reports)
    .where(and(isNull(reports.resolvedAt), inArray(reports.targetId, ids)))
    .groupBy(reports.targetId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/**
 * 搜索账号: findPlayers' accounts, each with what the list marks beside them: paused till when, yellow cards that
 * count, cases waiting, a name and UIDs held, someone of the 管理台. A moderator searches by name, id and UID only
 * (not by email), and finds none of the 管理台's people. plainSearch: whether every account found has the search in
 * its name or at the start of its id, so the 操作记录 may keep what was searched (an email or a UID it masks).
 */
export async function findAccounts(q: unknown, now = Date.now(), viewer: Viewer | null = null): Promise<FoundAccounts & { plainSearch: boolean }> {
  const needle = searchNeedle(q);
  if (!needle) return { players: [], total: 0, plainSearch: true };
  const staff = await staffRoles();
  const match = isMod(viewer) ? and(playersMatching(needle, false), notInArray(users.id, [...staff.keys()])) : playersMatching(needle);
  const [rows, [n]] = await Promise.all([
    db.select().from(users).where(match).orderBy(desc(users.createdAt)).limit(FIND_PLAYERS_MAX),
    db.select({ n: count() }).from(users).where(match),
  ]);
  const ids = rows.map((u) => u.id);
  const [cases, yellows] = await Promise.all([
    openCaseCounts(ids),
    ids.length
      ? db.select().from(modActions).where(and(inArray(modActions.userId, ids), eq(modActions.yellow, true), gt(modActions.createdAt, new Date(now - YELLOW_DAYS * MS_DAY))))
      : [],
  ]);
  const players = rows.map((u) => ({
    ...playerOf(u),
    suspendedUntil: u.suspendedUntil && u.suspendedUntil.getTime() > now ? u.suspendedUntil.getTime() : null,
    yellow: yellows.filter((a) => a.userId === u.id && countsYellow(a, now)).length,
    open: cases.get(u.id) ?? 0,
    held: Boolean(u.profileHeldAt),
    staff: staff.get(u.id) ?? null,
  }));
  const plainSearch = !needle.includes("@") && !/^\d+$/.test(needle.replace(/\s/g, "")) && rows.every((u) => u.name.toLowerCase().includes(needle) || u.id.startsWith(needle));
  return { players, total: n.n, plainSearch };
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
export async function takeBackRoaches(adminId: string, ids: unknown, rule: unknown, now = Date.now(), by: Actor | null = null) {
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
    const actionId = await db.transaction(async (tx) => {
      const [record] = await tx
        .insert(modActions)
        .values({ userId, action: "removeRoach", rule: code, yellow: true, roachSlot: Math.min(...theirs.map((r) => r.slot)), createdAt: at, ...byColumns(by) })
        .returning({ id: modActions.id });
      await addNotes([{ userId, kind: "action", actionId: record.id, rule: code }], tx);
      return record.id;
    });
    if (by) await logAdmin(by, "act", "act.takeBack", { targetId: userId, actionId, detail: `在地图上收回了 ${before.n - after.n} 只，违反：${RULES[code]}` }, now);
  }
  return { roaches: gone, players };
}

/** A roach of a player with open reports, for the owner's map: where, main or clone, whose and why, and its case */
export type ReportedRoach = ReportedRoachAll;

/** How many reported players' roaches the owner's map marks at most, and how many roach cases it lists */
const REPORTED_MAX = 3000;
const PLACES_MAX = 500;

/** Reasons in a few words, the most frequent first: 「名字不合适 ×2、骚扰刷屏」 */
function reasonsWords(tally: Map<string, number>) {
  return [...tally]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => {
      const words = isRoachReportReason(reason) ? ROACH_REASON_SHORT[reason] : ((REPORT_REASONS as Record<string, string>)[reason] ?? REPORT_REASONS.other);
      return n > 1 ? `${words} ×${n}` : words;
    })
    .join("、");
}

const tallyOf = (reasons: string[]) => {
  const tally = new Map<string, number>();
  for (const r of reasons) tally.set(r, (tally.get(r) ?? 0) + 1);
  return tally;
};

/**
 * 站长地图's 「被举报的人的全部蟑螂」 (the owner only): every roach of the players with open reports (any reason, a
 * roach of theirs reported included), each with its owner's name as the 管理台 shows it, the reasons reported, the
 * case to settle it in and why it is marked. Breeze asked for it (2026-11-11): the one place the owner sees where
 * someone's roaches are, only while reports are open, only to judge whether it was on purpose.
 */
export async function reportedRoaches(): Promise<ReportedRoach[]> {
  const open = await db
    .select({ id: reports.id, targetId: reports.targetId, reason: reports.reason, roachId: reports.roachId, roachSlot: reports.roachSlot, at: reports.createdAt })
    .from(reports)
    .where(isNull(reports.resolvedAt))
    .orderBy(asc(reports.createdAt));
  if (!open.length) return [];
  const why = new Map<string, Set<string>>();
  // per owner: the reports about them, and about each of their roaches (by roach, or by report once it is gone)
  const aboutOwner = new Map<string, string[]>();
  const aboutRoach = new Map<string, { key: string; slot: number | null; reasons: string[] }[]>();
  for (const r of open) {
    why.set(r.targetId, (why.get(r.targetId) ?? new Set()).add(r.reason));
    if (!isRoachReportReason(r.reason)) {
      aboutOwner.set(r.targetId, [...(aboutOwner.get(r.targetId) ?? []), r.reason]);
      continue;
    }
    const key = r.roachId ? `roach:${r.roachId}` : `report:${r.id}`;
    const cases = aboutRoach.get(r.targetId) ?? [];
    const c = cases.find((x) => x.key === key);
    if (c) c.reasons.push(r.reason);
    else cases.push({ key, slot: r.roachSlot, reasons: [r.reason] });
    aboutRoach.set(r.targetId, cases);
  }
  const label = (reason: string) =>
    (REPORT_REASONS as Record<string, string>)[reason] ?? (ROACH_REPORT_REASONS as Record<string, string>)[reason] ?? reason;
  const rows = await db
    .select({ id: roaches.id, publicId: roaches.publicId, lng: roaches.lng, lat: roaches.lat, slot: roaches.slot, userId: roaches.userId, name: users.name, anonymous: users.anonymous })
    .from(roaches)
    .innerJoin(users, eq(users.id, roaches.userId))
    .where(inArray(roaches.userId, [...why.keys()]))
    .limit(REPORTED_MAX);
  return rows.map((r) => {
    const own = aboutRoach.get(r.userId)?.find((c) => c.key === `roach:${r.id}`);
    const person = aboutOwner.get(r.userId);
    const sibling = aboutRoach.get(r.userId)?.find((c) => c.key !== `roach:${r.id}`);
    let caseId: string;
    let words: string;
    let about: ReportedRoach["about"];
    if (own) {
      [caseId, words, about] = [own.key, reasonsWords(tallyOf(own.reasons)), "self"];
    } else if (person?.length) {
      [caseId, words, about] = [r.userId, reasonsWords(tallyOf(person)), "owner"];
    } else {
      const other = sibling!;
      const which = other.slot === 0 ? "本体" : r.slot === 0 ? "一只克隆体" : "另一只克隆体";
      [caseId, words, about] = [other.key, `它的${which}被举报：${reasonsWords(tallyOf(other.reasons))}`, "sibling"];
    }
    return {
      caseId,
      id: r.publicId,
      lng: r.lng,
      lat: r.lat,
      main: r.slot === 0,
      owner: ownerName(r),
      reasons: [...(why.get(r.userId) ?? [])].map(label),
      why: words,
      about,
    };
  });
}

/**
 * 站长地图's 「位置被举报的」: the roach cases open for where a roach was put (stalk, place, pattern), the one waiting
 * longest first, at most PLACES_MAX: their reporters as 待处理 counts them (the same SQL), where the roach is now
 * and where it was at the latest report. Never who reported, nor where the reporter's roaches are: for 「一直贴着
 * 我放」 only how far it was from the nearest of them.
 */
export async function reportedPlaces(now = Date.now(), viewer: Viewer | null = null): Promise<ReportedPlace[]> {
  const seen = casesSeenBy(viewer, isMod(viewer) ? await staffRoles() : new Map());
  const rows = await db.execute<CaseRow>(sql`${caseTable(now)}
    select key, target, roachy, lvl, reporters, reliable, since from c where roachy and ${seen}
    order by since asc nulls last, key limit ${PLACES_MAX}::int`);
  if (!rows.length) return [];
  const keys = new Set(rows.map((r) => r.key));
  const targets = [...new Set(rows.map((r) => r.target))];
  const open = (
    await db
      .select()
      .from(reports)
      .where(and(isNull(reports.resolvedAt), inArray(reports.reason, ROACH_KEYS), inArray(reports.targetId, targets)))
      .orderBy(asc(reports.createdAt))
  ).filter((r) => keys.has(caseOf(r)));
  const roachIds = [...new Set(open.flatMap((r) => (r.roachId ? [r.roachId] : [])))];
  const [owners, spots] = await Promise.all([
    db.select({ id: users.id, name: users.name, anonymous: users.anonymous }).from(users).where(inArray(users.id, targets)),
    roachIds.length ? db.select({ id: roaches.id, publicId: roaches.publicId, lng: roaches.lng, lat: roaches.lat }).from(roaches).where(inArray(roaches.id, roachIds)) : [],
  ]);
  return rows.flatMap((row): ReportedPlace[] => {
    const theirs = open.filter((r) => caseOf(r) === row.key);
    const latest = theirs.at(-1);
    if (!latest || latest.placeLng === null || latest.placeLat === null) return [];
    const was = { lng: latest.placeLng, lat: latest.placeLat };
    const current = latest.roachId ? spots.find((x) => x.id === latest.roachId) : undefined;
    const stalk = theirs.filter((r) => r.reason === "stalk").at(-1);
    return [
      {
        caseId: row.key,
        id: current?.publicId ?? null,
        main: latest.roachSlot === 0,
        owner: ownerName(owners.find((o) => o.id === row.target)),
        now: current ? { lng: current.lng, lat: current.lat } : null,
        was,
        state: roachState(current, was),
        reasons: [...tallyOf(theirs.map((r) => r.reason))].map(([reason, n]) => ({ reason: reason as RoachReportReason, n })),
        reporters: row.reporters,
        reliable: row.reliable,
        since: row.since ? new Date(row.since).getTime() : now,
        nearM: stalk ? stalk.nearM : null,
      },
    ];
  });
}

// ---- 管理台: one account, its history, undoing, notes and the log ----

/** How many of each list an account's page shows at most */
const ACCOUNT_LIST_MAX = 200;
/** A note's length, in characters (emoji as one) */
export const NOTE_MAX = 500;

/**
 * Whether this viewer may still undo an action: one the 管理台 took, of a kind that can be given back, not undone
 * already; for a moderator, only one of their own, within MOD_UNDO_HOURS
 */
const canUndo = (a: ModActionRow, viewer: Viewer | null | undefined, now: number) =>
  !a.auto &&
  UNDOABLE.includes(a.action) &&
  !a.undoneAt &&
  a.appealResult !== "reverted" &&
  (!isMod(viewer) || (a.byUserId === viewer.id && now - a.createdAt.getTime() < MOD_UNDO_HOURS * MS_HOUR));

function historyItem(a: ModActionRow, viewer: Viewer | null | undefined, now: number): AdminHistoryItem {
  return {
    actionId: a.id,
    action: a.action as AdminHistoryItem["action"],
    rule: isRuleCode(a.rule) ? a.rule : null,
    // before there were others, the owner did everything
    by: a.auto ? null : (a.byAlias ?? OWNER_ALIAS),
    auto: a.auto,
    at: a.createdAt.getTime(),
    until: a.until?.getTime() ?? null,
    main: a.roachSlot === 0,
    appeal: a.appealedAt
      ? { text: a.appeal ?? "", at: a.appealedAt.getTime(), result: a.appealResult === "kept" || a.appealResult === "reverted" ? a.appealResult : null }
      : null,
    undoneAt: a.undoneAt?.getTime() ?? null,
    canUndo: canUndo(a, viewer, now),
  };
}

const accountGone = () => new HttpError(404, "这个账号已经不在了。");

/**
 * Everything the 管理台 shows of one account, reported or not: the info box of a case, what was cleared from it,
 * its declarations of the last 7 days (without where from), every report about it kept (never who made one), the
 * reports it made, what was done about it, and the notes on it. Never where its roaches are or when it came by.
 */
export async function account(id: unknown, now = Date.now(), viewer: Viewer | null = null): Promise<AdminAccount> {
  const userId = String(id ?? "");
  if (!UUID.test(userId)) throw accountGone();
  const staff = await staffRoles();
  if (isMod(viewer) && staff.has(userId)) throw accountGone();
  const [[u], who] = await Promise.all([db.select().from(users).where(eq(users.id, userId)).limit(1), people([userId], now, staff)]);
  const person = who.get(userId);
  if (!u || !person) throw accountGone();
  const [cleared, decls, about, [made], history, notes, cases, [asked]] = await Promise.all([
    db.select().from(clearedValues).where(eq(clearedValues.userId, userId)).orderBy(desc(clearedValues.createdAt)),
    db
      .select()
      .from(declarations)
      .where(and(eq(declarations.senderId, userId), gt(declarations.createdAt, new Date(now - 7 * MS_DAY))))
      .orderBy(desc(declarations.createdAt))
      .limit(ACCOUNT_LIST_MAX),
    db
      .select()
      .from(reports)
      .where(and(eq(reports.targetId, userId), or(isNull(reports.resolvedAt), gt(reports.createdAt, new Date(now - KEEP_REPORT_DAYS * MS_DAY)))))
      .orderBy(desc(reports.createdAt))
      .limit(ACCOUNT_LIST_MAX),
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.reporterId, userId), isNull(reports.resolvedAt))),
    db.select().from(modActions).where(eq(modActions.userId, userId)).orderBy(desc(modActions.createdAt)).limit(ACCOUNT_LIST_MAX),
    db.select().from(adminNotes).where(eq(adminNotes.userId, userId)).orderBy(desc(adminNotes.createdAt)).limit(ACCOUNT_LIST_MAX),
    openCaseCounts([userId]),
    db
      .select()
      .from(adminRequests)
      .where(and(eq(adminRequests.userId, userId), isNull(adminRequests.answeredAt)))
      .limit(1),
  ]);
  const reporterIds = [...new Set(about.flatMap((r) => (r.reporterId ? [r.reporterId] : [])))];
  const reporters = new Map((reporterIds.length ? await db.select().from(users).where(inArray(users.id, reporterIds)) : []).map((r) => [r.id, r]));
  // settling closes a case's reports at the moment its action is kept: that tells who settled each
  const settledAt = new Map(history.map((a) => [a.createdAt.getTime(), a]));
  return {
    person,
    cleared: cleared.map((c) => ({ kind: c.kind === "uid" ? "uid" : "name", value: c.value, at: c.createdAt.getTime() })),
    last24: person.last24h,
    declarations: decls.map((d) => ({ text: declarationText(storedDeclaration(d)), at: d.createdAt.getTime() })),
    reports: about.map((r): AdminAccountReport => {
      const reporter = r.reporterId ? reporters.get(r.reporterId) : undefined;
      const settled = r.resolvedAt ? settledAt.get(r.resolvedAt.getTime()) : undefined;
      return {
        reason: asReason(r.reason),
        note: r.note,
        at: r.createdAt.getTime(),
        reporter: reporter ? reporterInfo(reporter, now) : null,
        roach: isRoachReportReason(r.reason) ? { main: r.roachSlot === 0 } : null,
        resolvedAt: r.resolvedAt?.getTime() ?? null,
        resolution: r.resolution,
        by: settled && !settled.auto ? (settled.byAlias ?? OWNER_ALIAS) : null,
      };
    }),
    reportsMade: { upheld: u.reportsUpheld, dismissed: u.reportsDismissed, open: made.n, reliable: reliableReporter(u, now) },
    history: history.map((a) => historyItem(a, viewer, now)),
    notes: notes.map((n): AdminNote => ({ id: n.id, by: n.byAlias, text: n.text, at: n.createdAt.getTime() })),
    openCases: cases.get(userId) ?? 0,
    banRequest: asked
      ? {
          id: asked.id,
          by: asked.byAlias,
          mine: Boolean(viewer && asked.byUserId === viewer.id),
          rule: isRuleCode(asked.rule) ? asked.rule : "harass",
          reason: asked.reason,
          at: asked.createdAt.getTime(),
        }
      : null,
  };
}

/**
 * 搜到以后直接处理: an action on any account, reported or not, under a rule the 管理台 must pick (the player's
 * 站长通知 names it). As settling their case in 待处理, so the reports about them close with it. The new line of its
 * 处理记录 (none for a ban, which deletes the account).
 */
export async function actOnAccount(id: unknown, action: unknown, rule: unknown, by: Actor, now = Date.now()): Promise<AdminHistoryItem | null> {
  const userId = String(id ?? "");
  if (!UUID.test(userId)) throw accountGone();
  if (!ACCOUNT_ACTIONS.includes(action as AdminAction)) throw new HttpError(400, "不知道要怎么处理。");
  if (!isRuleCode(rule)) throw new HttpError(400, "先选一条 TA 违反的规则。");
  if (await hiddenFrom(by, userId)) throw accountGone();
  const done = await settleCase(userId, action as AdminAction, { rule, by }, now);
  if (!done.actionId) return null;
  const [a] = await db.select().from(modActions).where(eq(modActions.id, done.actionId)).limit(1);
  return a ? historyItem(a, by, now) : null;
}

/** 解除暂停: the player's interactions back now, whoever paused them, with the 站长通知 that says so */
export async function unsuspendAccount(id: unknown, by: Actor, now = Date.now()): Promise<AdminHistoryItem> {
  const userId = String(id ?? "");
  const [u] = UUID.test(userId) ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [];
  if (!u || (await hiddenFrom(by, u.id))) throw accountGone();
  if (!u.suspendedUntil || u.suspendedUntil.getTime() <= now) throw new HttpError(400, "TA 现在没有被暂停。");
  const a = await db.transaction(async (tx) => {
    await tx.update(users).set({ suspendedUntil: null, suspendedAuto: false }).where(eq(users.id, u.id));
    const [a] = await tx
      .insert(modActions)
      .values({ userId: u.id, action: "unsuspend", createdAt: new Date(now), ...byColumns(by) })
      .returning();
    await addNotes([{ userId: u.id, kind: "unsuspended" }], tx);
    return a;
  });
  await logAdmin(by, "act", "act.unsuspend", { targetId: u.id, actionId: a.id, detail: ACTION_WORDS.unsuspend }, now);
  return historyItem(a, by, now);
}

/**
 * 撤销, after the page's own 5 seconds: what the action did given back (revertAction), and it counts no more. An
 * action waiting on an appeal is as if the appeal won; otherwise the player is told it was undone. A dismissal, a
 * roach taken back and a ban cannot be undone. A moderator undoes only their own, within MOD_UNDO_HOURS.
 */
export async function undoAction(actionId: unknown, by: Actor, now = Date.now()): Promise<AdminHistoryItem> {
  const id = String(actionId ?? "");
  if (!UUID.test(id)) throw new HttpError(400, "找不到这次处理了。");
  const at = new Date(now);
  const a = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(modActions).where(eq(modActions.id, id)).for("update");
    if (!a) throw new HttpError(400, "找不到这次处理了。");
    if (a.undoneAt || a.appealResult === "reverted") throw new HttpError(400, "这次处理已经撤销了。");
    if (a.auto || !UNDOABLE.includes(a.action)) throw new HttpError(400, "这种处理撤销不了。");
    if (!canUndo(a, by, now)) throw new HttpError(403, `只能撤销你自己 ${MOD_UNDO_HOURS} 小时内做的处理。`);
    await revertAction(tx, a);
    const appealing = Boolean(a.appealedAt && !a.answeredAt);
    const changed = { undoneAt: at, ...(appealing ? { appealResult: "reverted", answeredAt: at } : {}) };
    await tx.update(modActions).set(changed).where(eq(modActions.id, a.id));
    await addNotes([{ userId: a.userId, kind: appealing ? "appealReverted" : "undone", actionId: a.id }], tx);
    await tx
      .update(adminLog)
      .set({ undoneAt: at })
      .where(and(eq(adminLog.actionId, a.id), isNull(adminLog.undoneAt)));
    return { ...a, ...changed };
  });
  await logAdmin(by, "act", "act.undo", { targetId: a.userId, actionId: a.id, detail: `撤销了「${ACTION_WORDS[a.action as AdminAction] ?? a.action}」` }, now);
  return historyItem(a, by, now);
}

/** 备注 on an account, the newest first */
export async function accountNotes(id: unknown, viewer: Viewer | null = null): Promise<AdminNote[]> {
  const userId = String(id ?? "");
  if (!UUID.test(userId) || (await hiddenFrom(viewer, userId))) throw accountGone();
  const rows = await db.select().from(adminNotes).where(eq(adminNotes.userId, userId)).orderBy(desc(adminNotes.createdAt)).limit(ACCOUNT_LIST_MAX);
  return rows.map((n) => ({ id: n.id, by: n.byAlias, text: n.text, at: n.createdAt.getTime() }));
}

/** 加备注: 1 to NOTE_MAX characters, which the player never sees */
export async function addNote(id: unknown, text: unknown, by: Actor, now = Date.now()): Promise<AdminNote> {
  const userId = String(id ?? "");
  const said = String(text ?? "").trim();
  const length = [...said].length;
  if (!length) throw new HttpError(400, "备注不能是空的。");
  if (length > NOTE_MAX) throw new HttpError(400, `备注最多 ${NOTE_MAX} 个字。`);
  const [u] = UUID.test(userId) ? await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1) : [];
  if (!u || (await hiddenFrom(by, u.id))) throw accountGone();
  const [n] = await db.insert(adminNotes).values({ userId, byUserId: by.id, byAlias: by.alias, text: said, createdAt: new Date(now) }).returning();
  await logAdmin(by, "act", "act.note", { targetId: userId, detail: "加了一条备注" }, now);
  return { id: n.id, by: n.byAlias, text: n.text, at: n.createdAt.getTime() };
}

/**
 * What was done in the 管理台 today (Beijing time), by whom: the viewer first, then the most. A moderator sees only
 * their own. Things done are the 操作记录's 处理 (act) lines, as its 今天处理 counts them.
 */
export async function doneToday(viewer: Viewer, now = Date.now()): Promise<DoneToday[]> {
  const rows = await db
    .select({ id: adminLog.actorId, alias: sql<string>`max(${adminLog.actorAlias})`, n: count() })
    .from(adminLog)
    .where(
      and(
        gte(adminLog.at, new Date(beijingMidnight(beijingDate(now)))),
        eq(adminLog.kind, "act"),
        isMod(viewer) ? eq(adminLog.actorId, viewer.id) : undefined,
      ),
    )
    .groupBy(adminLog.actorId);
  return rows
    .map((r) => ({ alias: r.alias, you: r.id === viewer.id, n: r.n }))
    .sort((a, b) => Number(b.you) - Number(a.you) || b.n - a.n);
}

/** Steps taken on the site rather than on an account: 知道了, the name blocklist, 禁放区 and 全站变灰 */
const SITE_ACTS = new Set(["act.ack", "act.nameWords", "act.zone", "act.zoneLift", "act.gray", "act.grayEnd"]);
/** Lines of the log that are always about one account, so one without an account now was about one since gone */
const aboutAnAccount = (what: string) => (what.startsWith("act.") && !SITE_ACTS.has(what)) || what === "view.account";

const LOG_KINDS: Record<Exclude<AdminLogFilter, "all">, string[]> = { act: ["act"], look: ["view", "search"], gate: ["gate"], admin: ["admin"] };

/**
 * 操作记录, a page at a time, the newest first: by kind, by who, before a line (its id). Each line with the account
 * it was about as it is now, whether what it did may still be undone, and for a ban asked for what the owner
 * answered. Today's numbers on top (Beijing time). A moderator gets only their own lines, and their own numbers;
 * the owner also everyone they may pick to see the lines of.
 */
export async function adminLogPage(q: unknown, now = Date.now(), viewer: Viewer | null = null): Promise<AdminLogPage> {
  const query = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
  const limit = Math.min(Math.max(Math.floor(Number(query.limit) || 50), 1), 200);
  const kinds = Object.hasOwn(LOG_KINDS, String(query.kind)) ? LOG_KINDS[query.kind as keyof typeof LOG_KINDS] : null;
  const before = Math.floor(Number(query.before));
  const who = isMod(viewer) ? viewer.id : typeof query.who === "string" && UUID.test(query.who) ? query.who : null;
  const where = and(
    kinds ? inArray(adminLog.kind, kinds) : undefined,
    before > 0 ? lt(adminLog.id, before) : undefined,
    who ? eq(adminLog.actorId, who) : undefined,
  );
  const midnight = new Date(beijingMidnight(beijingDate(now)));
  const [rows, [today], team, done] = await Promise.all([
    db
      .select({ log: adminLog, name: users.name, anonymous: users.anonymous })
      .from(adminLog)
      .leftJoin(users, eq(users.id, adminLog.targetId))
      .where(where)
      .orderBy(desc(adminLog.id))
      .limit(limit + 1),
    db
      .select({
        acts: sql<number>`count(*) filter (where ${adminLog.kind} = 'act')`.mapWith(Number),
        views: sql<number>`count(*) filter (where ${adminLog.kind} = 'view')`.mapWith(Number),
        searches: sql<number>`count(*) filter (where ${adminLog.kind} = 'search')`.mapWith(Number),
        fails: sql<number>`count(*) filter (where ${adminLog.what} = 'gate.fail')`.mapWith(Number),
      })
      .from(adminLog)
      .where(and(gte(adminLog.at, midnight), isMod(viewer) ? eq(adminLog.actorId, viewer.id) : undefined)),
    isMod(viewer)
      ? []
      : db
          .select({ id: admins.userId, alias: admins.alias })
          .from(admins)
          .orderBy(sql`${admins.role} = 'owner' desc`, asc(admins.addedAt)),
    isMod(viewer)
      ? []
      : db
          .select({ id: adminLog.actorId, n: count() })
          .from(adminLog)
          .where(and(gte(adminLog.at, midnight), eq(adminLog.kind, "act")))
          .groupBy(adminLog.actorId),
  ]);
  const page = rows.slice(0, limit);
  const actionIds = [...new Set(page.flatMap((r) => (r.log.actionId && r.log.kind === "act" ? [r.log.actionId] : [])))];
  // a ban asked for is answered by the owner's line naming the request: act.ban or act.banDeclined (adminRequests.ts)
  const asked = [...new Set(page.flatMap((r) => (r.log.what === "act.banRequest" && r.log.actionId ? [r.log.actionId] : [])))];
  const [actionRows, answerRows] = await Promise.all([
    actionIds.length ? db.select().from(modActions).where(inArray(modActions.id, actionIds)) : [],
    asked.length
      ? db
          .select({ actionId: adminLog.actionId, what: adminLog.what })
          .from(adminLog)
          .where(and(inArray(adminLog.actionId, asked), inArray(adminLog.what, ["act.ban", "act.banDeclined"])))
      : [],
  ]);
  const actions = new Map(actionRows.map((a) => [a.id, a]));
  const answers = new Map(answerRows.map((r) => [r.actionId, r.what === "act.ban" ? ("done" as const) : ("declined" as const)]));
  return {
    entries: page.map(({ log, name, anonymous }) => {
      const a = log.actionId ? actions.get(log.actionId) : undefined;
      return {
        id: log.id,
        at: log.at.getTime(),
        actor: log.actorAlias,
        kind: log.kind as AdminLogPage["entries"][number]["kind"],
        what: log.what,
        target: log.targetId ? { id: log.targetId, name: ownerName({ name: name ?? "", anonymous: anonymous ?? false }) } : null,
        gone: !log.targetId && aboutAnAccount(log.what),
        detail: log.detail,
        actionId: log.actionId,
        canUndo: Boolean(a && log.what !== "act.undo" && canUndo(a, viewer, now)),
        undone: Boolean(log.undoneAt),
        answer: log.what === "act.banRequest" && log.actionId ? (answers.get(log.actionId) ?? null) : null,
      };
    }),
    today: { acts: today?.acts ?? 0, views: today?.views ?? 0, searches: today?.searches ?? 0, fails: today?.fails ?? 0 },
    more: rows.length > limit,
    people: team.map((p) => ({ ...p, acts: done.find((d) => d.id === p.id)?.n ?? 0 })),
  };
}

/** A search as the 操作记录 may keep it: an email or a UID (or anything that only matched one) masked */
export const searchWords = (q: unknown, plain: boolean) => {
  const needle = searchNeedle(q);
  return plain ? needle.slice(0, 30) : needle.includes("@") ? maskEmail(needle) : `${needle.slice(0, 2)}***`;
};

/** 查邮箱 as the 操作记录 keeps it: the address masked */
export const maskedLookup = (email: unknown) => maskEmail(String(email ?? "").trim().toLowerCase());

/** For the 操作记录: what a few name words were, at most a few dozen of them */
export function wordsDetail(verb: string, words: string[]) {
  const shown = words.slice(0, 20).join("、");
  return words.length > 20 ? `${verb} ${words.length} 个词：${shown} 等` : `${verb} ${words.length} 个词：${shown}`;
}
