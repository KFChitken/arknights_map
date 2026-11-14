import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/server/db";
import { passCounters, sessions, users } from "@/lib/server/schema";
import { GET, POST, PUT } from "./route";

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

type Method = "GET" | "POST" | "PUT";
type Answer = { status: number; body: Record<string, unknown>; cache: string | null };

async function call(method: Method, op: string, body?: unknown, query = ""): Promise<Answer> {
  const url = `http://localhost/api/passes/${op}${query}`;
  const req =
    method === "GET"
      ? new NextRequest(url)
      : new NextRequest(url, {
          method,
          headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
  const res = await { GET, POST, PUT }[method](req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

/** Every request 通行证寻访 answers, as the page sends them */
const EVERY: [Method, string, unknown?][] = [
  ["POST", "open"],
  ["POST", "draw", { n: 1 }],
  ["PUT", "wish", { ids: [1] }],
  ["GET", "collection"],
  ["GET", "log"],
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
  await db.execute(sql`truncate ${users}, ${sessions}, ${passCounters} cascade`);
  jar.token = null;
});

afterEach(() => vi.unstubAllEnvs());

describe("通行证寻访's requests", () => {
  it("are answered 404 while PASSES is off, as if nothing were here", async () => {
    vi.stubEnv("PASSES", "off");
    for (const [method, op, body] of EVERY) expect((await call(method, op, body)).status, op).toBe(404);
    await signIn(await account("owner@example.com"));
    for (const [method, op, body] of EVERY) {
      expect(await call(method, op, body), op).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });
    }
  });

  it("are only for the 站长 and the admins while PASSES is admins; anyone else, visitors too, gets 404", async () => {
    vi.stubEnv("PASSES", "admins");
    expect((await call("POST", "open")).status).toBe(404);
    await signIn(await account("someone@example.com"));
    for (const [method, op, body] of EVERY) expect((await call(method, op, body)).status, op).toBe(404);
    await signIn(await account("owner@example.com"));
    expect(await call("POST", "open")).toMatchObject({ status: 200, body: { tickets: 10, welcomed: true } });
  });

  it("let a player open the page, draw, change the wish list and read what they have, once PASSES is on", async () => {
    vi.stubEnv("PASSES", "on");
    expect(await call("POST", "open")).toMatchObject({ status: 401, body: { error: expect.any(String) } });
    await signIn(await account("player@example.com"));
    // only the ways in that exist, each by its own method
    expect((await call("GET", "draw")).status).toBe(404);
    expect((await call("POST", "collection")).status).toBe(404);
    expect((await call("POST", "nothing")).status).toBe(404);
    expect((await call("POST", "toString")).status).toBe(404);
    expect(await call("POST", "draw", { n: 1 })).toMatchObject({ status: 409, body: { error: "先打开寻访页。" } });

    const opened = await call("POST", "open");
    expect(opened).toMatchObject({ status: 200, body: { tickets: 10, welcomed: true }, cache: "no-store" });
    const drew = await call("POST", "draw", { n: 1 });
    expect(drew.status).toBe(200);
    expect(drew.body.drawn).toEqual([expect.objectContaining({ no: 1, tier: "new", foil: true })]);
    expect(drew.body.state).toMatchObject({ tickets: 9 });
    expect(await call("POST", "draw", { n: 3 })).toMatchObject({ status: 400, body: { error: "一次只能寻访 1 次或 10 次。" } });
    expect(await call("PUT", "wish", { ids: [1, 2] })).toMatchObject({ status: 200, body: { wish: [1, 2] } });
    expect(await call("GET", "collection")).toMatchObject({ status: 200, body: { passes: 1 }, cache: "no-store" });
    const log = await call("GET", "log");
    expect(log).toMatchObject({ status: 200, body: { more: false } });
    expect(log.body.rows).toHaveLength(1);
    expect((await call("GET", "log", undefined, "?before=abc")).body.rows).toHaveLength(1);
    expect((await call("GET", "log", undefined, `?before=${(log.body.rows as { id: number }[])[0].id}`)).body.rows).toEqual([]);
  });

  it("wait for the age check and an updated privacy policy before drawing; what the player has stays readable", async () => {
    vi.stubEnv("PASSES", "on");
    const id = await account("player@example.com");
    await signIn(id);
    await call("POST", "open");
    await db.update(users).set({ ageCheckAt: new Date() }).where(eq(users.id, id));
    for (const [method, op, body] of EVERY.slice(0, 3)) {
      expect(await call(method, op, body), op).toMatchObject({ status: 428, body: { code: "age" } });
    }
    for (const [method, op] of EVERY.slice(3)) expect((await call(method, op)).status, op).toBe(200);

    await db.update(users).set({ ageCheckAt: null, policyAcceptedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(users.id, id));
    const policy = await call("POST", "draw", { n: 1 });
    expect(policy.status).toBe(428);
    expect(policy.body.code).toBeUndefined();
    expect((await call("GET", "collection")).status).toBe(200);
  });

  it("slow down a player who asks too fast", async () => {
    vi.stubEnv("PASSES", "on");
    await signIn(await account("player@example.com"));
    await call("POST", "open");
    for (let i = 0; i < 20; i++) expect((await call("PUT", "wish", { ids: [1 + (i % 3)] })).status).not.toBe(429);
    expect(await call("PUT", "wish", { ids: [1] })).toMatchObject({ status: 429, body: { error: "点得太快了，歇一会儿再试。" } });
  });
});
