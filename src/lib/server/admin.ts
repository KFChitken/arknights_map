import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { declarationText } from "../declarations";
import { isReportReason, type AdminAction, type AdminCase } from "../safety";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { DAY } from "../world/logic";
import { banAccount } from "./account";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { clearName } from "./safety";
import { declarations, reports, touches, users, type UserRow } from "./schema";
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
