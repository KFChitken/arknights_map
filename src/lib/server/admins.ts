import "server-only";
import { and, count, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
import {
  clockWords,
  CODE_TRIES,
  FRESH_MINUTES,
  maskEmail,
  minutesWords,
  OWNER_ALIAS,
  PAUSE_MAX_HOURS,
  PAUSE_MINUTES,
  pauseMinutes,
  pausedWords,
  SETUP_LOGIN_MINUTES,
  UNLOCK_HOURS,
  type AdminLogKind,
  type AdminRole,
  type GateState,
  type GateWho,
  type SetupStart,
} from "../adminConsole";
import { beijingShort } from "../beijing";
import { currentSessionId } from "./auth";
import { db } from "./db";
import { ADMIN_EMAILS } from "./env";
import { HttpError } from "./http";
import { sendAdminMail } from "./mail";
import { adminBackupCodes, adminLog, admins, sessions, users, type AdminRow, type UserRow } from "./schema";
import { backupHash, makeBackupCodes, open, seal } from "./seal";
import { logError } from "./signals";
import { cleanCode, groupedSecret, newTotpSecret, rightStep, totpUri } from "./totp";

/**
 * The 管理台's door. Who may come in: the owner (a sign-in email in ADMIN_EMAILS, which decides it whatever the
 * admins table says) and, later, the moderators the owner adds. Coming in takes an authenticator code on each
 * device every UNLOCK_HOURS, the heaviest steps one from the last FRESH_MINUTES, and wrong codes pause the person
 * for a while. Everything done inside is kept in admin_log (logAdmin).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Someone the door lets in: their role, what the 管理台 calls them, and their row */
export type Admin = { userId: string; role: AdminRole; alias: string; row: AdminRow };
/** Who did something, as admin_log and mod_actions keep it */
export type Actor = { id: string; alias: string };
/** This device's sign-in, as far as the door needs it */
export type AdminSession = { id: string; createdAt: Date; adminUntil: Date | null; adminFreshAt: Date | null };
/** A request that came through the door: who, as a player and as an admin, and from which sign-in */
export type AdminContext = { admin: Admin; user: UserRow; session: AdminSession };

export const isOwnerEmail = (email: string | null | undefined) => Boolean(email && ADMIN_EMAILS.includes(email));

export const actorOf = (admin: Admin): Actor => ({ id: admin.userId, alias: admin.alias });

/**
 * The person as the 管理台 knows them, from their admins row (if any): the owner gets one the first time they come
 * (inserted at most once however many tabs come at once); a row whose owner left ADMIN_EMAILS lets nobody in.
 */
async function asAdmin(user: UserRow, found: AdminRow | null): Promise<Admin | null> {
  if (isOwnerEmail(user.email)) {
    let row = found;
    if (!row || row.role !== "owner") {
      [row] = await db
        .insert(admins)
        .values({ userId: user.id, role: "owner", alias: OWNER_ALIAS })
        .onConflictDoUpdate({ target: admins.userId, set: { role: "owner" } })
        .returning();
    }
    return { userId: user.id, role: "owner", alias: row.alias, row };
  }
  if (found?.role === "mod") return { userId: user.id, role: "mod", alias: found.alias, row: found };
  return null;
}

/** Whether a player may come into the 管理台 at all, and as whom; null for everyone else */
export async function adminOf(user: UserRow | null): Promise<Admin | null> {
  if (!user) return null;
  const [row] = await db.select().from(admins).where(eq(admins.userId, user.id)).limit(1);
  return asAdmin(user, row ?? null);
}

// The sign-in, the player and their admins row in one go, put together once (as auth.ts currentUser)
const contextQuery = db
  .select({
    session: { id: sessions.id, createdAt: sessions.createdAt, adminUntil: sessions.adminUntil, adminFreshAt: sessions.adminFreshAt },
    user: users,
    admin: admins,
  })
  .from(sessions)
  .innerJoin(users, eq(users.id, sessions.userId))
  .leftJoin(admins, eq(admins.userId, sessions.userId))
  .where(and(eq(sessions.id, sql.placeholder("id")), gt(sessions.expiresAt, sql`now()`)))
  .limit(1)
  .prepare("admin_context");

/** This request's sign-in, if it is someone the 管理台 lets in */
export async function adminContext(): Promise<AdminContext | null> {
  const id = await currentSessionId();
  if (!id) return null;
  const [row] = await contextQuery.execute({ id });
  if (!row) return null;
  const admin = await asAdmin(row.user, row.admin);
  return admin ? { admin, user: row.user, session: row.session } : null;
}

const pausedUntil = (row: AdminRow, now: number) => (row.pausedUntil && row.pausedUntil.getTime() > now ? row.pausedUntil.getTime() : null);
const unlockedUntil = (s: AdminSession, now: number) => (s.adminUntil && s.adminUntil.getTime() > now ? s.adminUntil.getTime() : null);
const recentLogin = (s: AdminSession, now: number) => now - s.createdAt.getTime() < SETUP_LOGIN_MINUTES * MINUTE;
const whoOf = (ctx: AdminContext): GateWho => ({ alias: ctx.admin.alias, role: ctx.admin.role, email: maskEmail(ctx.user.email) });
/** Until when a code typed on this device still does for the heaviest steps (requireFresh), or null */
const freshUntil = (s: AdminSession, now: number) => {
  const at = s.adminFreshAt?.getTime();
  return at !== undefined && now - at < FRESH_MINUTES * MINUTE ? at + FRESH_MINUTES * MINUTE : null;
};
/** In: until when on this device, the backup codes left, and until when no code is asked for again */
const openState = (ctx: AdminContext, backupLeft: number, now: number): GateState => ({
  ...whoOf(ctx),
  state: "open",
  until: ctx.session.adminUntil!.getTime(),
  backupLeft,
  freshUntil: freshUntil(ctx.session, now),
});

export async function backupCodesLeft(userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(adminBackupCodes)
    .where(and(eq(adminBackupCodes.userId, userId), isNull(adminBackupCodes.usedAt)));
  return row.n;
}

/** Where this person stands at the door, on this device */
export async function gateState(ctx: AdminContext, now = Date.now()): Promise<GateState> {
  const who = whoOf(ctx);
  const paused = pausedUntil(ctx.admin.row, now);
  if (paused) return { ...who, state: "paused", until: paused, minutes: pauseMinutes(ctx.admin.row.pauses) };
  if (!ctx.admin.row.totpSecret) return { ...who, state: "setup", recentLogin: recentLogin(ctx.session, now) };
  const backupLeft = await backupCodesLeft(ctx.admin.userId);
  if (!unlockedUntil(ctx.session, now)) return { ...who, state: "locked", triesLeft: Math.max(1, CODE_TRIES - ctx.admin.row.fails), backupLeft };
  return openState(ctx, backupLeft, now);
}

const pausedError = (ctx: AdminContext, until: number, minutes: number, now: number) =>
  new HttpError(423, pausedWords(ctx.admin.role, until, minutes, now), "ADMIN_PAUSED", { until, minutes });

/** Ops the door lets through whatever the state: where one stands, and locking this device */
const ALWAYS = new Set(["gate", "lock"]);
/** Ops for setting up an authenticator, only before there is one */
const SETUP_OPS = new Set(["setupStart", "setupConfirm"]);

/**
 * The door, for every request to the 管理台's endpoints, in this order: not someone it lets in (404, as if there
 * were no such thing), paused (423), no authenticator yet (403, but for setting one up), this device locked (401,
 * but for unlocking it). What it lets through gets the context; the heaviest ops then ask requireFresh too.
 */
export async function enter(op: string, now = Date.now()): Promise<AdminContext> {
  const ctx = await adminContext();
  if (!ctx) throw new HttpError(404, "没有这个功能。");
  if (ALWAYS.has(op)) return ctx;
  const paused = pausedUntil(ctx.admin.row, now);
  if (paused) throw pausedError(ctx, paused, pauseMinutes(ctx.admin.row.pauses), now);
  if (!ctx.admin.row.totpSecret) {
    if (SETUP_OPS.has(op)) return ctx;
    throw new HttpError(403, "先绑定验证器，才能用管理台。", "ADMIN_SETUP");
  }
  if (SETUP_OPS.has(op)) throw new HttpError(400, "验证器已经绑好了。");
  if (op === "unlock") return ctx;
  if (!unlockedUntil(ctx.session, now)) throw new HttpError(401, "这台设备要先输验证器里的数字。", "ADMIN_LOCKED");
  return ctx;
}

/** The person's authenticator secret, opened */
function secretOf(row: AdminRow) {
  try {
    return open(row.totpSecret ?? "");
  } catch {
    // only if AUTH_SECRET changed (which it must not), or the column was edited by hand
    throw new HttpError(500, "验证器的密钥解不开了，要在服务器上重置以后重新绑。");
  }
}

/**
 * A wrong code: one more in a row for the person (not the device), counted in one statement so every process
 * counts the same; the CODE_TRIESth pauses them (PAUSE_MINUTES, twice as long each time after, PAUSE_MAX_HOURS at
 * most), logs it and tells the owner.
 */
async function wrongCode(ctx: AdminContext, now: number, code: "ADMIN_WRONG" | "ADMIN_FRESH", backup = false): Promise<never> {
  const at = new Date(now).toISOString();
  const pausing = sql`${admins.fails} + 1 >= ${CODE_TRIES}::int`;
  const [row] = await db
    .update(admins)
    .set({
      fails: sql`case when ${pausing} then 0 else ${admins.fails} + 1 end`,
      // 2^10 quarters of an hour are far past the day: no bigger power is needed
      pausedUntil: sql`case when ${pausing}
        then ${at}::timestamptz + least(interval '${sql.raw(String(PAUSE_MINUTES))} minutes' * power(2, least(${admins.pauses}, 10)), interval '${sql.raw(String(PAUSE_MAX_HOURS))} hours')
        else ${admins.pausedUntil} end`,
      pauses: sql`case when ${pausing} then least(${admins.pauses} + 1, 1000) else ${admins.pauses} end`,
      pauseReason: sql`case when ${pausing} then 'codes' else ${admins.pauseReason} end`,
    })
    .where(eq(admins.userId, ctx.admin.userId))
    .returning({ fails: admins.fails, pausedUntil: admins.pausedUntil, pauses: admins.pauses });
  const actor = actorOf(ctx.admin);
  await logAdmin(actor, "gate", "gate.fail", { detail: backup ? "备用码不对" : "验证码不对" }, now);
  const until = row?.pausedUntil?.getTime() ?? 0;
  if (row && row.fails === 0 && until > now) {
    const minutes = pauseMinutes(row.pauses);
    await logAdmin(actor, "gate", "gate.pause", { detail: `连续错 ${CODE_TRIES} 次，暂停 ${minutesWords(minutes)}` }, now);
    await mailOwner(
      ctx.admin.userId,
      "gate.pause",
      `${ctx.admin.alias} 连续输错验证码，暂停到 ${clockWords(until, now)}`,
      `${ctx.admin.alias} 连续输错了 ${CODE_TRIES} 次${backup ? "备用码" : "验证码"}，管理台先暂停 ${minutesWords(minutes)}，到北京时间 ${beijingShort(until)}。\n\n如果不是本人在输，说明有人登进了这个舟P账号：在「我的资料」里退出其他设备。`,
      now,
    );
    throw pausedError(ctx, until, minutes, now);
  }
  const left = CODE_TRIES - (row?.fails ?? 0);
  const next = minutesWords(pauseMinutes((row?.pauses ?? 0) + 1));
  const first = backup ? "这个备用码不对，或者已经用过了。" : "不对，再看一眼验证器。";
  throw new HttpError(code === "ADMIN_FRESH" ? 401 : 400, `${first}连续错 ${CODE_TRIES} 次会暂停 ${next}，还能再试 ${left} 次。`, code, { triesLeft: left });
}

/**
 * A code from the authenticator, right within a step either side of now and not used before (the step is taken
 * in one conditional update, so two requests with the same code cannot both pass): the wrong count starts again.
 */
async function takeCode(ctx: AdminContext, code: unknown, now: number, errorCode: "ADMIN_WRONG" | "ADMIN_FRESH") {
  const status = errorCode === "ADMIN_FRESH" ? 401 : 400;
  if (!cleanCode(code)) throw new HttpError(status, "输入验证器里的 6 位数字。", errorCode);
  const step = rightStep(secretOf(ctx.admin.row), code, now);
  if (step === null) return wrongCode(ctx, now, errorCode);
  const taken = await db
    .update(admins)
    .set({ totpLastStep: step, fails: 0, pauses: 0, pausedUntil: null, pauseReason: null })
    .where(and(eq(admins.userId, ctx.admin.userId), or(isNull(admins.totpLastStep), lt(admins.totpLastStep, step))))
    .returning({ id: admins.userId });
  if (!taken.length) throw new HttpError(status, "这个数字刚用过，等下一个。", errorCode);
}

/** This device unlocked for UNLOCK_HOURS, and confirmed just now */
async function openDevice(ctx: AdminContext, now: number) {
  const until = new Date(now + UNLOCK_HOURS * HOUR);
  await db
    .update(sessions)
    .set({ adminUntil: until, adminFreshAt: new Date(now) })
    .where(eq(sessions.id, ctx.session.id));
  ctx.session.adminUntil = until;
  ctx.session.adminFreshAt = new Date(now);
}

/** unlock { code } or unlock { backup }: this device in for UNLOCK_HOURS; a backup code is used up, and the owner told */
export async function unlock(ctx: AdminContext, input: unknown, now = Date.now()): Promise<GateState> {
  const given = (input && typeof input === "object" ? input : {}) as { code?: unknown; backup?: unknown };
  const actor = actorOf(ctx.admin);
  const userId = ctx.admin.userId;
  if (typeof given.backup === "string" && given.backup.trim()) {
    const hash = backupHash(userId, given.backup);
    const used = hash
      ? await db
          .update(adminBackupCodes)
          .set({ usedAt: new Date(now) })
          .where(and(eq(adminBackupCodes.userId, userId), eq(adminBackupCodes.codeHash, hash), isNull(adminBackupCodes.usedAt)))
          .returning({ hash: adminBackupCodes.codeHash })
      : [];
    if (!used.length) return wrongCode(ctx, now, "ADMIN_WRONG", true);
    await db.update(admins).set({ fails: 0, pauses: 0, pausedUntil: null, pauseReason: null }).where(eq(admins.userId, userId));
    await openDevice(ctx, now);
    const left = await backupCodesLeft(userId);
    await logAdmin(actor, "gate", "gate.backup", { detail: `用备用码进来，还剩 ${left} 个` }, now);
    await mailOwner(
      userId,
      "gate.backup",
      `${ctx.admin.alias} 用了一个备用码，还剩 ${left} 个`,
      `${ctx.admin.alias} 在北京时间 ${beijingShort(now)} 用备用码进了管理台，还剩 ${left} 个备用码。\n\n如果不是本人，说明有人登进了这个舟P账号，还拿到了备用码：马上在管理台锁上所有设备、重新生成备用码，再在「我的资料」里退出其他设备。`,
      now,
    );
    return openState(ctx, left, now);
  }
  await takeCode(ctx, given.code, now, "ADMIN_WRONG");
  await openDevice(ctx, now);
  await logAdmin(actor, "gate", "gate.unlock", {}, now);
  return openState(ctx, await backupCodesLeft(userId), now);
}

/**
 * For the heaviest steps: a right code on this device within FRESH_MINUTES, or one sent along with the request
 * (fresh). Without either, 401 ADMIN_FRESH, and the page asks for one beside the button.
 */
export async function requireFresh(ctx: AdminContext, fresh: unknown, now = Date.now()) {
  const at = ctx.session.adminFreshAt?.getTime();
  if (at !== undefined && now - at < FRESH_MINUTES * MINUTE) return;
  if (fresh === undefined || fresh === null || fresh === "") throw new HttpError(401, "这一步要再输一次验证器里的数字。", "ADMIN_FRESH");
  await takeCode(ctx, fresh, now, "ADMIN_FRESH");
  await db.update(sessions).set({ adminFreshAt: new Date(now) }).where(eq(sessions.id, ctx.session.id));
  ctx.session.adminFreshAt = new Date(now);
}

/** 锁上: this device needs a code again */
export async function lockDevice(ctx: AdminContext) {
  await db.update(sessions).set({ adminUntil: null, adminFreshAt: null }).where(eq(sessions.id, ctx.session.id));
}

/** 锁上所有设备: every device of the person needs a code again */
export async function lockAllDevices(ctx: AdminContext) {
  const locked = await db
    .update(sessions)
    .set({ adminUntil: null, adminFreshAt: null })
    .where(and(eq(sessions.userId, ctx.admin.userId), or(isNotNull(sessions.adminUntil), isNotNull(sessions.adminFreshAt))))
    .returning({ id: sessions.id });
  return locked.length;
}

function requireRecentLogin(ctx: AdminContext, now: number) {
  if (!recentLogin(ctx.session, now)) throw new HttpError(403, `为了安全，先退出再登录一次，${SETUP_LOGIN_MINUTES} 分钟内来绑。`, "ADMIN_RELOGIN");
}

/** 绑定验证器, first: a new secret waits (sealed) for its first right code; the QR code and the secret to type in */
export async function setupStart(ctx: AdminContext, now = Date.now()): Promise<SetupStart> {
  requireRecentLogin(ctx, now);
  const secret = newTotpSecret();
  const waiting = await db
    .update(admins)
    .set({ totpPending: seal(secret) })
    .where(and(eq(admins.userId, ctx.admin.userId), isNull(admins.totpSecret)))
    .returning({ id: admins.userId });
  if (!waiting.length) throw new HttpError(400, "验证器已经绑好了。");
  const qr = await QRCode.toString(totpUri(secret, ctx.admin.alias), { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return { qr, secret: groupedSecret(secret) };
}

/** A new set of backup codes in place of the old: only their HMACs are kept */
async function storeBackupCodes(tx: Pick<typeof db, "delete" | "insert">, userId: string, now: number) {
  const codes = makeBackupCodes();
  await tx.delete(adminBackupCodes).where(eq(adminBackupCodes.userId, userId));
  await tx.insert(adminBackupCodes).values(codes.map((c) => ({ userId, codeHash: backupHash(userId, c)!, createdAt: new Date(now) })));
  return codes;
}

/**
 * 绑定验证器, then: the first right code makes the waiting secret the person's, gives them BACKUP_CODES backup codes
 * (shown this once), unlocks this device and tells the owner (the owner's own too, in case it was not them).
 */
export async function setupConfirm(ctx: AdminContext, input: unknown, now = Date.now()): Promise<{ codes: string[]; state: GateState }> {
  requireRecentLogin(ctx, now);
  const code = input && typeof input === "object" ? (input as { code?: unknown }).code : input;
  const userId = ctx.admin.userId;
  const [row] = await db.select({ pending: admins.totpPending, secret: admins.totpSecret }).from(admins).where(eq(admins.userId, userId)).limit(1);
  if (row?.secret) throw new HttpError(400, "验证器已经绑好了。");
  if (!row?.pending) throw new HttpError(400, "先扫这一页的二维码。");
  if (!cleanCode(code)) throw new HttpError(400, "输入 App 里显示的 6 位数字。");
  let secret: string;
  try {
    secret = open(row.pending);
  } catch {
    throw new HttpError(400, "二维码过期了，刷新页面重新扫。");
  }
  const step = rightStep(secret, code, now);
  if (step === null) throw new HttpError(400, "不对，再看一眼验证器。扫的是这一页的二维码吗？");
  const codes = await db.transaction(async (tx) => {
    const done = await tx
      .update(admins)
      .set({ totpSecret: row.pending, totpPending: null, totpConfirmedAt: new Date(now), totpLastStep: step, fails: 0, pauses: 0, pausedUntil: null, pauseReason: null })
      .where(and(eq(admins.userId, userId), isNull(admins.totpSecret), eq(admins.totpPending, row.pending!)))
      .returning({ id: admins.userId });
    // another tab bound one, or started again with a new QR code, meanwhile
    if (!done.length) throw new HttpError(400, "二维码换过了，刷新页面重新扫。");
    return storeBackupCodes(tx, userId, now);
  });
  await openDevice(ctx, now);
  const actor = actorOf(ctx.admin);
  await logAdmin(actor, "gate", "gate.setup", {}, now);
  await mailOwner(
    userId,
    "gate.setup",
    `${ctx.admin.alias} 绑好了验证器`,
    `${ctx.admin.alias} 在北京时间 ${beijingShort(now)} 绑好了验证器，以后进管理台都要输验证器里的数字。\n\n如果不是本人绑的，说明有人登进了这个舟P账号：在「我的资料」里退出其他设备，再在服务器上重置这个人的验证器（scripts/admin-reset.sql）。`,
    now,
  );
  return { codes, state: openState(ctx, codes.length, now) };
}

/** 重新生成备用码: the whole set replaced (the old ones stop working); the new ones are shown this once */
export async function renewBackupCodes(ctx: AdminContext, now = Date.now()) {
  const codes = await db.transaction((tx) => storeBackupCodes(tx, ctx.admin.userId, now));
  await logAdmin(actorOf(ctx.admin), "gate", "gate.newBackup", { detail: `换了一组 ${codes.length} 个备用码` }, now);
  return codes;
}

/**
 * 重新绑验证器: the person's authenticator and backup codes go, and every device of theirs locks; next time they set
 * one up again. Only one's own for now (a lost phone: come in by backup code, then this).
 */
export async function resetAdminTotp(ctx: AdminContext, userId: unknown, now = Date.now()) {
  const id = userId === undefined || userId === null || userId === "" ? ctx.admin.userId : String(userId);
  if (id !== ctx.admin.userId) throw new HttpError(403, "只能重置你自己的验证器。");
  await db.transaction(async (tx) => {
    await tx
      .update(admins)
      .set({ totpSecret: null, totpPending: null, totpConfirmedAt: null, totpLastStep: null, fails: 0, pauses: 0, pausedUntil: null, pauseReason: null })
      .where(eq(admins.userId, id));
    await tx.delete(adminBackupCodes).where(eq(adminBackupCodes.userId, id));
    await tx.update(sessions).set({ adminUntil: null, adminFreshAt: null }).where(eq(sessions.userId, id));
  });
  await logAdmin(actorOf(ctx.admin), "admin", "admin.reset", { targetId: id, detail: "重置了验证器" }, now);
  await mailOwner(
    id,
    "admin.reset",
    `${ctx.admin.alias} 重置了验证器`,
    `${ctx.admin.alias} 在北京时间 ${beijingShort(now)} 重置了自己的验证器，备用码也都作废了。下次进管理台要重新绑。\n\n如果不是本人，说明有人登进了这个舟P账号：在「我的资料」里退出其他设备。`,
    now,
  );
}

/**
 * One line in admin_log for something done in the 管理台. detail is a short line that never holds a player's name,
 * email or UID. A target gone meanwhile (deleted, banned) is kept as none rather than failing the write.
 */
export async function logAdmin(
  actor: Actor,
  kind: AdminLogKind,
  what: string,
  more: { targetId?: string | null; actionId?: string | null; detail?: string | null } = {},
  now = Date.now(),
) {
  const target = more.targetId && UUID.test(more.targetId) ? more.targetId : null;
  await db.insert(adminLog).values({
    at: new Date(now),
    actorId: actor.id,
    actorAlias: actor.alias,
    kind,
    what,
    targetId: target ? sql`(select ${users.id} from ${users} where ${users.id} = ${target}::uuid)` : null,
    actionId: more.actionId && UUID.test(more.actionId) ? more.actionId : null,
    detail: more.detail ? more.detail.slice(0, 300) : null,
  });
}

/** How long one look at an account lasts: opening it again within this (the page reading it back after a step) is the same look */
export const LOOK_MINUTES = 10;

/** Whether this person's look at this account is already in the 操作记录, within LOOK_MINUTES */
export async function lookedLately(actor: Actor, targetId: string, now = Date.now()) {
  if (!UUID.test(targetId)) return false;
  const n = await db.$count(
    adminLog,
    and(eq(adminLog.actorId, actor.id), eq(adminLog.what, "view.account"), eq(adminLog.targetId, targetId), gt(adminLog.at, new Date(now - LOOK_MINUTES * 60_000))),
  );
  return n > 0;
}

/**
 * Tell the owner about something at the door: at most once an hour for the same thing about the same person (its
 * line in admin_log is already written, so one more there within the hour means one was sent). Subjects start
 * 「舟P 管理台：」. Never anyone's email, only what the 管理台 calls them.
 */
async function mailOwner(personId: string, what: string, subject: string, text: string, now: number) {
  if (!ADMIN_EMAILS.length) return;
  const [recent] = await db
    .select({ n: count() })
    .from(adminLog)
    .where(and(eq(adminLog.what, what), or(eq(adminLog.actorId, personId), eq(adminLog.targetId, personId)), gt(adminLog.at, new Date(now - HOUR))));
  if (recent.n > 1) return;
  try {
    await sendAdminMail(ADMIN_EMAILS, `舟P 管理台：${subject}`, text);
  } catch (e) {
    logError("admin mail", e);
  }
}
