import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beijingDayWords } from "@/lib/beijing";
import { RULES } from "@/lib/safety";
import { deleteAccount } from "@/lib/server/account";
import { db } from "@/lib/server/db";
import { sendAdminMail } from "@/lib/server/mail";
import { forgetNameWords } from "@/lib/server/nameWords";
import { resetRoachFeed } from "@/lib/server/roachFeed";
import { adminBackupCodes, adminLog, admins, bannedEmails, clearedValues, modActions, nameWords, reports, roaches, sessions, users } from "@/lib/server/schema";
import { staffItems } from "@/lib/server/staffNotes";
import { totpCode, totpStep } from "@/lib/server/totp";
import * as world from "@/lib/server/world";
import { POST } from "./route";

// the route reads its cookie as any page does; here, the one this test signed in with
const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sid" && jar.token ? { name, value: jar.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/server/mail", () => ({ sendAdminMail: vi.fn(), sendLoginCode: vi.fn() }));
vi.mock("@/lib/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/env")>()),
  ADMIN_EMAILS: ["owner@example.com"],
}));

const MINUTE = 60_000;
const DAY = 86_400_000;
const TOKYO = { lng: 139.7, lat: 35.68 };
const SHANGHAI = { lng: 121.47, lat: 31.23 };
const PARK = { lng: 139.75, lat: 35.69 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the endpoint answers in many shapes, which the tests read into freely
type Answer = { result?: any; error?: string; code?: string; until?: number; minutes?: number; triesLeft?: number };

async function call(op: string, args: unknown[] = [], more: Record<string, unknown> = {}) {
  const req = new NextRequest(`http://localhost/api/admin/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ args, ...more }),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Answer, cache: res.headers.get("cache-control") };
}

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const codeNow = (secret: string, steps = 0) => totpCode(secret, totpStep(Date.now()) + steps);

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

/** A device signed in as the player that long ago; the requests from here on come from it */
async function device(userId: string, minutesAgo = 0) {
  const token = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(token).digest("base64url");
  await db.insert(sessions).values({ id, userId, createdAt: new Date(Date.now() - minutesAgo * MINUTE), expiresAt: new Date(Date.now() + 20 * DAY) });
  jar.token = token;
  return { token, id };
}
const use = (d: { token: string }) => (jar.token = d.token);

/** The owner with an authenticator set up and this device unlocked: its secret and backup codes */
async function owner() {
  const user = await account("owner@example.com");
  const here = await device(user.id);
  const start = await call("setupStart");
  const secret = String(start.body.result.secret).replace(/\s/g, "");
  const done = await call("setupConfirm", [{ code: codeNow(secret) }]);
  expect(done.status).toBe(200);
  // that step's code is used: the next one is the first to take
  later(30_000);
  return { user, here, secret, codes: done.body.result.codes as string[] };
}

/** A named player with a main roach in Tokyo */
async function player(email: string, name = "小坏") {
  const u = await account(email);
  await db.update(users).set({ name, anonymous: false }).where(eq(users.id, u.id));
  await world.placeRoach(u.id, { kind: "main" }, TOKYO);
  return u;
}

/** A report of a player by someone else (a new account each time unless given) */
async function reported(target: { id: string; name: string }, reason: string, more: Partial<typeof reports.$inferInsert> = {}, by?: string) {
  const reporterId = by ?? (await account(`r${randomBytes(4).toString("hex")}@example.com`)).id;
  const [r] = await db
    .insert(reports)
    .values({ reporterId, targetId: target.id, reason, context: "x", targetName: target.name || "x", ...more })
    .returning();
  return r;
}

/** A report of a roach of theirs where it stands now */
async function roachReported(roach: { id: string; userId: string; slot: number; lng: number; lat: number }, reason: string, nearM: number | null = null, by?: string) {
  return reported({ id: roach.userId, name: "x" }, reason, { roachId: roach.id, placeLng: roach.lng, placeLat: roach.lat, roachSlot: roach.slot, nearM }, by);
}

const roachesOf = (userId: string) => db.select().from(roaches).where(eq(roaches.userId, userId)).orderBy(roaches.slot);
const logged = async () => (await db.select().from(adminLog).orderBy(adminLog.id)).map((l) => l.what);
const staffTexts = async (userId: string) => (await staffItems(userId, new Date(0))).map((i) => (i.kind === "staff" ? i.text : ""));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now());
  await db.execute(sql`truncate ${users}, ${bannedEmails}, ${nameWords} cascade`);
  forgetNameWords();
  resetRoachFeed();
  jar.token = null;
  vi.mocked(sendAdminMail).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const OPS = ["gate", "unlock", "lock", "lockAll", "setupStart", "setupConfirm", "newBackupCodes", "resetAdminTotp", "cases", "resolve", "account", "act", "undo", "log", "reportedRoaches", "nope"];

describe("the 管理台's door", () => {
  it("is a 404 for everyone it does not let in, for every op, and keeps nothing in a cache", async () => {
    const check = async (who: string) => {
      for (const op of OPS) {
        const res = await call(op);
        expect([res.status, res.body.error, res.cache], `${who} ${op}`).toEqual([404, "没有这个功能。", "no-store"]);
      }
    };
    await check("nobody signed in");
    const p = await account("player@example.com");
    await device(p.id);
    await check("a player");
    // a row left from when they were the owner lets nobody in: ADMIN_EMAILS decides
    await db.insert(admins).values({ userId: p.id, role: "owner", alias: "站长" });
    await check("an owner no more");
    expect(await logged()).toEqual([]);
  });

  it("has the owner set up an authenticator first, only soon after signing in", async () => {
    const me = await account("owner@example.com");
    await device(me.id, 20);
    expect((await call("gate")).body.result).toEqual({ alias: "站长", role: "owner", email: "ow***@example.com", state: "setup", recentLogin: false });
    // their row is made on their first visit
    expect(await db.select({ alias: admins.alias, role: admins.role }).from(admins)).toEqual([{ alias: "站长", role: "owner" }]);
    for (const op of ["cases", "unlock", "account", "log", "reportedRoaches"]) {
      expect((await call(op)).body, op).toMatchObject({ code: "ADMIN_SETUP" });
    }
    expect((await call("setupStart")).body).toEqual({ error: "为了安全，先退出再登录一次，15 分钟内来绑。", code: "ADMIN_RELOGIN" });

    await device(me.id, 1);
    expect((await call("gate")).body.result).toMatchObject({ state: "setup", recentLogin: true });
    const start = (await call("setupStart")).body.result;
    expect(start.qr).toMatch(/^<svg/);
    expect(start.secret).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    const secret = start.secret.replace(/\s/g, "");
    // only sealed at rest
    const [row] = await db.select().from(admins);
    expect(row.totpPending).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(secret);

    // a wrong code is no wrong try: nothing to guess yet
    expect((await call("setupConfirm", [{ code: codeNow(secret, 3) }])).body.error).toBe("不对，再看一眼验证器。扫的是这一页的二维码吗？");
    expect((await db.select().from(admins))[0].fails).toBe(0);
    const done = await call("setupConfirm", [{ code: codeNow(secret) }]);
    expect(done.body.result.codes).toHaveLength(10);
    expect(done.body.result.state).toMatchObject({ state: "open", backupLeft: 10 });
    expect((await call("cases")).status).toBe(200);
    expect((await call("setupStart")).body.error).toBe("验证器已经绑好了。");
    expect(await logged()).toEqual(["gate.setup", "view.cases"]);
    expect(vi.mocked(sendAdminMail).mock.calls.map(([to, subject]) => [to, subject])).toEqual([[["owner@example.com"], "舟P 管理台：站长 绑好了验证器"]]);
    const [mailText] = vi.mocked(sendAdminMail).mock.calls.map((c) => c[2]);
    expect(mailText).not.toContain("owner@example.com");
  });

  it("unlocks each device for 12 hours with a code, and takes each code once", async () => {
    const { user, secret, codes } = await owner();
    const other = await device(user.id);
    expect((await call("gate")).body.result).toMatchObject({ state: "locked", triesLeft: 5, backupLeft: 10 });
    expect((await call("cases")).body).toEqual({ error: "这台设备要先输验证器里的数字。", code: "ADMIN_LOCKED" });
    const code = codeNow(secret);
    expect((await call("unlock", [{ code }])).body.result).toMatchObject({ state: "open", backupLeft: 10 });
    expect((await call("cases")).status).toBe(200);
    // the same number on a third device: used, and no wrong try
    await device(user.id);
    expect((await call("unlock", [{ code }])).body.error).toBe("这个数字刚用过，等下一个。");
    expect((await db.select().from(admins))[0].fails).toBe(0);
    expect((await call("unlock", [{ code: "12345" }])).body.error).toBe("输入验证器里的 6 位数字。");

    use(other);
    later(12 * 60 * MINUTE + MINUTE);
    expect((await call("cases")).body.code).toBe("ADMIN_LOCKED");
    expect((await call("unlock", [{ code: codeNow(secret) }])).status).toBe(200);
    expect((await call("lock")).status).toBe(200);
    expect((await call("cases")).body.code).toBe("ADMIN_LOCKED");

    // 锁上所有设备
    later(30_000);
    await call("unlock", [{ code: codeNow(secret) }]);
    expect((await call("lockAll")).status).toBe(200);
    expect(await db.$count(sessions, and(eq(sessions.userId, user.id), sql`${sessions.adminUntil} is not null`))).toBe(0);
    expect((await call("cases")).body.code).toBe("ADMIN_LOCKED");
    expect(codes).toHaveLength(10);
    expect(await logged()).toEqual(["gate.setup", "gate.unlock", "view.cases", "gate.unlock", "gate.lock", "gate.unlock", "gate.lockAll"]);
  });

  it("pauses the person after five wrong codes in a row on any device, twice as long each time, a day at most", async () => {
    const { user, secret } = await owner();
    const wrong = () => codeNow(secret, 5);
    const a = await device(user.id);
    for (let i = 0; i < 3; i++) {
      const res = await call("unlock", [{ code: wrong() }]);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "ADMIN_WRONG", triesLeft: 4 - i });
    }
    expect((await call("unlock", [{ code: wrong() }])).body.error).toBe("不对，再看一眼验证器。连续错 5 次会暂停 15 分钟，还能再试 1 次。");
    expect((await call("gate")).body.result).toMatchObject({ state: "locked", triesLeft: 1 });
    // the fifth on another device of theirs
    await device(user.id);
    const paused = await call("unlock", [{ code: wrong() }]);
    expect(paused.status).toBe(423);
    expect(paused.body.code).toBe("ADMIN_PAUSED");
    expect(paused.body.until! - Date.now()).toBe(15 * MINUTE);
    expect(paused.body.error).toMatch(/^输错太多次，先暂停 15 分钟（到 \d\d:\d\d）。已经发邮件到你的邮箱。/);
    expect(vi.mocked(sendAdminMail).mock.calls.at(-1)![1]).toMatch(/^舟P 管理台：站长 连续输错验证码，暂停到 /);
    // paused: even the right code, and everything else
    use(a);
    expect((await call("unlock", [{ code: codeNow(secret) }])).status).toBe(423);
    expect((await call("cases")).status).toBe(423);
    expect((await call("gate")).body.result).toMatchObject({ state: "paused", minutes: 15 });

    later(16 * MINUTE);
    for (let i = 0; i < 4; i++) await call("unlock", [{ code: wrong() }]);
    const again = await call("unlock", [{ code: wrong() }]);
    expect(again.body.until! - Date.now()).toBe(30 * MINUTE);
    expect(again.body.error).toMatch(/^输错太多次，先暂停 30 分钟/);

    // a day at most
    await db.update(admins).set({ pauses: 9, pausedUntil: null });
    for (let i = 0; i < 5; i++) await call("unlock", [{ code: wrong() }]);
    const [row] = await db.select().from(admins);
    expect(row.pausedUntil!.getTime() - Date.now()).toBe(DAY);
    expect((await call("gate")).body.result).toMatchObject({ state: "paused", minutes: 24 * 60 });

    // a right code starts it all again
    later(DAY + MINUTE);
    await call("unlock", [{ code: wrong() }]);
    expect((await call("unlock", [{ code: codeNow(secret) }])).status).toBe(200);
    expect((await db.select().from(admins))[0]).toMatchObject({ fails: 0, pauses: 0, pausedUntil: null });
    expect((await logged()).filter((w) => w === "gate.pause")).toHaveLength(3);
    expect((await logged()).filter((w) => w === "gate.fail")).toHaveLength(16);
  });

  it("takes each backup code once, and a new set in place of the old", async () => {
    const { user, secret, codes } = await owner();
    await device(user.id);
    const typed = ` ${codes[0].toLowerCase().replace("-", " ")} `;
    expect((await call("unlock", [{ backup: typed }])).body.result).toMatchObject({ state: "open", backupLeft: 9 });
    expect(vi.mocked(sendAdminMail).mock.calls.at(-1)![1]).toBe("舟P 管理台：站长 用了一个备用码，还剩 9 个");
    await device(user.id);
    expect((await call("unlock", [{ backup: codes[0] }])).body).toMatchObject({ code: "ADMIN_WRONG", triesLeft: 4 });
    expect((await call("unlock", [{ backup: codes[1] }])).status).toBe(200);
    expect(await db.$count(adminBackupCodes, isNull(adminBackupCodes.usedAt))).toBe(8);

    // a new set wants a fresh code once the last is over ten minutes old
    later(11 * MINUTE);
    expect((await call("newBackupCodes")).body).toEqual({ error: "这一步要再输一次验证器里的数字。", code: "ADMIN_FRESH" });
    expect((await call("newBackupCodes", [], { fresh: codeNow(secret, 5) })).body).toMatchObject({ code: "ADMIN_FRESH", triesLeft: 4 });
    const fresh = await call("newBackupCodes", [], { fresh: codeNow(secret) });
    expect(fresh.body.result).toHaveLength(10);
    expect(fresh.body.result).not.toContain(codes[2]);
    // fresh now: no code for the next ten minutes
    expect((await call("newBackupCodes")).status).toBe(200);
    await device(user.id);
    expect((await call("unlock", [{ backup: codes[2] }])).status).toBe(400);
    expect((await call("unlock", [{ backup: fresh.body.result[0] }])).status).toBe(400);
    expect(await logged()).toEqual(["gate.setup", "gate.backup", "gate.fail", "gate.backup", "gate.fail", "gate.newBackup", "gate.newBackup", "gate.fail", "gate.fail"]);
  });

  it("resets one's own authenticator after a fresh code: every device locks, and the backup codes go", async () => {
    const { user, secret } = await owner();
    // signed in too long ago to set one up again straight away
    later(16 * MINUTE);
    const other = await call("resetAdminTotp", [user.id]);
    expect(other.body.code).toBe("ADMIN_FRESH");
    expect((await call("resetAdminTotp", ["11111111-1111-4111-8111-111111111111"], { fresh: codeNow(secret) })).body.error).toBe("只能重置你自己的验证器。");
    expect((await call("resetAdminTotp", [user.id])).status).toBe(200);
    expect((await call("gate")).body.result).toMatchObject({ state: "setup", recentLogin: false });
    expect(await db.$count(adminBackupCodes)).toBe(0);
    expect((await db.select().from(admins))[0]).toMatchObject({ totpSecret: null, totpLastStep: null });
    expect(vi.mocked(sendAdminMail).mock.calls.at(-1)![1]).toBe("舟P 管理台：站长 重置了验证器");
    expect((await logged()).at(-1)).toBe("admin.reset");
  });
});

describe("the 管理台's ops", () => {
  it("asks for a fresh code before a ban, and keeps the ban in the log after the account is gone", async () => {
    const { secret } = await owner();
    const bad = await player("bad@example.com");
    await reported(bad, "spam");
    later(11 * MINUTE);
    expect((await call("resolve", [bad.id, "ban"])).body.code).toBe("ADMIN_FRESH");
    expect((await call("act", [{ id: bad.id, action: "ban" }])).body.error).toBe("先选一条 TA 违反的规则。");
    expect((await call("resolve", [bad.id, "ban", "harass"], { fresh: codeNow(secret) })).status).toBe(200);
    expect(await db.$count(users, eq(users.id, bad.id))).toBe(0);
    const [line] = await db.select().from(adminLog).where(eq(adminLog.what, "act.ban"));
    expect(line).toMatchObject({ targetId: null, actorAlias: "站长", detail: `违反：${RULES.harass}` });
    const page = (await call("log")).body.result;
    expect(page.entries[0]).toMatchObject({ what: "act.ban", target: null, gone: true, canUndo: false });
  });

  it("finds accounts by name, the start of their id, or a game UID, and keeps what was searched masked when it was an email or a UID", async () => {
    await owner();
    const bad = await player("bad.player@example.com", "号称最强博士");
    await db.update(users).set({ uidArknights: "00050005", suspendedUntil: new Date(Date.now() + DAY) }).where(eq(users.id, bad.id));
    await reported(bad, "name");
    for (const q of ["号称", bad.id.slice(0, 8), "0005 0005", "00050", "bad.player@"]) {
      const found = (await call("findPlayers", [q])).body.result;
      expect(found.players.map((p: { id: string }) => p.id), q).toEqual([bad.id]);
    }
    expect((await call("findPlayers", ["0005"])).body.result.total).toBe(1);
    expect((await call("findPlayers", ["50005"])).body.result.total).toBe(0);
    const [found] = (await call("findPlayers", ["号称"])).body.result.players;
    expect(found).toMatchObject({ yellow: 0, open: 1, held: false });
    expect(found.suspendedUntil).toBeGreaterThan(Date.now());
    const details = (await db.select().from(adminLog).where(eq(adminLog.what, "search")).orderBy(adminLog.id)).map((l) => l.detail);
    expect(details[0]).toBe("搜「号称」，找到 1 个");
    expect(details.slice(2).join(" ")).not.toMatch(/0005|bad\.player/);
    expect(details[4]).toBe("搜「ba***@」，找到 1 个");
  });

  it("acts on any account under a rule it must pick, records who, and tells the player which rule", async () => {
    await owner();
    const p = await player("plain@example.com", "收一手号私聊");
    const open = await reported(p, "contact");
    expect((await call("act", [{ id: p.id, action: "warn" }])).body.error).toBe("先选一条 TA 违反的规则。");
    expect((await call("act", [{ id: p.id, action: "dismiss", rule: "contact" }])).body.error).toBe("不知道要怎么处理。");
    const item = (await call("act", [{ id: p.id, action: "warn", rule: "contact" }])).body.result;
    expect(item).toMatchObject({ action: "warn", rule: "contact", by: "站长", canUndo: true, undoneAt: null });
    const [a] = await db.select().from(modActions).where(eq(modActions.userId, p.id));
    expect(a).toMatchObject({ byAlias: "站长", yellow: true, rule: "contact" });
    expect((await db.select().from(reports).where(eq(reports.id, open.id)))[0].resolution).toBe("warned");
    expect((await staffTexts(p.id))[0]).toContain(`「${RULES.contact}」`);
    const lines = await db.select().from(adminLog).where(eq(adminLog.what, "act.warn"));
    expect(lines).toMatchObject([{ targetId: p.id, actionId: a.id, detail: `违反：${RULES.contact}` }]);

    // the whole account, without who reported
    const full = (await call("account", [p.id])).body.result;
    expect(full.history).toMatchObject([{ actionId: a.id, by: "站长" }]);
    expect(full.reports).toMatchObject([{ reason: "contact", resolution: "warned", by: "站长" }]);
    expect(JSON.stringify(full)).not.toContain(open.reporterId!);
    expect(full.person.yellow).toBe(1);
    expect((await call("account", ["11111111-1111-4111-8111-111111111111"])).body).toEqual({ error: "这个账号已经不在了。" });
  });

  it("undoes warnings, pauses, clearings and age questions, and tells the player; not a dismissal, a roach taken back or a ban", async () => {
    await owner();
    const p = await player("p@example.com", "收一手号私聊");
    await db.update(users).set({ uidArknights: "12345678" }).where(eq(users.id, p.id));
    const act = async (action: string, rule = "harass") => (await call("act", [{ id: p.id, action, rule }])).body.result;

    const warned = await act("warn");
    expect((await call("undo", [warned.actionId])).body.result).toMatchObject({ undoneAt: expect.any(Number), canUndo: false });
    expect((await call("account", [p.id])).body.result.person.yellow).toBe(0);
    expect((await staffTexts(p.id)).some((t) => t === `站长撤销了 ${beijingDayWords(Date.now())}对你的处理，黄牌不算了。`)).toBe(true);
    expect((await call("undo", [warned.actionId])).body.error).toBe("这次处理已经撤销了。");

    const suspended = await act("suspend");
    expect((await db.select().from(users).where(eq(users.id, p.id)))[0].suspendedUntil).not.toBeNull();
    await call("undo", [suspended.actionId]);
    expect((await db.select().from(users).where(eq(users.id, p.id)))[0].suspendedUntil).toBeNull();

    const aged = await act("ageCheck", "age");
    await call("undo", [aged.actionId]);
    expect((await db.select().from(users).where(eq(users.id, p.id)))[0].ageCheckAt).toBeNull();

    for (const action of ["clearName", "clearUid", "clearBoth"]) {
      await db.update(users).set({ name: "收一手号私聊", anonymous: false, uidArknights: "12345678" }).where(eq(users.id, p.id));
      const cleared = await act(action, "name");
      expect(await db.$count(clearedValues, eq(clearedValues.actionId, cleared.actionId)), action).toBeGreaterThan(0);
      await call("undo", [cleared.actionId]);
      expect(await db.$count(clearedValues, eq(clearedValues.actionId, cleared.actionId)), action).toBe(0);
    }

    // while an appeal waits: as if the appeal won
    const appealed = await act("warn");
    await db.update(modActions).set({ appeal: "不是我", appealedAt: new Date() }).where(eq(modActions.id, appealed.actionId));
    await call("undo", [appealed.actionId]);
    expect((await db.select().from(modActions).where(eq(modActions.id, appealed.actionId)))[0]).toMatchObject({ appealResult: "reverted" });
    expect((await staffTexts(p.id)).some((t) => t.startsWith("站长看了你的申诉：撤销了这次处理"))).toBe(true);
    // an undone action cannot be appealed any more
    const undoneNote = (await staffItems(p.id, new Date(0))).find((i) => i.kind === "staff" && i.appeal?.actionId === warned.actionId);
    expect(undoneNote && undoneNote.kind === "staff" && undoneNote.appeal?.state).toBe("answered");

    // the log: each undo, and the line of what it undid marked
    const lines = await db.select().from(adminLog).where(eq(adminLog.actionId, warned.actionId)).orderBy(adminLog.id);
    expect(lines.map((l) => [l.what, Boolean(l.undoneAt)])).toEqual([
      ["act.warn", true],
      ["act.undo", false],
    ]);
    const page = (await call("log", [{ kind: "act" }])).body.result;
    const warnLine = page.entries.find((e: { what: string; actionId: string }) => e.what === "act.warn" && e.actionId === warned.actionId);
    // (the name cleared by the last clearing above)
    expect(warnLine).toMatchObject({ undone: true, canUndo: false, target: { id: p.id, name: "（没有名字）" } });

    // what cannot be given back
    const bad = await player("bad@example.com");
    const [roach] = await roachesOf(bad.id);
    await roachReported(roach, "place");
    await reported(bad, "spam");
    await call("resolve", [bad.id, "dismiss"]);
    await call("resolve", [`roach:${roach.id}`, "removeRoach", "roach"]);
    for (const a of await db.select().from(modActions).where(eq(modActions.userId, bad.id))) {
      expect((await call("undo", [a.id])).body.error, a.action).toBe("这种处理撤销不了。");
    }
  });

  it("lifts a pause, keeps notes no player sees, and puts every op in the log with the account it was about", async () => {
    const { user } = await owner();
    const p = await player("p@example.com", "夜莺不睡觉");
    expect((await call("unsuspend", [p.id])).body.error).toBe("TA 现在没有被暂停。");
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + DAY), suspendedAuto: true }).where(eq(users.id, p.id));
    expect((await call("unsuspend", [p.id])).body.result).toMatchObject({ action: "unsuspend", by: "站长", canUndo: false });
    expect((await db.select().from(users).where(eq(users.id, p.id)))[0]).toMatchObject({ suspendedUntil: null, suspendedAuto: false });
    expect(await staffTexts(p.id)).toContain("站长看过了，没发现问题，你的互动恢复了。");

    expect((await call("addNote", [p.id, "   "])).body.error).toBe("备注不能是空的。");
    expect((await call("addNote", [p.id, "x".repeat(501)])).body.error).toBe("备注最多 500 个字。");
    expect((await call("addNote", [p.id, " 换过两个号了 "])).body.result).toMatchObject({ by: "站长", text: "换过两个号了" });
    expect((await call("notes", [p.id])).body.result).toMatchObject([{ text: "换过两个号了" }]);
    expect(JSON.stringify(await world.inbox(p.id))).not.toContain("换过两个号了");

    await call("cases");
    await call("cases", [{ auto: true }]);
    await call("account", [p.id]);
    // read back after a step: the same look
    await call("account", [p.id]);
    await call("banInfo", ["p@example.com"]);
    await call("giveBadge", ["p@example.com", "beta"]);
    await call("addNameWords", ["坏词\n另一个"]);
    await call("status");
    await call("appeals");
    await call("retention");
    await call("log");
    await call("gate");
    expect(await logged()).toEqual([
      "gate.setup",
      "act.unsuspend",
      "act.note",
      "view.cases",
      "view.account",
      "search",
      "act.badge",
      "act.nameWords",
    ]);
    const all = await db.select().from(adminLog).orderBy(adminLog.id);
    expect(all.find((l) => l.what === "search")!.detail).toBe("查邮箱 p***@example.com");
    expect(all.find((l) => l.what === "act.nameWords")!.detail).toBe("加了 2 个词：坏词、另一个");
    expect(all.every((l) => l.actorId === user.id && l.actorAlias === "站长")).toBe(true);
    expect(JSON.stringify(all.map((l) => l.detail))).not.toMatch(/夜莺|p@example\.com/);

    const page = (await call("log")).body.result;
    expect(page.today).toEqual({ acts: 4, views: 2, searches: 1, fails: 0 });
    expect(page.entries[0]).toMatchObject({ what: "act.nameWords", target: null, gone: false });
    expect(page.entries.find((e: { what: string }) => e.what === "view.account")).toMatchObject({ target: { id: p.id, name: "夜莺不睡觉" } });
    expect((await call("log", [{ kind: "look" }])).body.result.entries.map((e: { kind: string }) => e.kind)).toEqual(["search", "view", "view"]);
    expect((await call("log", [{ limit: 2 }])).body.result).toMatchObject({ more: true });
    const before = (await call("log", [{ limit: 2 }])).body.result.entries[1].id;
    expect((await call("log", [{ before, limit: 100 }])).body.result.entries.every((e: { id: number }) => e.id < before)).toBe(true);

    // the account gone: the lines stay, without whose it was
    const [row] = await db.select().from(users).where(eq(users.id, p.id));
    await deleteAccount(row);
    expect(await db.$count(adminLog, eq(adminLog.targetId, p.id))).toBe(0);
    expect((await call("log")).body.result.entries.find((e: { what: string }) => e.what === "view.account")).toMatchObject({ target: null, gone: true });
  });

  it("clears names the list blocks with a record each, leaving their other reports open", async () => {
    await owner();
    await call("addNameWords", ["坏词"]);
    const p = await player("p@example.com", "坏词小王");
    const open = await reported(p, "spam");
    expect((await call("clearNames", [[p.id]])).body.result).toBe(1);
    const [a] = await db.select().from(modActions).where(eq(modActions.userId, p.id));
    expect(a).toMatchObject({ action: "clearName", rule: "name", byAlias: "站长" });
    expect((await db.select().from(reports).where(eq(reports.id, open.id)))[0].resolvedAt).toBeNull();
    expect((await db.select().from(adminLog).where(eq(adminLog.what, "act.clearName")))[0]).toMatchObject({ targetId: p.id, actionId: a.id });
    expect((await call("undo", [a.id])).status).toBe(200);
  });
});

describe("the map's reported roaches", () => {
  async function scene() {
    const bad = await player("bad@example.com");
    await world.placeRoach(bad.id, { kind: "clone" }, PARK);
    const [main, clone] = await roachesOf(bad.id);
    const reporter = await account("reporter@example.com");
    await world.placeRoach(reporter.id, { kind: "main" }, SHANGHAI);
    const [theirs] = await roachesOf(reporter.id);
    // the clone put somewhere it should not be, twice; the main one beside the reporter's
    await roachReported(clone, "place");
    await roachReported(clone, "place");
    await roachReported(main, "stalk", 40, reporter.id);
    // someone reported only for their name: none of their roaches is about a place
    const named = await player("named@example.com", "名字有问题");
    await reported(named, "name");
    return { bad, main, clone, reporter, theirs, named };
  }

  it("lists the roach cases open for where a roach was put, as 待处理 counts them, never who reported or where they are", async () => {
    await owner();
    const { bad, main, clone, reporter, theirs, named } = await scene();
    const res = (await call("reportedRoaches", [{ view: "place" }])).body.result;
    expect(res.view).toBe("place");
    const places = res.places;
    expect(places.map((p: { caseId: string }) => p.caseId)).toEqual([`roach:${clone.id}`, `roach:${main.id}`]);
    const [c, m] = places;
    expect(c).toMatchObject({
      id: clone.publicId,
      main: false,
      owner: "小坏",
      now: { lng: PARK.lng, lat: PARK.lat },
      was: { lng: PARK.lng, lat: PARK.lat },
      state: "here",
      reasons: [{ reason: "place", n: 2 }],
      reporters: 2,
      nearM: null,
    });
    expect(m).toMatchObject({ main: true, reasons: [{ reason: "stalk", n: 1 }], nearM: 40 });
    // the same numbers as the case in 待处理
    const queued = (await call("cases", [{ caseId: `roach:${clone.id}` }])).body.result.cases[0];
    expect([c.reporters, c.reliable]).toEqual([queued.reporters, queued.reliable]);
    const text = JSON.stringify(res);
    expect(text).not.toContain(reporter.id);
    expect(text).not.toContain(String(theirs.lng));
    expect(text).not.toContain(named.id);
    expect((await logged()).at(-2)).toBe("view.map");

    // moved since, and taken back
    await db.update(roaches).set({ lng: PARK.lng + 0.01 }).where(eq(roaches.id, main.id));
    await world.removeRoach(bad.id, clone.id);
    const after = (await call("reportedRoaches")).body.result.places;
    const gone = after.filter((p: { state: string }) => p.state === "gone");
    // a roach gone: a case per report, as in 待处理
    expect(gone).toHaveLength(2);
    expect(gone[0]).toMatchObject({ id: null, now: null, was: { lng: PARK.lng, lat: PARK.lat } });
    expect(after.find((p: { main: boolean }) => p.main)).toMatchObject({ state: "moved", now: { lng: PARK.lng + 0.01 } });
  });

  it("shows the owner every roach of the players reported, each with its case and why", async () => {
    await owner();
    const { bad, main, clone, named } = await scene();
    const [namedRoach] = await roachesOf(named.id);
    const res = (await call("reportedRoaches", [{ view: "all" }])).body.result;
    expect(res.view).toBe("all");
    const by = (id: string) => res.roaches.find((r: { id: string }) => r.id === id);
    expect(by(clone.publicId)).toMatchObject({ caseId: `roach:${clone.id}`, about: "self", why: "放在不合适的地方 ×2" });
    expect(by(main.publicId)).toMatchObject({ caseId: `roach:${main.id}`, about: "self", why: "贴着别人放" });
    expect(by(namedRoach.publicId)).toMatchObject({ caseId: named.id, about: "owner", why: "名字不合适", owner: "名字有问题" });
    expect(res.roaches).toHaveLength(3);
    // one roach reported, the other not: the other is marked for its sibling
    await call("resolve", [`roach:${main.id}`, "dismiss"]);
    expect((await call("reportedRoaches", [{ view: "all" }])).body.result.roaches.find((r: { id: string }) => r.id === main.publicId)).toMatchObject({
      caseId: `roach:${clone.id}`,
      about: "sibling",
      why: "它的一只克隆体被举报：放在不合适的地方 ×2",
    });
    expect(bad.id).toBeTruthy();
  });

  it("settles a roach's case from the map: nothing wrong tells the owner nothing; taking it back takes the clones with the main one", async () => {
    await owner();
    const { bad, main, clone } = await scene();
    expect((await call("resolve", [`roach:${clone.id}`, "dismiss"])).status).toBe(200);
    expect(await db.$count(reports, and(eq(reports.roachId, clone.id), isNull(reports.resolvedAt)))).toBe(0);
    expect(await staffTexts(bad.id)).toEqual([]);
    expect((await call("resolve", [`roach:${main.id}`, "removeRoach", "roach"])).status).toBe(200);
    expect(await roachesOf(bad.id)).toEqual([]);
    const [a] = await db.select().from(modActions).where(and(eq(modActions.userId, bad.id), eq(modActions.action, "removeRoach")));
    expect(a).toMatchObject({ yellow: true, rule: "roach", byAlias: "站长" });
    expect((await staffTexts(bad.id))[0]).toBe(`因为社区守则里「${RULES.roach}」这一条，站长把你的一只本体收回到你手里了，记一张黄牌。`);
    expect(await logged()).toEqual(["gate.setup", "act.dismiss", "act.removeRoach"]);
  });
});
