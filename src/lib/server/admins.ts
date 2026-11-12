import "server-only";
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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
  VIEW_LIMIT,
  VIEW_PAUSE_HOURS,
  type AdminLogKind,
  type AdminRole,
  type GateState,
  type GateWho,
  type PauseReason,
  type SetupStart,
} from "../adminConsole";
import { beijingShort } from "../beijing";
import { currentSessionId } from "./auth";
import { db } from "./db";
import { ADMIN_EMAILS, SITE_URL } from "./env";
import { HttpError } from "./http";
import { onReload } from "./live";
import { sendAdminMail } from "./mail";
import { adminBackupCodes, adminLog, admins, sessions, users, type AdminRow, type UserRow } from "./schema";
import { backupHash, makeBackupCodes, open, seal } from "./seal";
import { errorCode, logError } from "./signals";
import { cleanCode, groupedSecret, newTotpSecret, rightStep, totpUri } from "./totp";

/**
 * The 管理台's door. Who may come in: the owner (a sign-in email in ADMIN_EMAILS, which decides it whatever the
 * admins table says) and the moderators the owner adds (adminTeam.ts), who first agree to the rules (pledge).
 * Coming in takes an authenticator code on each device every UNLOCK_HOURS, the heaviest steps one from the last
 * FRESH_MINUTES, and wrong codes pause the person for a while (a moderator also when they open too many accounts
 * in an hour, countView). Everything done inside is kept in admin_log (logAdmin).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Someone the door lets in: their role, what the 管理台 calls them, and their row */
export type Admin = { userId: string; role: AdminRole; alias: string; row: AdminRow };
/** Who did something, as admin_log and mod_actions keep it, and their role, which decides what they see and may do */
export type Actor = { id: string; alias: string; role: AdminRole };
/** This device's sign-in, as far as the door needs it */
export type AdminSession = { id: string; createdAt: Date; adminUntil: Date | null; adminFreshAt: Date | null };
/** A request that came through the door: who, as a player and as an admin, and from which sign-in */
export type AdminContext = { admin: Admin; user: UserRow; session: AdminSession };

export const isOwnerEmail = (email: string | null | undefined) => Boolean(email && ADMIN_EMAILS.includes(email));

export const actorOf = (admin: Admin): Actor => ({ id: admin.userId, alias: admin.alias, role: admin.role });

/**
 * Everyone who may come into the 管理台, and as what: the owner (by ADMIN_EMAILS, even before their first visit) and
 * the moderators. A moderator never sees them: not the cases about them, nor their accounts in a search or opened.
 */
export async function staffRoles(): Promise<Map<string, AdminRole>> {
  const [rows, owners] = await Promise.all([
    db.select({ id: admins.userId, role: admins.role }).from(admins),
    ADMIN_EMAILS.length ? db.select({ id: users.id }).from(users).where(inArray(users.email, ADMIN_EMAILS)) : [],
  ]);
  const roles = new Map<string, AdminRole>(rows.map((r) => [r.id, r.role === "owner" ? "owner" : "mod"]));
  for (const o of owners) roles.set(o.id, "owner");
  return roles;
}

// ---- the moderators, as the map knows them ----

/**
 * The moderators, held in memory by every process for the map alone (me() adds mod: true, and the map shows them
 * 看被举报的蟑螂): read when the process starts, again on every process when the owner adds or removes one
 * (reloadEverywhere("admins")), and every 5 minutes in case the word was missed. Whether they may then do anything
 * is the database's to say, on every request to the 管理台's endpoints (enter). On globalThis, as notices.ts.
 */
type Mods = { ids: ReadonlySet<string>; loading: Promise<void> | null; again: boolean; started: boolean };
const g = globalThis as unknown as { adminMods?: Mods };
const mods = (g.adminMods ??= { ids: new Set(), loading: null, again: false, started: false });
const MODS_RELOAD_MS = 5 * 60_000;

/** Read the moderators again. Asked again meanwhile, it reads once more after, so the last change is never missed. */
export function loadMods(): Promise<void> {
  if (mods.loading) {
    mods.again = true;
    return mods.loading;
  }
  const loading = (async () => {
    try {
      do {
        mods.again = false;
        const rows = await db.select({ id: admins.userId }).from(admins).where(eq(admins.role, "mod"));
        mods.ids = new Set(rows.map((r) => r.id));
      } while (mods.again);
    } finally {
      mods.loading = null;
    }
  })();
  mods.loading = loading;
  return loading;
}

/** At the start of every process (src/instrumentation-node.ts). Never throws: until they can be read, the map shows none. */
export async function startAdmins() {
  if (mods.started) return;
  mods.started = true;
  onReload("admins", loadMods);
  setInterval(() => loadMods().catch((e) => console.error("admins: reading the moderators again failed", errorCode(e))), MODS_RELOAD_MS).unref();
  await loadMods().catch((e) => console.error("admins: reading the moderators failed, so the map shows none for now", errorCode(e)));
}

/** Whether the map shows this player a moderator's tools: from memory, never asking the database */
export const isModHere = (userId: string) => mods.ids.has(userId);

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

/** Paused now: until when, for how many minutes in all, and why; else null */
type Pause = { until: number; minutes: number; reason: PauseReason };
function pauseOf(row: AdminRow, now: number): Pause | null {
  const until = row.pausedUntil?.getTime() ?? 0;
  if (until <= now) return null;
  const reason: PauseReason = row.pauseReason === "views" ? "views" : "codes";
  return { until, minutes: reason === "views" ? VIEW_PAUSE_HOURS * 60 : pauseMinutes(row.pauses), reason };
}
/** The owner needs no rules read; a moderator reads them once, before their first authenticator */
const pledged = (admin: Admin) => admin.role === "owner" || Boolean(admin.row.pledgedAt);
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
  const paused = pauseOf(ctx.admin.row, now);
  if (paused) return { ...who, state: "paused", ...paused };
  if (!ctx.admin.row.totpSecret) return { ...who, state: "setup", recentLogin: recentLogin(ctx.session, now), pledged: pledged(ctx.admin) };
  const backupLeft = await backupCodesLeft(ctx.admin.userId);
  if (!unlockedUntil(ctx.session, now)) return { ...who, state: "locked", triesLeft: Math.max(1, CODE_TRIES - ctx.admin.row.fails), backupLeft };
  return openState(ctx, backupLeft, now);
}

const pausedError = (ctx: AdminContext, p: Pause, now: number) =>
  new HttpError(423, pausedWords(ctx.admin.role, p.until, p.minutes, now, p.reason), "ADMIN_PAUSED", { ...p });

/** Ops the door lets through whatever the state: where one stands, and locking this device */
const ALWAYS = new Set(["gate", "lock"]);
/** Ops for setting up an authenticator (a moderator agreeing to the rules first), only before there is one */
const SETUP_OPS = new Set(["pledge", "setupStart", "setupConfirm"]);

/**
 * The door, for every request to the 管理台's endpoints, in this order: not someone it lets in (404, as if there
 * were no such thing), paused (423), no authenticator yet (403, but for setting one up), this device locked (401,
 * but for unlocking it). What it lets through gets the context; the heaviest ops then ask requireFresh too.
 */
export async function enter(op: string, now = Date.now()): Promise<AdminContext> {
  const ctx = await adminContext();
  if (!ctx) throw new HttpError(404, "没有这个功能。");
  if (ALWAYS.has(op)) return ctx;
  const paused = pauseOf(ctx.admin.row, now);
  if (paused) throw pausedError(ctx, paused, now);
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
      `${ctx.admin.alias} 连续输错了 ${CODE_TRIES} 次${backup ? "备用码" : "验证码"}，管理台先暂停 ${minutesWords(minutes)}，到北京时间 ${beijingShort(until)}。\n\n${ifNotThem(ctx.admin, "在输")}`,
      now,
    );
    throw pausedError(ctx, { until, minutes, reason: "codes" }, now);
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
      `${ctx.admin.alias} 在北京时间 ${beijingShort(now)} 用备用码进了管理台，还剩 ${left} 个备用码。\n\n${
        ctx.admin.role === "owner"
          ? "如果不是本人，说明有人登进了这个舟P账号，还拿到了备用码：马上在管理台锁上所有设备、重新生成备用码，再在「我的资料」里退出其他设备。"
          : ifNotThem(ctx.admin, "")
      }`,
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
  if (!pledged(ctx.admin)) throw new HttpError(403, "先读完管理员守则。");
}

/**
 * 管理员守则, agreed to (「我读过了，会照着做」): a moderator's first step, once, before their first authenticator. One
 * reset later does not ask again. The owner needs none (MOD_ONLY).
 */
export async function pledge(ctx: AdminContext, now = Date.now()): Promise<GateState> {
  if (!ctx.admin.row.pledgedAt) {
    const [row] = await db
      .update(admins)
      .set({ pledgedAt: sql`coalesce(${admins.pledgedAt}, ${new Date(now).toISOString()}::timestamptz)` })
      .where(eq(admins.userId, ctx.admin.userId))
      .returning();
    if (row) ctx.admin.row = row;
    await logAdmin(actorOf(ctx.admin), "gate", "gate.pledge", {}, now);
  }
  return gateState(ctx, now);
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
    `${ctx.admin.alias} 在北京时间 ${beijingShort(now)} 绑好了验证器，以后进管理台都要输验证器里的数字。\n\n${
      ctx.admin.role === "owner"
        ? "如果不是本人绑的，说明有人登进了这个舟P账号：在「我的资料」里退出其他设备，再在服务器上重置这个人的验证器（scripts/admin-reset.sql）。"
        : ifNotThem(ctx.admin, "绑的")
    }`,
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
 * one up again (a moderator without reading the rules again). One's own (a lost phone: come in by backup code, then
 * this), or for the owner a moderator's, who is told so by email; the owner is told either way, in case it was not them.
 */
export async function resetAdminTotp(ctx: AdminContext, input: unknown, now = Date.now()) {
  // { userId } as the 管理员 page sends it, or the id alone; none: one's own
  const userId = input && typeof input === "object" ? (input as { userId?: unknown }).userId : input;
  const id = userId === undefined || userId === null || userId === "" ? ctx.admin.userId : String(userId);
  const own = id === ctx.admin.userId;
  let them = { alias: ctx.admin.alias, email: null as string | null };
  if (!own) {
    if (ctx.admin.role !== "owner") throw new HttpError(403, "只能重置你自己的验证器。");
    const [row] = UUID.test(id)
      ? await db
          .select({ alias: admins.alias, role: admins.role, email: users.email })
          .from(admins)
          .innerJoin(users, eq(users.id, admins.userId))
          .where(eq(admins.userId, id))
          .limit(1)
      : [];
    if (!row || row.role !== "mod") throw new HttpError(400, "找不到这位管理员了。");
    them = row;
  }
  await db.transaction(async (tx) => {
    await tx
      .update(admins)
      .set({ totpSecret: null, totpPending: null, totpConfirmedAt: null, totpLastStep: null, fails: 0, pauses: 0, pausedUntil: null, pauseReason: null })
      .where(eq(admins.userId, id));
    await tx.delete(adminBackupCodes).where(eq(adminBackupCodes.userId, id));
    await tx.update(sessions).set({ adminUntil: null, adminFreshAt: null }).where(eq(sessions.userId, id));
  });
  await logAdmin(actorOf(ctx.admin), "admin", "admin.reset", { targetId: id, detail: own ? "重置了自己的验证器" : `重置了「${them.alias}」的验证器` }, now);
  if (!own) await mailPerson(them.email, "舟P 管理台：你的验证器被重置了", `站长重置了你的验证器。下次打开管理台时重新绑定。\n\n${SITE_URL}/admin`);
  await mailOwner(
    id,
    "admin.reset",
    own ? `${ctx.admin.alias} 重置了验证器` : `重置了「${them.alias}」的验证器`,
    own
      ? `${ctx.admin.alias} 在北京时间 ${beijingShort(now)} 重置了自己的验证器，备用码也都作废了。下次进管理台要重新绑。\n\n如果不是本人，说明有人登进了这个舟P账号：在「我的资料」里退出其他设备。`
      : `北京时间 ${beijingShort(now)}，「${them.alias}」的验证器被重置了，备用码也都作废了。TA 下次进管理台要重新绑。\n\n${NOT_YOU}`,
    now,
  );
}

/**
 * A moderator's look at one more account (one not in the 操作记录 within LOOK_MINUTES): the VIEW_LIMITth within an
 * hour is not shown, and pauses them VIEW_PAUSE_HOURS (the owner may lift it early, adminTeam.ts unpauseAdmin) and
 * tells the owner, once (only one request sets the pause). The map's 看被举报的蟑螂 is not counted, and the owner has
 * no limit.
 */
export async function countView(ctx: AdminContext, now = Date.now()) {
  if (ctx.admin.role !== "mod") return;
  const seen = await db.$count(adminLog, and(eq(adminLog.actorId, ctx.admin.userId), eq(adminLog.what, "view.account"), gt(adminLog.at, new Date(now - HOUR))));
  if (seen + 1 < VIEW_LIMIT) return;
  const pause: Pause = { until: now + VIEW_PAUSE_HOURS * HOUR, minutes: VIEW_PAUSE_HOURS * 60, reason: "views" };
  const set = await db
    .update(admins)
    .set({ pausedUntil: new Date(pause.until), pauseReason: "views" })
    .where(and(eq(admins.userId, ctx.admin.userId), or(isNull(admins.pausedUntil), lt(admins.pausedUntil, new Date(now)))))
    .returning({ id: admins.userId });
  if (set.length) {
    const alias = ctx.admin.alias;
    await logAdmin(actorOf(ctx.admin), "gate", "gate.views", { detail: `一小时里打开账号到了 ${VIEW_LIMIT} 个，暂停 ${VIEW_PAUSE_HOURS} 小时` }, now);
    await mailOwner(
      ctx.admin.userId,
      "gate.views",
      `${alias} 一小时里看了太多账号，暂停到 ${clockWords(pause.until, now)}`,
      `${alias} 一小时里打开账号到了 ${VIEW_LIMIT} 个的上限，管理台先暂停 ${VIEW_PAUSE_HOURS} 小时，到北京时间 ${beijingShort(pause.until)}。\n\n如果 TA 是在正常处理举报，可以在管理台的「管理员」页提前解除；如果不是，在那里移除 TA。`,
      now,
    );
  }
  throw pausedError(ctx, pause, now);
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

/** The end of a mail to the owner about a step they may not have taken themselves */
export const NOT_YOU = "如果不是你做的，说明有人登进了你的舟P账号：马上在管理台锁上所有设备，再在「我的资料」里退出其他设备。";

/** For the owner, about a moderator at the door: what to do if it was not them */
const ifNotThem = (admin: Admin, doing: string) => `不是 ${admin.alias} 本人${doing}的话，去管理台的「管理员」页重置 TA 的验证器，或者移除 TA。`;

/**
 * Tell the owner about something in the 管理台: at most once an hour for the same thing about the same person (its
 * line in admin_log is already written, so one more there within the hour means one was sent). Subjects start
 * 「舟P 管理台：」. Never a player's email or name, only what the 管理台 calls its people.
 */
export async function mailOwner(personId: string, what: string, subject: string, text: string, now: number) {
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

/** Tell one of the 管理台's people something at their own sign-in email (never anyone else's details) */
export async function mailPerson(email: string | null | undefined, subject: string, text: string) {
  if (!email) return;
  try {
    await sendAdminMail([email], subject, text);
  } catch (e) {
    logError("admin mail", e);
  }
}
