import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ONLY } from "@/lib/adminConsole";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { boardChanged, HIDE_AFTER, publishPaper, ratePaper, reportPaper, dealPaper } from "@/lib/server/handwriting";
import { sendAdminMail } from "@/lib/server/mail";
import { adminLog, admins, blocks, handwritingRatings, handwritings, modActions, reports, sessions, users } from "@/lib/server/schema";
import { boardSettings, loadSettings } from "@/lib/server/siteSettings";
import { staffItems } from "@/lib/server/staffNotes";
import { totpCode, totpStep } from "@/lib/server/totp";
import { BOARD, simplified, tidySheet } from "@/lib/study/board";
import { DIGITS, WRITE_DIGITS } from "@/lib/study/write325";
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

const DAY = 86_400_000;
const PASSING = tidySheet(WRITE_DIGITS.map((d) => DIGITS[d][0]));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the endpoint answers in many shapes, which the tests read into freely
type Answer = { result?: any; error?: string; code?: string };

async function call(op: string, args: unknown[] = []) {
  const req = new NextRequest(`http://localhost/api/admin/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Answer };
}

/** A player who signed up ten days ago, named on the map */
async function account(email: string, name = "") {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({
      email,
      name,
      anonymous: !name,
      ageConfirmedAt: now,
      policyAcceptedAt: now,
      crossBorderAcceptedAt: now,
      publicPlaceAcceptedAt: now,
      createdAt: new Date(Date.now() - 10 * DAY),
      writePassedAt: now,
    })
    .returning();
  return u;
}

/** A device signed in as the player; the requests from here on come from it */
async function device(userId: string) {
  const token = randomBytes(32).toString("base64url");
  // runs out by the database's clock, as the site checks it, not the faked one
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: sql`now() + interval '20 days'` });
  jar.token = token;
  return token;
}

/** Bound to an authenticator and unlocked, with the rules read first by a moderator */
async function bind(pledge: boolean) {
  if (pledge) expect((await call("pledge")).status).toBe(200);
  const start = await call("setupStart");
  const secret = String(start.body.result.secret).replace(/\s/g, "");
  expect((await call("setupConfirm", [{ code: totpCode(secret, totpStep(Date.now())) }])).status).toBe(200);
}

/** The owner, with an authenticator and this device unlocked */
async function owner() {
  const user = await account("owner@example.com", "站长本人");
  const token = await device(user.id);
  await bind(false);
  return { user, token };
}

const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const staffTexts = async (userId: string) => (await staffItems(userId, new Date(0))).map((i) => (i.kind === "staff" ? i.text : ""));

/** A named player's paper put up (as show), rated by `rated` others; its id */
async function paperBy(email: string, show: "anon" | "named", rated = 0) {
  const u = await account(email, "写字的");
  const mine = await publishPaper(u, PASSING, show);
  for (let i = 0; i < rated; i++) {
    const r = await account(`rater${i}-${email}`);
    const d = await dealPaper(r);
    await ratePaper(await row(r.id), d.deal!.id, i === 0 ? BOARD.meme : 700);
  }
  return { user: u, paper: mine!.id };
}

/** Reported by n reliable players for scrawl: the reporters */
async function reportedBy(paper: string, n: number) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = await account(`reporter${i}-${randomBytes(3).toString("hex")}@example.com`);
    await reportPaper(r.id, paper, "scrawl", "");
    out.push(r);
  }
  return out;
}

const caseOf = async (caseId: string) => (await call("cases", [{ caseId }])).body.result.cases[0];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now());
  await db.execute(sql`truncate ${users} cascade`);
  await loadMods();
  await loadSettings();
  boardChanged();
  jar.token = null;
  vi.mocked(sendAdminMail).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("手写榜's papers in 待处理", () => {
  it("are cases of their own: the paper as the board keeps it, how it is shown, its mark and counts, hidden or not; never in the writer's own case", async () => {
    await owner();
    const w = await paperBy("w@example.com", "named", 2);
    const reporters = await reportedBy(w.paper, HIDE_AFTER);
    // a report of the writer themselves is a case apart
    await db.insert(reports).values({ reporterId: reporters[0].id, targetId: w.user.id, reason: "spam", context: "x", targetName: "写字的" });
    const page = (await call("cases")).body.result;
    expect(page.cases.map((c: { caseId: string; kind: string }) => [c.kind, c.caseId]).sort()).toEqual(
      [
        ["person", w.user.id],
        ["writing", `writing:${w.paper}`],
      ].sort(),
    );
    const c = await caseOf(`writing:${w.paper}`);
    expect(c).toMatchObject({
      kind: "writing",
      rule: "writing",
      level: "green",
      reporters: HIDE_AFTER,
      writing: { sheet: simplified(PASSING), show: "named", mark: 100, n: 2, n799: 1, hidden: true, score: expect.any(Number), at: expect.any(Number) },
    });
    expect(c.reports).toHaveLength(HIDE_AFTER);
    expect(c.reports.every((r: { reason: string; context: string }) => r.reason === "scrawl" && r.context === "手写榜上的字（署名）")).toBe(true);
    // the person's case holds only the report of them
    expect((await caseOf(w.user.id)).reports.map((r: { reason: string }) => r.reason)).toEqual(["spam"]);
    // 待处理 on the map's own list of reported roaches: nothing of a paper
    expect((await call("reportedRoaches", [{ view: "all" }])).body.result).toEqual({ view: "all", roaches: [] });
  });

  it("put a paper back on 没问题, and keep it up on a warning, a yellow card; the reporters told what came of it, nobody blocked", async () => {
    await owner();
    const a = await paperBy("a@example.com", "anon");
    const ra = await reportedBy(a.paper, HIDE_AFTER);
    expect((await db.select().from(handwritings).where(eq(handwritings.id, a.paper)))[0].hiddenAt).not.toBeNull();
    expect((await call("resolve", [`writing:${a.paper}`, "dismiss"])).status).toBe(200);
    expect((await db.select().from(handwritings).where(eq(handwritings.id, a.paper)))[0].hiddenAt).toBeNull();
    expect(await db.select().from(reports).where(eq(reports.writingId, a.paper))).toMatchObject(Array(HIDE_AFTER).fill({ resolution: "dismissed" }));
    expect(await staffTexts(a.user.id)).toEqual([]);
    expect(await staffTexts(ra[0].id)).toEqual([expect.stringContaining("举报的那张手写榜上的字（不是 325，乱画）了：这次没发现问题。")]);
    expect((await row(ra[0].id)).reportsDismissed).toBe(1);

    const b = await paperBy("b@example.com", "anon");
    const rb = await reportedBy(b.paper, 1);
    expect((await call("resolve", [`writing:${b.paper}`, "warn"])).status).toBe(200);
    expect(await db.select().from(handwritings).where(eq(handwritings.id, b.paper))).toHaveLength(1);
    expect(await db.select().from(modActions).where(eq(modActions.userId, b.user.id))).toMatchObject([{ action: "warn", rule: "writing", yellow: true }]);
    expect(await staffTexts(b.user.id)).toEqual([expect.stringContaining("因为社区守则里「手写榜上不能放不合适的字」这一条，站长提醒你一次，记一张黄牌。")]);
    expect(await staffTexts(rb[0].id)).toEqual([expect.stringContaining("已经处理了，谢谢你。")]);
    expect(await db.select().from(blocks)).toEqual([]);
    // not the ways of another case
    const c = await paperBy("c@example.com", "anon");
    await reportedBy(c.paper, 1);
    for (const action of ["clearName", "suspend", "removeRoach"])
      expect(await call("resolve", [`writing:${c.paper}`, action])).toMatchObject({ status: 400, body: { error: "手写榜上的字的举报只能：没问题、警告、撤下这张字或者封号。" } });
    expect(await call("resolve", [c.user.id, "removeWriting"])).toMatchObject({ status: 400 });
  });

  it("take a paper down on 撤下: it goes with its ratings, a yellow card the writer is told of, and the reporters hear it was dealt with", async () => {
    await owner();
    const w = await paperBy("w@example.com", "anon", 2);
    const rs = await reportedBy(w.paper, 2);
    expect(await call("resolve", [`writing:${w.paper}`, "removeWriting"])).toMatchObject({ status: 200 });
    expect(await db.select().from(handwritings)).toEqual([]);
    expect(await db.select().from(handwritingRatings)).toEqual([]);
    const [a] = await db.select().from(modActions).where(eq(modActions.userId, w.user.id));
    expect(a).toMatchObject({ action: "removeWriting", rule: "writing", yellow: true });
    expect(await staffTexts(w.user.id)).toEqual(["因为社区守则里「手写榜上不能放不合适的字」这一条，站长撤下了你放在手写榜上的字，记一张黄牌。"]);
    for (const r of rs) expect(await staffTexts(r.id)).toEqual([expect.stringContaining("张手写榜上的字（不是 325，乱画）了：已经处理了，谢谢你。")]);
    expect(await db.select().from(reports)).toMatchObject(Array(2).fill({ resolution: "writing_removed", writingId: null }));
    expect((await call("account", [w.user.id])).body.result.person.yellow).toBe(1);
    expect((await call("account", [w.user.id])).body.result.person.settled.writingsRemoved).toBe(1);
    expect((await db.select().from(adminLog)).map((l) => [l.what, l.detail])).toContainEqual(["act.removeWriting", "违反：手写榜上不能放不合适的字"]);
    // nothing left to take down
    expect((await call("resolve", [`writing:${w.paper}`, "removeWriting"])).status).toBe(400);
  });

  it("are still settled once the paper is gone, as wreport:<id>: a warning or nothing wrong, never 撤下", async () => {
    await owner();
    const w = await paperBy("w@example.com", "anon");
    const [r] = await reportedBy(w.paper, 1);
    // replaced by its writer: the old one is gone, the report stays open
    await publishPaper(await row(w.user.id), PASSING, "named");
    const [open] = await db.select().from(reports).where(eq(reports.reporterId, r.id));
    expect(open.writingId).toBeNull();
    const c = await caseOf(`wreport:${open.id}`);
    expect(c).toMatchObject({ kind: "writing", caseId: `wreport:${open.id}`, writing: null });
    expect(await call("resolve", [`wreport:${open.id}`, "removeWriting"])).toMatchObject({ status: 400, body: { error: "这张字已经撤下了。" } });
    expect((await call("resolve", [`wreport:${open.id}`, "warn"])).status).toBe(200);
    expect(await db.select().from(modActions).where(eq(modActions.userId, w.user.id))).toMatchObject([{ action: "warn", yellow: true }]);
    // the new paper is not touched
    expect(await db.select().from(handwritings).where(eq(handwritings.userId, w.user.id))).toMatchObject([{ show: "named" }]);
  });
});

describe("手写榜暂停, the owner's", () => {
  it("pauses the board and lets it go again, each change in the 操作记录; a moderator may do neither", async () => {
    const boss = await owner();
    await paperBy("w@example.com", "anon", BOARD.minRaters);
    // ratings reach the board within a minute (it is ranked at most once a minute)
    expect((await call("board")).body.result).toMatchObject({ papers: 1, ratings: BOARD.minRaters });
    vi.setSystemTime(Date.now() + 61_000);
    expect((await call("board")).body.result).toEqual({ mode: expect.any(String), paused: false, papers: 1, ranked: 1, hidden: 0, ratings: BOARD.minRaters });
    expect(await call("setBoard", [{ paused: "yes" }])).toMatchObject({ status: 400, body: { error: "手写榜暂停只能开或关。" } });
    try {
      expect((await call("setBoard", [{ paused: true }])).body.result).toMatchObject({ paused: true, papers: 1 });
      expect(boardSettings().paused).toBe(true);
      // the same again adds nothing to the log
      expect((await call("setBoard", [{ paused: true }])).status).toBe(200);
      expect((await call("setBoard", [{ paused: false }])).body.result).toMatchObject({ paused: false });
      expect((await db.select().from(adminLog).orderBy(adminLog.id)).map((l) => [l.what, l.detail])).toEqual([
        ["gate.setup", null],
        ["act.board", "暂停了手写榜"],
        ["act.board", "恢复了手写榜"],
      ]);

      const mod = await account("mod@example.com", "小林的号");
      await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小林", addedBy: boss.user.id });
      await loadMods();
      await device(mod.id);
      await bind(true);
      expect(await call("board")).toMatchObject({ status: 403, body: { error: OWNER_ONLY } });
      expect(await call("setBoard", [{ paused: true }])).toMatchObject({ status: 403, body: { error: OWNER_ONLY } });
      expect(boardSettings().paused).toBe(false);
    } finally {
      jar.token = boss.token;
      await call("setBoard", [{ paused: false }]);
    }
  });
});
