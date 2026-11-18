import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, blocks, friendships, passes, passWallets, reports, sessions, siteSettings, squadMembers, squadRooms, statCounts, users } from "@/lib/server/schema";
import { setOnMap } from "@/lib/server/passes";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetStatCounts } from "@/lib/server/stats";
import { POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// the route reads its cookie as any page does; here, the one of the player this test acts as
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
type Answer = { status: number; body: Record<string, unknown> | null };

const KEY = "8di6kbgf9neg7e";
const CARD = { core: 5, strategy: 18, level: 3 };

/** One with a card filled in; a teammate's strategy none (无偏好) unless given, so a round may start */
async function player(name: string, strategy: number | null = null) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({
      email: `${name}@example.com`,
      name,
      anonymous: false,
      ageConfirmedAt: now,
      policyAcceptedAt: now,
      crossBorderAcceptedAt: now,
      publicPlaceAcceptedAt: now,
      squadCore: CARD.core,
      squadStrategy: strategy,
      squadLevel: CARD.level,
    })
    .returning();
  return u;
}
const tokens = new Map<string, string>();
async function signIn(u: Pick<User, "id">) {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    tokens.set(u.id, token);
  }
  jar.token = token;
}

async function post(u: Pick<User, "id">, op: string, body: unknown = {}): Promise<Answer> {
  await signIn(u);
  const req = new NextRequest(`http://localhost/api/squad/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const roomOf = (a: Answer) => a.body!.room as SquadRoom;

async function opened(host: User) {
  const res = await post(host, "open", { key: KEY, server: "cn", level: 3, tags: [2] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return roomOf(res);
}
async function goIn(u: User, room: SquadRoom) {
  const res = await post(u, "join", { room: room.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return roomOf(res);
}
/** The pass a player wears (a character of the catalogue, its number), drawn now */
async function wears(u: User, charId = 7, no = 1) {
  const [p] = await db.insert(passes).values({ userId: u.id, charId, no, wish: false, drawnAt: new Date() }).returning();
  await db.update(users).set({ wornPass: p.id }).where(eq(users.id, u.id));
}
/** One's pass as another in the room sees it on TA's card (undefined: none) */
const passOf = async (viewer: User, h: number) => roomOf(await post(viewer, "room")).members.find((m) => m.h === h)?.pass;
beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${friendships}, ${blocks}, ${reports}, ${siteSettings}, ${statCounts}, ${admins}, ${passes}, ${passWallets} cascade`);
  await loadSettings();
  await loadMods();
  forgetStatCounts();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
  vi.stubEnv("SQUAD", "on");
});

afterEach(async () => {
  await flushSaysNow();
  vi.unstubAllEnvs();
});

describe("a teammate's card: the pass TA wears", () => {
  it("hangs on TA's card in the room as on a main roach's on the map: the same to strangers, 触须之交 and TA, number and day, never how many", async () => {
    vi.stubEnv("PASSES", "on");
    vi.stubEnv("PASS_ART", "off");
    const owner = await player("owner", CARD.strategy);
    const [friend, stranger] = await Promise.all([player("friend"), player("stranger")]);
    await db.insert(friendships).values(owner.id < friend.id ? { a: owner.id, b: friend.id } : { a: friend.id, b: owner.id });
    const room = await opened(owner);
    await goIn(friend, room);
    await goIn(stranger, room);
    await wears(stranger, 7, 3);
    await db.insert(passes).values({ userId: stranger.id, charId: 7, no: 4, wish: false, drawnAt: new Date() });
    const seen = await passOf(owner, 3);
    expect(seen).toMatchObject({ charId: 7, no: 3, rarity: expect.anything(), drawnAt: expect.any(Number) });
    // as printed, never how many TA has, which of TA's passes it is, or whose
    expect(Object.keys(seen!).sort()).toEqual(["art", "avatar", "charId", "color", "drawnAt", "en", "fancy", "game", "name", "no", "rarity"]);
    expect(await passOf(friend, 3)).toEqual(seen);
    expect(await passOf(stranger, 3)).toEqual(seen);
    // nobody else wears one; a 人机 never does
    expect(await passOf(stranger, 1)).toBeUndefined();
    await post(owner, "bot", { do: "add" });
    expect(await passOf(owner, -1)).toBeUndefined();
  });

  it("is on nobody's card while 寻访 is off, to the 站长 and the admins alone while it is theirs, never once TA keeps it off the cards", async () => {
    vi.stubEnv("PASSES", "off");
    const owner = await player("owner", CARD.strategy);
    const [a, b] = await Promise.all([player("a"), player("b")]);
    const room = await opened(owner);
    await goIn(a, room);
    await goIn(b, room);
    await wears(b);
    expect(await passOf(owner, 3)).toBeUndefined();
    vi.stubEnv("PASSES", "admins");
    expect(await passOf(owner, 3)).toMatchObject({ charId: 7 });
    expect(await passOf(a, 3)).toBeUndefined();
    vi.stubEnv("PASSES", "on");
    expect(await passOf(a, 3)).toMatchObject({ charId: 7 });
    // 地图卡片上挂出通行证 off: off the map's cards and the room's alike
    await setOnMap(b, false);
    expect(await passOf(owner, 3)).toBeUndefined();
    expect(await passOf(a, 3)).toBeUndefined();
  });
});
