import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOD_ONLY, MOD_OPS, OWNER_ONLY, VIEW_LIMIT } from "@/lib/adminConsole";
import { MOD_NO_BAN } from "@/lib/server/admin";
import { isModHere, loadMods, startAdmins } from "@/lib/server/admins";
import { takeSnapshot } from "@/lib/server/dashboard";
import { db, pg } from "@/lib/server/db";
import { hearOthers } from "@/lib/server/live";
import { sendAdminMail } from "@/lib/server/mail";
import { forgetNameWords } from "@/lib/server/nameWords";
import { resetRoachFeed } from "@/lib/server/roachFeed";
import {
  adminLog,
  adminRequests,
  admins,
  bannedEmails,
  dailyTotals,
  modActions,
  nameWords,
  onlineHours,
  onlineNow,
  reports,
  roaches,
  sessions,
  statCounts,
  statSnapshots,
  users,
} from "@/lib/server/schema";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { totpCode, totpStep } from "@/lib/server/totp";
import * as world from "@/lib/server/world";
import { POST as worldPOST } from "../../world/[op]/route";
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
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TOKYO = { lng: 139.7, lat: 35.68 };
const NOBODY = "11111111-1111-4111-8111-111111111111";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the endpoint answers in many shapes, which the tests read into freely
type Answer = { result?: any; error?: string; code?: string; until?: number; minutes?: number; reason?: string };

async function call(op: string, args: unknown[] = [], more: Record<string, unknown> = {}) {
  const req = new NextRequest(`http://localhost/api/admin/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ args, ...more }),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Answer, text };
}

/** The map's me(), as this device */
async function me() {
  const req = new NextRequest("http://localhost/api/world/me", {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ args: [] }),
  });
  const res = await worldPOST(req, { params: Promise.resolve({ op: "me" }) });
  return ((await res.json()) as { result: { mod?: true; admin?: unknown } | null }).result;
}

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
const codeNow = (secret: string) => totpCode(secret, totpStep(Date.now()));

async function account(email: string, name = "") {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, name, anonymous: !name, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

type Device = { token: string; id: string };
/** A device signed in as the player that long ago; the requests from here on come from it */
async function device(userId: string, minutesAgo = 0): Promise<Device> {
  const token = randomBytes(32).toString("base64url");
  const id = createHash("sha256").update(token).digest("base64url");
  await db.insert(sessions).values({ id, userId, createdAt: new Date(Date.now() - minutesAgo * MINUTE), expiresAt: new Date(Date.now() + 20 * DAY) });
  jar.token = token;
  return { token, id };
}
const use = (d: Device) => (jar.token = d.token);

/** Set up an authenticator on this device, the rules read first by a moderator: its secret */
async function bind(pledge: boolean) {
  if (pledge) expect((await call("pledge")).status).toBe(200);
  const start = await call("setupStart");
  expect(start.status).toBe(200);
  const secret = String(start.body.result.secret).replace(/\s/g, "");
  expect((await call("setupConfirm", [{ code: codeNow(secret) }])).status).toBe(200);
  return secret;
}

/** The owner, with an authenticator and this device unlocked */
async function owner() {
  const user = await account("owner@example.com", "站长本人");
  const here = await device(user.id);
  const secret = await bind(false);
  return { user, here, secret };
}

/** A moderator the owner added (straight into the table), with the rules read, an authenticator and this device unlocked */
async function moderator(email: string, alias: string, by?: string) {
  const user = await account(email, `${alias}的号`);
  await db.insert(admins).values({ userId: user.id, role: "mod", alias, addedBy: by ?? null });
  const here = await device(user.id);
  const secret = await bind(true);
  return { user, here, secret };
}

/** A named player with a main roach in Tokyo */
async function player(email: string, name = "小坏") {
  const u = await account(email, name);
  await world.placeRoach(u.id, { kind: "main" }, TOKYO);
  return u;
}

/** A report of a player by someone (a new account unless given) */
async function reported(target: { id: string; name: string }, reason: string, by?: string, more: Partial<typeof reports.$inferInsert> = {}) {
  const reporterId = by ?? (await account(`r${randomBytes(4).toString("hex")}@example.com`)).id;
  const [r] = await db
    .insert(reports)
    .values({ reporterId, targetId: target.id, reason, context: "x", targetName: target.name || "x", ...more })
    .returning();
  return r;
}

/** A report of a player's main roach where it stands */
async function roachReported(userId: string, reason: string, by?: string) {
  const [r] = await db.select().from(roaches).where(eq(roaches.userId, userId)).limit(1);
  return reported({ id: userId, name: "x" }, reason, by, { roachId: r.id, placeLng: r.lng, placeLat: r.lat, roachSlot: r.slot });
}

const mails = () => vi.mocked(sendAdminMail).mock.calls.map(([to, subject]) => ({ to, subject }));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now());
  await db.execute(sql`truncate ${users}, ${bannedEmails}, ${nameWords} cascade`);
  forgetNameWords();
  resetRoachFeed();
  await loadMods();
  jar.token = null;
  vi.mocked(sendAdminMail).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** What only the owner may call (Breeze's choice: everything day to day for a moderator, a ban only by asking), and what other threads add later */
const OWNER_OPS = [
  "resetAdminTotp",
  "banRequests",
  "answerBanRequest",
  "admins",
  "findAdminCandidate",
  "addAdmin",
  "removeAdmin",
  "renameAdmin",
  "unpauseAdmin",
  "status",
  "ack",
  "retention",
  "appCounts",
  "dashboard",
  "banInfo",
  "giveBadge",
  "takeBadge",
  "roachesNear",
  "takeBackRoaches",
  // 公告, the sponsor desk, the off-limits zones and 一键变灰: the owner's whenever they come
  "notices",
  "saveNotice",
  "publishNotice",
  "withdrawNotice",
  "sponsor",
  "saveSponsor",
  "saveSponsorMonth",
  "removeSponsorMonth",
  "zones",
  "zone",
  "zonePreview",
  "drawZone",
  "liftZone",
  "gray",
  "setGray",
  "endGray",
];
/** Arguments that leave things as they are, for the owner's turn at each op */
const HARMLESS: Record<string, unknown[]> = { resetAdminTotp: [NOBODY], removeAdmin: [{ userId: NOBODY }], unpauseAdmin: [{ userId: NOBODY }] };
/** The door's own, tried apart (they lock this device) */
const LOCKING = new Set(["lock", "lockAll"]);

describe("moderators in the 管理台", () => {
  it("may call what the table says and nothing else, and the owner everything but what only a moderator needs", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");

    use(mod.here);
    for (const op of MOD_OPS) {
      if (LOCKING.has(op)) continue;
      const res = op === "unlock" ? await call(op, [{ code: codeNow(mod.secret) }]) : await call(op);
      expect([res.status, res.body.error], `moderator ${op}`).not.toEqual([403, OWNER_ONLY]);
    }
    for (const op of OWNER_OPS) {
      expect(MOD_OPS.has(op), op).toBe(false);
      const res = await call(op);
      expect([res.status, res.body.error], `moderator ${op}`).toEqual([403, OWNER_ONLY]);
    }
    // the map's whole view of the reported players' roaches is the owner's alone
    expect((await call("reportedRoaches", [{ view: "all" }])).body.error).toBe(OWNER_ONLY);
    expect((await call("reportedRoaches", [{ view: "place" }])).status).toBe(200);
    // and locking still works
    expect((await call("lockAll")).status).toBe(200);
    expect((await call("cases")).body.code).toBe("ADMIN_LOCKED");

    use(boss.here);
    for (const op of [...MOD_OPS, ...OWNER_OPS]) {
      if (LOCKING.has(op) || op === "unlock") continue;
      const res = await call(op, HARMLESS[op] ?? []);
      expect([res.status, res.body.error], `owner ${op}`).not.toEqual([403, OWNER_ONLY]);
      if (Object.hasOwn(MOD_ONLY, op)) expect(res.status, `owner ${op}`).toBe(400);
    }
    expect((await call("banRequest", [{ id: mod.user.id, rule: "harass", reason: "x" }])).body.error).toBe(MOD_ONLY.banRequest);
  });

  it("never sends a moderator a whole email, while the owner sees them", async () => {
    const boss = await owner();
    const mod = await moderator("lin.moderator@example.com", "小林");
    const bad = await player("bad.player@example.com");
    await reported(bad, "harass");
    await roachReported(bad.id, "place");
    await db.insert(nameWords).values({ word: "小坏" });
    forgetNameWords();
    // a step of the owner's, appealed
    use(boss.here);
    const warned = await call("act", [{ id: bad.id, action: "warn", rule: "harass" }]);
    await db.update(modActions).set({ appeal: "不是我", appealedAt: new Date() }).where(eq(modActions.id, warned.body.result.actionId));
    await reported(bad, "name");
    await call("addNote", [bad.id, "看着点"]);
    expect((await call("account", [bad.id])).body.result.person.email).toBe("bad.player@example.com");

    use(mod.here);
    const emails = (await db.select({ email: users.email }).from(users)).map((u) => u.email!);
    const answers = [
      await call("gate"),
      await call("cases"),
      await call("appeals"),
      await call("findPlayers", ["小坏"]),
      await call("account", [bad.id]),
      await call("notes", [bad.id]),
      await call("log"),
      await call("nameHits"),
      await call("reportedRoaches", [{ view: "place" }]),
    ];
    for (const a of answers) {
      expect(a.status, a.text).toBe(200);
      for (const email of emails) expect(a.text).not.toContain(email);
    }
    expect(answers[4].body.result.person.email).toBe("ba***@example.com");
    expect(answers[0].body.result.email).toBe("li***@example.com");
  });

  it("shows the owner 数据看板 in totals that point at nobody, and keeps no record of the look", async () => {
    await db.execute(sql`truncate ${statCounts}, ${statSnapshots}, ${onlineNow}, ${onlineHours}, ${dailyTotals}`);
    forgetStatCounts();
    const boss = await owner();
    const a = await player("someone.a@example.com", "小甲");
    const b = await player("someone.b@example.com", "小乙");
    const [bMain] = await db.select().from(roaches).where(eq(roaches.userId, b.id));
    await world.touch(a.id, bMain.publicId, true);
    await saveStatCounts();
    await takeSnapshot();
    use(boss.here);
    const logged = (await db.select().from(adminLog)).length;
    const res = await call("dashboard");
    expect(res.status).toBe(200);
    expect(res.body.result.totals).toMatchObject({ players: 3, touches: { sneaky: 0, bold: 1 }, roaches: { mains: 2 } });
    expect(res.body.result.today.counts).toMatchObject({ "touch.bold": 1, "place.main": 2 });
    const own = await db.select({ id: roaches.id, publicId: roaches.publicId }).from(roaches);
    for (const secret of [boss.user.id, a.id, b.id, "@example.com", "someone", "小甲", "小乙", "站长本人", ...own.flatMap((r) => [r.id, r.publicId])]) {
      expect(res.text, secret).not.toContain(secret);
    }
    expect((await db.select().from(adminLog)).length).toBe(logged);
  });

  it("keeps the 管理台's people and a moderator's own reports out of their sight", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    const other = await moderator("other@example.com", "阿杰");
    const bad = await player("bad@example.com");
    const theirs = await player("theirs@example.com", "被小林举报的");
    await reported(bad, "harass");
    await roachReported(bad.id, "place");
    // about the owner, about another moderator, and two reported by this moderator
    await reported(boss.user, "harass");
    await reported(other.user, "spam");
    await reported(theirs, "harass", mod.user.id);
    await roachReported(theirs.id, "stalk", mod.user.id);

    use(boss.here);
    const all = (await call("cases")).body.result;
    expect(all.total).toBe(6);
    expect(all.cases.filter((c: { staff: string | null }) => c.staff).map((c: { staff: string }) => c.staff).sort()).toEqual(["mod", "owner"]);

    use(mod.here);
    const seen = (await call("cases")).body.result;
    expect(seen.cases.map((c: { targetId: string }) => c.targetId)).toEqual([bad.id, bad.id]);
    expect(seen.total).toBe(2);
    expect(seen.levels.red + seen.levels.yellow + seen.levels.green).toBe(2);
    // not even by its id
    expect((await call("cases", [{ caseId: theirs.id }])).body.result.cases).toEqual([]);
    const places = (await call("reportedRoaches", [{ view: "place" }])).body.result.places;
    expect(places.map((p: { owner: string }) => p.owner)).toEqual(["小坏"]);
    // nor settled by them, from the queue or from 搜索账号
    expect((await call("resolve", [theirs.id, "warn"])).status).toBe(403);
    expect((await call("act", [{ id: theirs.id, action: "warn", rule: "harass" }])).status).toBe(403);
    expect((await call("resolve", [other.user.id, "warn"])).status).toBe(400);

    // never found nor opened: the owner's and the moderators' accounts
    expect((await call("findPlayers", ["的号"])).body.result.players).toEqual([]);
    expect((await call("findPlayers", ["站长本人"])).body.result.players).toEqual([]);
    expect((await call("findPlayers", ["bad@example.com"])).body.result.total).toBe(0);
    for (const id of [boss.user.id, other.user.id, mod.user.id]) {
      expect((await call("account", [id])).status, id).toBe(404);
      expect((await call("notes", [id])).status, id).toBe(404);
      expect((await call("addNote", [id, "x"])).status, id).toBe(404);
      expect((await call("act", [{ id, action: "warn", rule: "harass" }])).status, id).toBe(404);
    }
    expect((await call("findPlayers", ["小坏"])).body.result.players.map((p: { id: string }) => p.id)).toEqual([bad.id]);

    // the owner finds them, marked
    use(boss.here);
    const found = (await call("findPlayers", ["的号"])).body.result.players;
    expect(found.map((p: { staff: string }) => p.staff)).toEqual(["mod", "mod"]);
    expect((await call("account", [other.user.id])).body.result.person.staff).toBe("mod");
  });

  it("lets a moderator read but not answer an appeal against their own step, and none from the 管理台's people", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    const other = await moderator("other@example.com", "阿杰");
    const bad = await player("bad@example.com");
    use(mod.here);
    const warned = (await call("act", [{ id: bad.id, action: "warn", rule: "harass" }])).body.result;
    await db.update(modActions).set({ appeal: "不是我", appealedAt: new Date() }).where(eq(modActions.id, warned.actionId));
    // one about another moderator, appealed
    const [staffAction] = await db
      .insert(modActions)
      .values({ userId: other.user.id, action: "warn", rule: "harass", yellow: true, byUserId: boss.user.id, byAlias: "站长", appeal: "?", appealedAt: new Date() })
      .returning();

    const appeals = (await call("appeals")).body.result;
    expect(appeals.map((a: { actionId: string; mine: boolean; by: string }) => [a.actionId, a.mine, a.by])).toEqual([[warned.actionId, true, "小林"]]);
    expect((await call("answerAppeal", [warned.actionId, false])).body).toMatchObject({ error: "这件是你处理的，交给站长或别的管理员。" });
    expect((await call("answerAppeal", [staffAction.id, false])).status).toBe(400);

    use(other.here);
    expect((await call("appeals")).body.result.map((a: { mine: boolean }) => a.mine)).toEqual([false]);
    expect((await call("answerAppeal", [warned.actionId, true])).status).toBe(200);

    use(boss.here);
    expect((await call("appeals")).body.result.map((a: { actionId: string }) => a.actionId)).toEqual([staffAction.id]);
  });

  it("has a moderator ask for a ban, which the owner confirms with a fresh code or sends back", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    const bad = await player("bad@example.com");
    const meh = await player("meh@example.com", "一般般");
    await reported(bad, "harass");

    use(mod.here);
    expect((await call("resolve", [bad.id, "ban", "harass"])).body.error).toBe(MOD_NO_BAN);
    expect((await call("act", [{ id: bad.id, action: "ban", rule: "harass" }])).body.error).toBe(MOD_NO_BAN);
    expect((await call("banRequest", [{ id: bad.id, rule: "harass", reason: "" }])).status).toBe(400);
    expect((await call("banRequest", [{ id: bad.id, rule: "harass", reason: "x".repeat(301) }])).status).toBe(400);
    expect((await call("cases")).body.result.cases).toHaveLength(1);
    const asked = await call("banRequest", [{ id: bad.id, rule: "harass", reason: "连着三天刷屏骂人" }]);
    expect(asked.status).toBe(200);
    expect((await call("banRequest", [{ id: bad.id, rule: "harass", reason: "再来" }])).body.error).toBe("已经有人提请封这个号了，等站长确认。");
    expect((await call("account", [bad.id])).body.result.banRequest).toMatchObject({ by: "小林", mine: true, rule: "harass", reason: "连着三天刷屏骂人" });
    // handed over: out of every moderator's 待处理 while the owner has it
    expect((await call("cases")).body.result.cases).toEqual([]);
    expect(mails().map((m) => m.subject)).toContain("舟P 管理台：小林 提请封号，等你确认");
    const second = await call("banRequest", [{ id: meh.id, rule: "name", reason: "名字不行" }]);
    expect(second.status).toBe(200);

    use(boss.here);
    expect((await call("cases")).body.result.cases.map((c: { targetId: string }) => c.targetId)).toEqual([bad.id]);
    expect((await call("banRequests")).body.result.map((r: { by: string; who: { targetId: string } }) => [r.by, r.who.targetId])).toEqual([
      ["小林", bad.id],
      ["小林", meh.id],
    ]);
    // a ban wants a code from the last 10 minutes
    later(11 * MINUTE);
    expect((await call("answerBanRequest", [{ id: asked.body.result.id, ban: true }])).body.code).toBe("ADMIN_FRESH");
    expect((await call("answerBanRequest", [{ id: asked.body.result.id, ban: true }], { fresh: codeNow(boss.secret) })).status).toBe(200);
    expect(await db.$count(users, eq(users.id, bad.id))).toBe(0);
    expect(await db.$count(bannedEmails)).toBe(1);
    expect(await db.$count(adminLog, and(eq(adminLog.what, "act.ban"), eq(adminLog.actionId, asked.body.result.id)))).toBe(1);
    expect((await call("answerBanRequest", [{ id: asked.body.result.id, ban: true }])).body.error).toBe("这条提请已经处理过了。");
    // sent back
    expect((await call("answerBanRequest", [{ id: second.body.result.id, ban: false }])).status).toBe(200);
    expect((await db.select().from(adminRequests))[0]).toMatchObject({ answer: "declined" });
    expect((await call("banRequests")).body.result).toEqual([]);

    use(mod.here);
    const log = (await call("log", [{ kind: "act" }])).body.result.entries;
    expect(log.filter((e: { what: string }) => e.what === "act.banRequest").map((e: { answer: string }) => e.answer)).toEqual(["declined", "done"]);
    // asking again after a no is fine
    expect((await call("banRequest", [{ id: meh.id, rule: "name", reason: "又改回来了" }])).status).toBe(200);
  });

  it("shows a moderator only their own 操作记录, and lets them undo only their own steps of the last day", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    const bad = await player("bad@example.com");
    use(boss.here);
    const owners = (await call("act", [{ id: bad.id, action: "warn", rule: "harass" }])).body.result;
    use(mod.here);
    const mine = (await call("act", [{ id: bad.id, action: "suspend", rule: "harass" }])).body.result;
    const old = (await call("act", [{ id: bad.id, action: "clearName", rule: "name" }])).body.result;
    await db
      .update(modActions)
      .set({ createdAt: new Date(Date.now() - 25 * HOUR) })
      .where(eq(modActions.id, old.actionId));

    const page = (await call("log")).body.result;
    expect(new Set(page.entries.map((e: { actor: string }) => e.actor))).toEqual(new Set(["小林"]));
    expect(page.people).toEqual([]);
    // nor someone else's, asked by name
    expect((await call("log", [{ who: boss.user.id }])).body.result.entries.every((e: { actor: string }) => e.actor === "小林")).toBe(true);
    const history = (await call("account", [bad.id])).body.result.history;
    expect(history.map((h: { actionId: string; canUndo: boolean }) => [h.actionId, h.canUndo])).toEqual([
      [mine.actionId, true],
      [owners.actionId, false],
      [old.actionId, false],
    ]);
    expect((await call("undo", [owners.actionId])).body.error).toBe("只能撤销你自己 24 小时内做的处理。");
    expect((await call("undo", [old.actionId])).status).toBe(403);
    expect((await call("undo", [mine.actionId])).status).toBe(200);
    // 待处理's line on top: what they did today, and nobody else's
    expect((await call("cases")).body.result.today).toEqual([{ alias: "小林", you: true, n: 3 }]);

    use(boss.here);
    const all = (await call("log")).body.result;
    expect(new Set(all.entries.map((e: { actor: string }) => e.actor))).toEqual(new Set(["站长", "小林"]));
    expect(all.people.map((p: { alias: string }) => p.alias)).toEqual(["站长", "小林"]);
    expect((await call("log", [{ who: mod.user.id }])).body.result.entries.every((e: { actor: string }) => e.actor === "小林")).toBe(true);
    expect((await call("undo", [old.actionId])).status).toBe(200);
    expect((await call("cases")).body.result.today).toEqual([
      { alias: "站长", you: true, n: 2 },
      { alias: "小林", you: false, n: 3 },
    ]);
    expect((await call("log")).body.result.people).toEqual([
      { id: boss.user.id, alias: "站长", acts: 2 },
      { id: mod.user.id, alias: "小林", acts: 3 },
    ]);
  });

  it("pauses a moderator for a day at the 200th account in an hour, and tells the owner once", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    const bad = await player("bad@example.com");
    const next = await player("next@example.com", "下一个");
    use(mod.here);
    // 199 looks already this hour, the last at bad's
    expect((await call("account", [bad.id])).status).toBe(200);
    await db.insert(adminLog).values(
      Array.from({ length: VIEW_LIMIT - 2 }, () => ({ actorId: mod.user.id, actorAlias: "小林", kind: "view", what: "view.account", at: new Date(Date.now() - 30 * MINUTE) })),
    );
    // the same account again is the same look
    expect((await call("account", [bad.id])).status).toBe(200);
    // the map's looks do not count
    expect((await call("reportedRoaches")).status).toBe(200);
    vi.mocked(sendAdminMail).mockReset();
    const blocked = await call("account", [next.id]);
    expect(blocked).toMatchObject({ status: 423, body: { code: "ADMIN_PAUSED", reason: "views", minutes: 24 * 60 } });
    expect(blocked.body.error).toContain("一小时里看了太多账号");
    expect((await call("cases")).body).toMatchObject({ code: "ADMIN_PAUSED", reason: "views" });
    expect((await call("gate")).body.result).toMatchObject({ state: "paused", reason: "views" });
    expect(mails()).toEqual([{ to: ["owner@example.com"], subject: expect.stringContaining("小林 一小时里看了太多账号") }]);

    // the owner, with no limit, lifts it early
    use(boss.here);
    expect((await call("admins")).body.result.find((a: { alias: string }) => a.alias === "小林")).toMatchObject({ pauseReason: "views", pausedUntil: expect.any(Number) });
    expect((await call("unpauseAdmin", [{ userId: mod.user.id }])).status).toBe(200);
    use(mod.here);
    expect((await call("gate")).body.result.state).toBe("open");
    expect(mails()).toHaveLength(1);
  });

  it("asks a moderator to read the rules before setting up an authenticator, and the owner not", async () => {
    await owner();
    const user = await account("mod@example.com");
    await db.insert(admins).values({ userId: user.id, role: "mod", alias: "小林" });
    await device(user.id);
    expect((await call("gate")).body.result).toMatchObject({ state: "setup", pledged: false, role: "mod" });
    expect((await call("setupStart")).body.error).toBe("先读完管理员守则。");
    expect((await call("cases")).body.code).toBe("ADMIN_SETUP");
    expect((await call("pledge")).body.result).toMatchObject({ state: "setup", pledged: true });
    expect((await call("setupStart")).status).toBe(200);
    expect(await db.$count(adminLog, eq(adminLog.what, "gate.pledge"))).toBe(1);
  });

  it("asks nothing of the database for the map's moderator button", async () => {
    await startAdmins();
    const lin = await account("lin@example.com", "林");
    await db.insert(admins).values({ userId: lin.id, role: "mod", alias: "小林" });
    await device(lin.id);
    // in the table, not yet in memory: me() does not look
    expect((await me())?.mod).toBeUndefined();
    await loadMods();
    expect((await me())?.mod).toBe(true);
  });

  it("locks a removed moderator out on every device at once, and a reset one back to setting up", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    const phone = await device(mod.user.id);
    expect((await call("unlock", [{ code: codeNow(mod.secret) }])).status).toBe(400);
    later(30_000);
    expect((await call("unlock", [{ code: codeNow(mod.secret) }])).status).toBe(200);
    const other = await moderator("other@example.com", "阿杰");

    use(boss.here);
    later(11 * MINUTE);
    expect((await call("resetAdminTotp", [other.user.id])).body.code).toBe("ADMIN_FRESH");
    vi.mocked(sendAdminMail).mockReset();
    expect((await call("resetAdminTotp", [{ userId: other.user.id }], { fresh: codeNow(boss.secret) })).status).toBe(200);
    expect(mails().map((m) => [m.to, m.subject])).toEqual([
      [["other@example.com"], "舟P 管理台：你的验证器被重置了"],
      [["owner@example.com"], "舟P 管理台：重置了「阿杰」的验证器"],
    ]);
    use(other.here);
    expect((await call("cases")).body.code).toBe("ADMIN_SETUP");
    // no rules again
    expect((await call("gate")).body.result).toMatchObject({ state: "setup", pledged: true });

    use(boss.here);
    expect((await call("removeAdmin", [{ userId: boss.user.id }])).status).toBe(400);
    expect((await call("removeAdmin", [{ userId: mod.user.id }])).status).toBe(200);
    for (const d of [mod.here, phone]) {
      use(d);
      expect((await call("gate")).status).toBe(404);
      expect((await call("cases")).status).toBe(404);
    }
    expect(await db.$count(sessions, and(eq(sessions.userId, mod.user.id), sql`${sessions.adminUntil} is not null`))).toBe(0);
    expect(await db.$count(adminLog, eq(adminLog.actorAlias, "小林"))).toBeGreaterThan(0);
  });

  it("marks for the owner the cases about the 管理台's people, and settles them as any other", async () => {
    const boss = await owner();
    const mod = await moderator("mod@example.com", "小林");
    await reported(mod.user, "harass");
    use(boss.here);
    const [c] = (await call("cases")).body.result.cases;
    expect(c).toMatchObject({ targetId: mod.user.id, staff: "mod" });
    expect((await call("resolve", [mod.user.id, "dismiss"])).status).toBe(200);
  });

  // last: it leaves this process listening to the others
  it("has the owner add a moderator by full email or id, who is invited, and whom the map then knows on every process", async () => {
    vi.stubEnv("LIVE_ACROSS", "1");
    await startAdmins();
    await hearOthers();
    const boss = await owner();
    const lin = await account("lin@example.com", "林");
    const demo = await account("demo@example.com", "测试");
    await db.update(users).set({ demoKey: "x" }).where(eq(users.id, demo.id));

    expect((await call("findAdminCandidate", [{ q: "lin" }])).status).toBe(400);
    expect((await call("findAdminCandidate", [{ q: "demo@example.com" }])).status).toBe(400);
    expect((await call("findAdminCandidate", [{ q: "owner@example.com" }])).body.error).toBe("这是站长的账号。");
    expect((await call("findAdminCandidate", [{ q: lin.id }])).body.result).toMatchObject({ id: lin.id, name: "林", email: "lin@example.com" });
    const found = (await call("findAdminCandidate", [{ q: "LIN@example.com " }])).body.result;
    expect(found.id).toBe(lin.id);

    expect((await call("addAdmin", [{ userId: lin.id, alias: "" }])).status).toBe(400);
    expect((await call("addAdmin", [{ userId: lin.id, alias: "一二三四五六七八九十一二三" }])).status).toBe(400);
    expect((await call("addAdmin", [{ userId: lin.id, alias: "副站长" }])).status).toBe(400);
    later(11 * MINUTE);
    vi.mocked(sendAdminMail).mockReset();
    expect((await call("addAdmin", [{ userId: lin.id, alias: "小林" }])).body.code).toBe("ADMIN_FRESH");
    expect((await call("addAdmin", [{ userId: lin.id, alias: "小林" }], { fresh: codeNow(boss.secret) })).status).toBe(200);
    expect((await call("addAdmin", [{ userId: lin.id, alias: "小林" }])).body.error).toBe("TA 已经是管理员了。");
    expect((await call("findAdminCandidate", [{ q: lin.id }])).body.error).toBe("TA 已经是管理员了。");
    expect(mails().map((m) => [m.to, m.subject])).toEqual([
      [["lin@example.com"], "你被加为舟P 管理员"],
      [["owner@example.com"], "舟P 管理台：加了管理员「小林」"],
    ]);
    expect(vi.mocked(sendAdminMail).mock.calls[0][2]).toContain("/admin");
    // nobody else may be called the same
    const jie = await account("jie@example.com");
    expect((await call("addAdmin", [{ userId: jie.id, alias: "小林" }])).body.error).toBe("这个称呼有人用了，换一个。");
    expect((await call("addAdmin", [{ userId: jie.id, alias: "阿杰" }])).status).toBe(200);
    expect((await call("renameAdmin", [{ userId: jie.id, alias: "小林" }])).body.error).toBe("这个称呼有人用了，换一个。");
    expect((await call("renameAdmin", [{ userId: jie.id, alias: "杰哥" }])).status).toBe(200);
    expect((await call("renameAdmin", [{ userId: boss.user.id, alias: "老板" }])).body.error).toBe("站长写在服务器设置里，这里改不了。");

    const list = (await call("admins")).body.result;
    expect(list.map((a: { alias: string; role: string; bound: boolean; pledged: boolean }) => [a.alias, a.role, a.bound, a.pledged])).toEqual([
      ["站长", "owner", true, true],
      ["小林", "mod", false, false],
      ["杰哥", "mod", false, false],
    ]);

    // the map: this process read them again at once, and another tells this one when it changes them
    expect(isModHere(lin.id)).toBe(true);
    await device(lin.id);
    expect(await me()).toMatchObject({ mod: true });
    expect((await me())?.admin).toBeUndefined();
    await db.delete(admins).where(eq(admins.userId, jie.id));
    expect(isModHere(jie.id)).toBe(true);
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "admins" }));
    await vi.waitFor(() => expect(isModHere(jie.id)).toBe(false));
  });
});
