import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPORTS_PER_IP_HOUR } from "@/lib/rules";
import { db } from "@/lib/server/db";
import { sessions, users } from "@/lib/server/schema";
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

async function call(op: string, args: unknown[] = [], headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost/api/world/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify({ args }),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } };
}

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
  await db.execute(sql`truncate ${users}, ${sessions} cascade`);
  jar.token = null;
});

describe("只看本体 (setOnlyMains)", () => {
  const onlyMains = async (id: string) => (await db.select({ on: users.onlyMains }).from(users).where(eq(users.id, id)))[0].on;

  it("needs a player signed in, keeps it on their account, and takes only true for on", async () => {
    expect((await call("setOnlyMains", [true])).status).toBe(401);
    const a = await account("a@example.com");
    const b = await account("b@example.com");
    await signIn(a);
    expect(await call("setOnlyMains", [true])).toEqual({ status: 200, body: { result: null } });
    expect(await onlyMains(a)).toBe(true);
    expect(await onlyMains(b)).toBe(false);
    for (const v of ["true", 1, null]) {
      await call("setOnlyMains", [true]);
      expect((await call("setOnlyMains", [v])).status).toBe(200);
      expect(await onlyMains(a), String(v)).toBe(false);
    }
    // and in what the page reads about who is signed in
    expect((await call("me")).body.result).toMatchObject({ onlyMains: false });
  });
});

describe("举报 from one network", () => {
  it("takes at most REPORTS_PER_IP_HOUR an hour from one address, players and roaches alike, whichever accounts send them", async () => {
    const from = (ip: string) => ({ "x-forwarded-for": ip });
    // signed out, nothing is counted
    expect((await call("report", ["t:nothing", "spam"], from("203.0.113.9"))).status).toBe(401);
    const a = await account("a@example.com");
    const b = await account("b@example.com");
    await signIn(a);
    for (let i = 0; i < REPORTS_PER_IP_HOUR; i++) {
      // nothing to report here, but each one tried counts
      const op = i % 2 ? "report" : "reportRoach";
      expect((await call(op, [`t:${i}`, op === "report" ? "spam" : "place"], from("203.0.113.9"))).status, `${i}`).toBe(400);
    }
    await signIn(b);
    const over = await call("report", ["t:more", "spam"], from("203.0.113.9"));
    expect(over).toEqual({ status: 429, body: { error: "操作太频繁了，歇一会儿再试。" } });
    expect((await call("reportRoach", ["more", "place"], from("203.0.113.9"))).status).toBe(429);
    // another network is not held up
    expect((await call("report", ["t:more", "spam"], from("198.51.100.4"))).status).toBe(400);
    // nor is anything else from the same one
    expect((await call("setOnlyMains", [true], from("203.0.113.9"))).status).toBe(200);
  });
});
