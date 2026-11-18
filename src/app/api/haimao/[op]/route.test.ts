import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/server/db";
import { haimaoPlayers, sessions, users } from "@/lib/server/schema";
import { POST } from "./route";

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

type Answer = { status: number; body: Record<string, unknown>; cache: string | null };

async function call(op: string, body: unknown = {}): Promise<Answer> {
  const req = new NextRequest(`http://localhost/api/haimao/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

/** Every request 今日剧情 makes, as the page sends them (UTC+8, as most players) */
const EVERY: [string, unknown][] = [
  ["story", { offset: -480 }],
  ["pick", { day: 1, answer: 0, offset: -480 }],
  ["end", { offset: -480 }],
];

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning({ id: users.id });
  return u.id;
}

/** Signed in as the player: the requests from here on are theirs */
async function signIn(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: new Date(Date.now() + 86_400_000) });
  jar.token = token;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${haimaoPlayers} cascade`);
  jar.token = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("今日剧情's requests", () => {
  it("are answered 404 while HAIMAO is off, as if nothing were here", async () => {
    vi.stubEnv("HAIMAO", "off");
    for (const [op, body] of EVERY) expect((await call(op, body)).status, op).toBe(404);
    await signIn(await account("owner@example.com"));
    for (const [op, body] of EVERY) expect(await call(op, body), op).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });
  });

  it("are answered 404 to anyone she does not show to while HAIMAO is admins, visitors too", async () => {
    vi.stubEnv("HAIMAO", "admins");
    for (const [op, body] of EVERY) expect((await call(op, body)).status, op).toBe(404);
    await signIn(await account("someone@example.com"));
    for (const [op, body] of EVERY) expect((await call(op, body)).status, op).toBe(404);
    await signIn(await account("owner@example.com"));
    expect(await call("story", { offset: -480 })).toMatchObject({ status: 200, cache: "no-store" });
  });

  it("ask visitors to sign in once she is out for everyone, and know no other request", async () => {
    vi.stubEnv("HAIMAO", "on");
    for (const [op, body] of EVERY) expect((await call(op, body)).status, op).toBe(401);
    await signIn(await account("someone@example.com"));
    expect((await call("spin")).status).toBe(404);
    expect((await call("toString")).status).toBe(404);
  });

  it("wait while the player is asked to say again they are 18 or older", async () => {
    vi.stubEnv("HAIMAO", "on");
    const me = await account("someone@example.com");
    await db.update(users).set({ ageCheckAt: new Date() }).where(eq(users.id, me));
    await signIn(me);
    for (const [op, body] of EVERY) expect(await call(op, body), op).toMatchObject({ status: 428, body: { code: "age" } });
  });

  it("tell the day's scene, take its answer, and refuse one that is not", async () => {
    vi.stubEnv("HAIMAO", "on");
    await signIn(await account("someone@example.com"));
    expect(await call("story", { offset: -480 })).toMatchObject({
      status: 200,
      cache: "no-store",
      body: { love: 0, days: 0, end: false, today: { kind: "scene", day: 1, picked: null } },
    });
    expect(await call("pick", { day: 1, answer: 2, offset: -480 })).toMatchObject({
      status: 200,
      body: { love: 3, days: 1, picks: [2], today: { kind: "scene", day: 1, picked: 2 }, plus: 3 },
    });
    expect((await call("pick", { day: 1, answer: 7, offset: -480 })).status).toBe(400);
    expect(await call("end", { offset: -480 })).toMatchObject({ status: 200, body: { end: false, plus: 0 } });
  });
});
