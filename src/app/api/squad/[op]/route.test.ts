import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import season from "@/data/squad-season.json";
import { COUNTED } from "@/lib/dashboard";
import { siteDay, siteDayStart } from "@/lib/siteDay";
import {
  findKey,
  GO_MAX_MS,
  JOINS_PER_HOUR,
  KEEP_MS,
  KEY_CHANGES,
  KEY_EVERY_MS,
  LIFE_MS,
  OPEN_EVERY_MS,
  OPENS_PER_DAY,
  REWAIT_MS,
  STRATEGIES,
  WAIT_IDLE_MS,
  type SquadList,
  type SquadRoom,
} from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { block, report } from "@/lib/server/safety";
import { admins, blocks, friendships, reports, roaches, sessions, siteSettings, squadMembers, squadRooms, statCounts, touches, users } from "@/lib/server/schema";
import { loadSettings, setSquad } from "@/lib/server/siteSettings";
import {
  changeKey,
  endAllSquadRooms,
  flushSaysNow,
  forgetSquad,
  joinRoom,
  openRoom,
  setState,
  squadMe,
  sweepSquad,
} from "@/lib/server/squad";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
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
type Answer = { status: number; body: Record<string, unknown> | null; etag?: string | null };

const KEY = "8di6kbgf9neg7e";
const CARD = { core: 5, strategy: 18, level: 3 };
/** What the card brings into a room: its picks */
const PICKS = { core: CARD.core, strategy: CARD.strategy };
/** A seat on the list: its roach as drawn, and the picks */
const SEAT = { ...PICKS, avatar: expect.any(String), color: expect.any(String) };

async function account(name: string, more: Partial<typeof users.$inferInsert> = {}) {
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
      ...more,
    })
    .returning();
  return u;
}
/** One with a card filled in */
const player = (name: string, more: Partial<typeof users.$inferInsert> = {}) =>
  account(name, { squadCore: CARD.core, squadStrategy: CARD.strategy, squadLevel: CARD.level, ...more });
const row = async (u: Pick<User, "id">) => (await db.select().from(users).where(eq(users.id, u.id)))[0];

const tokens = new Map<string, string>();
async function signIn(u: Pick<User, "id"> | null) {
  if (!u) return void (jar.token = null);
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    tokens.set(u.id, token);
  }
  jar.token = token;
}

/** A request to /api/squad/<op> as the player (null: a visitor) */
async function post(u: Pick<User, "id"> | null, op: string, body: unknown = {}): Promise<Answer> {
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

/** The list as the player sees it, the ETag held given */
async function list(u: Pick<User, "id"> | null, query = "", etag?: string): Promise<Answer> {
  await signIn(u);
  forgetSquad();
  const req = new NextRequest(`http://localhost/api/squad/list${query}`, { headers: etag ? { "if-none-match": etag } : {} });
  const res = await GET(req, { params: Promise.resolve({ op: "list" }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, etag: res.headers.get("etag") };
}
const roomsOf = async (u: Pick<User, "id">, query = "") => ((await list(u, query)).body as SquadList).rooms;

/** The host opens a room (険境模拟 on 官服, 冲奖杯) and sees it */
async function opened(host: User, more: Record<string, unknown> = {}) {
  const res = await post(host, "open", { key: KEY, server: "cn", level: 3, tags: [2], ...more });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body!.room as SquadRoom;
}
async function goIn(u: User, room: SquadRoom) {
  const res = await post(u, "join", { room: room.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body!.room as SquadRoom;
}

const befriend = (x: User, y: User) => db.insert(friendships).values(x.id < y.id ? { a: x.id, b: y.id } : { a: y.id, b: x.id });
const roomRow = async (id: string) => (await db.select().from(squadRooms).where(eq(squadRooms.id, id)))[0] ?? null;
const inNow = async (roomId: string) =>
  (await db.select({ id: squadMembers.userId }).from(squadMembers).where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt)))).map((r) => r.id);
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((a, r) => a + Number(r.n), 0);
};

/** What reaches a player's open pages (the event stream), from here on */
const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${friendships}, ${blocks}, ${siteSettings}, ${statCounts}, ${admins} cascade`);
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

describe("who 一起卫戍 is open to", () => {
  it("SQUAD=off answers everyone 404; admins only the 站长 and the admins; on, a visitor is asked to sign in", async () => {
    const owner = await player("owner");
    const someone = await player("someone");
    vi.stubEnv("SQUAD", "off");
    expect((await post(owner, "room")).status).toBe(404);
    expect((await list(owner)).status).toBe(404);
    expect(await squadMe(await row(owner))).toBeUndefined();
    vi.stubEnv("SQUAD", "admins");
    expect((await post(owner, "room")).status).toBe(200);
    expect((await post(someone, "room")).status).toBe(404);
    expect((await list(someone)).status).toBe(404);
    expect((await post(null, "room")).status).toBe(404);
    expect(await squadMe(await row(someone))).toBeUndefined();
    vi.stubEnv("SQUAD", "on");
    expect((await post(someone, "room")).status).toBe(200);
    expect((await post(null, "room")).status).toBe(401);
    expect(await squadMe(await row(someone))).toEqual({ card: CARD, showName: false, room: false, closed: null });
  });

  it("shows its way in to players of 明日方舟 and of no game yet, never to those of 终末地 alone", async () => {
    expect(await squadMe(await row(await player("ak", { games: ["arknights"] })))).toBeDefined();
    expect(await squadMe(await row(await player("none", { games: [] })))).toBeDefined();
    expect(await squadMe(await row(await player("both", { games: ["arknights", "endfield"] })))).toBeDefined();
    expect(await squadMe(await row(await player("ef", { games: ["endfield"] })))).toBeUndefined();
  });
});

describe("卫戍名片", () => {
  it("must be filled in before opening or going in; core needed (or 随机应变), a strategy or none, a 难度 or none", async () => {
    const host = await player("host");
    const room = await opened(host);
    const blank = await account("blank");
    expect(await post(blank, "open", { key: KEY, server: "cn", level: 3 })).toMatchObject({ status: 409, body: { code: "squadCard" } });
    expect(await post(blank, "join", { room: room.id })).toMatchObject({ status: 409, body: { code: "squadCard" } });
    for (const bad of [{ core: 11 }, { core: 1, strategy: 99 }, { core: 1, level: 6 }, { core: 1, level: 0 }, { core: 1, level: "3" }, { strategy: 1 }]) {
      expect((await post(blank, "card", { card: bad })).status, JSON.stringify(bad)).toBe(400);
    }
    // the extras a card of before had are ignored, never refused
    expect(await post(blank, "card", { card: { core: 1, extras: [1, 2, 3] } })).toMatchObject({ status: 200, body: { card: { core: 1, strategy: null, level: null } } });
    expect(await post(blank, "card", { card: { core: 0, level: 4 } })).toMatchObject({ status: 200, body: { card: { core: 0, strategy: null, level: 4 }, showName: false } });
    expect(await squadMe(await row(blank))).toMatchObject({ card: { core: 0, strategy: null, level: 4 } });
    // into a room go the picks, never extras (those of before stay in their column, neither read nor written)
    await db.update(users).set({ squadExtras: [3, 4] }).where(eq(users.id, blank.id));
    expect((await goIn(blank, room)).members.find((m) => m.you)).toEqual(expect.objectContaining({ core: 0, strategy: null }));
    expect((await db.select().from(squadMembers).where(eq(squadMembers.userId, blank.id)))[0].extras).toEqual([]);
    // 列表上显示我的名字: off until turned on, kept with the card, and off again once the card is cleared
    expect((await post(blank, "card", { card: { core: 0 }, showName: "yes" })).status).toBe(400);
    expect(await post(blank, "card", { card: { core: 0 }, showName: true })).toMatchObject({ status: 200, body: { showName: true } });
    expect(await post(blank, "card", { card: { core: 1 } })).toMatchObject({ status: 200, body: { card: { core: 1 }, showName: true } });
    // cleared, it is filled in again before the next room
    expect(await post(blank, "card", { card: null })).toMatchObject({ status: 200, body: { card: null, showName: false } });
    expect(await row(blank)).toMatchObject({ squadCore: null, squadLevel: null, squadShowName: false, squadExtras: [3, 4] });
  });

  it("has the season's 44 general strategies and 17 of a core alliance, by ids never given twice", () => {
    expect(STRATEGIES.filter((s) => !s.core)).toHaveLength(44);
    expect(STRATEGIES.filter((s) => s.core)).toHaveLength(17);
    expect(new Set(STRATEGIES.map((s) => s.id)).size).toBe(61);
    expect(STRATEGIES.find((s) => s.op === "卡莱莎")?.name).toBe("食腐之蝶");
    expect(season.cores).toHaveLength(10);
    expect(season.extras).toHaveLength(16);
    // every 盟约型 one belongs to a core alliance there is
    for (const s of STRATEGIES.filter((x) => x.core)) expect(season.cores.some((c) => c.id === s.core)).toBe(true);
  });
});

describe("a room", () => {
  it("finds the key in what was pasted: 14 letters and digits standing alone, kept in lowercase", () => {
    expect(findKey("8di6kbgf9neg7e")).toBe(KEY);
    expect(findKey("同盟密钥 | 8DI6KBGF9NEG7E 复制")).toBe(KEY);
    expect(findKey("  8di6 kbgf 9neg 7e ")).toBe(KEY);
    expect(findKey("8di6kbgf9neg7e1")).toBeNull();
    expect(findKey("8di6kbgf9neg")).toBeNull();
    expect(findKey("我的同盟")).toBeNull();
  });

  it("opens with the key, on one server for good; its host is number 1", async () => {
    const host = await player("host");
    expect(await post(host, "open", { key: "AB12CD34", server: "cn", level: 3 })).toMatchObject({ status: 400, body: { error: "同盟密钥是 14 位字母和数字，在游戏同盟右上角点「复制」。" } });
    expect((await post(host, "open", { key: KEY, server: "moon", level: 3 })).status).toBe(400);
    expect((await post(host, "open", { key: KEY, server: "cn", level: 9 })).status).toBe(400);
    expect((await post(host, "open", { key: KEY, server: "cn", level: 3, tags: [1, 2, 3] })).status).toBe(400);
    const t = Date.now();
    const room = await opened(host, { key: "同盟密钥 | 8DI6KBGF9NEG7E", server: "bili" });
    expect(room).toMatchObject({ key: KEY, server: "bili", level: 3, tags: [2], state: "wait", you: 1, host: true, keyLeft: KEY_CHANGES });
    expect(room.keyAt).toBeGreaterThanOrEqual(t - 1000);
    expect(room.members).toMatchObject([{ h: 1, host: true, you: true, name: "host", ...PICKS }]);
    expect(await counted(COUNTED.squadRoom)).toBe(1);
    expect((await squadMe(await row(host)))!.room).toBe(true);
  });

  it("lets others in from the list up to four, each by a number of their own; the key only to those in it", async () => {
    const host = await player("host");
    const room = await opened(host);
    const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map((n) => player(n)));
    const heard = hear(host);
    const inA = await goIn(a, room);
    expect(inA).toMatchObject({ key: KEY, you: 2, host: false });
    expect(inA.members.map((m) => [m.h, m.name, m.host, m.you])).toEqual([
      [1, "host", true, false],
      [2, "a", false, true],
    ]);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "in", h: 2 } });
    await goIn(b, room);
    await goIn(c, room);
    expect(await post(d, "join", { room: room.id })).toMatchObject({ status: 409, body: { code: "squadFull" } });
    // the list never carries the key
    expect(JSON.stringify((await list(d)).body)).not.toContain(KEY);
    expect(await counted(COUNTED.squadJoin)).toBe(3);
    // one leaving makes room again
    expect((await post(c, "leave")).status).toBe(200);
    expect((await goIn(d, room)).you).toBe(5);
  });

  it("is one at a time: opening or going in at another leaves it, and the host's ends with them", async () => {
    const host = await player("host");
    const other = await player("other");
    const a = await player("a");
    const first = await opened(host);
    const second = await opened(other);
    await goIn(a, first);
    await goIn(a, second);
    expect(await inNow(first.id)).toEqual([host.id]);
    // the host going in elsewhere ends their room
    const heard = hear(a);
    await goIn(host, second);
    expect((await roomRow(first.id))!.endReason).toBe("host");
    expect((await inNow(second.id)).sort()).toEqual([other.id, a.id, host.id].sort());
    // and the host leaving ends it for everyone
    await post(other, "leave");
    expect((await roomRow(second.id))!).toMatchObject({ endReason: "host", state: "ended" });
    expect(heard).toContainEqual({ t: "end", room: second.id, why: "host" });
  });

  it("等人 / 开打 / 结束: playing, it is closed and at the bottom of the list; 等人 starts the wait over once every 10 minutes", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    const other = await opened(await player("other"));
    expect((await post(a, "state", { to: "go" })).status).toBe(409);
    expect((await post(host, "state", { to: "go" })).body!.room).toMatchObject({ state: "go", endsWhy: "go" });
    expect(await post(a, "join", { room: room.id })).toMatchObject({ status: 409, body: { code: "squadPlaying" } });
    expect((await roomsOf(a)).map((r) => [r.id, r.state])).toEqual([
      [other.id, "wait"],
      [room.id, "go"],
    ]);
    // back to 等人 again too soon
    expect((await post(host, "state", { to: "wait" })).status).toBe(429);
    const t = Date.now();
    await setState(host, { to: "wait" }, t + 11_000);
    expect((await roomRow(room.id))!.state).toBe("wait");
    // 等人 tapped again: not before 10 minutes, then the wait starts over
    await expect(setState(host, { to: "wait" }, t + 60_000)).rejects.toMatchObject({ status: 429 });
    await setState(host, { to: "wait" }, t + 11_000 + REWAIT_MS);
    expect((await roomRow(room.id))!.waitedAt.getTime()).toBe(t + 11_000 + REWAIT_MS);
    await post(host, "state", { to: "end" });
    expect((await roomRow(room.id))!.endReason).toBe("host");
  });

  it("asks one to leave for good; a new key once a minute, thirty times a room, everyone in it told", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(a);
    // pasted at once after opening: a minute first
    expect((await post(host, "key", { key: "zz12cd34ef56gh" })).status).toBe(429);
    const t = Date.now() + KEY_EVERY_MS;
    expect(await changeKey(host, { key: "zz12cd34ef56gh" }, t)).toMatchObject({ room: { key: "zz12cd34ef56gh", keyAt: t, keyLeft: KEY_CHANGES - 1 } });
    await expect(changeKey(host, { key: "yy12cd34ef56gh" }, t + KEY_EVERY_MS - 1000)).rejects.toMatchObject({ status: 429 });
    expect(heard.filter((x) => x.t === "room" && (x.what as { kind?: string })?.kind === "key")).toHaveLength(1);
    await db.update(squadRooms).set({ keyChanges: KEY_CHANGES }).where(eq(squadRooms.id, room.id));
    await expect(changeKey(host, { key: "yy12cd34ef56gh" }, t + 2 * KEY_EVERY_MS)).rejects.toMatchObject({ status: 429 });
    expect((await post(a, "key", { key: "yy12cd34ef56gh" })).status).toBe(403);
    expect((await post(host, "kick", { h: 2 })).status).toBe(200);
    expect(heard).toContainEqual({ t: "you", room: room.id, why: "kicked" });
    expect(await post(a, "join", { room: room.id })).toMatchObject({ status: 403, body: { code: "squadShut" } });
  });

  it("我进同盟了 and the room's own card: told to everyone in it, the 卫戍名片 as it was", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(host);
    expect((await post(a, "game", { on: true })).body!.room).toMatchObject({ members: [{ inGame: false }, { inGame: true }] });
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "game", h: 2 } });
    const prefs = await post(a, "prefs", { card: { core: 1, strategy: 46, extras: [] } });
    expect((prefs.body!.room as SquadRoom).members[1]).toMatchObject({ core: 1, strategy: 46 });
    expect((await row(a)).squadCore).toBe(CARD.core);
    // again within ten seconds
    expect((await post(a, "prefs", { card: { core: 2 } })).status).toBe(429);
    expect((await roomsOf(host))[0].seats[1]).toMatchObject({ core: 1, strategy: 46 });
  });
});

describe("the list", () => {
  it("is of one server at a time: as asked, else the profile UID's, else 官服", async () => {
    const a = await player("a");
    const b = await player("b", { uidServerArknights: "bili" });
    const cn = await opened(await player("cnHost"));
    const bili = await opened(await player("biliHost"), { server: "bili" });
    expect((await roomsOf(a)).map((r) => r.id)).toEqual([cn.id]);
    expect((await list(a)).body!.server).toBe("cn");
    expect((await roomsOf(b)).map((r) => r.id)).toEqual([bili.id]);
    expect((await roomsOf(b, "?server=cn")).map((r) => r.id)).toEqual([cn.id]);
    expect((await roomsOf(b, "?server=cn&level=4")).map((r) => r.id)).toEqual([]);
  });

  it("names only the host, and a teammate to their own 触须之交; every seat with its card", async () => {
    const host = await player("host");
    const mate = await player("mate");
    const friend = await player("friend");
    const stranger = await player("stranger");
    await befriend(friend, mate);
    const room = await opened(host);
    await goIn(mate, room);
    const [byStranger] = await roomsOf(stranger);
    expect(byStranger).toMatchObject({ id: room.id, host: { name: "host", friend: false }, friend: false, mine: false });
    expect(byStranger.seats).toEqual([
      { role: "host", ...SEAT },
      { role: "mate", ...SEAT },
    ]);
    const [byFriend] = await roomsOf(friend);
    expect(byFriend.seats[1]).toEqual({ role: "friend", name: "mate", ...SEAT });
    expect(byFriend.friend).toBe(true);
    expect((await roomsOf(mate))[0].seats[1].role).toBe("you");
    // 列表上显示我的名字, off at first: turned on, everyone's next list names TA; off again, only TA's 触须之交
    expect((await post(mate, "card", { card: CARD, showName: true })).status).toBe(200);
    expect((await roomsOf(stranger))[0].seats[1]).toEqual({ role: "mate", name: "mate", ...SEAT });
    expect((await roomsOf(friend))[0].seats[1]).toEqual({ role: "friend", name: "mate", ...SEAT });
    expect((await post(mate, "card", { card: CARD, showName: false })).status).toBe(200);
    expect((await roomsOf(stranger))[0].seats[1]).toEqual({ role: "mate", ...SEAT });
    expect((await roomsOf(friend))[0].seats[1]).toEqual({ role: "friend", name: "mate", ...SEAT });
  });

  it("puts rooms with 触须之交 first, then those missing fewest, then the freshest key; those playing last", async () => {
    const viewer = await player("viewer");
    const t = Date.now() - 10 * 60_000;
    const hosts = await Promise.all(["h1", "h2", "h3", "h4", "h5"].map((n) => player(n)));
    const ids: string[] = [];
    for (const [i, h] of hosts.entries()) ids.push((await openRoom(await row(h), { key: KEY, server: "cn", level: 3 }, t + i * 1000)).room!.id);
    await befriend(viewer, hosts[0]);
    await joinRoom(await player("x"), { room: ids[1] }, t + 5000);
    await db.update(squadRooms).set({ state: "go" }).where(eq(squadRooms.id, ids[2]));
    // the oldest room's key pasted again just now: before the newer room's
    await changeKey(hosts[3], { key: "zz12cd34ef56gh" }, t + 5 * 60_000);
    expect((await roomsOf(viewer)).map((r) => r.id)).toEqual([ids[0], ids[1], ids[3], ids[4], ids[2]]);
  });

  it("shows a room only for 触须之交 to the host's alone, who alone come in", async () => {
    const host = await player("host");
    const friend = await player("friend");
    const stranger = await player("stranger");
    await befriend(host, friend);
    const room = await opened(host, { friendsOnly: true });
    expect(await roomsOf(stranger)).toEqual([]);
    expect(await post(stranger, "join", { room: room.id })).toMatchObject({ status: 403, body: { code: "squadShut" } });
    expect((await roomsOf(friend))[0]).toMatchObject({ id: room.id, friendsOnly: true, friend: true });
    await goIn(friend, room);
  });

  it("answers 304 to a page holding it already", async () => {
    const a = await player("a");
    await opened(await player("host"));
    const first = await list(a);
    expect(first.status).toBe(200);
    expect((await list(a, "", first.etag!)).status).toBe(304);
    await opened(await player("other"));
    expect((await list(a, "", first.etag!)).status).toBe(200);
  });

  it("says when 一起卫戍 is closed for now, which ends every room and lets none open", async () => {
    const owner = await player("owner");
    const host = await player("host");
    const room = await opened(host);
    const heard = hear(host);
    await setSquad(owner.id, { closed: true, note: "序列Ⅱ开放后再见" });
    await endAllSquadRooms("admin");
    expect((await roomRow(room.id))!.endReason).toBe("admin");
    expect(heard).toContainEqual({ t: "end", room: room.id, why: "admin" });
    expect((await list(host)).body).toMatchObject({ rooms: [], closed: "序列Ⅱ开放后再见" });
    expect(await post(host, "open", { key: KEY, server: "cn", level: 3 })).toMatchObject({ status: 503, body: { code: "squadClosed" } });
    expect((await squadMe(await row(host)))!.closed).toBe("序列Ⅱ开放后再见");
  });
});

describe("blocking", () => {
  it("keeps the two apart: neither sees the other's rooms, nor comes in where the other is", async () => {
    const host = await player("host");
    const blocked = await player("blocked");
    const room = await opened(host);
    await db.insert(blocks).values({ blockerId: blocked.id, blockedId: host.id });
    expect(await roomsOf(blocked)).toEqual([]);
    expect(await post(blocked, "join", { room: room.id })).toMatchObject({ status: 403, body: { code: "squadShut" } });
    // nor a room with them in it as one of the others
    const other = await opened(await player("other"));
    await goIn(host, other);
    expect(await roomsOf(blocked)).toEqual([]);
  });

  it("parts them in a room: the host's blocking asks TA out for good; anyone else's takes the one who blocked out", async () => {
    const host = await player("host");
    const [a, b] = await Promise.all([player("a"), player("b")]);
    const room = await opened(host);
    await goIn(a, room);
    await goIn(b, room);
    const heardB = hear(b);
    // a blocks b: a leaves, b stays
    await block(a.id, `sq:${room.id}:3`);
    expect((await inNow(room.id)).sort()).toEqual([host.id, b.id].sort());
    // the host blocks b: b is asked to leave, and never let in again
    await block(host.id, `sq:${room.id}:3`);
    expect(await inNow(room.id)).toEqual([host.id]);
    expect(heardB).toContainEqual({ t: "you", room: room.id, why: "kicked" });
    expect(await post(b, "join", { room: room.id })).toMatchObject({ status: 403 });
    // blocking the host: you leave
    const c = await player("c");
    await goIn(c, room);
    await block(c.id, `sq:${room.id}:1`);
    expect(await inNow(room.id)).toEqual([host.id]);
  });

  it("reports by number in the room, with its 难度 and tags and TA's card there for the case", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    await report(a.id, `sq:${room.id}:1`, "spam", "");
    const [r] = await db.select().from(reports);
    expect(r.targetId).toBe(host.id);
    expect(r.context).toBe("一起卫戍里（险境模拟·冲奖杯），TA 在房间里选的：核心盟约 阿戈尔，策略 老鲤（得闲饮茶）");
    // not by someone in no room, nor of a number nobody has
    await expect(report((await player("outsider")).id, `sq:${room.id}:1`, "spam", "")).rejects.toThrow();
    await expect(report(a.id, `sq:${room.id}:9`, "spam", "")).rejects.toThrow();
  });
});

describe("the set lines", () => {
  it("go to everyone in the room by number, one every 3 s, never written down but counted", async () => {
    const host = await player("host");
    const a = await player("a");
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(host);
    expect((await post(a, "say", { p: 4 })).body).toMatchObject({ sent: true });
    expect((await post(a, "say", { p: 6 })).body).toMatchObject({ sent: false });
    expect((await post(a, "say", { p: 99 })).status).toBe(400);
    await flushSaysNow();
    expect(heard).toContainEqual({ t: "say", room: room.id, items: [{ h: 2, p: 4 }] });
    expect(await counted(COUNTED.squadSay)).toBe(1);
  });
});

describe("touching someone in the room", () => {
  it("touches TA's main roach as on the map; both bold, they are 触须之交 and told so", async () => {
    const host = await player("host");
    const a = await player("a");
    await db.insert(roaches).values([
      { userId: host.id, slot: 0, lng: 121.47, lat: 31.23 },
      { userId: a.id, slot: 0, lng: 121.5, lat: 31.25 },
    ]);
    const room = await opened(host);
    await goIn(a, room);
    const heard = hear(host);
    expect((await post(host, "touch", { h: 2, bold: true })).status).toBe(200);
    expect(await db.select().from(touches)).toHaveLength(1);
    const back = await post(a, "touch", { h: 1, bold: true });
    expect(back.body!.newFriend).toBeTruthy();
    expect(heard).toContainEqual({ t: "room", room: room.id });
    expect((await post(host, "room")).body!.room).toMatchObject({ members: [{ friend: false }, { friend: true }] });
    expect((await post(host, "touch", { h: 7, bold: true })).status).toBe(409);
  });
});

describe("the limits", () => {
  it("opens one every two minutes and six a site day", async () => {
    const host = await row(await player("host"));
    const start = siteDayStart(siteDay(Date.now())) + 60_000;
    const body = { key: KEY, server: "cn", level: 3 };
    await openRoom(host, body, start);
    await expect(openRoom(host, body, start + OPEN_EVERY_MS - 1000)).rejects.toMatchObject({ status: 429 });
    for (let i = 1; i < OPENS_PER_DAY; i++) await openRoom(host, body, start + i * OPEN_EVERY_MS);
    await expect(openRoom(host, body, start + OPENS_PER_DAY * OPEN_EVERY_MS)).rejects.toMatchObject({ status: 429 });
    // the next site day, again
    await openRoom(host, body, start + 86_400_000);
  });

  it("goes in at twenty rooms an hour", async () => {
    const a = await row(await player("a"));
    const t = Date.now();
    const hosts = await Promise.all(Array.from({ length: JOINS_PER_HOUR + 1 }, (_, i) => player(`h${i}`)));
    const ids: string[] = [];
    for (const h of hosts) ids.push((await openRoom(await row(h), { key: KEY, server: "cn", level: 3 }, t - 3_600_000 * 2)).room!.id);
    for (let i = 0; i < JOINS_PER_HOUR; i++) await joinRoom(a, { room: ids[i] }, t - 1000 * (JOINS_PER_HOUR - i));
    await expect(joinRoom(a, { room: ids[JOINS_PER_HOUR] }, t)).rejects.toMatchObject({ status: 429 });
  });
});

describe("the sweep", () => {
  it("ends a room waiting 15 minutes with nothing happening, playing 3 hours, or open 6 hours; deletes it a day after", async () => {
    const t = Date.now();
    const idle = (await openRoom(await row(await player("idle")), { key: KEY, server: "cn", level: 3 }, t)).room!;
    const playing = (await openRoom(await row(await player("playing")), { key: KEY, server: "cn", level: 3 }, t)).room!;
    await setState(await row((await db.select().from(users).where(eq(users.name, "playing")))[0]), { to: "go" }, t);
    const old = (await openRoom(await row(await player("old")), { key: KEY, server: "cn", level: 3 }, t)).room!;
    // the old room kept busy: someone comes in now and then
    await db.update(squadRooms).set({ movedAt: new Date(t + LIFE_MS - 60_000) }).where(eq(squadRooms.id, old.id));
    // a new key starts the wait over
    const keyed = (await openRoom(await row(await player("keyed")), { key: KEY, server: "cn", level: 3 }, t)).room!;
    await changeKey(await row((await db.select().from(users).where(eq(users.name, "keyed")))[0]), { key: "zz12cd34ef56gh" }, t + 10 * 60_000);
    await sweepSquad(t + WAIT_IDLE_MS - 1000);
    expect((await roomRow(idle.id))!.endedAt).toBeNull();
    await sweepSquad(t + WAIT_IDLE_MS + 1000);
    expect((await roomRow(idle.id))!.endReason).toBe("idle");
    expect((await roomRow(keyed.id))!.endedAt).toBeNull();
    await sweepSquad(t + 10 * 60_000 + WAIT_IDLE_MS + 1000);
    expect((await roomRow(keyed.id))!.endReason).toBe("idle");
    expect((await roomRow(playing.id))!.endedAt).toBeNull();
    await sweepSquad(t + GO_MAX_MS + 1000);
    expect((await roomRow(playing.id))!.endReason).toBe("go");
    expect((await roomRow(old.id))!.endedAt).toBeNull();
    await sweepSquad(t + LIFE_MS + 1000);
    expect((await roomRow(old.id))!.endReason).toBe("life");
    await sweepSquad(t + WAIT_IDLE_MS + 1000 + KEEP_MS - 5000);
    expect(await roomRow(idle.id)).not.toBeNull();
    await sweepSquad(t + WAIT_IDLE_MS + 1000 + KEEP_MS + 1000);
    expect(await roomRow(idle.id)).toBeNull();
    expect(await db.select().from(squadMembers).where(eq(squadMembers.roomId, idle.id))).toEqual([]);
  });
});
