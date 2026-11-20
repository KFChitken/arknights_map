import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dexCells, FISH_ITEMS, itemOf } from "@/lib/fish/items";
import type { FishDex } from "@/lib/fish/rules";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { FISH_ART_DIR } from "@/lib/server/env";
import { forgetBank } from "@/lib/server/fish";
import { forgetHits } from "@/lib/server/rateLimit";
import { fishDex, fishLines, fishShouts, sessions, users } from "@/lib/server/schema";
import { GET as ART } from "../../../fish-art/[file]/route";
import { POST } from "./route";

// the owner is an admin; the pictures' folder a fresh one of the test's own
vi.mock("@/lib/server/env", async (original) => {
  const { mkdtempSync } = await import("node:fs");
  const os = await import("node:os");
  const p = await import("node:path");
  return {
    ...(await original<typeof import("@/lib/server/env")>()),
    ADMIN_EMAILS: ["owner@example.com"],
    FISH_ART_DIR: mkdtempSync(p.join(os.tmpdir(), "fish-art-")),
  };
});

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
  const [u] = await db.insert(users).values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now }).returning();
  return u;
}

const tokens = new Map<string, string>();
async function signIn(u: Pick<User, "id">) {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) });
    tokens.set(u.id, token);
  }
  jar.token = token;
}

/** A line in the water bitten a moment ago, with this on the hook */
async function hooked(userId: string, item: number) {
  const now = Date.now();
  const row = { spot: "pier", castAt: new Date(now - 60_000), biteAt: new Date(now - 100), item, variant: 0, cm: null, shadow: "m" };
  await db.insert(fishLines).values({ userId, ...row }).onConflictDoUpdate({ target: fishLines.userId, set: row });
}

const art = (file: string) => ART(new Request(`http://localhost/fish-art/${file}`), { params: Promise.resolve({ file }) });

const GAME = FISH_ITEMS.filter((i) => i.cat === "game");
/** A purple 方舟原物, and one of ours */
const GAME_PURPLE = GAME.find((i) => i.tier === 4)!.no;
const KOI = 21;

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions} cascade`);
  await loadMods();
  jar.token = null;
  tokens.clear();
  forgetBank();
  forgetHits();
  vi.stubEnv("FISH", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("钓鳞's 方舟原物", () => {
  it("are only for whom FISH_GAME lets have them: the dex's column and cells, what is said on the bank, the dex kept all the same", async () => {
    const owner = await account("owner@example.com");
    const a = await account("a@example.com");
    const b = await account("b@example.com");
    // a has caught one of them, and one of ours; b caught a purple one of each, said on the bank
    await db.insert(fishDex).values([
      { userId: a.id, item: GAME[0].no, variant: 0, n: 1, firstSpot: "pier" },
      { userId: a.id, item: 1, variant: 0, n: 2, best: 3000, firstSpot: "pier" },
    ]);
    await db.insert(fishShouts).values([
      { userId: b.id, spot: "pier", item: GAME_PURPLE, variant: 0, cm: null },
      { userId: b.id, spot: "pier", item: KOI, variant: 0, cm: 5000 },
    ]);
    const state = async (u: User) => {
      await signIn(u);
      return (await call("state", { after: 0 })).body as { game: boolean; cells: number; owned: number; shouts: { no: number }[] };
    };
    const dex = async (u: User) => {
      await signIn(u);
      return (await call("dex")).body as unknown as FishDex;
    };

    // off (not set): nobody
    for (const u of [owner, a]) expect(await state(u)).toMatchObject({ game: false, cells: dexCells() });
    expect((await state(a)).owned).toBe(1);
    expect((await state(a)).shouts.map((s) => s.no)).toEqual([KOI]);
    expect((await dex(a)).mine.map((m) => m.no)).toEqual([1]);

    // admins: the owner alone
    vi.stubEnv("FISH_GAME", "admins");
    expect(await state(owner)).toMatchObject({ game: true, cells: dexCells(FISH_ITEMS, true) });
    expect((await state(owner)).shouts.map((s) => s.no).sort((x, y) => x - y)).toEqual([KOI, GAME_PURPLE].sort((x, y) => x - y));
    expect(await state(a)).toMatchObject({ game: false, cells: dexCells(), owned: 1 });

    // on: everyone, and what a caught shows again
    vi.stubEnv("FISH_GAME", "on");
    expect(await state(a)).toMatchObject({ game: true, cells: dexCells() + GAME.length, owned: 2 });
    expect((await dex(a)).mine.map((m) => m.no).sort((x, y) => x - y)).toEqual([1, GAME[0].no]);
  });

  it("come up for one who has them, and one on the hook as FISH_GAME went off for them is something else of its tier", async () => {
    const a = await account("a@example.com");
    await signIn(a);
    vi.stubEnv("FISH_GAME", "on");
    await hooked(a.id, GAME_PURPLE);
    const kept = await call("reel");
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect((kept.body.caught as { no: number }).no).toBe(GAME_PURPLE);

    await hooked(a.id, GAME_PURPLE);
    vi.stubEnv("FISH_GAME", "off");
    const swapped = await call("reel");
    expect(swapped.status).toBe(200);
    const got = itemOf((swapped.body.caught as { no: number }).no)!;
    expect(got.cat).not.toBe("game");
    expect(got.tier).toBe(itemOf(GAME_PURPLE)!.tier);
  });

  it("have their pictures served only while FISH_GAME is on, and only by a picture's own name", async () => {
    const file = "0123456789abcdef.webp";
    writeFileSync(path.join(FISH_ART_DIR, file), "picture");
    expect((await art(file)).status).toBe(404);
    for (const mode of ["admins", "on"]) {
      vi.stubEnv("FISH_GAME", mode);
      const res = await art(file);
      expect(res.status, mode).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(await res.text()).toBe("picture");
    }
    for (const bad of ["fedcba9876543210.webp", "0123456789abcdef.png", "0123456789ABCDEF.webp", "..%2F.env", "0123.webp"]) expect((await art(bad)).status, bad).toBe(404);
  });
});
