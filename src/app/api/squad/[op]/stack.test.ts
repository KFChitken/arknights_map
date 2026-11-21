import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { STACK_HAND_EVERY_MS, STACK_IDLE_MS, STACK_MOST_MS, stackSwing, type StackData, type StackMode } from "@/lib/squadMode";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { sessions, siteSettings, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { openMode, sweepModes } from "@/lib/server/squadModes";
import { POST } from "./route";

// 基建加盖 on the server (玩点什么's fifth mode)

// the owner is an admin
vi.mock("@/lib/server/env", async (original) => ({
  ...(await original<typeof import("@/lib/server/env")>()),
  ADMIN_EMAILS: ["owner@example.com"],
}));

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
const KEY = "8di6kbgf9neg7e";

async function player(name: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email: `${name}@example.com`, name, anonymous: false, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now, squadCore: 0 })
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
async function ask(u: Pick<User, "id">, op: string, body: unknown) {
  await signIn(u);
  forgetHits();
  const req = new NextRequest(`http://localhost/api/squad/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const post = (u: Pick<User, "id">, op: string, body: unknown = {}) => ask(u, op, body);
const viewOf = async (u: Pick<User, "id">) => (await post(u, "room")).body!.room as SquadRoom;
const stackOf = async (u: Pick<User, "id">) => (await viewOf(u)).mode as StackMode;

/** The 站长's room with a and b in it, SQUAD on */
async function cast() {
  vi.stubEnv("SQUAD", "on");
  const host = await player("owner");
  const a = await player("a");
  const b = await player("b");
  const room = (await post(host, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
  for (const u of [a, b]) expect((await post(u, "join", { room: room.id })).status).toBe(200);
  return { host, a, b, room };
}

const offs: (() => void)[] = [];
function told(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

let clock = 0;
const at = (ms: number) => {
  clock = ms;
  vi.setSystemTime(new Date(ms));
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(Date.parse("2026-11-20T10:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadBots}, ${siteSettings} cascade`);
  await loadSettings();
  await loadMods();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const dataOf = async (roomId: string) => (await db.select({ d: squadRooms.modeData }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0].d as StackData;
const bestOf = async (roomId: string) => (await db.select({ best: squadRooms.stackBest }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0].best;
const handleOf = (room: SquadRoom, name: string) => room.members.find((m) => m.name === name)!.h;
/** The first time from `after` on (whole ms) the swing of a round begun at roundAt is at x (px) */
function when(x: number, roundAt: number, after: number) {
  for (let t = after; t < after + 1_600; t++) if (Math.round(stackSwing(roundAt, t)) === x) return t;
  throw new Error(`the swing is never at ${x}`);
}
/** 放 by u with the swing at x, the page's time 30 ms before the server's, the earliest after `after` */
async function dropAt(u: Pick<User, "id">, x: number, roundAt: number, round: number, after = clock) {
  const t = when(x, roundAt, after);
  at(t + 30);
  return post(u, "stack", { do: "drop", round, at: t });
}

describe("基建加盖", () => {
  it("opens round 1 with no blocks, its opener in it with a full hand, anyone in the room coming in at any time", async () => {
    const { a, b, room } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "stack" }, clock);
    const v = await viewOf(b);
    const aH = handleOf(v, "a");
    expect(v.mode).toEqual({
      kind: "stack",
      by: aH,
      at: t0,
      in: [{ h: aH, combo: 0 }],
      endsAt: t0 + STACK_IDLE_MS,
      until: t0 + STACK_MOST_MS,
      round: 1,
      roundAt: t0,
      blocks: [],
      best: 0,
    });
    at(t0 + 20_000);
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await stackOf(b)).in.map((m) => m.h)).toEqual([aH, handleOf(v, "b")].sort((x, y) => x - y));
    expect(await dataOf(room.id)).toEqual({ round: 1, at: t0, blocks: [], hands: {} });
  });

  it("puts a block where the swing is at the page's time, a block out of the hand, one a second at most, and tells the room", async () => {
    const { host, a, b, room } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "stack" }, clock);
    const aH = handleOf(await viewOf(a), "a");
    const heard = told(host);
    // a quarter of the way: the middle
    at(t0 + 430);
    expect(await post(a, "stack", { do: "drop", round: 1, at: t0 + 400 })).toMatchObject({ status: 200, body: { round: 1, best: 1, x: 0, falls: false, wobbles: false, height: 1 } });
    expect(heard).toEqual([{ t: "room", room: room.id, what: { kind: "stack", h: aH } }]);
    let mine = await stackOf(a);
    expect(mine.blocks).toEqual([{ h: aH, x: 0, at: t0 + 400 }]);
    expect(mine.hand).toEqual({ n: 2, at: t0 + 430 });
    expect(mine.best).toBe(1);
    expect(mine.endsAt).toBe(t0 + 430 + STACK_IDLE_MS);
    // b's view has the tower but no hand of b's
    expect((await stackOf(b)).hand).toBeUndefined();
    // again within the second: refused, nothing put
    at(t0 + 1_200);
    expect(await post(a, "stack", { do: "drop", round: 1, at: t0 + 1_200 })).toMatchObject({ status: 429, body: { error: "慢点，每秒只收 1 块。" } });
    // a time too far back is the server's now: 1600 ms on, the swing at its start again
    at(t0 + 1_600);
    expect(await post(a, "stack", { do: "drop", round: 1, at: t0 + 1_000 })).toMatchObject({ status: 200, body: { x: -60, falls: true } });
    mine = await stackOf(a);
    expect(mine.blocks[1]).toEqual({ h: aH, x: -60, at: t0 + 1_600 });
    expect(mine.fell).toEqual({ at: t0 + 1_600, height: 1 });
    expect(mine.hand).toEqual({ n: 1, at: t0 + 430 });
    // those not in it may not put one
    expect(await post(b, "stack", { do: "drop", round: 1 })).toMatchObject({ status: 409, body: { error: "先加入才能放。" } });
    expect(await post(host, "stack", { do: "lift" })).toMatchObject({ status: 400 });
  });

  it("sways at more than 18 px off, falls at more than 40 px off or with its middle more than 30 px off; keeps the room's highest; 再来一轮 begins the next", async () => {
    const { a, b, room } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "stack" }, clock);
    await post(b, "modein", { in: true });
    expect(await dropAt(a, 0, t0, 1)).toMatchObject({ status: 200, body: { x: 0, wobbles: false, height: 1 } });
    expect(await dropAt(b, 20, t0, 1)).toMatchObject({ status: 200, body: { x: 20, wobbles: true, falls: false, height: 2 } });
    expect(await dropAt(a, 50, t0, 1, clock + 1_000)).toMatchObject({ status: 200, body: { x: 50, wobbles: true, falls: false, height: 3, best: 3 } });
    // 10 px off the one under it, but the middle (0, 20, 50, 60) 32.5 px off the plank's
    const fall = await dropAt(b, 60, t0, 1, clock + 1_000);
    expect(fall).toMatchObject({ status: 200, body: { x: 60, falls: true, height: 3, best: 3 } });
    const fellAt = clock - 30;
    expect((await stackOf(a)).fell).toEqual({ at: fellAt, height: 3 });
    expect(await bestOf(room.id)).toBe(3);
    expect(await post(a, "stack", { do: "drop", round: 1 })).toMatchObject({ status: 409, body: { error: "塔已经塌了，点「再来一轮」接着搭。" } });
    // 再来一轮, from anyone in it; asked again for the round gone, nothing
    at(clock + 2_000);
    const r2 = clock;
    expect(await post(b, "stack", { do: "again", round: 1 })).toMatchObject({ status: 200, body: { round: 2, best: 3 } });
    expect(await post(a, "stack", { do: "again", round: 1 })).toMatchObject({ status: 200, body: { round: 2 } });
    const mode = await stackOf(a);
    expect(mode).toMatchObject({ round: 2, roundAt: r2, blocks: [], best: 3, endsAt: r2 + STACK_IDLE_MS });
    expect(mode).not.toHaveProperty("fell");
    expect(await post(a, "stack", { do: "again", round: 2 })).toMatchObject({ status: 409, body: { error: "这一轮还没塌，接着放吧。" } });
    expect(await post(a, "stack", { do: "drop", round: 1 })).toMatchObject({ status: 409, body: { error: "刚开了新的一轮，看准了再放。" } });
    // the first block on the plank, then one 45 px off it: down, the round 1 high, the room's highest as it was
    expect(await dropAt(a, 0, r2, 2)).toMatchObject({ status: 200, body: { height: 1, best: 3 } });
    expect(await dropAt(b, 45, r2, 2, clock + 1_000)).toMatchObject({ status: 200, body: { falls: true, height: 1, best: 3 } });
    expect(await bestOf(room.id)).toBe(3);
  });

  it("keeps each one's hand from round to round, one more growing each half minute, empty refused, the same on coming back", async () => {
    const { a, room } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "stack" }, clock);
    for (const k of [0, 1, 2]) expect((await dropAt(a, 0, t0, 1, t0 + 400 + k * 1_600)).status).toBe(200);
    const first = clock - 2 * 1_600;
    expect(await dropAt(a, 0, t0, 1, clock + 1_000)).toMatchObject({ status: 409, body: { error: "手里没块了，等它长出来。" } });
    // out and back in: the hand as it was
    expect((await post(a, "modein", { in: false })).status).toBe(200);
    expect(await post(a, "stack", { do: "drop", round: 1 })).toMatchObject({ status: 409, body: { error: "先加入才能放。" } });
    expect((await post(a, "modein", { in: true })).status).toBe(200);
    expect((await stackOf(a)).hand).toEqual({ n: 0, at: first });
    expect(await dropAt(a, 0, t0, 1, clock + 1_000)).toMatchObject({ status: 409 });
    // half a minute after the first, one has grown
    at(first + STACK_HAND_EVERY_MS - 1);
    expect(await post(a, "stack", { do: "drop", round: 1, at: clock })).toMatchObject({ status: 409, body: { error: "手里没块了，等它长出来。" } });
    expect(await dropAt(a, 0, t0, 1, first + STACK_HAND_EVERY_MS)).toMatchObject({ status: 200, body: { height: 4 } });
    expect((await dataOf(room.id)).hands[String(handleOf(await viewOf(a), "a"))]).toMatchObject({ n: 0, at: first + STACK_HAND_EVERY_MS });
  });

  it("ends a minute after the last block or round begun, the room told; the room keeps its highest, a new opening a full hand", async () => {
    const { host, a, b, room } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "stack" }, clock);
    expect((await dropAt(a, 0, t0, 1)).status).toBe(200);
    const last = clock;
    const heard = told(host);
    at(last + STACK_IDLE_MS - 1);
    expect(await sweepModes(clock)).toBe(0);
    expect((await viewOf(b)).mode?.kind).toBe("stack");
    at(last + STACK_IDLE_MS);
    expect((await viewOf(b)).mode).toBeNull();
    expect(await sweepModes(clock)).toBe(1);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", on: false } });
    expect(await bestOf(room.id)).toBe(1);
    expect(await viewOf(a)).not.toHaveProperty("modeAgain");
    // its opener could open the next at once; b does: the room's highest shown, every hand full again
    await openMode(b, { kind: "stack" }, clock);
    const next = await stackOf(a);
    expect(next).toMatchObject({ round: 1, blocks: [], best: 1 });
    expect(next).not.toHaveProperty("hand");
  });

  it("lives on a minute from 再来一轮 too", async () => {
    const { a, b } = await cast();
    const t0 = clock;
    await openMode(a, { kind: "stack" }, clock);
    expect((await dropAt(a, 0, t0, 1)).status).toBe(200);
    expect((await dropAt(a, 45, t0, 1, clock + 1_000)).body).toMatchObject({ falls: true });
    at(clock + 50_000);
    expect((await post(a, "stack", { do: "again", round: 1 })).status).toBe(200);
    const again = clock;
    at(again + STACK_IDLE_MS - 1);
    expect(await sweepModes(clock)).toBe(0);
    expect((await stackOf(b)).round).toBe(2);
    at(again + STACK_IDLE_MS);
    expect(await sweepModes(clock)).toBe(1);
  });
});
