import "server-only";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { badgeById } from "../badges";
import { beijingDate, beijingMidnight } from "../beijing";
import { declarationText } from "../declarations";
import { isReportReason, type AdminAction, type AdminCase, type AdminPlayer, type RetentionStats } from "../safety";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { DAY } from "../world/logic";
import { banAccount } from "./account";
import { award } from "./badges";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { clearName } from "./safety";
import { dailyTotals, declarations, friendships, reports, touches, userBadges, users, type UserRow } from "./schema";
import { storedDeclaration } from "./world";

/** The admin page's rules: who may open it, what it shows and the three ways to settle a report. */

export const isAdmin = (u: UserRow | null) => Boolean(u?.email && ADMIN_EMAILS.includes(u.email));

/** Every player with open reports, the most reported first. */
export async function openCases(): Promise<AdminCase[]> {
  const open = await db.select().from(reports).where(isNull(reports.resolvedAt)).orderBy(asc(reports.createdAt));
  const targets = [...new Set(open.map((r) => r.targetId))];
  if (!targets.length) return [];
  const since = new Date(Date.now() - DAY);
  const people = await db.select().from(users).where(inArray(users.id, targets));
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
    cases.push({
      targetId: u.id,
      name: u.name,
      anonymous: u.anonymous,
      avatar: ROACH_AVATARS.find((a) => a === u.avatar) ?? "hood",
      color: ROACH_COLORS.find((c) => c === u.color) ?? "cyan",
      joinedAt: u.createdAt.getTime(),
      last24h: { touches: sentTouches.n, declarations: recent.filter((d) => d.createdAt > since).length },
      declarations: recent.map((d) => ({ text: declarationText(storedDeclaration(d)), at: d.createdAt.getTime() })),
      reporters: new Set(theirs.map((r) => r.reporterId)).size,
      reports: theirs.map((r) => ({
        reason: isReportReason(r.reason) ? r.reason : "other",
        note: r.note,
        context: r.context,
        name: r.targetName,
        at: r.createdAt.getTime(),
      })),
    });
  }
  return cases.sort((x, y) => y.reporters - x.reporters || x.reports[0].at - y.reports[0].at);
}

/** Settle every open report about one player. */
export async function resolveCase(targetId: string, action: AdminAction) {
  const [u] = await db.select().from(users).where(eq(users.id, String(targetId))).limit(1);
  if (!u) throw new HttpError(400, "这个账号已经不在了。");
  const settle = (resolution: string) =>
    db
      .update(reports)
      .set({ resolvedAt: new Date(), resolution })
      .where(and(eq(reports.targetId, u.id), isNull(reports.resolvedAt)));
  if (action === "dismiss") await settle("dismissed");
  else if (action === "clearName") {
    await clearName(u.id);
    await settle("name_cleared");
  } else if (action === "ban") {
    if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
    // the reports go with the account
    await banAccount(u);
  } else throw new HttpError(400, "不知道要怎么处理。");
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
