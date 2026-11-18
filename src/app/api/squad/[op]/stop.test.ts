import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_SHUT, type SquadList, type SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, blocks, friendships, reports, sessions, siteSettings, squadInvites, squadMembers, squadRooms, statCounts, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad, squadCalls } from "@/lib/server/squad";
import { forgetStatCounts } from "@/lib/server/stats";
import { friendKey } from "@/lib/server/world";
import { GET, POST } from "./route";

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
async function roomsOf(u: Pick<User, "id">): Promise<SquadList["rooms"]> {
  await signIn(u);
  forgetSquad();
  const res = await GET(new NextRequest("http://localhost/api/squad/list"), { params: Promise.resolve({ op: "list" }) });
  return ((await res.json()) as SquadList).rooms;
}
const befriend = (x: User, y: User) => db.insert(friendships).values(x.id < y.id ? { a: x.id, b: y.id } : { a: y.id, b: x.id });
const stop = (u: User, on: boolean) => post(u, "stop", { on });
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

describe("停止加入", () => {
  it("is the host's alone, told to the room, and counts as something happening", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    const heard = hear(a);
    await db.update(squadRooms).set({ movedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(squadRooms.id, room.id));
    expect(await stop(a, true)).toMatchObject({ status: 403 });
    expect(await post(owner, "stop", { on: "yes" })).toMatchObject({ status: 400 });
    const stopped = await stop(owner, true);
    expect(roomOf(stopped).stopped).toBe(true);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "stop", on: true } });
    const [r] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(Date.now() - r.movedAt.getTime()).toBeLessThan(60_000);
    expect(roomOf(await post(a, "room")).stopped).toBe(true);
    // again: nothing changes, nothing told
    heard.length = 0;
    expect((await stop(owner, true)).status).toBe(200);
    expect(heard).toEqual([]);
  });

  it("keeps everyone else out: off the list, from it, an invitation and a 宣言招人, one who left too; no invitation, 宣言 or 人机 meanwhile", async () => {
    const owner = await player("owner", CARD.strategy);
    const [a, outsider, friend] = await Promise.all([player("a"), player("outsider"), player("friend")]);
    await befriend(owner, friend);
    const room = await opened(owner);
    await goIn(a, room);
    // an invitation sent before
    expect((await post(owner, "invite", { friends: [friendKey(owner.id, friend.id)] })).status).toBe(200);
    const [invite] = await db.select().from(squadInvites).where(eq(squadInvites.toUserId, friend.id));
    expect((await stop(owner, true)).status).toBe(200);
    // the list: those in it alone
    expect(await roomsOf(outsider)).toEqual([]);
    expect((await roomsOf(a)).map((r) => r.id)).toEqual([room.id]);
    // nobody comes in, however they come
    const shut = { status: 403, body: { error: "房主停止了加入。", code: ROOM_SHUT } };
    expect(await post(outsider, "join", { room: room.id })).toMatchObject(shut);
    expect(await post(friend, "join", { invite: invite.id })).toMatchObject(shut);
    expect((await squadCalls(friend.id, [room.id])).get(room.id)).toMatchObject({ state: "stopped" });
    expect((await post(a, "leave")).status).toBe(200);
    expect(await post(a, "join", { room: room.id })).toMatchObject(shut);
    // nor are they called: the host told to let them in first, anyone else that it is stopped
    expect(await post(owner, "invite", { friends: [friendKey(owner.id, friend.id)] })).toMatchObject({ status: 409, body: { error: "先点「恢复加入」再邀请。" } });
    expect(await post(owner, "declare", {})).toMatchObject({ status: 409, body: { error: "先点「恢复加入」再发宣言。" } });
    expect(await post(owner, "bot", { do: "add" })).toMatchObject({ status: 409, body: { error: "先点「恢复加入」再加人机。" } });
  });

  it("stays through 开始游戏 and 结束这局 till the host lets them in, those in it going on as ever", async () => {
    const owner = await player("owner", CARD.strategy);
    const [a, b] = await Promise.all([player("a"), player("b")]);
    const room = await opened(owner);
    await goIn(a, room);
    await stop(owner, true);
    await post(a, "game", { on: true });
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    await later(room.id);
    expect(roomOf(await post(owner, "state", { to: "wait" })).stopped).toBe(true);
    // those in it: lines, picks, readiness, as before
    expect(await post(a, "say", { p: 1 })).toMatchObject({ status: 200, body: { sent: true } });
    expect((await post(a, "prefs", { round: { core: 5, strategy: null, extras: [] } })).status).toBe(200);
    expect((await post(a, "game", { on: true })).status).toBe(200);
    // an invitation from someone in it: refused, so said
    expect(await post(a, "invite", { friends: [] })).toMatchObject({ status: 409, body: { error: "房主停止了加入。" } });
    // let in again: all as before
    expect(roomOf(await stop(owner, false)).stopped).toBe(false);
    expect((await roomsOf(b)).map((r) => r.id)).toEqual([room.id]);
    expect((await post(b, "join", { room: room.id })).status).toBe(200);
  });
});
