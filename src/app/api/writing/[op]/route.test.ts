import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGE_CHECK } from "@/lib/consent";
import { deleteAccount } from "@/lib/server/account";
import { db } from "@/lib/server/db";
import { boardChanged, dealPaper, HIDE_AFTER } from "@/lib/server/handwriting";
import { blocks, handwritingRatings, handwritings, reports, sessions, users } from "@/lib/server/schema";
import { loadSettings, setBoard } from "@/lib/server/siteSettings";
import { nextSiteDayAt, siteDay } from "@/lib/siteDay";
import { BOARD, SHEET, simplified, tidySheet, type Sheet } from "@/lib/study/board";
import { DIGITS, WRITE_DIGITS } from "@/lib/study/write325";
import { GET, POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

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

const DAY = 86_400_000;

/** The clock, faked from here on and kept clear of the site day's turning (04:00 in Beijing) for the next ten minutes */
function clock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Date.now();
  const turn = nextSiteDayAt(now);
  vi.setSystemTime(turn - now < 10 * 60_000 ? turn + 60_000 : now);
}
/** A minute and a little on: the requests' per-minute limits begin again */
const aMinuteOn = () => vi.setSystemTime(Date.now() + 61_000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the endpoint answers in many shapes, which the tests read into freely
type Answer = { status: number; body: any; cache: string | null };

async function call(op: string, body?: unknown, method: "GET" | "POST" = "POST", raw?: string): Promise<Answer> {
  const url = `http://localhost/api/writing/${op}`;
  const req =
    method === "GET"
      ? new NextRequest(url)
      : new NextRequest(url, {
          method,
          headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
          body: raw ?? JSON.stringify(body ?? {}),
        });
  const res = await { GET, POST }[method](req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: await res.json(), cache: res.headers.get("cache-control") };
}

/** A player who signed up `days` ago (rating wants RELIABLE_AFTER_DAYS), named on the map */
async function account(email: string, more: Partial<typeof users.$inferInsert> = {}, days = 10) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({
      email,
      name: email.split("@")[0],
      anonymous: false,
      ageConfirmedAt: now,
      policyAcceptedAt: now,
      crossBorderAcceptedAt: now,
      publicPlaceAcceptedAt: now,
      createdAt: new Date(Date.now() - days * DAY),
      ...more,
    })
    .returning();
  return u;
}

/** Signed in as the player: the requests from here on are theirs */
async function signIn(userId: string) {
  const token = randomBytes(32).toString("base64url");
  // runs out by the database's clock, as the site checks it, not the faked one
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: sql`now() + interval '7 days'` });
  jar.token = token;
}
const signOut = () => (jar.token = null);

/** 3, 2 and 5 as 徒手写 marks them 100, sent as the page sends a paper; and three lines, which fail */
const PASSING: Sheet = tidySheet(WRITE_DIGITS.map((d) => DIGITS[d][0]));
const FAILING: Sheet = tidySheet(
  WRITE_DIGITS.map(() => [
    [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
    ],
  ]),
);

const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const paperOf = async (userId: string) => (await db.select().from(handwritings).where(eq(handwritings.userId, userId)))[0];

/** A player signed in who passed 徒手写 and put a paper up (show), whose paper's id this says */
async function writer(email: string, show: "anon" | "named" = "anon", more: Partial<typeof users.$inferInsert> = {}) {
  const u = await account(email, more);
  await signIn(u.id);
  expect((await call("publish", { squares: PASSING, show })).status).toBe(200);
  return { user: u, paper: (await paperOf(u.id)).id };
}

/** A player signed in who passed 徒手写 some day before, and may rate */
async function rater(email: string, days = 10) {
  const u = await account(email, { writePassedAt: new Date(Date.now() - 5 * DAY) }, days);
  await signIn(u.id);
  return u;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions} cascade`);
  await loadSettings();
  boardChanged();
  jar.token = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("手写榜's requests", () => {
  it("are answered 404 while STUDY keeps 325大学习 from the player, as if nothing were here; a visitor may only look at the board, once STUDY is on", async () => {
    vi.stubEnv("STUDY", "off");
    expect((await call("board")).status).toBe(404);
    const owner = await account("owner@example.com");
    await signIn(owner.id);
    expect(await call("board")).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });

    vi.stubEnv("STUDY", "admins");
    expect((await call("board")).status).toBe(200);
    const player = await account("someone@example.com");
    await signIn(player.id);
    for (const op of ["board", "pass", "publish", "withdraw", "deal", "rate", "skip", "report"]) expect((await call(op)).status).toBe(404);
    signOut();
    expect((await call("board")).status).toBe(404);

    vi.stubEnv("STUDY", "on");
    expect(await call("board")).toMatchObject({
      status: 200,
      body: { paused: false, rows: [], page: 1, pages: 1, mine: null, rate: { can: false, why: "signIn" } },
      cache: "no-store",
    });
    for (const op of ["pass", "publish", "withdraw", "deal", "rate", "skip", "report"]) expect((await call(op)).status).toBe(401);
    // only the ways in that exist, by POST
    expect((await call("board", {}, "GET")).status).toBe(404);
    expect((await call("nothing")).status).toBe(404);
    expect((await call("toString")).status).toBe(404);
  });

  it("wait while the player is asked to say again they are 18, or to agree to an updated privacy policy", async () => {
    vi.stubEnv("STUDY", "on");
    const u = await account("p@example.com", { ageCheckAt: new Date() });
    await signIn(u.id);
    expect(await call("board")).toMatchObject({ status: 428, body: { code: AGE_CHECK } });
    await db.update(users).set({ ageCheckAt: null, policyAcceptedAt: new Date(0) }).where(eq(users.id, u.id));
    expect((await call("pass", { squares: PASSING })).status).toBe(428);
  });

  it("refuse a request longer than SHEET.bytes before it is all in", async () => {
    vi.stubEnv("STUDY", "on");
    const u = await account("p@example.com");
    await signIn(u.id);
    expect(await call("pass", undefined, "POST", JSON.stringify({ squares: PASSING, pad: "x".repeat(SHEET.bytes) }))).toMatchObject({
      status: 413,
      body: { error: "这张字太大了，擦掉重写一张吧。" },
    });
    expect(await call("pass", undefined, "POST", "[1, 2")).toMatchObject({ status: 400 });
  });
});

describe("手写榜: a paper passed, put up and taken down", () => {
  it("marks a paper again: only a pass lets the player rate, and the paper is not kept", async () => {
    vi.stubEnv("STUDY", "on");
    const u = await account("p@example.com");
    await signIn(u.id);
    expect(await call("pass", { squares: FAILING })).toMatchObject({ status: 400, body: { error: "服务器认出来没过 60 分" } });
    expect(await call("pass", { squares: "x" })).toMatchObject({ status: 400, body: { error: "这张字没传对，再交一次试试。" } });
    expect(await call("pass", { squares: [Array.from({ length: SHEET.strokes + 1 }, () => [500, 500])] })).toMatchObject({
      status: 400,
      body: { error: "这张字太大了，擦掉重写一张吧。" },
    });
    expect((await row(u.id)).writePassedAt).toBeNull();
    expect((await call("deal")).body).toEqual({ deal: null, rate: { can: false, why: "pass" } });

    expect(await call("pass", { squares: PASSING })).toMatchObject({ status: 200, body: { mine: null, publishesLeft: BOARD.publishesPerDay, paused: false }, cache: "no-store" });
    expect((await row(u.id)).writePassedAt).not.toBeNull();
    expect(await db.select().from(handwritings)).toEqual([]);
    expect((await call("board")).body.rate).toEqual({ can: true, left: BOARD.ratesPerDay, skipsLeft: BOARD.skipsPerDay });
  });

  it("puts a paper up as 匿名舟P or named, simplified, in place of the last one, whose ratings go with it; BOARD.publishesPerDay a site day", async () => {
    clock();
    vi.stubEnv("STUDY", "on");
    const u = await account("writer@example.com");
    await signIn(u.id);
    expect(await call("publish", { squares: PASSING })).toMatchObject({ status: 400, body: { error: "选匿名放还是署名放。" } });
    expect(await call("publish", { squares: FAILING, show: "anon" })).toMatchObject({ status: 400, body: { error: "服务器认出来没过 60 分" } });
    expect(await db.select().from(handwritings)).toEqual([]);

    const up = await call("publish", { squares: PASSING, show: "anon" });
    expect(up).toMatchObject({ status: 200, body: { mine: { rank: null, score: BOARD.start, n: 0, n799: 0, hidden: false } } });
    const first = await paperOf(u.id);
    expect(first).toMatchObject({ id: up.body.mine.id, mark: 100, show: "anon", n: 0, sum: 0, n799: 0, hiddenAt: null, strokes: simplified(PASSING) });
    // putting one up says they passed, too
    expect((await row(u.id)).writePassedAt).not.toBeNull();

    // rated once, then replaced: the new one starts again, and the old one's rating is gone with it
    const r = await rater("r@example.com");
    expect((await call("deal")).body.deal).toEqual({ id: first.id, sheet: first.strokes });
    expect((await call("rate", { deal: first.id, score: 700 })).status).toBe(200);
    expect(await paperOf(u.id)).toMatchObject({ n: 1, sum: 700 });
    await signIn(u.id);
    const passed = await call("pass", { squares: PASSING });
    expect(passed.body).toMatchObject({ mine: { id: first.id, rank: null, n: 1 }, publishesLeft: BOARD.publishesPerDay - 1 });
    const again = await call("publish", { squares: PASSING, show: "named" });
    expect(again.body.mine).toMatchObject({ n: 0, hidden: false });
    expect(again.body.mine.id).not.toBe(first.id);
    expect(await db.select().from(handwritings)).toMatchObject([{ userId: u.id, show: "named", n: 0 }]);
    expect(await db.select().from(handwritingRatings)).toEqual([]);
    // the rater may rate the new one
    await signIn(r.id);
    expect((await call("deal")).body.deal.id).toBe(again.body.mine.id);

    await signIn(u.id);
    aMinuteOn();
    for (let i = 2; i < BOARD.publishesPerDay; i++) expect((await call("publish", { squares: PASSING, show: "anon" })).status).toBe(200);
    expect(await call("publish", { squares: PASSING, show: "anon" })).toMatchObject({ status: 429, body: { error: `今天放了 ${BOARD.publishesPerDay} 次了，明天再来。` } });
    expect((await call("pass", { squares: PASSING })).body.publishesLeft).toBe(0);
    // the next site day, again
    vi.setSystemTime(Date.now() + DAY);
    expect((await call("pass", { squares: PASSING })).body.publishesLeft).toBe(BOARD.publishesPerDay);
    expect((await call("publish", { squares: PASSING, show: "anon" })).status).toBe(200);
    expect(await row(u.id)).toMatchObject({ writeDay: siteDay(), writePublishes: 1 });

    // taken down: gone, and a second time there is nothing to take down
    expect(await call("withdraw")).toMatchObject({ status: 200, body: { gone: true } });
    expect(await call("withdraw")).toMatchObject({ status: 200, body: { gone: false } });
    expect(await db.select().from(handwritings)).toEqual([]);
  });

  it("puts nothing up while the player's interactions are paused", async () => {
    vi.stubEnv("STUDY", "on");
    const u = await account("p@example.com", { suspendedUntil: new Date(Date.now() + 3 * DAY) });
    await signIn(u.id);
    expect(await call("publish", { squares: PASSING, show: "anon" })).toMatchObject({ status: 403, body: { error: expect.stringContaining("这期间不能放字") } });
    // passing still counts
    expect((await call("pass", { squares: PASSING })).status).toBe(200);
  });

  it("shows a named paper under its writer's name on the map, now; 匿名舟P for one put up anonymously or by a player anonymous on the map", async () => {
    vi.stubEnv("STUDY", "on");
    const named = await writer("named@example.com", "named");
    const anon = await writer("anon@example.com", "anon");
    const hiding = await writer("hiding@example.com", "named", { anonymous: true });
    // rated by enough to be on the board
    await db.update(handwritings).set({ n: BOARD.minRaters, sum: BOARD.minRaters * 700 });
    boardChanged();
    const names = async () =>
      Object.fromEntries(((await call("board", { page: 1 })).body.rows as { id: string; name: string | null }[]).map((r) => [r.id, r.name]));
    expect(await names()).toEqual({ [named.paper]: "named", [anon.paper]: null, [hiding.paper]: null });
    await db.update(users).set({ name: "改了名" }).where(eq(users.id, named.user.id));
    expect((await names())[named.paper]).toBe("改了名");
    // never whose to a visitor either, nor anything else of them
    signOut();
    const visitor = await call("board");
    expect(visitor.body.rows).toHaveLength(3);
    for (const r of visitor.body.rows) expect(Object.keys(r).sort()).toEqual(["id", "n", "n799", "name", "rank", "score", "sheet"]);
    expect(visitor.body.rows[0]).toMatchObject({ rank: 1, sheet: simplified(PASSING), n: BOARD.minRaters, n799: 0 });
  });
});

describe("手写榜: rating", () => {
  it("deals another's paper, never one's own, one rated or reported already, one hidden, nor one of someone blocked either way", async () => {
    vi.stubEnv("STUDY", "on");
    const mine = await writer("me@example.com");
    const ok = await writer("ok@example.com");
    const blocked = await writer("blocked@example.com");
    const blocking = await writer("blocking@example.com");
    const hidden = await writer("hidden@example.com");
    const reported = await writer("reported@example.com");
    const me = mine.user;
    await db.update(users).set({ writePassedAt: new Date() }).where(eq(users.id, me.id));
    await db.insert(blocks).values([
      { blockerId: me.id, blockedId: blocked.user.id },
      { blockerId: blocking.user.id, blockedId: me.id },
    ]);
    await db.update(handwritings).set({ hiddenAt: new Date() }).where(eq(handwritings.id, hidden.paper));
    await signIn(me.id);
    expect((await call("report", { paper: reported.paper, reason: "scrawl", note: "" })).status).toBe(200);

    const dealt = await call("deal");
    expect(dealt).toMatchObject({ status: 200, body: { deal: { id: ok.paper, sheet: simplified(PASSING) }, rate: { can: true, left: BOARD.ratesPerDay } } });
    // never whose
    expect(Object.keys(dealt.body.deal).sort()).toEqual(["id", "sheet"]);
    // the same one again until it is rated or skipped
    expect((await call("deal")).body.deal.id).toBe(ok.paper);
    const rated = await call("rate", { deal: ok.paper, score: BOARD.max });
    expect(rated).toMatchObject({ status: 200, body: { deal: null, rate: { can: true, left: BOARD.ratesPerDay - 1 } } });
    expect(await call("deal")).toMatchObject({ status: 200, body: { deal: null, rate: { can: true } } });
  });

  it("takes no rating of the paper dealt once its rater reported it, or a block stands between them and its writer", async () => {
    vi.stubEnv("STUDY", "on");
    const a = await writer("a@example.com");
    const b = await writer("b@example.com");
    const r = await rater("r@example.com");
    // a, reported from the rating screen: not rated after, and the next dealt is another
    await db.update(users).set({ writeDeal: a.paper }).where(eq(users.id, r.id));
    expect((await call("report", { paper: a.paper, reason: "rude", note: "" })).status).toBe(200);
    expect(await call("rate", { deal: a.paper, score: 0 })).toMatchObject({ status: 409, body: { code: "stale_deal" } });
    expect((await call("deal")).body.deal.id).toBe(b.paper);
    // b, whose writer blocks the rater meanwhile
    await db.insert(blocks).values({ blockerId: b.user.id, blockedId: r.id });
    expect(await call("rate", { deal: b.paper, score: BOARD.max })).toMatchObject({ status: 409, body: { code: "stale_deal" } });
    expect((await call("deal")).body.deal).toBeNull();
    expect(await db.select().from(handwritingRatings)).toEqual([]);
    expect((await db.select().from(handwritings)).map((h) => h.n)).toEqual([0, 0]);
    expect((await row(r.id)).writeRates).toBe(0);
  });

  it("deals the papers fewest have rated first, one of the 20 fewest at random", async () => {
    vi.stubEnv("STUDY", "on");
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push((await writer(`w${i}@example.com`)).paper);
    for (const [i, id] of ids.entries()) await db.update(handwritings).set({ n: i, sum: i * 400 }).where(eq(handwritings.id, id));
    const r = await rater("r@example.com");
    const deal = async (random: number) => {
      await db.update(users).set({ writeDeal: null }).where(eq(users.id, r.id));
      return (await dealPaper(await row(r.id), Date.now(), () => random)).deal?.id;
    };
    expect(await deal(0)).toBe(ids[0]);
    expect(await deal(0.5)).toBe(ids[10]);
    expect(await deal(0.9999)).toBe(ids[19]);
    // what is dealt is kept as theirs to rate
    expect((await row(r.id)).writeDeal).toBe(ids[19]);
  });

  it("takes a rating of the paper dealt only, a whole number from 0 to BOARD.max, once; counts the 799s; BOARD.ratesPerDay a site day", async () => {
    clock();
    vi.stubEnv("STUDY", "on");
    const papers: string[] = [];
    for (let i = 0; i <= BOARD.ratesPerDay + 1; i++) papers.push((await writer(`w${i}@example.com`)).paper);
    const r = await rater("r@example.com");
    const first = (await call("deal")).body.deal.id as string;
    expect(papers).toContain(first);
    const other = papers.find((p) => p !== first)!;
    expect(await call("rate", { deal: other, score: 500 })).toMatchObject({ status: 409, body: { code: "stale_deal", error: "这张已经换过了。" } });
    expect(await call("rate", { deal: "nope", score: 500 })).toMatchObject({ status: 409, body: { code: "stale_deal" } });
    for (const score of [-1, BOARD.max + 1, 1.5, "799", null]) expect(await call("rate", { deal: first, score })).toMatchObject({ status: 400, body: { error: "分数要是 0 到 800 的整数。" } });
    expect(await db.select().from(handwritingRatings)).toEqual([]);

    const meme = await call("rate", { deal: first, score: BOARD.meme });
    expect(meme).toMatchObject({ status: 200, body: { rate: { can: true, left: BOARD.ratesPerDay - 1 } } });
    expect(meme.body.deal.id).not.toBe(first);
    expect(await db.select().from(handwritings).where(eq(handwritings.id, first))).toMatchObject([{ n: 1, sum: 799, n799: 1 }]);
    expect(await db.select().from(handwritingRatings)).toMatchObject([{ writingId: first, raterId: r.id, score: 799, meme: true }]);
    // the same paper again: it is not theirs to rate any more
    expect(await call("rate", { deal: first, score: 1 })).toMatchObject({ status: 409, body: { code: "stale_deal" } });

    // rated up to the day's last: then none dealt, and why
    let d = meme.body;
    for (let i = 2; i <= BOARD.ratesPerDay; i++) d = (await call("rate", { deal: d.deal.id, score: 790 })).body;
    expect(d).toEqual({ deal: null, rate: { can: false, why: "full" } });
    expect(await call("deal")).toMatchObject({ body: { deal: null, rate: { can: false, why: "full" } } });
    expect(await call("rate", { deal: papers[0], score: 790 })).toMatchObject({ status: 429, body: { error: `今天打满 ${BOARD.ratesPerDay} 张了，明天再来。` } });
    expect((await call("board")).body.rate).toEqual({ can: false, why: "full" });
    expect(await db.select().from(handwritingRatings)).toHaveLength(BOARD.ratesPerDay);
    // the next site day, again
    vi.setSystemTime(Date.now() + DAY);
    expect((await call("deal")).body).toMatchObject({ deal: { id: expect.any(String) }, rate: { can: true, left: BOARD.ratesPerDay } });
  });

  it("lets rate only those who passed 徒手写, signed up RELIABLE_AFTER_DAYS ago or more, their interactions not paused", async () => {
    vi.stubEnv("STUDY", "on");
    const w = await writer("w@example.com");
    const young = await rater("young@example.com", 1);
    expect((await call("deal")).body).toEqual({ deal: null, rate: { can: false, why: "young" } });
    expect(await call("rate", { deal: w.paper, score: 500 })).toMatchObject({ status: 403, body: { error: "注册满 3 天才能打分。" } });
    await db.update(users).set({ createdAt: new Date(Date.now() - 4 * DAY), suspendedUntil: new Date(Date.now() + DAY) }).where(eq(users.id, young.id));
    expect((await call("deal")).body).toMatchObject({ deal: null, rate: { can: false, why: "suspended", until: expect.any(Number) } });
    expect(await call("skip", { deal: w.paper })).toMatchObject({ status: 403, body: { error: expect.stringContaining("这期间不能打分") } });
  });

  it("skips a paper for another, never it again at once; BOARD.skipsPerDay a site day", async () => {
    clock();
    vi.stubEnv("STUDY", "on");
    const a = await writer("a@example.com");
    const b = await writer("b@example.com");
    await rater("r@example.com");
    let id = (await call("deal")).body.deal.id as string;
    for (let i = 1; i <= BOARD.skipsPerDay; i++) {
      const next = await call("skip", { deal: id });
      expect(next).toMatchObject({ status: 200, body: { rate: { can: true, left: BOARD.ratesPerDay, skipsLeft: BOARD.skipsPerDay - i } } });
      expect(next.body.deal.id).toBe(id === a.paper ? b.paper : a.paper);
      id = next.body.deal.id;
    }
    expect(await call("skip", { deal: id })).toMatchObject({ status: 429, body: { error: `今天跳过 ${BOARD.skipsPerDay} 次了，明天再跳。` } });
    // rating is still open
    expect((await call("rate", { deal: id, score: 400 })).status).toBe(200);
  });

  it("goes with an account: the paper and its ratings, and the ratings it gave, taken off the papers they were of", async () => {
    vi.stubEnv("STUDY", "on");
    const a = await writer("a@example.com");
    const b = await writer("b@example.com");
    await db.update(users).set({ writePassedAt: new Date() });
    await signIn(a.user.id);
    expect((await call("rate", { deal: (await call("deal")).body.deal.id, score: 600 })).status).toBe(200);
    await signIn(b.user.id);
    expect((await call("rate", { deal: (await call("deal")).body.deal.id, score: 799 })).status).toBe(200);
    const c = await rater("c@example.com");
    expect((await call("rate", { deal: (await call("deal")).body.deal.id, score: 100 })).status).toBe(200);
    expect((await call("rate", { deal: (await call("deal")).body.deal.id, score: 200 })).status).toBe(200);
    expect(await paperOf(a.user.id)).toMatchObject({ n: 2, n799: 1 });

    await deleteAccount(await row(b.user.id));
    // b's paper went, with a's rating of it; b's 799 is off a's paper
    expect(await db.select({ id: handwritings.id }).from(handwritings)).toEqual([{ id: a.paper }]);
    const left = await paperOf(a.user.id);
    expect(left.n799).toBe(0);
    expect([left.n, left.sum]).toEqual([1, (await db.select().from(handwritingRatings).where(eq(handwritingRatings.writingId, a.paper)))[0].score]);
    await deleteAccount(await row(c.id));
    expect(await paperOf(a.user.id)).toMatchObject({ n: 0, sum: 0, n799: 0 });
    expect(await db.select().from(handwritingRatings)).toEqual([]);
  });
});

describe("手写榜: the board", () => {
  it("ranks the papers rated by BOARD.minRaters or more, BOARD.page to a page, and tells the player where their own stands", async () => {
    vi.stubEnv("STUDY", "on");
    const ws: { user: typeof users.$inferSelect; paper: string }[] = [];
    for (let i = 0; i < BOARD.page + 3; i++) ws.push(await writer(`w${i}@example.com`));
    // all rated by enough but the last, each a little more than the one before
    for (const [i, w] of ws.entries()) await db.update(handwritings).set({ n: i === ws.length - 1 ? BOARD.minRaters - 1 : BOARD.minRaters, sum: BOARD.minRaters * (500 + 3 * i), n799: i % 2 }).where(eq(handwritings.id, w.paper));
    boardChanged();
    const one = await call("board", { page: 1 });
    expect(one.body).toMatchObject({ paused: false, page: 1, pages: 2 });
    expect(one.body.rows).toHaveLength(BOARD.page);
    expect(one.body.rows.map((r: { rank: number }) => r.rank)).toEqual(Array.from({ length: BOARD.page }, (_, i) => i + 1));
    expect(one.body.rows[0].id).toBe(ws[ws.length - 2].paper);
    const scores = one.body.rows.map((r: { score: number }) => r.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    const two = await call("board", { page: 2 });
    expect(two.body.rows.map((r: { id: string }) => r.id)).toEqual([ws[1].paper, ws[0].paper]);
    expect(two.body.rows.map((r: { rank: number }) => r.rank)).toEqual([BOARD.page + 1, BOARD.page + 2]);
    // past the last page: the last
    expect((await call("board", { page: 99 })).body.page).toBe(2);
    expect((await call("board", { page: "x" })).body.page).toBe(1);
    // the last one signed in: theirs is not on the board yet
    expect(one.body.mine).toEqual({ id: ws[ws.length - 1].paper, rank: null, score: expect.any(Number), n: BOARD.minRaters - 1, n799: 0, hidden: false });
    await signIn(ws[0].user.id);
    expect((await call("board")).body.mine).toEqual({ id: ws[0].paper, rank: BOARD.page + 2, score: expect.any(Number), n: BOARD.minRaters, n799: 0, hidden: false });
    // a page of the board is small: strokes, never pictures
    expect(JSON.stringify(one.body).length).toBeLessThan(BOARD.page * 1500);
  });

  it("is ranked again at most once a minute, but at once for what this process put up, took down or hid", async () => {
    clock();
    vi.stubEnv("STUDY", "on");
    const a = await writer("a@example.com");
    await db.update(handwritings).set({ n: BOARD.minRaters, sum: BOARD.minRaters * 700 }).where(eq(handwritings.id, a.paper));
    boardChanged();
    expect((await call("board")).body.rows).toHaveLength(1);
    // counted elsewhere: not yet
    await db.update(handwritings).set({ n: BOARD.minRaters + 1, sum: (BOARD.minRaters + 1) * 700 }).where(eq(handwritings.id, a.paper));
    expect((await call("board")).body.rows[0].n).toBe(BOARD.minRaters);
    aMinuteOn();
    expect((await call("board")).body.rows[0].n).toBe(BOARD.minRaters + 1);
    // taken down: off at once
    await signIn(a.user.id);
    expect((await call("withdraw")).body.gone).toBe(true);
    expect((await call("board")).body.rows).toEqual([]);
  });
});

describe("手写榜: reports", () => {
  it("are made as of a roach on the map: nobody blocked, once a paper while open; hidden once HIDE_AFTER reliable players' wait, not before", async () => {
    vi.stubEnv("STUDY", "on");
    const w = await writer("w@example.com");
    await db.update(handwritings).set({ n: BOARD.minRaters, sum: BOARD.minRaters * 700 }).where(eq(handwritings.id, w.paper));
    boardChanged();
    expect(await call("report", { paper: w.paper, reason: "scrawl", note: "" })).toMatchObject({ status: 400, body: { error: "这是你自己的字。" } });

    const reporters = [];
    for (let i = 0; i < HIDE_AFTER; i++) reporters.push(await rater(`r${i}@example.com`));
    // signed up a day ago: their report counts, but not toward hiding it
    await rater("young@example.com", 1);
    expect(await call("report", { paper: w.paper, reason: "nope", note: "" })).toMatchObject({ status: 400 });
    expect(await call("report", { paper: w.paper, reason: "writingOther", note: " " })).toMatchObject({ status: 400, body: { error: "选了「别的」的话，写一句是什么事吧。" } });
    expect(await call("report", { paper: "00000000-0000-4000-8000-000000000000", reason: "scrawl", note: "" })).toMatchObject({ status: 404, body: { error: "这张字已经不在榜上了。" } });
    expect(await call("report", { paper: w.paper, reason: "rude", note: "画了不好的东西" })).toMatchObject({ status: 200, body: { ok: true } });
    for (const r of reporters.slice(0, HIDE_AFTER - 1)) {
      await signIn(r.id);
      expect((await call("report", { paper: w.paper, reason: "scrawl", note: "" })).status).toBe(200);
      // once while open
      expect((await call("report", { paper: w.paper, reason: "rude", note: "" })).status).toBe(200);
    }
    // a young reporter's and two reliable ones' are not enough
    expect((await paperOf(w.user.id)).hiddenAt).toBeNull();
    expect((await call("board")).body.rows).toHaveLength(1);
    await signIn(reporters[HIDE_AFTER - 1].id);
    expect((await call("report", { paper: w.paper, reason: "scrawl", note: "" })).status).toBe(200);
    expect((await paperOf(w.user.id)).hiddenAt).not.toBeNull();
    const open = await db.select().from(reports).where(eq(reports.writingId, w.paper));
    expect(open).toHaveLength(HIDE_AFTER + 1);
    expect(open.every((r) => r.targetId === w.user.id && r.context === "手写榜上的字（匿名）")).toBe(true);
    // off the board, dealt to nobody, and the writer told why theirs is not there
    expect((await call("board")).body.rows).toEqual([]);
    await rater("other@example.com");
    expect((await call("deal")).body.deal).toBeNull();
    await signIn(w.user.id);
    expect((await call("board")).body.mine).toMatchObject({ id: w.paper, rank: null, hidden: true });
    // nobody blocked anybody
    expect(await db.select().from(blocks)).toEqual([]);
  });
});

describe("手写榜, paused by the owner", () => {
  it("shows only the player's own paper and refuses to put up, deal, rate, skip or report; passing and taking down go on, and what is up stays", async () => {
    vi.stubEnv("STUDY", "on");
    const owner = await account("owner@example.com");
    const w = await writer("w@example.com");
    const r = await rater("r@example.com");
    expect((await call("rate", { deal: w.paper, score: 500 })).status).toBe(409);
    expect((await call("rate", { deal: (await call("deal")).body.deal.id, score: 500 })).status).toBe(200);
    const w2 = await writer("w2@example.com");
    await signIn(r.id);
    const dealt = (await call("deal")).body.deal.id as string;
    expect(dealt).toBe(w2.paper);
    await setBoard(owner.id, { paused: true });
    try {
      expect(await call("board")).toMatchObject({ status: 200, body: { paused: true, mine: null } });
      for (const [op, body] of [
        ["deal", {}],
        ["rate", { deal: dealt, score: 799 }],
        ["skip", { deal: dealt }],
        ["report", { paper: w.paper, reason: "scrawl", note: "" }],
        ["publish", { squares: PASSING, show: "anon" }],
      ] as const)
        expect(await call(op, body)).toMatchObject({ status: 409, body: { code: "board_paused", error: "手写榜暂停了，过一阵再来。" } });
      expect(await call("pass", { squares: PASSING })).toMatchObject({ status: 200, body: { paused: true } });
      signOut();
      expect(await call("board")).toMatchObject({ status: 200, body: { paused: true, mine: null } });
      await signIn(w2.user.id);
      expect((await call("board")).body).toEqual({ paused: true, mine: expect.objectContaining({ id: w2.paper }) });
      expect(await call("withdraw")).toMatchObject({ status: 200, body: { gone: true } });
    } finally {
      await setBoard(owner.id, { paused: false });
    }
    // what was up and its ratings are as they were
    expect(await paperOf(w.user.id)).toMatchObject({ id: w.paper, n: 1, sum: 500, hiddenAt: null });
    await signIn(r.id);
    expect((await call("deal")).body).toMatchObject({ deal: null, rate: { can: true, left: BOARD.ratesPerDay - 1 } });
  });
});
