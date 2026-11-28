import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itemOf } from "@/lib/fish/items";
import { CASTS_A_DAY, PERFECT_MS, RING_MS } from "@/lib/fish/rules";
import { db } from "@/lib/server/db";
import { forgetBank } from "@/lib/server/fish";
import { fishDays, fishDex, fishLines, fishRecords, fishShouts, sessions, users } from "@/lib/server/schema";
import { nextSiteDayAt, siteDay } from "@/lib/siteDay";
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

type Answer = { status: number; body: Record<string, unknown> };

async function call(method: "GET" | "POST", op: string, body?: unknown): Promise<Answer> {
  const url = `http://localhost/api/fish/${op}`;
  const req =
    method === "GET"
      ? new NextRequest(url)
      : new NextRequest(url, {
          method,
          headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
  const res = await { GET, POST }[method](req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}

const tokens = new Map<string, string>();
/** Signed in as the player: the requests from here on are theirs */
async function signIn(userId: string) {
  let token = tokens.get(userId);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    // runs out by the database's clock, as the site checks it, not the faked one
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: sql`now() + interval '30 days'` });
    tokens.set(userId, token);
  }
  jar.token = token;
}

/** A line in the water as if cast `ago` ms back and bitten `bitten` ms back, with this on the hook */
async function hooked(userId: string, item: number, opts: { variant?: number; cm?: number | null; bitten?: number; spot?: string } = {}) {
  const now = Date.now();
  await db
    .insert(fishLines)
    .values({ userId, spot: opts.spot ?? "pier", castAt: new Date(now - 60_000), biteAt: new Date(now - (opts.bitten ?? 100)), item, variant: opts.variant ?? 0, cm: opts.cm ?? null, shadow: "m" })
    .onConflictDoUpdate({ target: fishLines.userId, set: { item, variant: opts.variant ?? 0, cm: opts.cm ?? null, biteAt: new Date(now - (opts.bitten ?? 100)) } });
}

const dayRow = async (userId: string) => (await db.select().from(fishDays).where(and(eq(fishDays.userId, userId), eq(fishDays.day, siteDay()))))[0];
const lineRow = async (userId: string) => (await db.select().from(fishLines).where(eq(fishLines.userId, userId)))[0];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${fishRecords}, ${fishShouts} cascade`);
  jar.token = null;
  tokens.clear();
  forgetBank();
  vi.stubEnv("FISH", "admins");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("钓鳞's requests", () => {
  it("are answered 404 while FISH keeps it from the player, and to a visitor until it is open to everyone", async () => {
    vi.stubEnv("FISH", "off");
    expect((await call("POST", "state")).status).toBe(404);
    const owner = await account("owner@example.com");
    const player = await account("p@example.com");
    await signIn(owner);
    expect(await call("POST", "state")).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });
    vi.stubEnv("FISH", "admins");
    expect((await call("POST", "state")).status).toBe(200);
    expect((await call("GET", "state")).status).toBe(404);
    expect((await call("POST", "nothing")).status).toBe(404);
    await signIn(player);
    expect((await call("POST", "state")).status).toBe(404);
    vi.stubEnv("FISH", "on");
    expect((await call("POST", "state")).status).toBe(200);
    jar.token = null;
    expect((await call("POST", "state")).status).toBe(401);
  });

  it("casts, waits for the bite, and pulls in once: early is refused and keeps the line, a second pull finds none", async () => {
    const owner = await account("owner@example.com");
    await signIn(owner);
    const cast = await call("POST", "cast", { spot: "pier", tz: 480 });
    expect(cast.status).toBe(200);
    const line = cast.body.line as { biteAt: number; castAt: number; shadow: string; spot: string };
    expect(line.spot).toBe("pier");
    expect(line.biteAt - line.castAt).toBeGreaterThanOrEqual(20_000);
    expect(line.biteAt - line.castAt).toBeLessThanOrEqual(180_000);
    // what is on the hook is not said until it is pulled
    expect(JSON.stringify(cast.body)).not.toMatch(/"item"|"no"|"cm"/);
    expect((await call("POST", "state")).body).toMatchObject({ casts: 1, line: { spot: "pier", biteAt: line.biteAt } });
    expect(await call("POST", "reel")).toMatchObject({ status: 409, body: { error: "还没咬钩，再等等。" } });
    expect(await lineRow(owner)).toBeDefined();
    vi.setSystemTime(new Date(line.biteAt + 300));
    const reel = await call("POST", "reel");
    expect(reel.status).toBe(200);
    const caught = reel.body.caught as { no: number; first: boolean; n: number; onTime: boolean };
    expect(itemOf(caught.no)?.at.pier).toBeDefined();
    expect(caught).toMatchObject({ first: true, n: 1, onTime: false });
    expect(await call("POST", "reel")).toMatchObject({ status: 409, body: { error: "水里没有你的竿，先甩一竿。" } });
    const dex = (await call("POST", "dex")).body as { mine: { no: number; n: number }[] };
    expect(dex.mine).toMatchObject([{ no: caught.no, n: 1 }]);
    expect((await call("POST", "state")).body).toMatchObject({ casts: 1, line: null, owned: 1 });
  });

  it("allows a hundred casts a site day, taken back or not, and a hundred more from 04:00 Beijing time", async () => {
    const owner = await account("owner@example.com");
    await signIn(owner);
    await db.insert(fishDays).values({ userId: owner, day: siteDay(), casts: CASTS_A_DAY - 2 });
    expect((await call("POST", "cast", { spot: "pier" })).status).toBe(200);
    expect((await call("POST", "pull")).status).toBe(200);
    expect(await lineRow(owner)).toBeUndefined();
    expect((await call("POST", "cast", { spot: "pier" })).body).toMatchObject({ casts: CASTS_A_DAY });
    expect(await call("POST", "cast", { spot: "pier" })).toMatchObject({ status: 429, body: { error: "今天的 100 竿钓完了，明天北京时间 4 点再来。" } });
    expect((await dayRow(owner)).casts).toBe(CASTS_A_DAY);
    // a second before 04:00 still the old day; at 04:00 a new one
    vi.setSystemTime(new Date(nextSiteDayAt() - 1_000));
    expect((await call("POST", "cast", { spot: "pier" })).status).toBe(429);
    vi.setSystemTime(new Date(nextSiteDayAt()));
    expect((await call("POST", "cast", { spot: "pier" })).body).toMatchObject({ casts: 1 });
    // 卫戍池塘 is for one in a room of 一起卫戍; anywhere else is no spot at all
    expect(await call("POST", "cast", { spot: "pond" })).toMatchObject({ status: 409, body: { error: "你不在卫戍房间里，钓不了卫戍池塘。" } });
    expect((await call("POST", "cast", { spot: "sea" })).status).toBe(400);
  });

  it("makes a pull in a ring's last 0.4 s on time and a tenth bigger, by the server's clock", async () => {
    const owner = await account("owner@example.com");
    await signIn(owner);
    await hooked(owner, 1, { cm: 4000, bitten: 2 * RING_MS + RING_MS - PERFECT_MS + 100 });
    expect((await call("POST", "reel")).body).toMatchObject({ caught: { no: 1, onTime: true, cm: 4400 } });
    await hooked(owner, 1, { cm: 4000, bitten: 2 * RING_MS + 300 });
    expect((await call("POST", "reel")).body).toMatchObject({ caught: { no: 1, onTime: false, cm: 4000, first: false, record: false, n: 2 } });
    await hooked(owner, 1, { cm: 5000, bitten: 300 });
    expect((await call("POST", "reel")).body).toMatchObject({ caught: { cm: 5000, record: true, n: 3 } });
    const dex = (await call("POST", "dex")).body as { mine: { no: number; best: number }[]; records: { no: number; cm: number }[] };
    expect(dex.mine).toMatchObject([{ no: 1, best: 5000 }]);
    expect(dex.records).toEqual([{ no: 1, variant: 0, cm: 5000 }]);
  });

  it("gives two tabs casting at once two casts and one line, and one catch for it", async () => {
    const owner = await account("owner@example.com");
    await signIn(owner);
    const both = await Promise.all([call("POST", "cast", { spot: "pier" }), call("POST", "cast", { spot: "pier" })]);
    expect(both.map((a) => a.status)).toEqual([200, 200]);
    expect((await dayRow(owner)).casts).toBe(2);
    expect((await db.select().from(fishLines)).length).toBe(1);
    vi.setSystemTime(new Date((await lineRow(owner)).biteAt.getTime() + 10));
    const pulls = await Promise.all([call("POST", "reel"), call("POST", "reel")]);
    expect(pulls.map((a) => a.status).sort()).toEqual([200, 409]);
    const dex = (await call("POST", "dex")).body as { mine: { n: number }[] };
    expect(dex.mine.reduce((s, r) => s + r.n, 0)).toBe(1);
  });

  it("says a purple catch on the bank to the others, with no name, never to the one who caught it", async () => {
    const owner = await account("owner@example.com");
    const other = await account("other@example.com");
    vi.stubEnv("FISH", "on");
    await signIn(other);
    const first = (await call("POST", "state")).body as { lastShout: number; shouts: unknown[] };
    expect(first.shouts).toEqual([]);
    await signIn(owner);
    await hooked(owner, 21, { cm: 5210 });
    expect((await call("POST", "reel")).status).toBe(200);
    expect((await call("POST", "state", { after: first.lastShout })).body).toMatchObject({ shouts: [] });
    await signIn(other);
    const seen = (await call("POST", "state", { after: first.lastShout })).body as { shouts: Record<string, unknown>[]; lastShout: number };
    expect(seen.shouts).toEqual([{ id: seen.lastShout, no: 21, variant: 0, cm: 5210 }]);
    expect(JSON.stringify(seen)).not.toContain(owner);
    // a page opening now does not hear it again
    expect((await call("POST", "state")).body).toMatchObject({ shouts: [] });
  });

  it("makes blue or better the cast after eight without, and 空军司令 of ten junk in a row", async () => {
    const owner = await account("owner@example.com");
    await signIn(owner);
    await db.insert(fishDays).values({ userId: owner, day: siteDay(), casts: 0, dry: 8, junk: 9 });
    expect((await call("POST", "cast", { spot: "pier" })).status).toBe(200);
    const line = await lineRow(owner);
    expect(itemOf(line.item)!.tier).toBeGreaterThanOrEqual(3);
    expect((await dayRow(owner)).dry).toBe(0);
    await hooked(owner, 2);
    expect((await call("POST", "reel")).body).toMatchObject({ admiral: true });
    expect((await call("POST", "state")).body).toMatchObject({ admiral: true });
    expect((await db.select().from(fishDex).where(eq(fishDex.userId, owner))).length).toBe(1);
  });
});
