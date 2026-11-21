import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AFK_MS, afkFor, type SquadList, type SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { sessions, siteSettings, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad, sweepSquad } from "@/lib/server/squad";
import { GET, POST } from "./route";

// 暂离: one whose page is away 10 minutes while the room waits

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
const MIN = 60_000;

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
async function list(u: Pick<User, "id">) {
  await signIn(u);
  forgetHits();
  forgetSquad();
  const res = await GET(new NextRequest("http://localhost/api/squad/list?server=cn", { headers: { host: "localhost" } }), { params: Promise.resolve({ op: "list" }) });
  return (await res.json()) as SquadList;
}
const viewOf = async (u: Pick<User, "id">) => (await post(u, "room")).body!.room as SquadRoom | null;
const memberOf = (v: SquadRoom, name: string) => v.members.find((m) => m.name === name)!;

let clock = 0;
const at = (ms: number) => {
  clock = ms;
  vi.setSystemTime(new Date(ms));
};

/**
 * The 站长's room with a and b in it, SQUAD on; their pages saying they are here (the 站长's too). a and b come in at the
 * same moment: a, numbered lower, counts as there longer (sweepAfk's heir).
 */
async function cast() {
  vi.stubEnv("SQUAD", "on");
  const host = await player("owner");
  const a = await player("a");
  const b = await player("b");
  const room = (await post(host, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
  for (const u of [a, b]) expect((await post(u, "join", { room: room.id })).status).toBe(200);
  for (const u of [host, a, b]) expect((await post(u, "here")).status).toBe(200);
  return { host, a, b, room };
}
const offs: (() => void)[] = [];
function told(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}
/** Their pages in view, saying so as they do every 2 minutes */
const stay = async (...us: Pick<User, "id">[]) => {
  for (const u of us) expect((await post(u, "here")).status).toBe(200);
};
/** Someone coming in or going meanwhile: the room not over by itself, as one waiting with nothing happening is (WAIT_IDLE_MS) */
const moving = (roomId: string) => db.update(squadRooms).set({ movedAt: new Date(clock) }).where(eq(squadRooms.id, roomId));
const rowOf = async (roomId: string, u: Pick<User, "id">) =>
  (await db.select().from(squadMembers).where(and(eq(squadMembers.roomId, roomId), eq(squadMembers.userId, u.id))))[0];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(Date.parse("2026-11-21T10:00:00Z"));
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

describe("暂离's rule", () => {
  it("counts from the later of going away and the room waiting, from AFK_MS on, only while it waits", () => {
    expect(afkFor("wait", 0, 0, AFK_MS - 1)).toBeNull();
    expect(afkFor("wait", 0, 0, AFK_MS)).toBe(AFK_MS);
    // away an hour, but back to waiting 5 minutes ago
    expect(afkFor("wait", 0, 55 * MIN, 60 * MIN)).toBeNull();
    expect(afkFor("wait", 0, 55 * MIN, 65 * MIN)).toBe(10 * MIN);
    expect(afkFor("go", 0, 0, 60 * MIN)).toBeNull();
    expect(afkFor("wait", undefined, 0, 60 * MIN)).toBeNull();
  });
});

describe("暂离", () => {
  it("is told to the room as a page goes away and comes back; 10 minutes on, the list marks the seat", async () => {
    const { host, a, room } = await cast();
    const heard = told(host);
    at(clock + 10 * MIN);
    const away = clock;
    expect((await post(a, "away")).status).toBe(200);
    const aH = memberOf((await viewOf(host))!, "a").h;
    expect(heard.at(-1)).toEqual({ t: "room", room: room.id, what: { kind: "here", h: aH, away } });
    expect(memberOf((await viewOf(host))!, "a").away).toBe(away);
    // away again: nothing more
    const n = heard.length;
    await post(a, "away");
    expect(heard).toHaveLength(n);
    const viewer = await player("viewer");
    at(away + AFK_MS - 1);
    expect((await list(viewer)).rooms[0].seats.map((s) => Boolean(s.afk))).toEqual([false, false, false]);
    at(away + AFK_MS);
    expect((await list(viewer)).rooms[0].seats.map((s) => Boolean(s.afk))).toEqual([false, true, false]);
    // anything done in the room: here again, told so
    expect((await post(a, "pose", { pose: 2 })).status).toBe(200);
    expect(heard.some((t) => (t.what as { kind?: string; away?: unknown } | undefined)?.kind === "here" && (t.what as { away?: unknown }).away === null)).toBe(true);
    expect(memberOf((await viewOf(host))!, "a").away).toBeUndefined();
    expect((await list(viewer)).rooms[0].seats.some((s) => s.afk)).toBe(false);
  });

  it("is never so in a round, and back to waiting gives AFK_MS more", async () => {
    const { a, room } = await cast();
    at(clock + 30 * MIN);
    await post(a, "away");
    const viewer = await player("viewer");
    await db.update(squadRooms).set({ state: "go", wentAt: new Date(clock) }).where(eq(squadRooms.id, room.id));
    at(clock + 20 * MIN);
    expect((await list(viewer)).rooms[0].seats.some((s) => s.afk)).toBe(false);
    // the round over: waiting from now
    await db.update(squadRooms).set({ state: "wait", wentAt: null, waitedAt: new Date(clock) }).where(eq(squadRooms.id, room.id));
    expect((await list(viewer)).rooms[0].seats.some((s) => s.afk)).toBe(false);
    at(clock + AFK_MS);
    expect((await list(viewer)).rooms[0].seats.filter((s) => s.afk)).toHaveLength(1);
  });

  it("takes a page gone silent as away from 2 minutes after its last 「在」, and never one from before", async () => {
    const { host, a, b, room } = await cast();
    // b's page is one from before: never said it is here
    await db.update(squadMembers).set({ hereAt: null }).where(eq(squadMembers.userId, b.id));
    const last = clock;
    const heard = told(host);
    at(last + 3 * MIN - 1);
    await sweepSquad(clock);
    expect((await rowOf(room.id, a)).awayAt).toBeNull();
    at(last + 3 * MIN + 1);
    await sweepSquad(clock);
    expect((await rowOf(room.id, a)).awayAt?.getTime()).toBe(last + 2 * MIN);
    expect(heard.filter((t) => (t.what as { kind?: string } | undefined)?.kind === "here").map((t) => (t.what as { away?: number }).away)).toContain(last + 2 * MIN);
    expect((await rowOf(room.id, b)).awayAt).toBeNull();
    // what b does says nothing for a page from before
    await post(b, "pose", { pose: 1 });
    expect((await rowOf(room.id, b)).hereAt).toBeNull();
  });

  it("lists a waiting room whose host is 暂离 after the others, and one where everyone is off the list but to those in it", async () => {
    vi.stubEnv("SQUAD", "on");
    const h1 = await player("h1");
    const m1 = await player("m1");
    const h2 = await player("h2");
    const viewer = await player("viewer");
    const r1 = (await post(h1, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
    await post(m1, "join", { room: r1.id });
    at(clock + 1_000);
    const r2 = (await post(h2, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
    for (const u of [h1, m1, h2]) await post(u, "here");
    at(clock + 20 * MIN);
    for (const u of [h1, m1, h2]) await post(u, "here");
    await post(h1, "away");
    // r1 has more in it, but its host is 暂离
    at(clock + AFK_MS);
    const shown = await list(viewer);
    expect(shown.rooms.map((r) => r.id)).toEqual([r2.id, r1.id]);
    expect(shown.rooms[1].hostAfk).toBe(true);
    expect(shown.rooms[0].hostAfk).toBeUndefined();
    await post(m1, "away");
    at(clock + AFK_MS);
    expect((await list(viewer)).rooms.map((r) => r.id)).toEqual([r2.id]);
    expect((await list(h1)).rooms.map((r) => r.id)).toContain(r1.id);
  });

  it("hands a room whose host is 暂离 to the one there longest who is not, the old host staying", async () => {
    const { host, a, b, room } = await cast();
    const heard = told(b);
    at(clock + 10 * MIN);
    await post(host, "away");
    at(clock + AFK_MS - MIN);
    await stay(a, b);
    await moving(room.id);
    await sweepSquad(clock);
    expect((await db.select().from(squadRooms).where(eq(squadRooms.id, room.id)))[0].hostId).toBe(host.id);
    at(clock + MIN);
    await stay(a, b);
    await sweepSquad(clock);
    expect((await db.select().from(squadRooms).where(eq(squadRooms.id, room.id)))[0].hostId).toBe(a.id);
    const v = (await viewOf(a))!;
    expect(v.host).toBe(true);
    expect(memberOf(v, "owner").away).toBeDefined();
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "host", h: memberOf(v, "a").h, afk: true } });
  });

  it("hands it to one whose page is here before one there longer but away, not 暂离 yet", async () => {
    const { host, a, b, room } = await cast();
    at(clock + 10 * MIN);
    await post(host, "away");
    at(clock + AFK_MS - 5 * MIN);
    await post(a, "away");
    at(clock + 5 * MIN);
    await stay(b);
    await moving(room.id);
    await sweepSquad(clock);
    expect((await db.select().from(squadRooms).where(eq(squadRooms.id, room.id)))[0].hostId).toBe(b.id);
  });

  it("takes one 暂离 20 minutes out of the room, telling them why, and says so as their page reads the room again", async () => {
    const { host, a, b, room } = await cast();
    const heardB = told(b);
    at(clock + 10 * MIN);
    await post(b, "away");
    at(clock + 20 * MIN - 1);
    await stay(host, a);
    await moving(room.id);
    await sweepSquad(clock);
    expect((await rowOf(room.id, b)).leftAt).toBeNull();
    at(clock + 1);
    await sweepSquad(clock);
    expect((await rowOf(room.id, b)).leftAt).not.toBeNull();
    expect(heardB.at(-1)).toEqual({ t: "you", room: room.id, why: "away" });
    expect((await post(b, "room")).body).toMatchObject({ room: null, out: "away" });
    expect((await viewOf(host))!.members.map((m) => m.name)).toEqual(["owner", "a"]);
    // one who left by themselves is told nothing of the kind
    const c = await player("c");
    await post(c, "join", { room: room.id });
    await post(c, "here");
    await post(c, "away");
    at(clock + 30 * MIN);
    await post(c, "leave");
    expect((await post(c, "room")).body).toEqual({ room: null, now: clock });
  });

  it("takes a host 暂离 20 minutes out, the room handed on first; with nobody here to hand it to, the room is over", async () => {
    const { host, a, b, room } = await cast();
    const heardHost = told(host);
    const heardA = told(a);
    at(clock + 10 * MIN);
    await post(host, "away");
    // no sweep meanwhile: handed on and out at once
    at(clock + 20 * MIN);
    await stay(a, b);
    await sweepSquad(clock);
    const [r] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(r.hostId).toBe(a.id);
    expect(r.endedAt).toBeNull();
    expect((await rowOf(room.id, host)).leftAt).not.toBeNull();
    expect(heardHost.at(-1)).toEqual({ t: "you", room: room.id, why: "away" });
    expect(heardA.some((t) => (t.what as { kind?: string; afk?: boolean } | undefined)?.kind === "host")).toBe(true);
    expect((await viewOf(a))!.members.map((m) => m.name)).toEqual(["a", "b"]);
    // a and b away too: a, the host now, 20 minutes on with nobody to hand it to
    const heardB = told(b);
    await post(b, "away");
    at(clock + MIN);
    await post(a, "away");
    at(clock + 20 * MIN);
    const n = heardA.length;
    await sweepSquad(clock);
    const [over] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(over.endedAt).not.toBeNull();
    expect(over.endReason).toBe("away");
    expect(await db.select().from(squadMembers).where(and(eq(squadMembers.roomId, room.id), isNull(squadMembers.leftAt)))).toEqual([]);
    // the host told why they are out, the others why it is over
    expect(heardA.slice(n)).toEqual([{ t: "you", room: room.id, why: "away" }]);
    expect(heardB.at(-1)).toEqual({ t: "end", room: room.id, why: "away" });
  });
});
