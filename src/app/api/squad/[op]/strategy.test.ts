import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, blocks, friendships, reports, sessions, siteSettings, squadBots, squadMembers, squadRooms, statCounts, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { answerBotsNow, flushSaysNow, forgetSquad } from "@/lib/server/squad";
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
  await answerBotsNow();
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
});

const round = (strategy: number | null, extras: number[] = [], core = 5) => ({ round: { core, strategy, extras } });
/** One's picks, the second's wait (PREFS_EVERY_MS) passed */
const prefs = (u: User, body: unknown) => (forgetHits(), post(u, "prefs", body));
const strategyOfH = async (u: User, h: number) => roomOf(await post(u, "room")).members.find((m) => m.h === h)!.strategy;

describe("strategies in a room", () => {
  it("never takes one someone else has, waiting or playing; none always", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    expect(await prefs(a, round(CARD.strategy))).toMatchObject({ status: 409, body: { error: "队友已经在用这个策略了，换一个吧。" } });
    expect((await prefs(a, round(19))).status).toBe(200);
    expect((await prefs(a, round(null))).status).toBe(200);
    // a 人机's is taken too
    expect((await post(owner, "bot", { do: "add" })).status).toBe(200);
    const [b] = await db.select().from(squadBots).where(eq(squadBots.roomId, room.id));
    expect(await prefs(a, round(b.strategy))).toMatchObject({ status: 409 });
    // a page of before (its picks alone) the same
    expect(await prefs(a, { card: { core: 5, strategy: CARD.strategy } })).toMatchObject({ status: 409 });
    // keeping one's own is no clash
    expect((await prefs(owner, round(CARD.strategy, [], 3))).status).toBe(200);
  });

  it("locks it once the round starts: one with none fills one in once; core and extras as ever; 结束这局 unlocks", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    await post(a, "game", { on: true });
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    const locked = { status: 409, body: { error: "开打了，策略锁住了，「结束这局」以后才能换。" } };
    expect(await prefs(owner, round(19))).toMatchObject(locked);
    expect(await prefs(owner, round(null))).toMatchObject(locked);
    // core and extras go on
    expect((await prefs(owner, round(CARD.strategy, [1, 2], 3))).status).toBe(200);
    // a, with none: one nobody has, once
    expect(await prefs(a, round(CARD.strategy))).toMatchObject({ status: 409, body: { error: "队友已经在用这个策略了，换一个吧。" } });
    expect((await prefs(a, round(20))).status).toBe(200);
    expect(await prefs(a, round(21))).toMatchObject(locked);
    expect(await prefs(a, round(null))).toMatchObject(locked);
    // a 人机's too, once it has one
    expect(await strategyOfH(a, 2)).toBe(20);
    await later(room.id);
    expect((await post(owner, "state", { to: "wait" })).status).toBe(200);
    expect((await prefs(owner, round(19))).status).toBe(200);
    expect((await prefs(a, round(null))).status).toBe(200);
  });

  it("locks a 人机's strategy too while it plays", async () => {
    const owner = await player("owner", CARD.strategy);
    const room = await opened(owner);
    expect((await post(owner, "bot", { do: "add" })).status).toBe(200);
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    expect(await post(owner, "bot", { do: "strategy", h: -1 })).toMatchObject({ status: 409 });
    await later(room.id);
  });
});

describe("对 TA 说", () => {
  it("says a line of its row to one in the room, everyone hearing it; never without one, nor another row with one, nor to oneself, nor while it plays", async () => {
    const owner = await player("owner", CARD.strategy);
    const [a, b] = await Promise.all([player("a"), player("b")]);
    const room = await opened(owner);
    await goIn(a, room);
    await goIn(b, room);
    const heard = hear(b);
    expect(await post(owner, "say", { p: 36 })).toMatchObject({ status: 400 });
    expect(await post(owner, "say", { p: 1, to: 2 })).toMatchObject({ status: 400 });
    expect(await post(owner, "say", { p: 36, to: 1 })).toMatchObject({ status: 409 });
    expect(await post(owner, "say", { p: 36, to: 9 })).toMatchObject({ status: 409 });
    expect(await post(owner, "say", { p: 37, to: 2 })).toMatchObject({ status: 200, body: { sent: true } });
    await flushSaysNow();
    expect(heard).toContainEqual({ t: "say", room: room.id, items: [{ h: 1, p: 37, to: 2 }] });
    // counted with the lines: one every few seconds
    expect(await post(owner, "say", { p: 40, to: 2 })).toMatchObject({ status: 200, body: { sent: false } });
    forgetHits();
    await post(a, "game", { on: true });
    await post(b, "game", { on: true });
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    expect(await post(owner, "say", { p: 40, to: 2 })).toMatchObject({ status: 409, body: { error: "开打以后不能点名说了。" } });
    expect(await post(owner, "say", { p: 14 })).toMatchObject({ status: 200, body: { sent: true } });
    await later(room.id);
  });

  it("has a 人机 named answer by itself: 好，我换 and another strategy, 好嘞, nothing to 谢谢", async () => {
    const owner = await player("owner", CARD.strategy);
    const room = await opened(owner);
    expect((await post(owner, "bot", { do: "add" })).status).toBe(200);
    const heard = hear(owner);
    const before = await strategyOfH(owner, -1);
    expect((await post(owner, "say", { p: 36, to: -1 })).status).toBe(200);
    await answerBotsNow();
    await flushSaysNow();
    const said = heard.filter((t) => t.t === "say").flatMap((t) => t.items as { h: number; p: number; to?: number }[]);
    expect(said).toContainEqual({ h: 1, p: 36, to: -1 });
    expect(said).toContainEqual({ h: -1, p: 41, to: 1 });
    const after = await strategyOfH(owner, -1);
    expect(after).not.toBe(before);
    expect(after).not.toBe(CARD.strategy);
    // asked to pick, with none: 好嘞 and one picked; to ready: 好嘞; thanked: nothing
    await db.update(squadBots).set({ strategy: null }).where(eq(squadBots.roomId, room.id));
    heard.length = 0;
    forgetHits();
    expect((await post(owner, "say", { p: 38, to: -1 })).status).toBe(200);
    await answerBotsNow();
    await flushSaysNow();
    expect(heard.filter((t) => t.t === "say").flatMap((t) => t.items as unknown[])).toContainEqual({ h: -1, p: 43, to: 1 });
    expect(await strategyOfH(owner, -1)).not.toBeNull();
    heard.length = 0;
    forgetHits();
    expect((await post(owner, "say", { p: 40, to: -1 })).status).toBe(200);
    await answerBotsNow();
    await flushSaysNow();
    expect(heard.filter((t) => t.t === "say").flatMap((t) => t.items as { h: number }[]).filter((i) => i.h === -1)).toEqual([]);
    // never at random: its own lines are of 组队, 开局 and 局内 alone
    for (let i = 0; i < 30; i++) {
      forgetHits();
      await post(owner, "bot", { do: "say", h: -1 });
    }
    await flushSaysNow();
    expect(heard.filter((t) => t.t === "say").flatMap((t) => t.items as { h: number; p: number }[]).filter((x) => x.h === -1 && x.p >= 36)).toEqual([]);
  });
});
