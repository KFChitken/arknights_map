import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InviteSent, ListenRoom } from "@/lib/listen";
import type { SquadList, SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listenInbox } from "@/lib/server/listenRooms";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { block } from "@/lib/server/safety";
import {
  admins,
  blocks,
  friendships,
  listenInvites,
  listenMembers,
  listenNow,
  listenRooms,
  sessions,
  siteSettings,
  songs,
  squadBots,
  squadMembers,
  squadRooms,
  statCounts,
  users,
} from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetStatCounts } from "@/lib/server/stats";
import { POST as LISTEN } from "../../listen/[op]/route";
import { GET, POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// the routes read their cookie as any page does; here, the one of the player this test acts as
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
    .values({
      email: `${name}@example.com`,
      name,
      anonymous: false,
      ageConfirmedAt: now,
      policyAcceptedAt: now,
      crossBorderAcceptedAt: now,
      publicPlaceAcceptedAt: now,
      squadCore: 0,
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
async function ask(route: typeof POST, path: string, u: Pick<User, "id">, op: string, body: unknown) {
  await signIn(u);
  forgetHits();
  const req = new NextRequest(`http://localhost/api/${path}/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await route(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
/** 一起卫戍's route, and 听歌's */
const post = (u: Pick<User, "id">, op: string, body: unknown = {}) => ask(POST, "squad", u, op, body);
const hear = (u: Pick<User, "id">, op: string, body: unknown = {}) => ask(LISTEN, "listen", u, op, body);
async function list(u: Pick<User, "id">) {
  await signIn(u);
  forgetSquad();
  const res = await GET(new NextRequest("http://localhost/api/squad/list"), { params: Promise.resolve({ op: "list" }) });
  return (await res.json()) as SquadList;
}
const roomOf = (r: { body: Record<string, unknown> | null }) => r.body!.room as SquadRoom;
const viewOf = async (u: Pick<User, "id">) => roomOf(await post(u, "room"));
const befriend = (x: User, y: User) => db.insert(friendships).values(x.id < y.id ? { a: x.id, b: y.id } : { a: y.id, b: x.id });
const inListen = async (roomId: string) =>
  (
    await db
      .select({ id: listenMembers.userId })
      .from(listenMembers)
      .where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt)))
  ).map((r) => r.id);

/** Three songs on one album */
async function seedSongs() {
  await db.insert(songs).values(
    ["s1", "s2", "s3"].map((id, i) => ({
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

/** The 站长's room of 一起卫戍 with a and b in it (none a 触须之交 of anyone's), SQUAD and LISTEN on, the songs there */
async function cast() {
  vi.stubEnv("SQUAD", "on");
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const host = await player("owner");
  const a = await player("a");
  const b = await player("b");
  const room = roomOf(await post(host, "open", { key: KEY, server: "cn", level: 3 }));
  for (const u of [a, b]) expect((await post(u, "join", { room: room.id })).status).toBe(200);
  return { host, a, b, room };
}

/** What reaches a player's open pages of 一起卫戍 (the event stream), from here on */
const offs: (() => void)[] = [];
function told(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}
const LISTEN_TOLD = { t: "room", what: { kind: "listen" } };

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadBots}, ${songs}, ${listenNow}, ${listenRooms}, ${listenMembers}, ${listenInvites}, ${friendships}, ${blocks}, ${siteSettings}, ${statCounts}, ${admins} cascade`,
  );
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetListeningCount();
  forgetStatCounts();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
});

describe("卫戍的一起听", () => {
  it("is the host's own 一起听, with everyone in the room invited (触须之交 or not, never a 人机); the room is told and sees it", async () => {
    const { host, a, b, room } = await cast();
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    expect(await viewOf(a)).toMatchObject({ hear: true, listen: null });
    const heard = told(a);
    const res = await hear(host, "squad", { song: "s1" });
    expect(res.status).toBe(200);
    const sent = res.body!.sent as InviteSent[];
    // by their numbers in the room: 2 and 3, the 人机 left out
    expect(sent).toEqual([
      { id: "2", ok: true },
      { id: "3", ok: true },
    ]);
    const lr = res.body!.room as ListenRoom;
    expect(lr).toMatchObject({ host: true, queue: ["s1"] });
    const invites = await db.select().from(listenInvites);
    expect(invites.map((i) => i.toUserId).sort()).toEqual([a.id, b.id].sort());
    expect(heard).toContainEqual({ ...LISTEN_TOLD, room: room.id });
    expect((await viewOf(host)).listen).toEqual({ room: lr.id, song: "Song 1", playing: false, n: 1, ours: 1, out: [2, 3], you: "in", later: [], uninvited: [] });
    expect((await viewOf(a)).listen).toEqual({
      room: lr.id,
      song: "Song 1",
      playing: false,
      n: 1,
      ours: 1,
      out: [2, 3],
      you: "invited",
      invite: invites.find((i) => i.toUserId === a.id)!.id,
    });
    // a teammate cannot start it
    expect(await hear(a, "squad", {})).toMatchObject({ status: 409, body: { error: "只有卫戍房间的房主能邀请大家一起听。" } });
  });

  it("lets those in the room in: at the invitation, or straight (加入) once it ran out or they said 下次吧; asked again after, quietly", async () => {
    const { host, a, b } = await cast();
    const lr = (await hear(host, "squad", {})).body!.room as ListenRoom;
    // a, straight: the invitation of a's answered by it
    expect((await hear(a, "join", { squad: true })).status).toBe(200);
    const [mine] = await db.select().from(listenInvites).where(eq(listenInvites.toUserId, a.id));
    expect(mine).toMatchObject({ answer: "joined" });
    expect((await db.select().from(listenMembers).where(eq(listenMembers.userId, a.id)))[0]).toMatchObject({ via: "squad" });
    // b, 下次吧: out, and the host sees who; 加入 later still works, an hour on
    const [theirs] = await db.select().from(listenInvites).where(eq(listenInvites.toUserId, b.id));
    expect((await hear(b, "later", { invite: theirs.id })).status).toBe(200);
    expect((await viewOf(b)).listen).toMatchObject({ you: "out", n: 2, ours: 2, out: [3] });
    expect((await viewOf(host)).listen).toMatchObject({ later: [3], uninvited: [] });
    // invited again within 30 minutes of 下次吧: quietly (seen at once)
    await hear(host, "squad", {});
    const again = await db.select().from(listenInvites).where(and(eq(listenInvites.toUserId, b.id), isNull(listenInvites.answer)));
    expect(again).toHaveLength(1);
    expect(again[0].seenAt).not.toBeNull();
    await db.update(listenInvites).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(listenInvites.toUserId, b.id));
    expect((await hear(b, "join", { squad: true })).status).toBe(200);
    expect((await inListen(lr.id)).sort()).toEqual([host.id, a.id, b.id].sort());
    expect((await viewOf(b)).listen).toMatchObject({ you: "in", n: 3, ours: 3, out: [] });
    // the host never goes in at their own; nobody out of the room goes in at it
    const c = await player("c");
    expect((await hear(c, "join", { squad: true })).status).toBe(410);
    expect((await hear(host, "join", { squad: true })).status).toBe(410);
  });

  it("is on only once someone of the room was invited to or is in the host's 一起听, and plays where the host played alone", async () => {
    const { host, a, room } = await cast();
    // the host's 一起听 with a 触须之交 out of the room: not the room's
    const c = await player("c");
    await befriend(host, c);
    const friendKey = ((await hear(host, "friends", {})).body!.friends as { id: string }[])[0].id;
    const own = (await hear(host, "open", { song: "s2", invite: [friendKey] })).body!.room as ListenRoom;
    expect((await viewOf(a)).listen).toBeNull();
    expect((await list(a)).rooms.find((r) => r.id === room.id)?.music).toBe(false);
    // invited: the same 一起听, the 触须之交 still in it
    expect(((await hear(host, "squad", {})).body!.room as ListenRoom).id).toBe(own.id);
    expect((await viewOf(a)).listen).toMatchObject({ room: own.id, song: "Song 2", playing: false });
    // a song played alone goes on in a new one where it got to: ♪ on the list
    await hear(host, "end", {});
    const went = (await hear(host, "squad", { song: "s3", at: 12 })).body!.room as ListenRoom;
    expect(went.startedAt).not.toBeNull();
    expect((await viewOf(a)).listen).toMatchObject({ room: went.id, song: "Song 3", playing: true });
    expect((await list(a)).rooms.find((r) => r.id === room.id)?.music).toBe(true);
    // the host in another's 一起听: out of it first (theirs goes on)
    await hear(host, "end", {});
    const other = (await hear(c, "open", { song: "s1", invite: [] })).body!.room as ListenRoom;
    const hostKey = ((await hear(c, "friends", {})).body!.friends as { id: string }[])[0].id;
    await hear(c, "invite", { friends: [hostKey] });
    const [toHost] = await db.select().from(listenInvites).where(eq(listenInvites.toUserId, host.id));
    expect((await hear(host, "join", { invite: toHost.id })).status).toBe(200);
    const mineNow = (await hear(host, "squad", {})).body!.room as ListenRoom;
    expect(mineNow.id).not.toBe(other.id);
    expect(await inListen(other.id)).toEqual([c.id]);
  });

  it("asks one asked out of the room out of it too, for good; the room over, it goes on", async () => {
    const { host, a, b, room } = await cast();
    const lr = (await hear(host, "squad", {})).body!.room as ListenRoom;
    await hear(a, "join", { squad: true });
    const aH = (await viewOf(host)).members.find((m) => m.name === "a")!.h;
    expect((await post(host, "kick", { h: aH })).status).toBe(200);
    expect(await inListen(lr.id)).toEqual([host.id]);
    expect((await hear(a, "join", { squad: true })).status).toBe(410);
    const [toA] = await db.select().from(listenInvites).where(eq(listenInvites.toUserId, a.id));
    expect((await hear(a, "join", { invite: toA.id })).status).toBe(403);
    // the room ends: the host's 一起听 goes on, b in it
    await hear(b, "join", { squad: true });
    await db.update(squadRooms).set({ stateAt: new Date(Date.now() - 60_000) }).where(eq(squadRooms.id, room.id));
    expect((await post(host, "state", { to: "end" })).status).toBe(200);
    expect((await db.select().from(squadRooms).where(eq(squadRooms.id, room.id)))[0].endedAt).not.toBeNull();
    expect((await db.select().from(listenRooms).where(eq(listenRooms.id, lr.id)))[0].endedAt).toBeNull();
    expect((await inListen(lr.id)).sort()).toEqual([host.id, b.id].sort());
  });

  it("is said in 消息 to be the room's, its host named a 触须之交 only where TA is one, and blocked by the invitation itself", async () => {
    const { host, a, b } = await cast();
    await befriend(host, b);
    await hear(host, "squad", {});
    const [toA] = await listenInbox(a.id, new Set());
    expect(toA).toMatchObject({ kind: "listenInvite", squad: true, state: "open" });
    expect(toA).not.toHaveProperty("friendId");
    const [toB] = await listenInbox(b.id, new Set());
    expect(toB).toMatchObject({ kind: "listenInvite", squad: true, friendId: expect.any(String) });
    // out of the room: an invitation of before says nothing of it
    await post(a, "leave");
    expect((await listenInbox(a.id, new Set()))[0]).not.toHaveProperty("squad");
    await block(a.id, toA.id);
    expect(await db.select({ by: blocks.blockerId, of: blocks.blockedId, known: blocks.known }).from(blocks)).toEqual([{ by: a.id, of: host.id, known: true }]);
  });

  it("shows nothing to one 听歌 is closed to; a page of before reads no songs, and its songs' buttons say to look again", async () => {
    const { host, a } = await cast();
    await hear(host, "squad", {});
    vi.stubEnv("LISTEN", "admins");
    expect(await viewOf(a)).toMatchObject({ hear: false, listen: null });
    expect(await viewOf(a)).toMatchObject({ dj: false, queue: [], idx: 0, startedAt: null, version: 0, requests: [], listening: null });
    for (const op of ["music", "request", "take", "drop"]) {
      expect(await post(host, op, { start: true, song: "s1", id: 1 })).toMatchObject({ status: 410, body: { error: "房间里的歌改成一起听了，刷新一下网页。" } });
    }
  });
});
