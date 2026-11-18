import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED, declName } from "@/lib/dashboard";
import { ROOM_KEEP_MS, type ListenCall, type ListenRoom } from "@/lib/listen";
import { DECLARATIONS_PER_DAY } from "@/lib/rules";
import { siteDay, siteDayStart } from "@/lib/siteDay";
import { loadMods } from "@/lib/server/admins";
import { spotRows } from "@/lib/server/declarationInbox";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { flushRxNow, sweepRooms } from "@/lib/server/listenRooms";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { block, report } from "@/lib/server/safety";
import {
  admins,
  blocks,
  declarations,
  declarationSpots,
  friendships,
  listenMembers,
  listenRooms,
  reports,
  roaches,
  sessions,
  songs,
  statCounts,
  touches,
  users,
} from "@/lib/server/schema";
import { loadSettings, setListen } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { friendIdsOf, inbox, touch } from "@/lib/server/world";
import type { InboxItem } from "@/lib/world/types";
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

/** 人民广场, and places 2 km, 5 km and 1,000 km away (Beijing) */
const HERE = { lng: 121.4737, lat: 31.2304 };
const NEAR = { lng: 121.4737, lat: 31.2484 };
const NEARISH = { lng: 121.4737, lat: 31.2754 };
const FAR = { lng: 116.4074, lat: 39.9042 };

async function account(email: string, name = "") {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({
      email,
      ageConfirmedAt: now,
      policyAcceptedAt: now,
      crossBorderAcceptedAt: now,
      publicPlaceAcceptedAt: now,
      ...(name ? { anonymous: false, name } : {}),
    })
    .returning();
  return u;
}

/** A roach of the player's, the main one unless a slot is given */
async function roachOf(u: User, at: { lng: number; lat: number }, slot = 0) {
  const [r] = await db.insert(roaches).values({ userId: u.id, slot, lng: at.lng, lat: at.lat }).returning();
  return r;
}

const tokens = new Map<string, string>();
/** A request to /api/listen/<op> as the player */
async function post(u: Pick<User, "id">, op: string, body: unknown = {}): Promise<Answer> {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    tokens.set(u.id, token);
  }
  jar.token = token;
  const req = new NextRequest(`http://localhost/api/listen/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** Two songs on one album */
async function seedSongs() {
  await db.insert(songs).values(
    ["s1", "s2"].map((id, i) => ({
      id,
      game: "arknights",
      name: `Song ${i + 1}`,
      albumId: "a1",
      album: "Album",
      artists: ["塞壬唱片-MSR"],
      seconds: 200 + i,
      file: `000000000000000${i + 1}.m4a`,
      bytes: 1000,
      albumOrder: 0,
      track: i,
      addedAt: new Date(),
    })),
  );
  await loadSongs();
}

/** What reaches a player's open pages (the event stream), from here on */
const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: { event: string; data: Record<string, unknown> | null }[] = [];
  offs.push(listen(u.id, (event, data) => got.push({ event, data: data ? (JSON.parse(data) as Record<string, unknown>) : null })));
  return got;
}
const toldOf = (got: ReturnType<typeof hear>, t?: string) => got.filter((x) => x.event === "listen" && (!t || x.data?.t === t)).map((x) => x.data!);

type Call = Extract<InboxItem, { kind: "declaration" }>;
/** The declarations in the player's 消息 */
const calls = async (u: User) => (await inbox(u.id)).filter((i): i is Call => i.kind === "declaration");
/** The newest 宣言一起听 the player got, and how its room looks to them now */
const callIn = async (u: User) => (await calls(u)).find((i) => i.listen);
const callOf = async (u: User): Promise<ListenCall | undefined> => (await callIn(u))?.listen;
/** Its id, as going in takes it */
const callId = async (u: User) => (await callIn(u))!.id.slice(2);

const roomOf = async (u: User) => (await post(u, "room")).body!.room as ListenRoom | null;
const roomRow = async (id: string) => (await db.select().from(listenRooms).where(eq(listenRooms.id, id)))[0] ?? null;
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((a, r) => a + Number(r.n), 0);
};

/**
 * The host, with a main roach at 人民广场 and a name to show; two players near, one 5 km off and one far, each with a
 * main roach; LISTEN on, the songs there
 */
async function cast() {
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const host = await account("host@example.com", "Dr.岚");
  const b = await account("b@example.com", "夜猫子博士");
  const c = await account("c@example.com");
  const d = await account("d@example.com");
  const far = await account("far@example.com");
  await roachOf(host, HERE);
  await roachOf(b, NEAR);
  await roachOf(c, NEARISH);
  await roachOf(d, NEAR);
  await roachOf(far, FAR);
  return { host, b, c, d, far };
}

/** The host declares (opening a room first when not in one); returns the room as the host sees it */
async function declared(host: User, body: Record<string, unknown> = { song: "s1" }) {
  const res = await post(host, "declare", body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body!.room as ListenRoom;
}

/** In at the 宣言一起听 the player got */
async function goIn(u: User) {
  const res = await post(u, "join", { declaration: await callId(u) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body!.room as ListenRoom;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${songs}, ${listenRooms}, ${friendships}, ${blocks}, ${statCounts}, ${admins} cascade`);
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetListeningCount();
  forgetStatCounts();
  forgetHits();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushRxNow();
  for (const off of offs.splice(0)) off();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("宣言一起听", () => {
  it("open a room for it, and call those near to it by its own sentence, once a room, counted as any declaration", async () => {
    const { host, b, c, d, far } = await cast();
    const hostHeard = hear(host);
    const bHeard = hear(b);
    const res = await post(host, "declare", { song: "s2" });
    expect(res.status).toBe(200);
    const room = res.body!.room as ListenRoom;
    expect(room).toMatchObject({ queue: ["s2"], host: true, declared: true, you: 1 });
    expect(res.body!.reach).toEqual(expect.stringContaining("10 公里"));
    const [row] = await db.select().from(declarations);
    expect(row).toMatchObject({ senderId: host.id, template: "listen", song: "Song 2", roomId: room.id, recipients: 3 });
    // those near hear of it at once, and find it in 宣言 with its room as it is; one far does not
    expect(bHeard.map((x) => x.event)).toContain("declare");
    for (const u of [b, c, d]) {
      const [call] = await calls(u);
      expect(call).toMatchObject({ text: "我在听《Song 2》，来一起听吗？", listen: { state: "open", n: 1, max: 20 } });
      expect(call.from).toBeFalsy();
    }
    expect(await calls(far)).toEqual([]);
    // the host's own page shows it sent
    expect(toldOf(hostHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    // once a room
    expect(await post(host, "declare", {})).toMatchObject({ status: 409, body: { error: "这场已经发过宣言了，一场只能发一次。" } });
    expect(await db.select().from(declarations)).toHaveLength(1);
    expect(await counted(COUNTED.listenRoom)).toBe(1);
    expect(await counted(COUNTED.decl)).toBe(1);
    expect(await counted(declName("listen"))).toBe(1);
    // nobody's id in what the host is answered
    const sent = JSON.stringify(res.body);
    for (const u of [host, b, c]) expect(sent).not.toContain(u.id);
  });

  it("go out from the roaches picked, with the song the room is at, by the host alone", async () => {
    const { host, b, c, far } = await cast();
    const clone = await roachOf(host, FAR, 1);
    const open = await post(host, "open", { song: "s1", invite: [] });
    const room = open.body!.room as ListenRoom;
    // its second song playing now
    await post(host, "queue", { add: "s2" });
    await db
      .update(listenRooms)
      .set({ startedAt: new Date(Date.now() - 210_000), version: sql`${listenRooms.version} + 1` })
      .where(eq(listenRooms.id, room.id));
    expect((await declared(host, { from: [clone.id] })).id).toBe(room.id);
    expect((await db.select().from(declarations))[0]).toMatchObject({ song: "Song 2", recipients: 1 });
    expect(await callOf(far)).toMatchObject({ state: "open" });
    expect(await calls(b)).toEqual([]);
    // someone else in it may not
    const host2 = await account("host2@example.com");
    await roachOf(host2, HERE);
    const other = await declared(host2);
    const [call] = await calls(c);
    expect(call.listen).toMatchObject({ state: "open" });
    expect((await post(c, "join", { declaration: call.id.slice(2) })).status).toBe(200);
    expect(await post(c, "declare", {})).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    expect((await roomOf(c))!.id).toBe(other.id);
  });

  it("count within the day's twenty, a minute apart, from a main roach; a room opened for one refused ends", async () => {
    const turn = siteDayStart(siteDay());
    vi.useFakeTimers({ now: turn + 30 * 60_000, toFake: ["Date"] });
    const { host } = await cast();
    // no main roach
    const lone = await account("lone@example.com");
    expect(await post(lone, "declare", { song: "s1" })).toMatchObject({ status: 400, body: { error: "先放下蟑螂本体，才能发宣言。" } });
    expect(await roomOf(lone)).toBeNull();
    const [gone] = await db.select().from(listenRooms).where(eq(listenRooms.hostId, lone.id));
    expect(gone.endedAt).not.toBeNull();
    // twenty today already
    const twenty = await db
      .insert(declarations)
      .values(Array.from({ length: DECLARATIONS_PER_DAY }, () => ({ senderId: host.id, template: "launch", game: "arknights", recipients: 0, createdAt: new Date(turn + 60_000) })))
      .returning({ id: declarations.id });
    const room = (await post(host, "open", { song: "s1", invite: [] })).body!.room as ListenRoom;
    expect(await post(host, "declare", {})).toMatchObject({ status: 400, body: { error: "今天的宣言发得够多啦，北京时间凌晨 4 点刷新。" } });
    // the room goes on, and may still be declared for
    expect(await roomRow(room.id)).toMatchObject({ endedAt: null, declaredAt: null });
    // yesterday's, but one half a minute ago: a minute's wait
    await db.delete(declarations);
    await db.insert(declarations).values({ senderId: host.id, template: "launch", game: "arknights", recipients: 0, createdAt: new Date(Date.now() - 30_000) });
    expect(await post(host, "declare", {})).toMatchObject({ status: 400, body: { error: "刚刚才发过宣言，歇一会儿再发吧。" } });
    vi.setSystemTime(Date.now() + 60_000);
    const sent = await declared(host, {});
    expect(sent.declared).toBe(true);
    // the host alone in it: 5 minutes from now, for those it called to come
    expect(sent.aloneSince).toBe(Date.now());
    expect((await roomRow(room.id))!.aloneSince!.getTime()).toBe(Date.now());
    expect(twenty).toHaveLength(DECLARATIONS_PER_DAY);
  });

  it("reach only those near who may listen, never one blocked; while LISTEN is admins, admins alone", async () => {
    vi.stubEnv("LISTEN", "admins");
    await seedSongs();
    const owner = await account("owner@example.com");
    const mod = await account("mod@example.com");
    const player = await account("player@example.com");
    const blocked = await account("blocked@example.com");
    await db.insert(admins).values([
      { userId: mod.id, role: "mod", alias: "小管" },
      { userId: blocked.id, role: "mod", alias: "小黑" },
    ]);
    await loadMods();
    await db.insert(blocks).values({ blockerId: blocked.id, blockedId: owner.id });
    for (const u of [owner, mod, player, blocked]) await roachOf(u, HERE);
    await declared(owner);
    expect((await db.select().from(declarations))[0].recipients).toBe(1);
    expect(await callOf(mod)).toMatchObject({ state: "open" });
    expect(await calls(player)).toEqual([]);
    expect(await calls(blocked)).toEqual([]);
    // found as any declaration is, when 消息 is read: open to everyone, everyone near sees it but the one blocked;
    // turned off, nobody does
    vi.stubEnv("LISTEN", "on");
    expect(await calls(mod)).toHaveLength(1);
    expect(await calls(player)).toHaveLength(1);
    expect(await calls(blocked)).toEqual([]);
    vi.stubEnv("LISTEN", "off");
    expect(await calls(mod)).toEqual([]);
  });

  it("show each who got it its room as it is now: how many, full, they are in it, shut to one asked to leave, over", async () => {
    const { host, b, c, d } = await cast();
    const owner = await account("owner@example.com");
    const room = await declared(host);
    expect(await callOf(b)).toEqual({ state: "open", n: 1, max: 20 });
    await goIn(b);
    expect(await callOf(b)).toEqual({ state: "in", n: 2, max: 20 });
    expect(await callOf(c)).toEqual({ state: "open", n: 2, max: 20 });
    await setListen(owner.id, { roomMax: 2 });
    expect(await callOf(c)).toEqual({ state: "full", n: 2, max: 2 });
    expect(await post(c, "join", { declaration: await callId(c) })).toMatchObject({ status: 409, body: { error: "这场满了。" } });
    await post(host, "kick", { h: 2 });
    expect(await callOf(b)).toMatchObject({ state: "shut" });
    expect(await callOf(d)).toEqual({ state: "open", n: 1, max: 2 });
    await post(host, "end");
    for (const u of [b, c, d]) expect(await callOf(u)).toEqual({ state: "over", n: 0, max: 2 });
    expect(await post(d, "join", { declaration: await callId(d) })).toMatchObject({ status: 410, body: { error: "这次一起听已经结束了。" } });
    // a day later the room is gone, and the declaration says it is over
    await sweepRooms((await roomRow(room.id))!.endedAt!.getTime() + ROOM_KEEP_MS + 60_000);
    expect(await roomRow(room.id)).toBeNull();
    expect((await db.select().from(declarations))[0].roomId).toBeNull();
    expect(await callOf(c)).toEqual({ state: "over", n: 0, max: 0 });
  });

  it("let in, with no say of the host's, those it reached alone, counted as come by a declaration", async () => {
    const { host, b, far } = await cast();
    const hostHeard = hear(host);
    const room = await declared(host);
    const id = (await db.select().from(declarations))[0].id;
    expect(await post(far, "join", { declaration: id })).toMatchObject({ status: 404, body: { error: "这条宣言已经结束了。" } });
    expect((await post(far, "join", { declaration: room.id })).status).toBe(404);
    expect((await post(far, "join", { declaration: "nope" })).status).toBe(404);
    // an ordinary declaration b sees is no way in
    const [plain] = await db
      .insert(declarations)
      .values({ senderId: host.id, template: "launch", game: "arknights", recipients: 1 })
      .returning({ id: declarations.id, senderId: declarations.senderId, createdAt: declarations.createdAt });
    await db.insert(declarationSpots).values(spotRows(plain, [HERE]));
    expect(await calls(b)).toHaveLength(2);
    expect(await post(b, "join", { declaration: plain.id })).toMatchObject({ status: 404, body: { error: "这条宣言已经结束了。" } });
    const theirs = await goIn(b);
    expect(theirs).toMatchObject({ id: room.id, you: 2, host: false, hostName: "Dr.岚" });
    expect(toldOf(hostHeard, "members").length).toBeGreaterThanOrEqual(2);
    const [member] = await db.select().from(listenMembers).where(eq(listenMembers.userId, b.id));
    expect(member.via).toBe("declaration");
    expect(await counted(COUNTED.listenJoinDecl)).toBe(1);
    expect(await counted(COUNTED.listenJoin)).toBe(0);
    // the declaration still reads as one from nearby, never naming the host
    expect((await callIn(b))!.from).toBeFalsy();
  });
});

describe("someone in 一起听", () => {
  /** The host's room, declared, with b and c come in at it (numbers 2 and 3 there) */
  async function full() {
    const people = await cast();
    const room = await declared(people.host);
    await goIn(people.b);
    await goIn(people.c);
    return { ...people, room };
  }

  it("请出去: by the host alone; TA is told alone and never let in again, the others see TA as gone", async () => {
    const { host, b, c, room } = await full();
    const bHeard = hear(b);
    const cHeard = hear(c);
    expect(await post(b, "kick", { h: 3 })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    expect((await post(host, "kick", { h: 1 })).status).toBe(400);
    expect((await post(host, "kick", { h: 9 })).status).toBe(400);
    expect((await post(host, "kick", { h: "2" })).status).toBe(400);
    const res = await post(host, "kick", { h: 2 });
    expect(res.status).toBe(200);
    expect((res.body!.room as ListenRoom).members.map((m) => [m.h, m.state])).toEqual([
      [1, "in"],
      [3, "in"],
      [2, "kicked"],
    ]);
    expect(toldOf(bHeard)).toEqual([{ t: "you", room: room.id, why: "kicked" }]);
    expect(toldOf(cHeard, "you")).toEqual([]);
    expect(toldOf(cHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    expect((await roomOf(c))!.members.find((m) => m.h === 2)!.state).toBe("left");
    expect(await roomOf(b)).toBeNull();
    expect(await post(host, "kick", { h: 2 })).toMatchObject({ status: 409, body: { error: "TA 已经不在这场里了。" } });
    expect(await post(b, "join", { declaration: await callId(b) })).toMatchObject({ status: 403, body: { error: "这场进不去了。" } });
  });

  it("碰 by TA's number there: TA's main roach, counted with the map's touches; both bold, 触须之交 at once", async () => {
    const { host, b, c, room } = await full();
    const [bMain] = await db.select().from(roaches).where(and(eq(roaches.userId, b.id), eq(roaches.slot, 0)));
    const bHeard = hear(b);
    const cHeard = hear(c);
    expect((await post(c, "touch", { h: 2 })).status).toBe(400);
    expect((await post(c, "touch", { h: 3, bold: true })).status).toBe(400);
    const sneaky = await post(c, "touch", { h: 2, bold: false });
    expect(sneaky.status).toBe(200);
    expect(sneaky.body).toMatchObject({ newFriend: null });
    expect(await db.select({ to: touches.toUserId, slot: touches.toSlot, pid: touches.toPublicId, bold: touches.bold }).from(touches)).toEqual([
      { to: b.id, slot: 0, pid: bMain.publicId, bold: false },
    ]);
    // one roach once a day, on the map or here: a sneaky touch may only be followed by a bold one
    await expect(touch(c.id, bMain.publicId, false)).rejects.toThrow("今天已经偷偷碰过这只蟑螂了");
    expect((await post(c, "touch", { h: 2, bold: true })).body).toMatchObject({ newFriend: null });
    expect(await post(c, "touch", { h: 2, bold: true })).toMatchObject({ status: 400, body: { error: "今天已经碰过这只蟑螂了，北京时间凌晨 4 点刷新。" } });
    // b answers boldly: 触须之交, and both of them see it in the room at once
    const [cMain] = await db.select().from(roaches).where(and(eq(roaches.userId, c.id), eq(roaches.slot, 0)));
    const back = await post(b, "touch", { h: 3, bold: true });
    expect(back.body!.newFriend).toBeTruthy();
    expect((await friendIdsOf(b.id)).has(c.id)).toBe(true);
    expect(toldOf(bHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    expect(toldOf(cHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    expect((await roomOf(c))!.members.find((m) => m.h === 2)).toMatchObject({ friend: true });
    expect((await roomOf(host))!.members.find((m) => m.h === 2)).toMatchObject({ friend: false });
    // TA without a main roach on the map
    await db.delete(roaches).where(eq(roaches.userId, host.id));
    expect(await post(b, "touch", { h: 1, bold: false })).toMatchObject({ status: 400, body: { error: "TA 现在地图上没有蟑螂，碰不了。" } });
    // nobody's id, nor any roach's, in what the room sends
    const sent = JSON.stringify([sneaky.body, await post(b, "room"), await post(c, "room"), await post(host, "room")]);
    for (const id of [host.id, b.id, c.id, bMain.id, bMain.publicId, cMain.id, cMain.publicId]) expect(sent).not.toContain(id);
    // out of the room, nobody to touch there
    await post(c, "leave");
    expect(await post(c, "touch", { h: 2, bold: false })).toMatchObject({ status: 409, body: { error: "你现在不在一起听里。" } });
  });

  it("拉黑 the host: you leave it, as though you had, and TA never knows", async () => {
    const { host, b, c, room } = await full();
    const bHeard = hear(b);
    const cHeard = hear(c);
    await block(b.id, `lr:${room.id}:1`);
    expect(await db.select({ blocker: blocks.blockerId, blocked: blocks.blockedId, known: blocks.known }).from(blocks)).toEqual([
      { blocker: b.id, blocked: host.id, known: true },
    ]);
    expect(toldOf(bHeard, "you")).toEqual([{ t: "you", room: room.id, why: "left" }]);
    expect(await roomOf(b)).toBeNull();
    expect(toldOf(cHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    expect((await roomOf(host))!.members.find((m) => m.h === 2)!.state).toBe("left");
    expect((await roomOf(c))!.members.find((m) => m.h === 2)!.state).toBe("left");
    // never in one room again; and out of it, nobody there to block
    expect(await post(b, "join", { declaration: (await calls(b))[0]?.id.slice(2) ?? room.id })).toMatchObject({ status: 404 });
    await expect(block(b.id, `lr:${room.id}:3`)).rejects.toThrow("找不到这条消息了。");
  });

  it("拉黑 by the host: for TA the room ended, the others see TA gone, and it goes on", async () => {
    const { host, b, c, room } = await full();
    const bHeard = hear(b);
    await block(host.id, `lr:${room.id}:2`);
    // b showed a name, so the host knew who it was
    expect((await db.select({ known: blocks.known }).from(blocks))[0].known).toBe(true);
    expect(toldOf(bHeard)).toEqual([{ t: "end", room: room.id, why: "host" }]);
    expect(await roomOf(b)).toBeNull();
    expect((await roomOf(host))!.members.map((m) => [m.h, m.state])).toEqual([
      [1, "in"],
      [3, "in"],
      [2, "left"],
    ]);
    expect((await roomOf(c))!.members.find((m) => m.h === 2)!.state).toBe("left");
    expect(await roomRow(room.id)).toMatchObject({ endedAt: null });
  });

  it("拉黑 between two others: gone from each other's list, deaf to each other's 短评, nothing seen by anyone else", async () => {
    const { host, b, c, d, room } = await full();
    await goIn(d);
    const bHeard = hear(b);
    const cHeard = hear(c);
    const hostHeard = hear(host);
    await block(c.id, `lr:${room.id}:2`);
    // b showed a name, so c knew who it was
    expect((await db.select({ known: blocks.known }).from(blocks))[0].known).toBe(true);
    expect((await roomOf(c))!.members.map((m) => m.h)).toEqual([1, 3, 4]);
    expect((await roomOf(b))!.members.map((m) => m.h)).toEqual([1, 2, 4]);
    expect((await roomOf(host))!.members.map((m) => [m.h, m.state])).toEqual([
      [1, "in"],
      [2, "in"],
      [3, "in"],
      [4, "in"],
    ]);
    expect(toldOf(bHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    expect(toldOf(cHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    expect(toldOf(hostHeard)).toEqual([]);
    // each other's 短评 go to everyone but them
    expect((await post(b, "react", { r: 0 })).body).toMatchObject({ sent: true });
    expect((await post(c, "react", { r: 1 })).body).toMatchObject({ sent: true });
    await flushRxNow();
    expect(toldOf(hostHeard, "rx").flatMap((x) => x.items as unknown[])).toEqual([
      { h: 2, r: 0 },
      { h: 3, r: 1 },
    ]);
    expect(toldOf(bHeard, "rx").flatMap((x) => x.items as unknown[])).toEqual([{ h: 2, r: 0 }]);
    expect(toldOf(cHeard, "rx").flatMap((x) => x.items as unknown[])).toEqual([{ h: 3, r: 1 }]);
    // and they can neither touch, ask the other to leave, nor block again by their number there
    expect(await post(b, "touch", { h: 3, bold: false })).toMatchObject({ status: 409, body: { error: "TA 已经不在这场里了。" } });
    await expect(block(b.id, `lr:${room.id}:3`)).rejects.toThrow("找不到这条消息了。");
    // both leave and come back: still never in one room together
    await post(b, "leave");
    expect(await post(b, "join", { declaration: await callId(b) })).toMatchObject({ status: 403, body: { error: "这场进不去了。" } });
  });

  it("举报 there: blocks as 拉黑 does, and the report says where", async () => {
    const { b, c, room } = await full();
    await report(b.id, `lr:${room.id}:3`, "spam", "");
    expect(await db.select({ blocker: blocks.blockerId, blocked: blocks.blockedId, known: blocks.known }).from(blocks)).toEqual([
      { blocker: b.id, blocked: c.id, known: false },
    ]);
    expect(await db.select({ reporter: reports.reporterId, target: reports.targetId, context: reports.context }).from(reports)).toEqual([
      { reporter: b.id, target: c.id, context: "一起听里" },
    ]);
    expect((await roomOf(b))!.members.map((m) => m.h)).toEqual([1, 2]);
    // someone not in the room may not, by any number
    const stranger = await account("x@example.com");
    await expect(report(stranger.id, `lr:${room.id}:2`, "spam", "")).rejects.toThrow("找不到这条消息了。");
    await expect(block(stranger.id, `lr:${room.id}:abc`)).rejects.toThrow("找不到这条消息了。");
    expect(await db.select().from(listenMembers).where(and(eq(listenMembers.roomId, room.id), isNull(listenMembers.leftAt)))).toHaveLength(3);
  });

  it("wait while 互动 is paused: no declaring, no touching; asking to leave is the host's own", async () => {
    const { host, b, room } = await full();
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, b.id));
    expect(await post(b, "touch", { h: 1, bold: false })).toMatchObject({ status: 403, body: { error: expect.stringContaining("暂停") } });
    expect(await post(b, "declare", {})).toMatchObject({ status: 403, body: { error: expect.stringContaining("暂停") } });
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, host.id));
    expect((await post(host, "kick", { h: 2 })).status).toBe(200);
    expect((await roomOf(host))!.id).toBe(room.id);
  });
});
