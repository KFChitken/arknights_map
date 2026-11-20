import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { itemOf } from "@/lib/fish/items";
import { type SquadRoom } from "@/lib/squad";
import { WEEK, weekStartOf } from "@/lib/hotList";
import { BALL_BACK_MS, FIRE_DROP_MS, fireNow, THROW_EVERY_MS, WOOD_EVERY_MS, WOOD_MAX, woodNow } from "@/lib/squadFire";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { blocks, sessions, siteSettings, squadFireRooms, squadFireSticks, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { throwAt } from "@/lib/server/squadPlay";
import { POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

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

async function player(name: string) {
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
      squadCore: 5,
      squadStrategy: null,
      squadLevel: 3,
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

async function squad(u: Pick<User, "id">, op: string, body: unknown = {}): Promise<Answer> {
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

async function opened(host: User) {
  const res = await squad(host, "open", { key: KEY, server: "cn", level: 3, tags: [2] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body!.room as SquadRoom;
}
async function goIn(u: User, room: SquadRoom) {
  const res = await squad(u, "join", { room: room.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}
const view = async (u: User) => (await squad(u, "room")).body!.room as SquadRoom;
const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
const roomRow = async (id: string) => (await db.select().from(squadRooms).where(eq(squadRooms.id, id)))[0];

const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T06:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${siteSettings}, ${blocks}, ${squadFireRooms}, ${squadFireSticks} cascade`);
  await loadSettings();
  await loadMods();
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
  vi.useRealTimers();
});

describe("篝火", () => {
  it("takes a stick a level up to Lv.10 and more after, with no top, from a hand of three growing one each 30 s", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(a);
    const first = (await squad(host, "fire")).body!;
    expect(first).toMatchObject({ fire: { level: 1, prog: 0, by: room.you, top: 1 }, up: true, wood: WOOD_MAX - 1 });
    expect(heard.some((t) => t.t === "room" && (t.what as { kind?: string })?.kind === "fire")).toBe(true);
    expect((await view(a)).fire).toMatchObject({ level: 1, prog: 0, by: room.you, at: Date.now() });
    // the host's sticks are the host's alone
    expect((await view(a)).members.find((m) => !m.you)).not.toHaveProperty("wood");
    expect((await view(a)).members.find((m) => m.you)).toMatchObject({ wood: WOOD_MAX, woodAt: null });
    await squad(host, "fire");
    await squad(host, "fire");
    expect(await squad(host, "fire")).toMatchObject({ status: 409, body: { error: "手里没柴了，30 秒长一根。" } });
    // a stick grows back
    later(WOOD_EVERY_MS);
    const mine = (await view(host)).members.find((m) => m.you)!;
    expect(woodNow(mine.wood!, mine.woodAt!, Date.now())).toBe(1);
    expect((await squad(host, "fire")).body).toMatchObject({ fire: { level: 4 }, wood: 0 });
    // from Lv.10, two sticks a level: the first on towards it, the second puts it up; no top past the old 5
    await db.update(squadRooms).set({ fireLevel: 10, fireProg: 0, fireAt: new Date(), fireTop: 10 }).where(eq(squadRooms.id, room.id));
    expect((await squad(a, "fire")).body).toMatchObject({ fire: { level: 10, prog: 1, top: 10 }, up: false });
    expect((await squad(a, "fire")).body).toMatchObject({ fire: { level: 11, prog: 0, top: 11 }, up: true });
    expect((await squad(a, "fire")).body).toMatchObject({ fire: { level: 11, prog: 1 }, up: false });
    // left alone: down one a minute, the stick on towards Lv.12 burnt with it
    later(2 * FIRE_DROP_MS + 1_000);
    const f = (await view(a)).fire;
    expect(fireNow(f.level, f.prog, f.at, Date.now())).toEqual({ level: 9, prog: 0 });
    later(WOOD_EVERY_MS);
    expect((await squad(a, "fire")).body).toMatchObject({ fire: { level: 10, prog: 0, top: 11 }, up: true });
  });

  it("keeps each 局's highest level and how long it burnt at the round's end, the last 局's and the room's highest", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    await squad(host, "fire");
    await squad(host, "fire");
    await squad(host, "fire");
    // Lv.3: burns 3 minutes; a round in between
    await db.update(squadMembers).set({ inGame: true }).where(eq(squadMembers.roomId, room.id));
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "go" })).status).toBe(200);
    later(90_000);
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "wait" })).status).toBe(200);
    const after = await roomRow(room.id);
    expect(after).toMatchObject({ fireLast: 90_000, fireLevel: 2, fireProg: 0, fireTop: 2, fireLastTop: 3, fireBestTop: 3 });
    expect((await view(a)).fire).toMatchObject({ last: 90_000, lastTop: 3, bestTop: 3, top: 2 });
    // the next 局: half a minute on it is down to Lv.1, and a's three sticks put it up to Lv.4
    later(WOOD_EVERY_MS);
    await squad(a, "fire");
    await squad(a, "fire");
    await squad(a, "fire");
    await db.update(squadMembers).set({ inGame: true }).where(eq(squadMembers.roomId, room.id));
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "go" })).status).toBe(200);
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "wait" })).status).toBe(200);
    expect(await roomRow(room.id)).toMatchObject({ fireLastTop: 4, fireBestTop: 4, fireTop: 4 });
    later(10 * 60_000);
    await db.update(squadMembers).set({ inGame: true }).where(eq(squadMembers.roomId, room.id));
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "go" })).status).toBe(200);
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "wait" })).status).toBe(200);
    expect(await roomRow(room.id)).toMatchObject({ fireLevel: 0, fireLastTop: 4, fireBestTop: 4, fireTop: 0 });
  });

  it("counts each stick for 火焰周榜 with the room's highest that week, while the week it was opened lasts", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    await squad(host, "fire");
    later(1_000);
    await squad(a, "fire");
    await squad(a, "fire");
    const week = new Date(weekStartOf(Date.now()));
    expect(await db.select().from(squadFireRooms)).toEqual([{ roomId: room.id, week, peak: 3, peakAt: new Date(Date.now()) }]);
    const sticks = await db.select().from(squadFireSticks);
    expect(sticks.map((r) => [r.userId, r.sticks, r.week])).toEqual(
      expect.arrayContaining([
        [host.id, 1, week],
        [a.id, 2, week],
      ]),
    );
    // down and up again to the same height: the first time it got there stays
    const firstAt = (await db.select().from(squadFireRooms))[0].peakAt;
    later(2 * FIRE_DROP_MS);
    later(WOOD_EVERY_MS * 3);
    await squad(a, "fire");
    expect((await db.select().from(squadFireRooms))[0]).toMatchObject({ peak: 3, peakAt: firstAt });
    // past Monday 04:00: the room was opened last week, and counts no more
    vi.setSystemTime(new Date(week.getTime() + WEEK + 60_000));
    await db.update(squadRooms).set({ fireAt: new Date(), fireLevel: 3 }).where(eq(squadRooms.id, room.id));
    await squad(host, "fire");
    await squad(host, "fire");
    expect((await db.select().from(squadFireRooms))[0].peak).toBe(3);
    expect((await db.select().from(squadFireSticks)).find((r) => r.userId === host.id)?.sticks).toBe(1);
  });
});

describe("扔东西", () => {
  it("lands on the one it is thrown at, told to the room, with what stays kept a while", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const toA = (await view(host)).members.find((m) => !m.you)!.h;
    const heard = hear(host);
    expect((await squad(host, "throw", { to: toA, item: 5 })).status).toBe(200);
    await flushSaysNow();
    expect(heard.find((t) => t.t === "throw")).toMatchObject({ items: [{ h: room.you, to: toA, item: 5 }] });
    expect((await view(host)).members.find((m) => m.h === toA)!.head).toEqual({ item: 5, until: Date.now() + 60_000 });
    later(THROW_EVERY_MS);
    // a ball: back with a tap, the rally counted
    expect((await squad(host, "throw", { to: toA, item: 9 })).status).toBe(200);
    expect((await view(a)).members.find((m) => m.you)!.ball).toMatchObject({ item: 9, from: room.you, n: 1 });
    expect((await squad(a, "hit")).body).toMatchObject({ n: 2 });
    expect((await view(host)).members.find((m) => m.you)!.ball).toMatchObject({ item: 9, from: toA, n: 2 });
    expect((await squad(host, "hit")).body).toMatchObject({ n: 3 });
    later(BALL_BACK_MS + 1);
    expect(await squad(a, "hit")).toMatchObject({ status: 409, body: { error: "球已经落地了。" } });
    // 令的酒, then 白开水: fainted, then up (a minute on: three a minute at the same one)
    later(60_000);
    await squad(host, "throw", { to: toA, item: 11 });
    expect((await view(a)).members.find((m) => m.you)!.fx).toMatchObject({ item: 11 });
    later(THROW_EVERY_MS);
    await squad(host, "throw", { to: toA, item: 12 });
    expect((await view(a)).members.find((m) => m.you)!.fx).toBeUndefined();
    // 醉倒睡觉 woken too
    await squad(a, "pose", { pose: 2 });
    later(60_000);
    await squad(host, "throw", { to: toA, item: 12 });
    expect((await view(a)).members.find((m) => m.you)!.pose).toBe(0);
  });

  it("is one every 5 s and three a minute at the same one, never at yourself", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const toA = (await view(host)).members.find((m) => !m.you)!.h;
    expect((await squad(host, "throw", { to: room.you, item: 1 })).status).toBe(409);
    expect((await squad(host, "throw", { to: toA, item: 99 })).status).toBe(400);
    expect((await squad(host, "throw", { to: toA, item: 2 })).status).toBe(200);
    expect(await squad(host, "throw", { to: toA, item: 2 })).toMatchObject({ status: 429, body: { error: "5 秒扔一次，等一下。" } });
    later(THROW_EVERY_MS);
    expect((await squad(host, "throw", { to: toA, item: 3 })).status).toBe(200);
    later(THROW_EVERY_MS);
    expect((await squad(host, "throw", { to: toA, item: 4 })).status).toBe(200);
    later(THROW_EVERY_MS);
    expect(await squad(host, "throw", { to: toA, item: 4 })).toMatchObject({ status: 429, body: { error: "这一分钟已经扔了 TA 3 次，过一会儿再扔。" } });
    later(60_000);
    expect((await squad(host, "throw", { to: toA, item: 4 })).status).toBe(200);
  });

  it("never reaches one who turned 别人扔我 off, nor between two who blocked each other", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const toA = (await view(host)).members.find((m) => !m.you)!.h;
    expect((await squad(a, "card", { card: { core: 5, strategy: null, level: 3 }, noThrow: true })).body).toMatchObject({ noThrow: true });
    expect((await view(host)).members.find((m) => m.h === toA)!.noThrow).toBe(true);
    expect(await squad(host, "throw", { to: toA, item: 1 })).toMatchObject({ status: 409, body: { error: "扔不到 TA。" } });
    await squad(a, "card", { card: { core: 5, strategy: null, level: 3 }, noThrow: false });
    await db.insert(blocks).values({ blockerId: a.id, blockedId: host.id });
    expect(await squad(host, "throw", { to: toA, item: 1 })).toMatchObject({ status: 409, body: { error: "扔不到 TA。" } });
  });

  it("opens a parcel to something of 钓鳞's junk, and shakes a 源石虫 off with a tap", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const toA = (await view(host)).members.find((m) => !m.you)!.h;
    const { out } = await throwAt(host, { to: toA, item: 14 }, Date.now(), () => 0);
    expect(itemOf(out!)).toMatchObject({ cat: "junk" });
    later(THROW_EVERY_MS);
    await squad(host, "throw", { to: toA, item: 6 });
    expect((await view(a)).members.find((m) => m.you)!.head).toMatchObject({ item: 6 });
    expect((await squad(a, "shake")).status).toBe(200);
    expect((await view(a)).members.find((m) => m.you)!.head).toBeUndefined();
    expect(await squad(a, "shake")).toMatchObject({ status: 409 });
  });
});
