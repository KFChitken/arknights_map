import "server-only";
import { and, asc, count, countDistinct, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { badgeById } from "../badges";
import { beijingDate, beijingMidnight } from "../beijing";
import { declarationText } from "../declarations";
import { serverName } from "../games";
import { BLOCKS_TO_REVIEW, BLOCKS_WINDOW_DAYS, RELIABLE_AFTER_DAYS, SUSPEND_DAYS, YELLOW_DAYS } from "../rules";
import {
  BATCH_ACTIONS,
  BLOCKS_LEVEL,
  CASE_LEVELS,
  isReportReason,
  isRuleCode,
  REPORT_LEVEL,
  RULE_OF_REASON,
  URGENT_REASONS,
  type AdminAction,
  type AdminCase,
  type AdminPlayer,
  type ReportCounts,
  type ReporterInfo,
  type RetentionStats,
  type RuleCode,
} from "../safety";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { DAY } from "../world/logic";
import { banAccount } from "./account";
import { award } from "./badges";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { roachesChanged } from "./roachFeed";
import { clearBoth, clearName, clearUid, releaseProfile, reliableReporter } from "./safety";
import { blocks, dailyTotals, declarations, friendships, modActions, reports, roaches, touches, userBadges, users, type UserRow } from "./schema";
import { addNotes, type NewNote } from "./staffNotes";
import { profileOf, storedDeclaration } from "./world";

/** The admin page's rules: who may open it, what it shows and the ways to settle a report. */

export const isAdmin = (u: UserRow | null) => Boolean(u?.email && ADMIN_EMAILS.includes(u.email));

/** Open reports, and how many of them are for URGENT_REASONS: the admin's corner of the map. */
export async function reportCounts(): Promise<ReportCounts> {
  const [row] = await db
    .select({
      open: count(),
      urgent: sql<number>`count(*) filter (where ${inArray(reports.reason, [...URGENT_REASONS])})`.mapWith(Number),
    })
    .from(reports)
    .where(isNull(reports.resolvedAt));
  return { open: row.open, urgent: row.urgent };
}

/** What the map adds to an admin's me(); nothing for anyone else. */
export const adminCounts = async (u: UserRow | null) => (isAdmin(u) ? await reportCounts() : undefined);

const MS_DAY = 86_400_000;

/** The resolution each way of settling writes on the reports it closes */
const RESOLUTION: Record<Exclude<AdminAction, "ban">, string> = {
  dismiss: "dismissed",
  clearName: "name_cleared",
  clearUid: "uid_cleared",
  clearBoth: "both_cleared",
  warn: "warned",
  suspend: "suspended",
  ageCheck: "age_check",
};

/** Before mod_actions (2026-11), a case's settling was only on its reports: once per moment it was settled */
const LEGACY: Record<string, keyof AdminCase["settled"]> = { dismissed: "dismissed", name_cleared: "nameCleared", uid_cleared: "uidCleared" };

/** Players blocked by different players in the last BLOCKS_WINDOW_DAYS, since the admin last looked at them */
async function blockedByMany(now: number) {
  const since = new Date(now - BLOCKS_WINDOW_DAYS * MS_DAY);
  const rows = await db
    .select({ id: blocks.blockedId, n: countDistinct(blocks.blockerId) })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(and(gt(blocks.createdAt, since), or(isNull(users.blocksReviewedAt), gt(blocks.createdAt, users.blocksReviewedAt))))
    .groupBy(blocks.blockedId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** The rule an action goes under unless the admin picks another: the name's or the UID's, else the case's most frequent reason's */
function autoRule(action: AdminAction | null, reasons: string[]): RuleCode {
  if (action === "clearName") return "name";
  if (action === "clearUid") return "contact";
  if (action === "ageCheck") return "age";
  const tally = new Map<RuleCode, number>();
  for (const r of reasons) {
    const rule = RULE_OF_REASON[isReportReason(r) ? r : "other"];
    tally.set(rule, (tally.get(rule) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "harass";
}

/**
 * Every player with open reports, or blocked by many lately: red cases first, then yellow, then green;
 * within a colour, the more reliable reporters first, then the one waiting longest. Never where their
 * roaches are or when they came by, nor who reported them.
 */
export async function openCases(now = Date.now()): Promise<AdminCase[]> {
  const open = await db.select().from(reports).where(isNull(reports.resolvedAt)).orderBy(asc(reports.createdAt));
  const many = await blockedByMany(now);
  const flagged = [...many].filter(([, n]) => n >= BLOCKS_TO_REVIEW).map(([id]) => id);
  const targets = [...new Set([...open.map((r) => r.targetId), ...flagged])];
  if (!targets.length) return [];
  const since = new Date(now - MS_DAY);
  const people = await db.select().from(users).where(inArray(users.id, targets));
  const reporterIds = [...new Set(open.flatMap((r) => (r.reporterId ? [r.reporterId] : [])))];
  const reporters = new Map(
    (reporterIds.length ? await db.select().from(users).where(inArray(users.id, reporterIds)) : []).map((u) => [u.id, u]),
  );
  const cases: AdminCase[] = [];
  for (const u of people) {
    const theirs = open.filter((r) => r.targetId === u.id);
    const recent = await db
      .select()
      .from(declarations)
      .where(eq(declarations.senderId, u.id))
      .orderBy(desc(declarations.createdAt))
      .limit(5);
    const [sentTouches] = await db
      .select({ n: count() })
      .from(touches)
      .where(and(eq(touches.fromUserId, u.id), gt(touches.createdAt, since)));
    const slots = await db.select({ slot: roaches.slot }).from(roaches).where(eq(roaches.userId, u.id));
    const [friends] = await db
      .select({ n: count() })
      .from(friendships)
      .where(or(eq(friendships.a, u.id), eq(friendships.b, u.id)));
    const [blockers] = await db.select({ n: count() }).from(blocks).where(eq(blocks.blockedId, u.id));
    const held = await db.select({ badge: userBadges.badge }).from(userBadges).where(eq(userBadges.userId, u.id));
    const actions = await db.select().from(modActions).where(eq(modActions.userId, u.id));
    const firstAction = Math.min(...actions.map((a) => a.createdAt.getTime()));
    const legacy = await db
      .selectDistinct({ resolution: reports.resolution, at: reports.resolvedAt })
      .from(reports)
      .where(and(eq(reports.targetId, u.id), isNotNull(reports.resolvedAt)));
    const settled = { dismissed: 0, nameCleared: 0, uidCleared: 0, warned: 0, suspended: 0, ageChecks: 0 };
    for (const a of actions.filter((x) => !x.auto)) {
      if (a.action === "dismiss") settled.dismissed++;
      if (a.action === "clearName" || a.action === "clearBoth") settled.nameCleared++;
      if (a.action === "clearUid" || a.action === "clearBoth") settled.uidCleared++;
      if (a.action === "warn") settled.warned++;
      if (a.action === "suspend") settled.suspended++;
      if (a.action === "ageCheck") settled.ageChecks++;
    }
    for (const l of legacy) {
      if (!l.at || l.at.getTime() >= firstAction) continue;
      const kind = l.resolution ? LEGACY[l.resolution] : undefined;
      if (kind) settled[kind]++;
      if (l.resolution === "both_cleared") {
        settled.nameCleared++;
        settled.uidCleared++;
      }
    }
    const yellow = actions.filter((a) => a.yellow && a.appealResult !== "reverted" && now - a.createdAt.getTime() < YELLOW_DAYS * MS_DAY).length;
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
    const distinct = [...new Set(theirs.flatMap((r) => (r.reporterId ? [r.reporterId] : [])))];
    // two or more new accounts reporting them within any hour: a pile-on, maybe
    const young = theirs.filter((r) => {
      const who = r.reporterId ? reporters.get(r.reporterId) : undefined;
      return who && r.createdAt.getTime() - who.createdAt.getTime() < RELIABLE_AFTER_DAYS * MS_DAY;
    });
    const brigade = young.some(
      (r) => new Set(young.filter((x) => x.createdAt.getTime() >= r.createdAt.getTime() && x.createdAt.getTime() - r.createdAt.getTime() <= 60 * 60_000).map((x) => x.reporterId)).size >= 2,
    );
    const level =
      theirs.length === 0
        ? BLOCKS_LEVEL
        : CASE_LEVELS.find((l) => theirs.some((r) => REPORT_LEVEL[isReportReason(r.reason) ? r.reason : "other"] === l))!;
    const profile = profileOf(u);
    // while held, anonymous and shareUid are the hold's doing; the admin sees what the player had chosen
    const heldAt = u.profileHeldAt;
    cases.push({
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
      badges: held.flatMap((b) => badgeById(b.badge)?.name ?? []),
      worn: (u.wornBadge && badgeById(u.wornBadge)?.name) || null,
      roaches: { main: slots.some((r) => r.slot === 0), clones: slots.filter((r) => r.slot > 0).length },
      friends: friends.n,
      blockedBy: blockers.n,
      settled,
      yellow,
      suspendedUntil: u.suspendedUntil && u.suspendedUntil.getTime() > now ? u.suspendedUntil.getTime() : null,
      suspendedAuto: Boolean(u.suspendedAuto && u.suspendedUntil && u.suspendedUntil.getTime() > now),
      ageCheckAt: u.ageCheckAt?.getTime() ?? null,
      ageConfirmedAt: u.ageConfirmedAt?.getTime() ?? null,
      blockedRecently: many.get(u.id) ?? 0,
      last24h: { touches: sentTouches.n, declarations: recent.filter((d) => d.createdAt > since).length },
      declarations: recent.map((d) => ({ text: declarationText(storedDeclaration(d)), at: d.createdAt.getTime() })),
      level,
      reporters: distinct.length,
      reliable: distinct.filter((id) => reporterOf(id)?.reliable).length,
      brigade,
      rule: theirs.length ? autoRule(null, theirs.map((r) => r.reason)) : "harass",
      since: theirs[0]?.createdAt.getTime() ?? now,
      reports: theirs.map((r) => ({
        reason: isReportReason(r.reason) ? r.reason : "other",
        note: r.note,
        context: r.context,
        name: r.targetName,
        at: r.createdAt.getTime(),
        reporter: reporterOf(r.reporterId),
      })),
    });
  }
  const order = (c: AdminCase) => CASE_LEVELS.indexOf(c.level);
  return cases.sort((x, y) => order(x) - order(y) || y.reliable - x.reliable || x.since - y.since);
}

/**
 * Settle every open report about one player in one of the admin's ways, all in one place: do it, keep it
 * in mod_actions (never who reported), close the reports, count it to each reporter once (upheld or
 * dismissed, for telling reliable reporters), and tell both sides (staffNotes.ts). A suspension the
 * reports made by themselves is lifted first, then the admin's choice applies. A ban deletes the
 * account, its reports with it.
 */
export async function settleCase(targetId: string, action: AdminAction, opts: { rule?: unknown } = {}, now = Date.now()) {
  const [u] = await db.select().from(users).where(eq(users.id, String(targetId))).limit(1);
  if (!u) throw new HttpError(400, "这个账号已经不在了。");
  if (action === "ban") {
    if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
    await banAccount(u);
    return;
  }
  if (!Object.hasOwn(RESOLUTION, action)) throw new HttpError(400, "不知道要怎么处理。");
  const open = await db
    .select()
    .from(reports)
    .where(and(eq(reports.targetId, u.id), isNull(reports.resolvedAt)))
    .orderBy(asc(reports.createdAt));
  const rule = isRuleCode(opts.rule) ? opts.rule : autoRule(action, open.map((r) => r.reason));
  const at = new Date(now);
  const autoSuspended = Boolean(u.suspendedAuto && u.suspendedUntil && u.suspendedUntil.getTime() > now);
  const wasHeld = Boolean(u.profileHeldAt);

  // 1. the action itself (clearing and letting out also end a hold)
  if (autoSuspended) await db.update(users).set({ suspendedUntil: null, suspendedAuto: false }).where(eq(users.id, u.id));
  const until = action === "suspend" ? new Date(now + SUSPEND_DAYS * MS_DAY) : null;
  if (action === "dismiss") await releaseProfile(u.id);
  else if (action === "clearName") await clearName(u.id);
  else if (action === "clearUid") await clearUid(u.id);
  else if (action === "clearBoth") await clearBoth(u.id);
  else if (action === "suspend") await db.update(users).set({ suspendedUntil: until, suspendedAuto: false }).where(eq(users.id, u.id));
  else if (action === "ageCheck") await db.update(users).set({ ageCheckAt: at }).where(eq(users.id, u.id));
  // the admin has looked at their being blocked by many, whatever was done
  await db.update(users).set({ blocksReviewedAt: at }).where(eq(users.id, u.id));

  await db.transaction(async (tx) => {
    // 2. the record
    const [record] = await tx
      .insert(modActions)
      .values({ userId: u.id, action, rule, yellow: action === "warn", until, createdAt: at })
      .returning({ id: modActions.id });
    // 3. the reports
    await tx
      .update(reports)
      .set({ resolvedAt: at, resolution: RESOLUTION[action] })
      .where(and(eq(reports.targetId, u.id), isNull(reports.resolvedAt)));
    // 4. once to each reporter, whose own earliest report in the case their note speaks of
    const first = new Map<string, (typeof open)[number]>();
    for (const r of open) if (r.reporterId && !first.has(r.reporterId)) first.set(r.reporterId, r);
    const reporterIds = [...first.keys()];
    if (reporterIds.length) {
      await tx
        .update(users)
        .set(action === "dismiss" ? { reportsDismissed: sql`${users.reportsDismissed} + 1` } : { reportsUpheld: sql`${users.reportsUpheld} + 1` })
        .where(inArray(users.id, reporterIds));
    }
    // 5. both sides
    const notes: NewNote[] = [...first.values()].map((r) => ({
      userId: r.reporterId!,
      kind: action === "dismiss" ? "reportDismissed" : "reportUpheld",
      reason: r.reason,
      reportedOn: beijingDate(r.createdAt.getTime()),
    }));
    if (action === "warn" || action === "suspend" || action === "clearName" || action === "clearUid" || action === "clearBoth") {
      notes.push({ userId: u.id, kind: "action", actionId: record.id, rule, until });
    } else if (action === "dismiss") {
      if (wasHeld) notes.push({ userId: u.id, kind: "released" });
      if (autoSuspended) notes.push({ userId: u.id, kind: "unsuspended" });
    }
    await addNotes(notes, tx);
  });
  // a cleared or released name changes what others see
  roachesChanged();
}

/** Several players at once, each settled on its own; never a ban */
export async function settleCases(targetIds: unknown, action: AdminAction) {
  if (!BATCH_ACTIONS.includes(action)) throw new HttpError(400, "这个处理不能批量做。");
  const ids = Array.isArray(targetIds) ? [...new Set(targetIds.map(String))].slice(0, 200) : [];
  for (const id of ids) await settleCase(id, action);
  return ids.length;
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

/** 所有玩家: every real account's login email and name, newest first, to find someone to act on. */
export async function allPlayers(): Promise<AdminPlayer[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, anonymous: users.anonymous, createdAt: users.createdAt })
    .from(users)
    .where(isNull(users.demoKey))
    .orderBy(desc(users.createdAt));
  return rows.map((u) => ({ id: u.id, email: u.email ?? "", name: u.name, anonymous: u.anonymous, joinedAt: u.createdAt.getTime() }));
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
