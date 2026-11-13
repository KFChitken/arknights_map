import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

async function call(op: string, args: unknown[] = []) {
  const req = new NextRequest(`http://localhost/api/world/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
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
