import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/server/db";
import { forgetHits } from "@/lib/server/rateLimit";
import { forgetRecords } from "@/lib/server/records";
import { sessions, users } from "@/lib/server/schema";
import { GET } from "./route";

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

async function call(op: string, query = "") {
  const req = new NextRequest(`http://localhost/api/records/${op}${query}`, { headers: { host: "localhost" } });
  const res = await GET(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

async function signIn(email: string) {
  const [u] = await db.insert(users).values({ email }).returning({ id: users.id });
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) });
  jar.token = token;
  return u.id;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions} cascade`);
  jar.token = null;
  forgetHits();
  forgetRecords();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/records", () => {
  it("is nothing at all while RECORDS keeps it from the player, and asks a visitor to sign in once open", async () => {
    expect((await call("summary")).status).toBe(404);
    vi.stubEnv("RECORDS", "admins");
    expect((await call("summary")).status).toBe(404);
    await signIn("a@example.com");
    expect((await call("summary")).status).toBe(404);
    await signIn("owner@example.com");
    expect((await call("summary")).status).toBe(200);
    vi.stubEnv("RECORDS", "on");
    jar.token = null;
    expect((await call("summary")).status).toBe(401);
    expect((await call("nothing")).status).toBe(404);
  });

  it("gives the player their own, never kept along the way, and only so often", async () => {
    vi.stubEnv("RECORDS", "on");
    await signIn("a@example.com");
    const summary = await call("summary", "?offset=480");
    expect(summary).toMatchObject({ status: 200, cache: "private, no-store" });
    expect(summary.body.days).toHaveLength(90);
    expect((await call("summary", "?offset=480&lite=1")).body).toMatchObject({ out: [0, 0, 0, 0, 0, 0, 0] });
    expect((await call("timeline", "?dir=in&cat=touch")).body).toEqual({ items: [], next: null });
    for (let i = 0; i < 18; i++) expect((await call("summary")).status).toBe(200);
    expect((await call("summary")).status).toBe(429);
    // the timeline has its own allowance
    expect((await call("timeline")).status).toBe(200);
  });
});
