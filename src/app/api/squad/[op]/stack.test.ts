import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { STACK_REBUILD_MS, STACK_TOP, stackGear, stackShift, stackSwing, stackSwingMs, towerNow, type SquadStack, type StackTower } from "@/lib/squadMode";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { sessions, siteSettings, squadBots, squadMembers, squadRooms, squadStackBlocks, squadStackTowers, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushRacesNow, flushSaysNow, flushStacksNow, forgetSquad } from "@/lib/server/squad";
import { sweepModes } from "@/lib/server/squadModes";
import { POST } from "./route";

// 基建加盖: the room's own tower, always there beside the modes

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
async function post(u: Pick<User, "id">, op: string, body: unknown = {}) {
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
const viewOf = async (u: Pick<User, "id">) => (await post(u, "room")).body!.room as SquadRoom;
const towerOf = async (u: Pick<User, "id">): Promise<SquadStack> => (await viewOf(u)).stack;
const handleOf = (room: SquadRoom, name: string) => room.members.find((m) => m.name === name)!.h;

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
  at(Date.parse("2026-11-18T10:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadBots}, ${siteSettings}, ${squadStackTowers}, ${squadStackBlocks} cascade`);
  await loadSettings();
  await loadMods();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushStacksNow();
  await flushRacesNow();
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const keptOf = async (roomId: string) => (await db.select({ s: squadRooms.stack, best: squadRooms.stackBest }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0];
/** The first time from `after` on (whole ms) the swing over a tower n high starting at swingAt is at x (px) */
function when(x: number, swingAt: number, n: number, after: number) {
  for (let t = after; t < after + 2_000; t++) if (Math.round(stackSwing(swingAt, n, t)) === x) return t;
  throw new Error(`the swing is never at ${x}`);
}
/** 放 by u with the swing at x over the tower as the room has it now, the page's time 30 ms before the server's, the earliest after `after` */
async function dropAt(u: Pick<User, "id">, x: number, after = clock) {
  const s = await towerOf(u);
  const t = when(x, s.swingAt, s.n, Math.max(after, s.at));
  at(t + 30);
  return post(u, "stack", { do: "drop", round: s.round, at: t });
}
/** The room's tower set as given (its last blocks those in top) */
async function setTower(roomId: string, tower: Partial<StackTower>) {
  const s: StackTower = { round: 1, at: clock, n: 0, sum: 0, top: [], swingAt: clock, last: {}, ...tower };
  await db.update(squadRooms).set({ stack: s }).where(eq(squadRooms.id, roomId));
  return s;
}

describe("基建加盖's swing", () => {
  it("goes there and back in 1600 ms, 0.9 of it each 10 layers, never under 800 ms: eight gears", () => {
    const ms = [0, 9, 10, 19, 20, 30, 40, 50, 60, 69, 70, 80, 500].map((n) => [n, stackSwingMs(n), stackGear(n)]);
    expect(ms).toEqual([
      [0, 1600, 1],
      [9, 1600, 1],
      [10, 1440, 2],
      [19, 1440, 2],
      [20, 1296, 3],
      [30, 1166, 4],
      [40, 1050, 5],
      [50, 945, 6],
      [60, 850, 7],
      [69, 850, 7],
      [70, 800, 8],
      [80, 800, 8],
      [500, 800, 8],
    ]);
  });

  it("goes on from where it is as it goes faster", () => {
    for (const [from, to, swingAt, t] of [
      [9, 10, 1_000, 5_321],
      [19, 20, 77, 98_765],
      [69, 70, 0, 123_456],
    ]) {
      const next = stackShift(swingAt, from, to, t);
      expect(stackSwing(next, to, t)).toBeCloseTo(stackSwing(swingAt, from, t), 6);
      // and from there at the new speed: a whole swing on, the same place
      expect(stackSwing(next, to, t + stackSwingMs(to))).toBeCloseTo(stackSwing(next, to, t), 6);
    }
  });

  it("rebuilds a tower that fell 3 s after, as it is asked for: the next round from then, the swing starting then", () => {
    const fell: StackTower = { round: 4, at: 0, n: 3, sum: 0, top: [], fell: { at: 10_000, height: 2 }, swingAt: 5, last: { "1": 9_000 } };
    expect(towerNow(fell, 0, 12_999)).toBe(fell);
    expect(towerNow(fell, 0, 13_000)).toEqual({ round: 5, at: 13_000, n: 0, sum: 0, top: [], swingAt: 13_000, last: { "1": 9_000 } });
    expect(towerNow(null, 42, 99)).toEqual({ round: 1, at: 42, n: 0, sum: 0, top: [], swingAt: 42, last: {} });
  });
});

describe("基建加盖", () => {
  it("is there from the room's opening, round 1; anyone in the room puts a block without opening or joining anything", async () => {
    const t0 = clock;
    const { host, a, b, room } = await cast();
    const v = await viewOf(a);
    expect(v.stack).toEqual({ round: 1, at: t0, n: 0, sum: 0, top: [], swingAt: t0, best: 0, busy: [] });
    expect(v.mode).toBeNull();
    const aH = handleOf(v, "a");
    const bH = handleOf(v, "b");
    const put = await dropAt(a, 0);
    expect(put).toMatchObject({ status: 200, body: { round: 1, n: 1, x: 0, falls: false, wobbles: false, best: 1, swingAt: t0 } });
    const aAt = clock - 30;
    expect(await dropAt(b, 10)).toMatchObject({ status: 200, body: { n: 2, x: 10, falls: false, wobbles: false, best: 2 } });
    const s = await towerOf(host);
    expect(s).toMatchObject({ round: 1, n: 2, sum: 10, best: 2, busy: [aH, bH].sort((x, y) => x - y) });
    expect(s.top).toEqual([
      { h: aH, x: 0, at: aAt },
      { h: bH, x: 10, at: clock - 30 },
    ]);
    // no mode opened by it
    expect((await viewOf(host)).mode).toBeNull();
    expect((await keptOf(room.id)).best).toBe(2);
    expect(await post(a, "stack", { do: "lift" })).toMatchObject({ status: 400 });
  });

  it("takes one a second from each, another's not held up; 在搭 is those who put one within 30 s", async () => {
    const { a, b } = await cast();
    await dropAt(a, 0);
    at(clock + 500);
    expect(await post(a, "stack", { do: "drop", round: 1, at: clock })).toMatchObject({ status: 429, body: { error: "慢点，每秒只收 1 块。" } });
    expect(await dropAt(b, 0)).toMatchObject({ status: 200, body: { n: 2 } });
    at(clock + 1_000);
    expect(await dropAt(a, 0)).toMatchObject({ status: 200, body: { n: 3 } });
    // a's last 30 s ago and more: building no more
    at(clock + 30_001);
    expect((await towerOf(a)).busy).toEqual([]);
  });

  it("goes a gear faster as it reaches 10 layers, the swing going on from where it was", async () => {
    const { a, b, room } = await cast();
    // nine standing, the swing as it began
    const top = Array.from({ length: 9 }, (_, i) => ({ h: 1, x: 0, at: clock + i }));
    const was = await setTower(room.id, { n: 9, sum: 0, top });
    at(clock + 10_000);
    const t = when(0, was.swingAt, 9, clock);
    at(t + 30);
    const res = await post(a, "stack", { do: "drop", round: 1, at: t });
    expect(res).toMatchObject({ status: 200, body: { n: 10, x: 0, falls: false } });
    const swingAt = res.body!.swingAt as number;
    expect(swingAt).toBe(stackShift(was.swingAt, 9, 10, t));
    expect(stackSwing(swingAt, 10, t)).toBeCloseTo(stackSwing(was.swingAt, 9, t), 6);
    expect((await towerOf(b)).swingAt).toBe(swingAt);
    // the 11th: no gear change, the swing's start kept
    const next = await dropAt(b, 0);
    expect(next).toMatchObject({ status: 200, body: { n: 11, swingAt } });
  });

  it("falls with one more than 40 px off, or its middle more than 30 px off; refused 3 s; then the next round by itself", async () => {
    const { a, b, room } = await cast();
    expect(await dropAt(a, 0)).toMatchObject({ body: { x: 0, wobbles: false } });
    expect(await dropAt(b, 20)).toMatchObject({ body: { x: 20, wobbles: true, falls: false, n: 2 } });
    at(clock + 1_000);
    expect(await dropAt(a, 50)).toMatchObject({ body: { x: 50, wobbles: true, falls: false, n: 3, best: 3 } });
    // 10 px off the one under it, but the middle (0, 20, 50, 60) 32.5 px off the plank's
    at(clock + 1_000);
    const fall = await dropAt(b, 60);
    expect(fall).toMatchObject({ status: 200, body: { x: 60, falls: true, n: 4, best: 3 } });
    const fellAt = clock - 30;
    const fallen = await towerOf(a);
    expect(fallen).toMatchObject({ round: 1, n: 4, fell: { at: fellAt, height: 3 }, best: 3 });
    expect((await keptOf(room.id)).best).toBe(3);
    // while its new plank is laid: refused
    at(fellAt + STACK_REBUILD_MS - 1);
    expect(await post(a, "stack", { do: "drop", round: 1, at: clock })).toMatchObject({ status: 409, body: { error: "塔刚塌，新地基马上打好。" } });
    // 3 s on: round 2, begun then, the swing from then (nothing written till a block)
    at(fellAt + STACK_REBUILD_MS);
    const r2 = fellAt + STACK_REBUILD_MS;
    const rebuilt = await towerOf(b);
    expect(rebuilt).toEqual({ round: 2, at: r2, n: 0, sum: 0, top: [], swingAt: r2, best: 3, busy: expect.any(Array) });
    expect((await keptOf(room.id)).s!.fell).toEqual({ at: fellAt, height: 3 });
    // one asking for the round gone
    expect(await post(a, "stack", { do: "drop", round: 1, at: clock })).toMatchObject({ status: 409, body: { error: "刚开了新的一轮，看准了再放。" } });
    // the first block of round 2, where the new swing is
    const first = await dropAt(a, -30, r2 + 1_000);
    expect(first).toMatchObject({ status: 200, body: { round: 2, n: 1, x: -30, swingAt: r2 } });
    const kept = (await keptOf(room.id)).s!;
    expect(kept).toMatchObject({ round: 2, at: r2, n: 1, sum: -30, swingAt: r2 });
    expect(kept.fell).toBeUndefined();
    // a block 45 px off it: down, 1 high, the room's highest as it was
    expect(await dropAt(b, 15, clock + 1_000)).toMatchObject({ body: { falls: true, best: 3 } });
    expect((await keptOf(room.id)).best).toBe(3);
  });

  it("keeps and sends only its top 12 blocks, its height and middle carrying the rest; a tall one still falls by its middle", async () => {
    const { a, b, room } = await cast();
    // twenty standing, all 30 px right: the middle at the edge
    const top = Array.from({ length: STACK_TOP }, (_, i) => ({ h: 1, x: 30, at: clock + i }));
    await setTower(room.id, { n: 20, sum: 600, top });
    at(clock + 10_000);
    expect(await dropAt(a, 30)).toMatchObject({ status: 200, body: { n: 21, falls: false } });
    const s = await towerOf(b);
    expect(s.top).toHaveLength(STACK_TOP);
    expect(s).toMatchObject({ n: 21, sum: 630 });
    expect(s.top.at(-1)).toMatchObject({ h: handleOf(await viewOf(a), "a"), x: 30 });
    // 30 px off the one under it, the middle 31.4 px off: down
    expect(await dropAt(b, 60)).toMatchObject({ status: 200, body: { falls: true, n: 22, best: 21 } });
  });

  it("keeps a room's highest past 32767", async () => {
    const { a, room } = await cast();
    await db.update(squadRooms).set({ stackBest: 32_767 }).where(eq(squadRooms.id, room.id));
    await setTower(room.id, { n: 32_767, sum: 0, top: [{ h: 1, x: 0, at: clock }] });
    at(clock + 5_000);
    expect(await dropAt(a, 0)).toMatchObject({ status: 200, body: { n: 32_768, best: 32_768 } });
    expect((await keptOf(room.id)).best).toBe(32_768);
  });

  it("tells the room its blocks together, a quarter second's at a time, never asking the pages to read the room again", async () => {
    const { host, a, b, room } = await cast();
    const v = await viewOf(a);
    const heard = told(host);
    await dropAt(a, 0);
    const aAt = clock - 30;
    await dropAt(b, 20);
    expect(heard).toEqual([]);
    await flushStacksNow();
    expect(heard).toEqual([
      {
        t: "stack",
        room: room.id,
        items: [
          { h: handleOf(v, "a"), x: 0, at: aAt, round: 1, n: 1, swingAt: v.stack.swingAt },
          { h: handleOf(v, "b"), x: 20, at: clock - 30, round: 1, n: 2, swingAt: v.stack.swingAt },
        ],
      },
    ]);
    // one that fell says so
    at(clock + 1_000);
    await dropAt(a, -40);
    await flushStacksNow();
    expect(heard[1]).toMatchObject({ t: "stack", items: [{ x: -40, n: 3, falls: true }] });
  });

  it("goes on beside a race: blocks put while it runs, the race untouched", async () => {
    const { a, b } = await cast();
    expect((await post(a, "mode", { kind: "race" })).status).toBe(200);
    expect((await post(a, "start")).status).toBe(200);
    expect((await viewOf(b)).mode).toMatchObject({ kind: "race" });
    expect(await dropAt(b, 0)).toMatchObject({ status: 200, body: { n: 1 } });
    expect(await dropAt(a, 0)).toMatchObject({ status: 200, body: { n: 2 } });
    const v = await viewOf(a);
    expect(v.mode).toMatchObject({ kind: "race" });
    expect(v.stack.n).toBe(2);
  });

  it("has no hand for 人机: one added to the room puts nothing and is never building", async () => {
    const { host, a } = await cast();
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    await dropAt(a, 0);
    const s = await towerOf(host);
    expect(s.n).toBe(1);
    expect(s.busy).toEqual([handleOf(await viewOf(a), "a")]);
  });

  it("clears a room left playing the old 基建加盖 mode as the sweep comes by, showing no mode meanwhile", async () => {
    const { host, room } = await cast();
    const v = await viewOf(host);
    await db
      .update(squadRooms)
      .set({
        mode: "stack",
        modeBy: v.you,
        modeAt: new Date(clock),
        modeUntil: new Date(clock + 60_000),
        modeLast: new Date(clock + 60_000),
        modeData: { round: 1, at: clock, blocks: [], hands: {} } as never,
      })
      .where(eq(squadRooms.id, room.id));
    await db.update(squadMembers).set({ modeIn: true }).where(eq(squadMembers.roomId, room.id));
    expect((await viewOf(host)).mode).toBeNull();
    await sweepModes(clock + 5_000);
    const [r] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(r.mode).toBeNull();
    expect(r.modeData).toBeNull();
    expect((await db.select().from(squadMembers).where(eq(squadMembers.roomId, room.id))).every((m) => !m.modeIn)).toBe(true);
  });
});
