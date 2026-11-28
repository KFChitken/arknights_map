import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "@/i18n";
import { itemOf } from "@/lib/fish/items";
import { CASTS_A_DAY, NET_EVERY_MS, NET_MAX, type FishHaul } from "@/lib/fish/rules";
import { db } from "@/lib/server/db";
import { castLine, forgetBank } from "@/lib/server/fish";
import { forgetHits } from "@/lib/server/rateLimit";
import { fishDays, fishDex, fishLines, fishNets, sessions, users } from "@/lib/server/schema";
import { siteDay } from "@/lib/siteDay";
import { POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sid" && jar.token ? { name, value: jar.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

type User = typeof users.$inferSelect;
type Answer = { status: number; body: Record<string, unknown> };
type Netted = { now: number; net: number | null; casts: number; haul: FishHaul | null };

async function call(op: string, body?: unknown): Promise<Answer> {
  const req = new NextRequest(`http://localhost/api/fish/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function account(email: string): Promise<User> {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

async function signIn(u: Pick<User, "id">) {
  const token = randomBytes(32).toString("base64url");
  // runs out by the database's clock, as the site checks it, not the faked one
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: sql`now() + interval '30 days'` });
  jar.token = token;
}

const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
const dayRow = async (userId: string) => (await db.select().from(fishDays).where(and(eq(fishDays.userId, userId), eq(fishDays.day, siteDay()))))[0];
const netRow = async (userId: string) => (await db.select().from(fishNets).where(eq(fishNets.userId, userId)))[0];
const pulled = (h: FishHaul) => h.items.reduce((n, i) => n + i.n, 0);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions} cascade`);
  jar.token = null;
  forgetBank();
  forgetHits();
  vi.stubEnv("FISH", "on");
  vi.stubEnv("PASSES", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("自动钓", () => {
  it("counts a cast every 3 minutes once on, 20 at most, and 收网 draws them at once: grey to blue, no variants, no 通行证 things", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    const on = (await call("net", { on: true })).body as Netted;
    expect(on).toMatchObject({ net: Date.now(), casts: 0, haul: null });
    expect((await call("state")).body).toMatchObject({ net: on.net });
    // on again: as it was
    later(60_000);
    expect(((await call("net", { on: true })).body as Netted).net).toBe(on.net);

    later(14 * NET_EVERY_MS);
    const first = (await call("haul")).body as Netted;
    expect(first.haul?.casts).toBe(14);
    expect(pulled(first.haul!)).toBe(14);
    for (const i of first.haul!.items) {
      expect(itemOf(i.no)!.tier).toBeLessThanOrEqual(3);
      expect(itemOf(i.no)!.kind).toBeUndefined();
      expect(itemOf(i.no)!.at.auto).toBeDefined();
      expect(i.variant).toBe(0);
    }
    expect(first.haul!.items.every((i) => i.first)).toBe(true);
    expect(first).toMatchObject({ casts: 14, net: on.net! + 14 * NET_EVERY_MS });
    expect((await dayRow(a.id)).casts).toBe(14);
    const dex = await db.select().from(fishDex).where(eq(fishDex.userId, a.id));
    expect(dex.reduce((n, d) => n + d.n, 0)).toBe(14);
    expect(dex.every((d) => d.firstSpot === "auto")).toBe(true);

    // a long while: 20 at most, the rest gone, the count on from the last whole slot
    later(61 * NET_EVERY_MS + 30_000);
    const second = (await call("haul")).body as Netted;
    expect(second.haul?.casts).toBe(NET_MAX);
    expect(second.haul!.items.every((i) => !i.first || !dex.some((d) => d.item === i.no))).toBe(true);
    expect(Date.now() - second.net!).toBe(90_000);
    expect((await dayRow(a.id)).casts).toBe(14 + NET_MAX);
    // nothing held yet
    expect(((await call("haul")).body as Netted).haul).toEqual({ casts: 0, items: [] });
  });

  it("takes no more than the day's casts left, and the slots past them are gone", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    await db.insert(fishDays).values({ userId: a.id, day: siteDay(), casts: CASTS_A_DAY - 5 });
    await call("net", { on: true });
    later(10 * NET_EVERY_MS);
    const res = (await call("haul")).body as Netted;
    expect(res.haul?.casts).toBe(5);
    expect(res.casts).toBe(CASTS_A_DAY);
    later(3 * NET_EVERY_MS);
    expect(((await call("haul")).body as Netted).haul?.casts).toBe(0);
    expect(await call("cast", { spot: "pier" })).toMatchObject({ status: 429 });
  });

  it("goes on beside the player's own line, is pulled in as it is switched off, and refuses 收网 while off", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    expect(await call("haul")).toMatchObject({ status: 409, body: { error: T.server.fish.netOff } });
    expect((await call("net", { on: "yes" })).status).toBe(400);
    await call("net", { on: true });
    await castLine(a, { spot: "pier" });
    later(2 * NET_EVERY_MS + 1);
    const off = (await call("net", { on: false })).body as Netted;
    expect(off).toMatchObject({ net: null, casts: 3, haul: { casts: 2 } });
    expect(await netRow(a.id)).toBeUndefined();
    expect(await db.select().from(fishLines).where(eq(fishLines.userId, a.id))).toHaveLength(1);
    // off already: nothing
    expect(((await call("net", { on: false })).body as Netted).haul).toBeNull();
  });

  it("moves neither the player's dry run nor their junk run (空军司令)", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    await db.insert(fishDays).values({ userId: a.id, day: siteDay(), dry: 5, junk: 4 });
    await call("net", { on: true });
    later(NET_MAX * NET_EVERY_MS);
    expect(((await call("haul")).body as Netted).haul?.casts).toBe(NET_MAX);
    expect(await dayRow(a.id)).toMatchObject({ dry: 5, junk: 4, admiral: false, casts: NET_MAX });
  });

  it("is the bank's: not there while FISH keeps the player from it", async () => {
    vi.stubEnv("FISH", "admins");
    vi.stubEnv("SQUAD", "admins");
    const owner = await account("owner@example.com");
    await signIn(owner);
    expect((await call("net", { on: true })).status).toBe(200);
    vi.stubEnv("FISH", "off");
    expect((await call("haul")).status).toBe(404);
    expect(await netRow(owner.id)).toBeDefined();
  });
});
