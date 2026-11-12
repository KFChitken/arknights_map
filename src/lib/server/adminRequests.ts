import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { BAN_REASON_MAX, type BanRequestCard } from "../adminConsole";
import { beijingShort } from "../beijing";
import { isRuleCode, RULES } from "../safety";
import { peopleOf, settleCase, THEIR_OWN_REPORT } from "./admin";
import { logAdmin, mailOwner, staffRoles, type Actor } from "./admins";
import { db } from "./db";
import { HttpError } from "./http";
import { adminRequests, reports, users } from "./schema";

/**
 * 提请封号: only the owner bans (Breeze's choice), so a moderator asks for one, with the rule broken and why, and the
 * owner confirms it (with a fresh code, as any ban) or sends it back. One open request per account at a time. The
 * owner is told by email; the answer shows in the moderator's 操作记录 (act.ban or act.banDeclined, naming the
 * request as its action). A ban deletes the account and its requests with it; answered ones go after
 * KEEP_ANSWERED_REQUEST_DAYS (retention.ts).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const gone = () => new HttpError(404, "这个账号已经不在了。");

/** banRequest { id, rule, reason }: a moderator asks the owner to ban this account */
export async function banRequest(by: Actor, input: unknown, now = Date.now()) {
  if (by.role !== "mod") throw new HttpError(400, "站长直接封号就行。");
  const q = objectOf(input);
  const userId = String(q.id ?? "");
  if (!isRuleCode(q.rule)) throw new HttpError(400, "先选一条 TA 违反的规则。");
  const reason = String(q.reason ?? "").trim();
  const length = [...reason].length;
  if (!length) throw new HttpError(400, "写一下为什么要封号，站长要看。");
  if (length > BAN_REASON_MAX) throw new HttpError(400, `理由最多 ${BAN_REASON_MAX} 个字。`);
  const [u] = UUID.test(userId) ? await db.select({ id: users.id, demoKey: users.demoKey }).from(users).where(eq(users.id, userId)).limit(1) : [];
  if (!u || (await staffRoles()).has(u.id)) throw gone();
  if (u.demoKey) throw new HttpError(400, "测试玩家不能封号。");
  const mine = await db.$count(reports, and(eq(reports.targetId, u.id), eq(reports.reporterId, by.id), isNull(reports.resolvedAt)));
  if (mine) throw new HttpError(403, THEIR_OWN_REPORT);
  const [asked] = await db
    .insert(adminRequests)
    .values({ userId: u.id, action: "ban", byUserId: by.id, byAlias: by.alias, rule: q.rule, reason, createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning();
  if (!asked) throw new HttpError(400, "已经有人提请封这个号了，等站长确认。");
  await logAdmin(by, "act", "act.banRequest", { targetId: u.id, actionId: asked.id, detail: `提请封号，违反：${RULES[q.rule]}` }, now);
  await mailOwner(
    by.id,
    "act.banRequest",
    `${by.alias} 提请封号，等你确认`,
    `${by.alias} 在北京时间 ${beijingShort(now)} 提请封一个账号，违反：${RULES[q.rule]}。\n\n打开管理台的「待处理」，提请封号的卡在最上面：确认封号，或者不封、退回给 TA。同一个人一小时里再提请，不另发邮件。`,
    now,
  );
  return { id: asked.id };
}

/** The owner's 待处理, at the top: bans asked for and not answered yet, the oldest first, each with the account's info box */
export async function banRequests(now = Date.now()): Promise<BanRequestCard[]> {
  const rows = await db.select().from(adminRequests).where(isNull(adminRequests.answeredAt)).orderBy(asc(adminRequests.createdAt)).limit(100);
  const who = await peopleOf([...new Set(rows.map((r) => r.userId))], now);
  return rows.flatMap((r): BanRequestCard[] => {
    const person = who.get(r.userId);
    if (!person) return [];
    return [{ id: r.id, by: r.byAlias, rule: isRuleCode(r.rule) ? r.rule : "harass", reason: r.reason, at: r.createdAt.getTime(), who: person }];
  });
}

/**
 * answerBanRequest { id, ban }: the owner's answer. ban: 确认封号 (the route asks for a fresh code first): the request
 * is marked answered first, so two tabs cannot both go on, then the account is banned as from 待处理 (deleting it and
 * this request with it). Otherwise 不封，退回给 TA: kept as declined, and the moderator's 操作记录 says 「站长没同意」.
 */
export async function answerBanRequest(by: Actor, input: unknown, now = Date.now()) {
  if (by.role !== "owner") throw new HttpError(403, "这个只有站长能做。");
  const q = objectOf(input);
  const id = String(q.id ?? "");
  const ban = q.ban === true;
  const [asked] = UUID.test(id)
    ? await db
        .update(adminRequests)
        .set({ answeredAt: new Date(now), answer: ban ? "done" : "declined" })
        .where(and(eq(adminRequests.id, id), isNull(adminRequests.answeredAt)))
        .returning()
    : [];
  if (!asked) throw new HttpError(400, "这条提请已经处理过了。");
  const rule = isRuleCode(asked.rule) ? asked.rule : "harass";
  if (!ban) {
    await logAdmin(by, "act", "act.banDeclined", { targetId: asked.userId, actionId: asked.id, detail: `不封，退回给「${asked.byAlias}」` }, now);
    return;
  }
  try {
    await settleCase(asked.userId, "ban", { rule }, now);
  } catch (e) {
    // not banned after all (a test player, or gone meanwhile): the request waits again
    await db.update(adminRequests).set({ answeredAt: null, answer: null }).where(eq(adminRequests.id, asked.id));
    throw e;
  }
  // the account is gone, and the request with it: this line keeps what happened, naming the request
  await logAdmin(by, "act", "act.ban", { targetId: asked.userId, actionId: asked.id, detail: `违反：${RULES[rule]}（「${asked.byAlias}」提请的）` }, now);
}
