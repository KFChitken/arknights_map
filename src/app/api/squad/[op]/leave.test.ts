import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, blocks, friendships, reports, sessions, siteSettings, squadMembers, squadRooms, statCounts, users } from "@/lib/server/schema";
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
/** As if the round's state changed long ago (STATE_EVERY_MS) */
const later = (roomId: string) => db.update(squadRooms).set({ stateAt: new Date(Date.now() - 60_000) }).where(eq(squadRooms.id, roomId));

const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${friendships}, ${blocks}, ${reports}, ${siteSettings}, ${statCounts}, ${admins} cascade`);
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
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
});

describe("the host leaving", () => {
  it("hands the room to one in it, who is its host from then on; the room goes on, waiting or playing, and is told", async () => {
    const owner = await player("owner", CARD.strategy);
    const [a, b] = await Promise.all([player("a"), player("b")]);
    const room = await opened(owner);
    await goIn(a, room);
    await goIn(b, room);
    const heard = hear(b);
    expect(await post(owner, "leave", { to: 2 })).toMatchObject({ status: 200 });
    // out of it, and a its host
    expect((await post(owner, "room")).body!.room).toBeNull();
    const asA = roomOf(await post(a, "room"));
    expect(asA.host).toBe(true);
    expect(asA.members.map((m) => [m.h, m.host])).toEqual([
      [2, true],
      [3, false],
    ]);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "host", h: 2 } });
    const [r] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(r.hostId).toBe(a.id);
    expect(r.endedAt).toBeNull();
    // the new host does what a host does: 开始游戏, and hands it on while it plays
    await post(b, "game", { on: true });
    expect((await post(a, "state", { to: "go" })).status).toBe(200);
    expect(await post(a, "leave", { to: 3 })).toMatchObject({ status: 200 });
    expect(roomOf(await post(b, "room"))).toMatchObject({ host: true, state: "go" });
  });

  it("never hands it to a 人机 or one not in it, nor does anyone but the host; alone, leaving ends the room", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    expect((await post(owner, "bot", { do: "add" })).status).toBe(200);
    expect(await post(owner, "leave", { to: -1 })).toMatchObject({ status: 409, body: { error: "人机不能当房主。" } });
    expect(await post(owner, "leave", { to: 9 })).toMatchObject({ status: 409 });
    expect(await post(owner, "leave", { to: "two" })).toMatchObject({ status: 400 });
    expect(await post(a, "leave", { to: 1 })).toMatchObject({ status: 403 });
    expect(roomOf(await post(owner, "room")).host).toBe(true);
    // a leaves as ever; the host, with nobody to hand it to, ends it on leaving
    expect((await post(a, "leave")).status).toBe(200);
    expect((await post(owner, "leave")).status).toBe(200);
    const [r] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(r.endedAt).not.toBeNull();
  });
});

describe("请出去 once a round has started", () => {
  it("is refused till the round ends; a 人机 may still be asked out", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    expect((await post(owner, "bot", { do: "add" })).status).toBe(200);
    await post(a, "game", { on: true });
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    expect(await post(owner, "kick", { h: 2 })).toMatchObject({ status: 409, body: { error: "开始游戏以后不能请人出去，这局结束再说。" } });
    expect((await post(owner, "kick", { h: -1 })).status).toBe(200);
    await later(room.id);
    expect((await post(owner, "state", { to: "wait" })).status).toBe(200);
    expect((await post(owner, "kick", { h: 2 })).status).toBe(200);
    expect(roomOf(await post(owner, "room")).members.map((m) => m.h)).toEqual([1]);
  });
});
