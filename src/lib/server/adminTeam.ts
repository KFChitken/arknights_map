import "server-only";
import { and, count, desc, eq, gt, inArray, isNull, max, sql } from "drizzle-orm";
import { ALIAS_MAX, maskEmail, OWNER_ALIAS, type AdminCandidate, type AdminMember } from "../adminConsole";
import { beijingShort } from "../beijing";
import { YELLOW_DAYS } from "../rules";
import { actorOf, isOwnerEmail, logAdmin, mailOwner, mailPerson, NOT_YOU, type AdminContext } from "./admins";
import { db } from "./db";
import { SITE_URL } from "./env";
import { HttpError } from "./http";
import { reloadEverywhere } from "./live";
import { adminBackupCodes, adminLog, admins, modActions, reports, sessions, users } from "./schema";
import { errorCode } from "./signals";

/**
 * The owner's 管理员 page: who may come into the 管理台, adding a moderator (an account that signed up with its own
 * email), removing one, renaming one, and lifting a pause early. Resetting someone's authenticator is admins.ts
 * resetAdminTotp. The route lets only the owner in here, the heaviest with a fresh code. Every change is in the
 * 操作记录 and mailed to the owner (in case it was not them), and adding or removing one tells every process
 * (reloadEverywhere("admins")), so the map's buttons come and go with it.
 */

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objectOf = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** What the door's own lines count as coming in */
const UNLOCKS = ["gate.unlock", "gate.backup", "gate.setup"];

/** Everyone who may come in now, the owner first: what the 管理员 page lists */
export async function listAdmins(now = Date.now()): Promise<AdminMember[]> {
  const rows = await db
    .select({ a: admins, email: users.email })
    .from(admins)
    .innerJoin(users, eq(users.id, admins.userId))
    .orderBy(sql`${admins.role} = 'owner' desc`, admins.addedAt);
  // an owner row is only someone's while their email stays in ADMIN_EMAILS
  const list = rows.filter((r) => r.a.role === "mod" || isOwnerEmail(r.email));
  const ids = list.map((r) => r.a.userId);
  if (!ids.length) return [];
  const [unlocks, week, backups] = await Promise.all([
    db
      .select({ id: adminLog.actorId, at: max(adminLog.at) })
      .from(adminLog)
      .where(and(inArray(adminLog.actorId, ids), inArray(adminLog.what, UNLOCKS)))
      .groupBy(adminLog.actorId),
    db
      .select({ id: adminLog.actorId, n: count() })
      .from(adminLog)
      .where(and(inArray(adminLog.actorId, ids), eq(adminLog.kind, "act"), gt(adminLog.at, new Date(now - 7 * DAY))))
      .groupBy(adminLog.actorId),
    db
      .select({ id: adminBackupCodes.userId, n: count() })
      .from(adminBackupCodes)
      .where(and(inArray(adminBackupCodes.userId, ids), isNull(adminBackupCodes.usedAt)))
      .groupBy(adminBackupCodes.userId),
  ]);
  const of = <T extends { id: string | null }>(list: T[], id: string) => list.find((x) => x.id === id);
  return list.map(({ a, email }) => {
    const paused = a.pausedUntil && a.pausedUntil.getTime() > now;
    return {
      userId: a.userId,
      alias: a.alias,
      role: a.role === "owner" ? "owner" : "mod",
      email: email ?? "",
      addedAt: a.addedAt.getTime(),
      pledged: a.role === "owner" || Boolean(a.pledgedAt),
      bound: Boolean(a.totpSecret),
      lastUnlock: of(unlocks, a.userId)?.at?.getTime() ?? null,
      week: of(week, a.userId)?.n ?? 0,
      backupLeft: of(backups, a.userId)?.n ?? 0,
      fails: a.fails,
      pausedUntil: paused ? a.pausedUntil!.getTime() : null,
      pauseReason: paused ? (a.pauseReason === "views" ? "views" : "codes") : null,
    };
  });
}

/** A moderator's name in the 管理台: 1 to ALIAS_MAX characters (emoji as one), never 「站长」 */
function aliasOf(value: unknown) {
  const alias = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const length = [...alias].length;
  if (!length) throw new HttpError(400, "给 TA 起一个称呼。");
  if (length > ALIAS_MAX) throw new HttpError(400, `称呼最多 ${ALIAS_MAX} 个字。`);
  if (alias.includes(OWNER_ALIAS)) throw new HttpError(400, `称呼里不能有「${OWNER_ALIAS}」。`);
  return alias;
}

/** Whether a failed write broke admins_alias_idx: someone else is called that already */
const aliasTaken = (e: unknown) => errorCode(e).includes("admins_alias_idx");

/**
 * findAdminCandidate { q }: the account to add, by its full sign-in email or its id, only a real account (not a test
 * player), and nobody who may come in already. The owner sees it whole: the name, the email, when it joined, and
 * how it stands (reports about it waiting, yellow cards that count) to be sure it is them.
 */
export async function findAdminCandidate(ctx: AdminContext, input: unknown, now = Date.now()): Promise<AdminCandidate> {
  const q = String(objectOf(input).q ?? input ?? "")
    .trim()
    .toLowerCase();
  if (!q) throw new HttpError(400, "输入 TA 注册舟P 用的完整邮箱，或者账号 ID。");
  const byId = UUID.test(q);
  if (!byId && !/^[^@\s]+@[^@\s]+$/.test(q)) throw new HttpError(400, "要完整的邮箱（带 @），或者账号 ID。");
  const [u] = await db
    .select()
    .from(users)
    .where(and(byId ? eq(users.id, q) : eq(users.email, q), isNull(users.demoKey)))
    .limit(1);
  await logAdmin(actorOf(ctx.admin), "search", "search", { detail: `找管理员人选 ${byId ? `${q.slice(0, 2)}***` : maskEmail(q)}` }, now);
  if (!u) throw new HttpError(400, "没找到。TA 要先用自己的邮箱注册舟P，再用那个邮箱或账号 ID 来找。");
  if (isOwnerEmail(u.email)) throw new HttpError(400, "这是站长的账号。");
  const [already] = await db.select({ id: admins.userId }).from(admins).where(eq(admins.userId, u.id)).limit(1);
  if (already) throw new HttpError(400, "TA 已经是管理员了。");
  const [[open], yellows] = await Promise.all([
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.targetId, u.id), isNull(reports.resolvedAt))),
    db
      .select({ undone: modActions.undoneAt, appeal: modActions.appealResult })
      .from(modActions)
      .where(and(eq(modActions.userId, u.id), eq(modActions.yellow, true), gt(modActions.createdAt, new Date(now - YELLOW_DAYS * DAY))))
      .orderBy(desc(modActions.createdAt)),
  ]);
  return {
    id: u.id,
    name: u.name ? `${u.name}${u.anonymous ? "（匿名）" : ""}` : "（没有名字）",
    email: u.email ?? "",
    joinedAt: u.createdAt.getTime(),
    reports: open.n,
    yellow: yellows.filter((y) => !y.undone && y.appeal !== "reverted").length,
  };
}

/**
 * addAdmin { userId, alias }: the account becomes a moderator (the route asks for a fresh code first). They are
 * invited at their sign-in email; on opening the 管理台 they read the rules and set up an authenticator, and see
 * nothing before that. Not someone who may come in already, the owner, or a test player.
 */
export async function addAdmin(ctx: AdminContext, input: unknown, now = Date.now()) {
  const q = objectOf(input);
  const userId = String(q.userId ?? "");
  const alias = aliasOf(q.alias);
  const [u] = UUID.test(userId) ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [];
  if (!u || u.demoKey) throw new HttpError(400, "找不到这个账号了。");
  if (isOwnerEmail(u.email)) throw new HttpError(400, "这是站长的账号。");
  let added;
  try {
    [added] = await db
      .insert(admins)
      .values({ userId: u.id, role: "mod", alias, addedBy: ctx.admin.userId, addedAt: new Date(now) })
      .onConflictDoNothing({ target: admins.userId })
      .returning();
  } catch (e) {
    if (aliasTaken(e)) throw new HttpError(400, "这个称呼有人用了，换一个。");
    throw e;
  }
  if (!added) throw new HttpError(400, "TA 已经是管理员了。");
  await logAdmin(actorOf(ctx.admin), "admin", "admin.add", { targetId: u.id, detail: `加了管理员「${alias}」` }, now);
  await reloadEverywhere("admins");
  await mailPerson(
    u.email,
    "你被加为舟P 管理员",
    `站长把你加为舟P 的管理员。用这个邮箱登录 ${SITE_URL} 后，打开 ${SITE_URL}/admin ，按提示读管理员守则、绑定验证器。不知道这件事的话，不用理这封邮件，也告诉站长一声。`,
  );
  await mailOwner(
    u.id,
    "admin.add",
    `加了管理员「${alias}」`,
    `北京时间 ${beijingShort(now)}，管理台加了一位管理员「${alias}」。TA 会收到一封邀请邮件，绑好验证器时你也会收到邮件。\n\n${NOT_YOU}`,
    now,
  );
  return { userId: u.id, alias };
}

/** The moderator a step is about, as the 管理员 page names them: never the owner, whose row the server's settings decide */
async function moderator(userId: unknown) {
  const id = String(userId ?? "");
  const [row] = UUID.test(id) ? await db.select().from(admins).where(eq(admins.userId, id)).limit(1) : [];
  if (row?.role === "owner") throw new HttpError(400, "站长写在服务器设置里，这里改不了。");
  if (!row) throw new HttpError(400, "找不到这位管理员了。");
  return row;
}

/**
 * removeAdmin { userId } (with a fresh code): their admins row and backup codes go, and every device of theirs locks,
 * so their next click in the 管理台 is the 404 everyone else gets. What they did stays in the records, under their name.
 */
export async function removeAdmin(ctx: AdminContext, input: unknown, now = Date.now()) {
  const row = await moderator(objectOf(input).userId);
  await db.transaction(async (tx) => {
    await tx.delete(admins).where(eq(admins.userId, row.userId));
    await tx.delete(adminBackupCodes).where(eq(adminBackupCodes.userId, row.userId));
    await tx.update(sessions).set({ adminUntil: null, adminFreshAt: null }).where(eq(sessions.userId, row.userId));
  });
  await logAdmin(actorOf(ctx.admin), "admin", "admin.remove", { targetId: row.userId, detail: `移除了管理员「${row.alias}」` }, now);
  await reloadEverywhere("admins");
  await mailOwner(
    row.userId,
    "admin.remove",
    `移除了管理员「${row.alias}」`,
    `北京时间 ${beijingShort(now)}，管理员「${row.alias}」被移除了，TA 再也进不了管理台。TA 做过的处理都还在记录里。\n\n${NOT_YOU}`,
    now,
  );
}

/** renameAdmin { userId, alias }: what the 管理台 calls a moderator from now on (what they did keeps the name they had) */
export async function renameAdmin(ctx: AdminContext, input: unknown, now = Date.now()) {
  const q = objectOf(input);
  const row = await moderator(q.userId);
  const alias = aliasOf(q.alias);
  if (alias === row.alias) return { userId: row.userId, alias };
  try {
    await db.update(admins).set({ alias }).where(eq(admins.userId, row.userId));
  } catch (e) {
    if (aliasTaken(e)) throw new HttpError(400, "这个称呼有人用了，换一个。");
    throw e;
  }
  await logAdmin(actorOf(ctx.admin), "admin", "admin.rename", { targetId: row.userId, detail: `「${row.alias}」改叫「${alias}」` }, now);
  return { userId: row.userId, alias };
}

/** unpauseAdmin { userId }: a moderator's pause (wrong codes, or too many accounts in an hour) lifted early */
export async function unpauseAdmin(ctx: AdminContext, input: unknown, now = Date.now()) {
  const row = await moderator(objectOf(input).userId);
  if (!row.pausedUntil || row.pausedUntil.getTime() <= now) throw new HttpError(400, "TA 现在没有被暂停。");
  await db.update(admins).set({ pausedUntil: null, pauseReason: null, fails: 0 }).where(eq(admins.userId, row.userId));
  await logAdmin(actorOf(ctx.admin), "admin", "admin.unpause", { targetId: row.userId, detail: `提前解除了「${row.alias}」的暂停` }, now);
}
