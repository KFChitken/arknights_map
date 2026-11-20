import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POND_PROTECT, SCHOOL_MS, SCHOOLS_A_ROUND } from "@/lib/fish/rules";
import { type SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { castLine, forgetBank } from "@/lib/server/fish";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { fishDays, fishLines, sessions, siteSettings, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { siteDay } from "@/lib/siteDay";
import { POST as FISH } from "../../fish/[op]/route";
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

async function call(route: typeof POST, path: string, u: Pick<User, "id">, op: string, body: unknown = {}): Promise<Answer> {
  await signIn(u);
  const req = new NextRequest(`http://localhost/api/${path}/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await route(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const squad = (u: Pick<User, "id">, op: string, body: unknown = {}) => call(POST, "squad", u, op, body);
const fish = (u: Pick<User, "id">, op: string, body: unknown = {}) => call(FISH, "fish", u, op, body);

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
/** The line in the pond bitten a moment ago, with this on the hook */
async function hooked(u: Pick<User, "id">, item: number, cm: number | null = null) {
  const now = Date.now();
  await db
    .insert(fishLines)
    .values({ userId: u.id, spot: "pond", castAt: new Date(now - 60_000), biteAt: new Date(now - 100), item, variant: 0, cm, shadow: "m" })
    .onConflictDoUpdate({ target: fishLines.userId, set: { item, cm, biteAt: new Date(now - 100), spot: "pond" } });
}

const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${siteSettings} cascade`);
  await loadSettings();
  await loadMods();
  forgetHits();
  forgetSquad();
  forgetBank();
  tokens.clear();
  jar.token = null;
  vi.stubEnv("SQUAD", "on");
  vi.stubEnv("FISH", "off");
});

afterEach(async () => {
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
});

describe("卫戍池塘", () => {
  it("is for one in a room, with SQUAD alone; the bank stays FISH's", async () => {
    const host = await player("host");
    expect(await fish(host, "cast", { spot: "pond" })).toMatchObject({ status: 409, body: { error: "你不在卫戍房间里，钓不了卫戍池塘。" } });
    await opened(host);
    expect((await fish(host, "cast", { spot: "pier" })).status).toBe(404);
    expect((await fish(host, "cast", { spot: "pond" })).status).toBe(200);
    vi.stubEnv("SQUAD", "off");
    expect((await fish(host, "state")).status).toBe(404);
  });

  it("shows the room who has a line in, tells it as it goes in and comes out, and counts 鳞 for 爆护", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(host);
    expect((await fish(a, "cast", { spot: "pond" })).status).toBe(200);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "pond", h: 2 } });
    expect((await view(host)).members.find((m) => m.h === 2)).toMatchObject({ fishing: true });
    // 鳞 count, junk does not
    await hooked(a, 1, 3000);
    expect((await fish(a, "reel")).status).toBe(200);
    await hooked(a, 10);
    expect((await fish(a, "reel")).status).toBe(200);
    const after = (await view(host)).members.find((m) => m.h === 2)!;
    expect(after.fishing).toBeUndefined();
    expect(after.fishN).toBe(1);
    await db.update(squadMembers).set({ fishN: POND_PROTECT - 1 }).where(eq(squadMembers.userId, a.id));
    await hooked(a, 1, 3000);
    await fish(a, "reel");
    expect((await view(a)).members.find((m) => m.you)!.fishN).toBe(POND_PROTECT);
    // pulled back: told too
    await fish(a, "cast", { spot: "pond" });
    heard.length = 0;
    expect((await fish(a, "pull")).status).toBe(200);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "pond", h: 2 } });
  });

  it("says purple and up to the whole room with the catcher's number, and the day's 空军司令 shows there", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(host);
    await hooked(a, 21, 5831);
    expect((await fish(a, "reel")).status).toBe(200);
    await flushSaysNow();
    expect(heard).toContainEqual({ t: "fish", room: room.id, items: [{ h: 2, no: 21, variant: 0, cm: 5831 }] });
    await db
      .insert(fishDays)
      .values({ userId: a.id, day: siteDay(), admiral: true })
      .onConflictDoUpdate({ target: [fishDays.userId, fishDays.day], set: { admiral: true } });
    expect((await view(host)).members.find((m) => m.h === 2)).toMatchObject({ admiral: true });
  });

  it("leaves a line in the pond as its player leaves the room: still pulled in, or taken back, with nothing counted to the room", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    expect((await fish(a, "cast", { spot: "pond" })).status).toBe(200);
    expect((await squad(a, "leave")).status).toBe(200);
    const heard = hear(host);
    const pondNews = () => heard.filter((e) => e.t === "fish" || (e.what as { kind?: string } | undefined)?.kind === "pond");
    // out of the room, the line still in: pulled in once bitten, a purple one said to no room
    expect((await fish(a, "state")).body!.line).toMatchObject({ spot: "pond" });
    await hooked(a, 21, 5831);
    const got = await fish(a, "reel");
    expect(got.status, JSON.stringify(got.body)).toBe(200);
    expect(got.body!.caught).toMatchObject({ no: 21 });
    await flushSaysNow();
    expect(pondNews()).toEqual([]);
    // and taken back before a bite
    await goIn(a, room);
    expect((await fish(a, "cast", { spot: "pond" })).status).toBe(200);
    expect((await squad(a, "leave")).status).toBe(200);
    heard.length = 0;
    expect((await fish(a, "pull")).status).toBe(200);
    expect((await fish(a, "state")).body!.line).toBeNull();
    await flushSaysNow();
    expect(pondNews()).toEqual([]);
    // none of it counted to the room it left
    expect((await view(host)).members.map((m) => m.h)).toEqual([1]);
  });

  it("brings a 鱼群 only once every real player has a line in, at most twice a 局, and starts the 局 over at the round's end", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const always = () => 0;
    // alone in the pond: no 鱼群 whatever the draw
    await castLine(host, { spot: "pond" }, Date.now(), always);
    expect((await view(host)).school).toBeUndefined();
    await castLine(a, { spot: "pond" }, Date.now(), always);
    const on = await view(host);
    expect(on.school).toBeGreaterThan(Date.now());
    expect(on.school).toBeLessThanOrEqual(Date.now() + SCHOOL_MS);
    // over, and again: the second of this 局, then no more
    await db.update(squadRooms).set({ schoolUntil: new Date(Date.now() - 1) }).where(eq(squadRooms.id, room.id));
    await castLine(a, { spot: "pond" }, Date.now(), always);
    await db.update(squadRooms).set({ schoolUntil: new Date(Date.now() - 1) }).where(eq(squadRooms.id, room.id));
    await castLine(a, { spot: "pond" }, Date.now(), always);
    const [r] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(r.schools).toBe(SCHOOLS_A_ROUND);
    expect((await view(host)).school).toBeUndefined();
    // a round played and over: a new 局, its 鳞 and 鱼群 counted anew
    await db.update(squadMembers).set({ fishN: 4, inGame: true }).where(and(eq(squadMembers.roomId, room.id)));
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "go" })).status).toBe(200);
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await squad(host, "state", { to: "wait" })).status).toBe(200);
    const [fresh] = await db.select().from(squadRooms).where(eq(squadRooms.id, room.id));
    expect(fresh.schools).toBe(0);
    expect((await db.select({ n: squadMembers.fishN }).from(squadMembers).where(eq(squadMembers.userId, a.id)))[0].n).toBe(0);
  });
});
