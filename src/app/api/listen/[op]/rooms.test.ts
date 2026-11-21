import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED } from "@/lib/dashboard";
import {
  ALONE_EARLY_MS,
  ALONE_MS,
  AWAY_MS,
  IDLE_MS,
  INVITE_MS,
  QUEUE_MAX,
  REQUESTS_EACH,
  ROOM_GAP_MS,
  ROOM_IDLE_MS,
  ROOM_KEEP_MS,
  ROOM_LIFE_MS,
  roomAt,
  RX_EVERY_MS,
  type ListenFriend,
  type ListenRoom,
} from "@/lib/listen";
import { siteDay, siteDayStart } from "@/lib/siteDay";
import { loadMods } from "@/lib/server/admins";
import { db, pg } from "@/lib/server/db";
import { betweenOf } from "@/lib/server/friendly";
import { forgetListeningCount, listenMe } from "@/lib/server/listen";
import { changeSongs, endAllRooms, flushRxNow, joinRoom, listenInbox, roomView, sweepRooms } from "@/lib/server/listenRooms";
import { hearOthers, listen, tellListen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import {
  admins,
  blocks,
  friendships,
  listenInvites,
  listenMembers,
  listenNow,
  listenRequests,
  listenRooms,
  sessions,
  siteSettings,
  songPlays,
  songs,
  statCounts,
  users,
} from "@/lib/server/schema";
import { loadSettings, setGray, setListen } from "@/lib/server/siteSettings";
import { loadSongs, saveSongPlays } from "@/lib/server/songs";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { friendKey, friends as friendList } from "@/lib/server/world";
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

async function account(email: string, id?: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ id, email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
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

/** Two songs on one album, and a third that is gone */
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
      goneAt: i === 2 ? new Date() : null,
    })),
  );
  await loadSongs();
}

/** n more songs, r0, r1 and on, of 100 s each, on a second album */
async function moreSongs(n: number) {
  await db.insert(songs).values(
    Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      game: "arknights",
      name: `More ${i}`,
      albumId: "a2",
      album: "More",
      artists: ["塞壬唱片-MSR"],
      seconds: 100,
      file: `${String(i + 10).padStart(16, "0")}.m4a`,
      bytes: 1000,
      albumOrder: 1,
      track: i,
      addedAt: new Date(),
    })),
  );
  await loadSongs();
}

async function befriend(x: User, y: User) {
  await db.insert(friendships).values(x.id < y.id ? { a: x.id, b: y.id } : { a: y.id, b: x.id });
}

/** What reaches a player's open pages (the event stream), from here on */
const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: { event: string; data: Record<string, unknown> | null }[] = [];
  offs.push(listen(u.id, (event, data) => got.push({ event, data: data ? (JSON.parse(data) as Record<string, unknown>) : null })));
  return got;
}
const toldOf = (got: ReturnType<typeof hear>, t?: string) => got.filter((x) => x.event === "listen" && (!t || x.data?.t === t)).map((x) => x.data!);

/** The host and two 触须之交 of TA's, who are not each other's; LISTEN on, the songs there */
async function cast() {
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const host = await account("host@example.com");
  const b = await account("b@example.com");
  const c = await account("c@example.com");
  await befriend(host, b);
  await befriend(host, c);
  return { host, b, c };
}

const invitesTo = async (u: Pick<User, "id">, now = Date.now()) =>
  (await listenInbox(u.id, new Set(), now)).filter((i): i is Extract<InboxItem, { kind: "listenInvite" }> => i.kind === "listenInvite");
/** The id of the latest invitation to the player, as joining takes it */
const inviteOf = async (u: Pick<User, "id">) => (await invitesTo(u))[0].id.slice(3);

/** The host opens a room with s1, inviting those given; returns it as the host sees it */
async function opened(host: User, ...guests: User[]) {
  const res = await post(host, "open", { song: "s1", invite: guests.map((g) => friendKey(host.id, g.id)) });
  expect(res.status).toBe(200);
  return res.body!.room as ListenRoom;
}

async function goIn(u: User) {
  const res = await post(u, "join", { invite: await inviteOf(u) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body!.room as ListenRoom;
}

const roomOf = async (u: User) => (await post(u, "room")).body!.room as ListenRoom | null;
const roomRow = async (id: string) => (await db.select().from(listenRooms).where(eq(listenRooms.id, id)))[0] ?? null;
const inNow = async (roomId: string) =>
  (await db.select({ id: listenMembers.userId }).from(listenMembers).where(and(eq(listenMembers.roomId, roomId), isNull(listenMembers.leftAt)))).map((r) => r.id);
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((a, r) => a + Number(r.n), 0);
};

beforeEach(async () => {
  await saveSongPlays();
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${songs}, ${songPlays}, ${listenNow}, ${listenRooms}, ${listenMembers}, ${listenInvites}, ${friendships}, ${blocks}, ${siteSettings}, ${statCounts}, ${admins} cascade`,
  );
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

describe("一起听's rooms", () => {
  it("open with invitations to 触须之交; each goes in at TA's own alone, and is known there by a number, never an id", async () => {
    const { host, b, c } = await cast();
    const bHeard = hear(b);
    const res = await post(host, "open", { song: "s1", invite: [friendKey(host.id, b.id), "not-a-friend"] });
    expect(res.status).toBe(200);
    expect(res.body!.sent).toEqual([
      { id: friendKey(host.id, b.id), ok: true },
      { id: "not-a-friend", ok: false, why: "你们已经不是触须之交了。" },
    ]);
    const room = res.body!.room as ListenRoom;
    expect(room).toMatchObject({ queue: ["s1"], idx: 0, startedAt: null, version: 1, max: 20, you: 1, host: true });
    expect(room.members).toMatchObject([{ h: 1, host: true, friend: false, state: "in" }]);
    expect(room.invited).toMatchObject([{ state: "waiting", card: { avatar: expect.any(String) } }]);
    // TA hears of it as of anything new in 消息, where it waits in 触须之交
    expect(bHeard.map((x) => x.event)).toContain("inbox");
    const [invite] = await invitesTo(b);
    expect(invite).toMatchObject({ state: "open", n: 1, song: "Song 1", seen: false, friendId: friendKey(b.id, host.id) });
    expect(await counted(COUNTED.listenRoom)).toBe(1);
    expect(await counted(COUNTED.listenInvite)).toBe(1);

    // knowing a room or someone else's invitation is not enough
    const id = invite.id.slice(3);
    expect(await post(c, "join", { invite: id })).toMatchObject({ status: 404, body: { error: "这个邀请过期了。" } });
    expect((await post(c, "join", { invite: room.id })).status).toBe(404);
    expect((await post(c, "join", {})).status).toBe(404);

    const hostHeard = hear(host);
    const theirs = await goIn(b);
    expect(theirs).toMatchObject({ id: room.id, you: 2, host: false, invited: [] });
    expect(theirs.members.map((m) => [m.h, m.host, m.friend, m.state])).toEqual([
      [1, true, true, "in"],
      [2, false, false, "in"],
    ]);
    expect(toldOf(hostHeard, "members")).toEqual([{ t: "members", room: room.id }]);
    const mine = (await roomOf(host))!;
    expect(mine.invited).toEqual([]);
    expect(mine.members.map((m) => [m.h, m.friend])).toEqual([
      [1, false],
      [2, true],
    ]);
    // nobody's id, in anything the room sends
    const sent = JSON.stringify([res.body, theirs, mine, await post(b, "room")]);
    for (const u of [host, b, c]) expect(sent).not.toContain(u.id);
    expect((await invitesTo(b))[0]).toMatchObject({ state: "in" });
    expect(await listenMe(b)).toEqual({ paused: false, room: true, roomMax: 20, mode: "on" });
    expect(await counted(COUNTED.listenJoin)).toBe(1);
    // going in again changes nothing
    expect((await goIn(b)).members).toHaveLength(2);
    expect(await counted(COUNTED.listenJoin)).toBe(1);
  });

  it("show each in it the others as TA sees them: a 触须之交 of the host's need not be one of yours", async () => {
    const { host, b, c } = await cast();
    await opened(host, b, c);
    await goIn(b);
    await goIn(c);
    const seen = async (u: User) => (await roomOf(u))!.members.map((m) => [m.h, m.friend]);
    expect(await seen(host)).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(await seen(b)).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
    // someone who left stays on the list as gone
    expect((await post(c, "leave")).status).toBe(200);
    expect((await roomOf(b))!.members.map((m) => m.state)).toEqual(["in", "in", "left"]);
    expect(await roomOf(c)).toBeNull();
  });

  it("give each in it, for a 触须之交 of TA's there, that one as TA's own list of 触须之交 has TA (for 拉远), and nothing more", async () => {
    const { host, b, c } = await cast();
    await opened(host, b, c);
    await goIn(b);
    await goIn(c);
    const keys = async (u: User) => (await roomOf(u))!.members.map((m) => [m.h, m.friendId ?? null]);
    // the host's two 触须之交, each as the host's own list has TA; none for the host
    expect(await keys(host)).toEqual([
      [1, null],
      [2, friendKey(host.id, b.id)],
      [3, friendKey(host.id, c.id)],
    ]);
    // b's: the host alone, by b's own key for TA (never the host's for b); c, not b's 触须之交, nothing
    expect(await keys(b)).toEqual([
      [1, friendKey(b.id, host.id)],
      [2, null],
      [3, null],
    ]);
    expect(friendKey(b.id, host.id)).not.toBe(friendKey(host.id, b.id));
    expect(await keys(c)).toEqual([
      [1, friendKey(c.id, host.id)],
      [2, null],
      [3, null],
    ]);
    // the very id of TA in the list b's page already has (where TA's roaches are)
    expect((await friendList(b.id)).map((f) => f.id)).toEqual([friendKey(b.id, host.id)]);
    // and nobody's place, in what the room sends
    const sent = JSON.stringify([await post(host, "room"), await post(b, "room"), await post(c, "room")]);
    expect(sent).not.toMatch(/"lng"|"lat"/);
    // a 触须之交 no longer: nothing
    await db.execute(sql`truncate ${friendships}`);
    expect(await keys(b)).toEqual([
      [1, null],
      [2, null],
      [3, null],
    ]);
  });

  it("keep an invitation good 30 minutes; 下次吧 shows the host only that TA has not come, and TA may still", async () => {
    const { host, b, c } = await cast();
    const room = await opened(host, b, c);
    const hostHeard = hear(host);
    expect((await post(b, "later", { invite: await inviteOf(b) })).status).toBe(200);
    expect(toldOf(hostHeard, "members")).toHaveLength(1);
    expect((await roomOf(host))!.invited.map((i) => i.state).sort()).toEqual(["missed", "waiting"]);
    expect((await invitesTo(b))[0]).toMatchObject({ state: "later", seen: true });
    // changed TA's mind
    await goIn(b);

    const later = Date.now() + INVITE_MS + 1_000;
    await expect(joinRoom(c, { invite: await inviteOf(c) }, later)).rejects.toMatchObject({ status: 410 });
    expect((await invitesTo(c, later))[0]).toMatchObject({ state: "over", n: 0 });
    expect((await roomView(room.id, host.id, later))!.invited.map((i) => i.state)).toEqual(["missed"]);
  });

  it("invite the same 触须之交 as often as the host likes, none of the day's touches; never one who is not, blocked, or may not listen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 03:00 in Beijing: the site's day turns at 04:00, and changes nothing
    const day = siteDayStart(siteDay(Date.parse("2026-11-16T12:00:00+08:00")));
    vi.setSystemTime(day - 3_600_000);
    const { host, b, c } = await cast();
    const d = await account("d@example.com");
    await befriend(host, d);
    await db.insert(blocks).values({ blockerId: d.id, blockedId: host.id });
    const bKey = friendKey(host.id, b.id);
    for (let i = 0; i < 5; i++) {
      await opened(host, b);
      // an invitation still good is not sent again
      expect((await post(host, "invite", { friends: [bKey] })).body!.sent).toEqual([{ id: bKey, ok: true }]);
      expect((await post(host, "end")).status).toBe(200);
    }
    expect(await db.select().from(listenInvites)).toHaveLength(5);
    const room = await opened(host);
    const sent = (await post(host, "invite", { friends: [bKey, friendKey(host.id, d.id), friendKey(b.id, c.id)] })).body!.sent;
    expect(sent).toEqual([
      { id: bKey, ok: true },
      { id: friendKey(host.id, d.id), ok: false, why: "TA 现在用不了听歌。" },
      { id: friendKey(b.id, c.id), ok: false, why: "你们已经不是触须之交了。" },
    ]);
    expect(await db.select().from(listenInvites)).toHaveLength(6);
    // both anonymous, so of one name: in the order of their ids; nothing of how many times
    expect((await post(host, "friends")).body!.friends).toEqual(
      [
        { id: bKey, card: expect.any(Object), inRoom: false },
        { id: friendKey(host.id, c.id), card: expect.any(Object), inRoom: false },
      ].sort((x, y) => (x.id < y.id ? -1 : 1)),
    );
    // a new site day changes nothing: the last ran out, so another goes
    vi.setSystemTime(day + 60_000);
    forgetHits();
    expect((await post(host, "invite", { friends: [bKey] })).body!.sent).toEqual([{ id: bKey, ok: true }]);
    expect(await db.select().from(listenInvites)).toHaveLength(7);
    expect((await roomOf(host))!.id).toBe(room.id);
    // only the host invites
    await goIn(b);
    expect(await post(b, "invite", { friends: [friendKey(b.id, host.id)] })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
  });

  it("list 触须之交 of one name in the order of their ids, whatever order the database reads them in", async () => {
    vi.stubEnv("LISTEN", "on");
    const host = await account("host@example.com");
    // all anonymous, so all of one name; put in with ids rising and keys falling, so both orders the database may read
    // them in (as put in, or by id) are the list's own backwards
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      let id: string;
      do {
        id = `0000000${i}${crypto.randomUUID().slice(8)}`;
      } while (keys.length && friendKey(host.id, id) > keys[keys.length - 1]);
      keys.push(friendKey(host.id, id));
      await befriend(host, await account(`f${i}@example.com`, id));
    }
    const friends = (await post(host, "friends")).body!.friends as ListenFriend[];
    expect(new Set(friends.map((f) => f.card.displayName)).size).toBe(1);
    expect(friends.map((f) => f.id)).toEqual([...keys].sort());
  });

  it("invite, while LISTEN is admins, only 触须之交 who are admins too", async () => {
    vi.stubEnv("LISTEN", "admins");
    await seedSongs();
    const owner = await account("owner@example.com");
    const mod = await account("mod@example.com");
    const player = await account("player@example.com");
    await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小管" });
    await loadMods();
    await befriend(owner, mod);
    await befriend(owner, player);
    const res = await post(owner, "open", { song: "s1", invite: [friendKey(owner.id, mod.id), friendKey(owner.id, player.id)] });
    expect(res.body!.sent).toEqual([
      { id: friendKey(owner.id, mod.id), ok: true },
      { id: friendKey(owner.id, player.id), ok: false, why: "TA 现在用不了听歌。" },
    ]);
    expect((await post(owner, "friends")).body!.friends).toMatchObject([{ id: friendKey(owner.id, mod.id) }]);
    expect(await invitesTo(player)).toEqual([]);
    expect((await post(player, "room")).status).toBe(404);
    expect((await goIn(mod)).members).toHaveLength(2);
    // 邀请一起听 on a 触须之交's card: there for the admin, not for the player, and never for the player's own
    const on = async (a: User, b: User) => (await betweenOf(a, [{ user: b, since: new Date() }])).get(b.id)!.listen;
    expect(await on(owner, mod)).toBe(true);
    expect(await on(owner, player)).toBeUndefined();
    expect(await on(player, owner)).toBeUndefined();
    vi.stubEnv("LISTEN", "on");
    expect(await on(player, owner)).toBe(true);
    vi.stubEnv("LISTEN", "off");
    expect(await on(owner, mod)).toBeUndefined();
  });

  it("open with no song named (a 触须之交's card) at 新歌's first", async () => {
    const { host, b } = await cast();
    const res = await post(host, "open", { song: null, invite: [friendKey(host.id, b.id)] });
    expect(res.status).toBe(200);
    expect(res.body!.room).toMatchObject({ queue: ["s1"], host: true });
    expect(res.body!.sent).toEqual([{ id: friendKey(host.id, b.id), ok: true }]);
    // a song named that is not there is not taken for none
    expect(await post(b, "open", { song: "s3" })).toMatchObject({ status: 404 });
    expect(await post(b, "open", { song: "" })).toMatchObject({ status: 404 });
  });

  it("open at a second of the song (one playing alone): playing from there at once, and given one more after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    const now = Date.now();
    const res = await post(host, "open", { song: "s1", invite: [], at: 42.5 });
    expect(res.status).toBe(200);
    const room = res.body!.room as ListenRoom;
    expect(room).toMatchObject({ host: true, idx: 0, startedAt: now - 42_500 });
    expect(room.queue).toEqual(["s1", "s2"]);
    expect((await roomRow(room.id))?.startedAt?.getTime()).toBe(now - 42_500);
    // a second not in the song, or not a number: waiting for its start, as ever
    for (const at of [200, "42", -1, null]) {
      const other = (await post(b, "open", { song: "s1", at })).body!.room as ListenRoom;
      expect(other, String(at)).toMatchObject({ queue: ["s1"], startedAt: null });
    }
  });

  it("take one at a time: opening or going in at another leaves the first, and the host's ends with TA", async () => {
    const { host, b, c } = await cast();
    const first = await opened(host, b);
    await goIn(b);
    const hostHeard = hear(host);
    // B opens a room of TA's own: out of the host's, which goes on
    await befriend(b, c);
    const second = (await post(b, "open", { song: "s2", invite: [friendKey(b.id, c.id)] })).body!.room as ListenRoom;
    expect(second.host).toBe(true);
    expect(await inNow(first.id)).toEqual([host.id]);
    expect(toldOf(hostHeard, "members")).toEqual([{ t: "members", room: first.id }]);
    // the host goes in at B's: the host's room is over for everyone in it
    expect((await post(b, "invite", { friends: [friendKey(b.id, host.id)] })).status).toBe(200);
    const theirs = await goIn(host);
    expect(theirs.id).toBe(second.id);
    expect(await roomRow(first.id)).toMatchObject({ endReason: "host", endedAt: expect.any(Date) });
    expect(toldOf(hostHeard, "end")).toEqual([{ t: "end", room: first.id, why: "host" }]);
    expect(await db.select().from(listenMembers).where(isNull(listenMembers.leftAt))).toHaveLength(2);
  });

  it("let no more in than a room may hold, two at the very same moment neither", async () => {
    const { host, b, c } = await cast();
    const owner = await account("owner@example.com");
    await setListen(owner.id, { roomMax: 2 });
    await opened(host, b, c);
    const [bInvite, cInvite] = [await inviteOf(b), await inviteOf(c)];
    const tries = await Promise.allSettled([joinRoom(b, { invite: bInvite }), joinRoom(c, { invite: cInvite })]);
    expect(tries.map((t) => t.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(tries.find((t) => t.status === "rejected")).toMatchObject({ reason: { status: 409, message: "这场满了。" } });
    expect(await db.select().from(listenMembers).where(isNull(listenMembers.leftAt))).toHaveLength(2);
  });

  it("never let in one asked to leave it, nor anyone who blocked or was blocked by someone in it", async () => {
    const { host, b, c } = await cast();
    const room = await opened(host, b, c);
    await goIn(b);
    await db.insert(blocks).values({ blockerId: b.id, blockedId: c.id });
    expect(await post(c, "join", { invite: await inviteOf(c) })).toMatchObject({ status: 403, body: { error: "这场进不去了。" } });
    // asked to leave (请出去, the next step): never in again, however invited
    await db.update(listenMembers).set({ leftAt: new Date(), kicked: true }).where(eq(listenMembers.userId, b.id));
    expect((await post(host, "invite", { friends: [friendKey(host.id, b.id)] })).body!.sent).toEqual([{ id: friendKey(host.id, b.id), ok: true }]);
    expect(await post(b, "join", { invite: await inviteOf(b) })).toMatchObject({ status: 403, body: { error: "这场进不去了。" } });
    expect((await roomOf(host))!.members.map((m) => m.state)).toEqual(["in", "kicked"]);
    expect(await inNow(room.id)).toEqual([host.id]);
  });

  it("keep the place of one whose page went for 2 minutes; past that a guest has left, and a host's room ends", async () => {
    const { host, b } = await cast();
    const room = await opened(host, b);
    await goIn(b);
    const t0 = Date.now();
    // B reloads: the page going says so, the page back says so
    expect((await post(b, "stop", { away: true })).status).toBe(200);
    expect(await sweepRooms(t0 + 60_000)).toBe(0);
    expect(await inNow(room.id)).toContain(b.id);
    expect((await roomOf(b))!.id).toBe(room.id);
    expect((await db.select().from(listenMembers).where(eq(listenMembers.userId, b.id)))[0].awayAt).toBeNull();
    // gone off for good
    await post(b, "stop", { away: true });
    const bHeard = hear(b);
    const hostHeard = hear(host);
    await sweepRooms(t0 + AWAY_MS + 60_000);
    expect(await inNow(room.id)).toEqual([host.id]);
    expect(toldOf(hostHeard, "members")).toHaveLength(1);
    expect((await roomOf(host))!.members.map((m) => m.state)).toEqual(["in", "left"]);
    // the host goes off: over for everyone
    await goIn(b);
    await post(host, "stop", { away: true });
    expect(await sweepRooms(Date.now() + AWAY_MS + 60_000)).toBe(1);
    expect(await roomRow(room.id)).toMatchObject({ endReason: "host" });
    expect(toldOf(bHeard, "end")).toEqual([{ t: "end", room: room.id, why: "host" }]);
  });

  it("end when the host ends or leaves it, 10 minutes after its songs, after 6 hours, or with nobody in it; a day later they are gone", async () => {
    const { host, b } = await cast();
    // 结束: everyone told, the listening of those in it stops counting soon
    const one = await opened(host, b);
    await goIn(b);
    expect((await post(b, "play", { song: "s1" })).status).toBe(200);
    const bHeard = hear(b);
    expect(await post(b, "end")).toMatchObject({ status: 403 });
    expect((await post(host, "end")).status).toBe(200);
    expect(toldOf(bHeard, "end")).toEqual([{ t: "end", room: one.id, why: "host" }]);
    const row = (await db.select().from(listenNow).where(eq(listenNow.userId, b.id)))[0];
    expect(row.roomId).toBeNull();
    expect(row.until.getTime()).toBeLessThanOrEqual(Date.now() + 30_000);
    expect((await invitesTo(b))[0]).toMatchObject({ state: "over" });
    expect(await roomOf(b)).toBeNull();
    // 离开 by the host
    const two = await opened(host);
    await post(host, "leave");
    expect(await roomRow(two.id)).toMatchObject({ endReason: "host" });

    // songs over with none to add (s2 gone too, s1 all there is): 10 minutes on, without a new one (B in it too, as
    // a host alone in it would end before)
    await db.update(songs).set({ goneAt: new Date() }).where(eq(songs.id, "s2"));
    await loadSongs();
    const three = await opened(host, b);
    await goIn(b);
    expect((await post(host, "queue", { start: true })).body!.room).toMatchObject({ queue: ["s1"], version: 2 });
    expect(await post(host, "queue", { next: true })).toMatchObject({ status: 409, body: { error: "待播里没有下一首了，先在选歌里点 ＋ 加几首。" } });
    const end = (await roomRow(three.id))!.startedAt!.getTime() + 200_000;
    expect(await sweepRooms(end + ROOM_IDLE_MS - 60_000)).toBe(0);
    expect(await sweepRooms(end + ROOM_IDLE_MS + 1_000)).toBe(1);
    expect(await roomRow(three.id)).toMatchObject({ endReason: "idle" });

    // never started, the host there all along (and B): 6 hours at most
    const four = await opened(host, b);
    await goIn(b);
    const opening = (await roomRow(four.id))!.createdAt.getTime();
    expect(await sweepRooms(opening + ROOM_LIFE_MS - 60_000)).toBe(0);
    expect(await sweepRooms(opening + ROOM_LIFE_MS)).toBe(1);

    // nobody left in it
    const five = await opened(host);
    await db.update(listenMembers).set({ leftAt: new Date() }).where(eq(listenMembers.roomId, five.id));
    expect(await sweepRooms()).toBe(1);

    // a day after a room ended: the room, who was in it and the invitations to it, all gone
    const last = Math.max(...(await db.select().from(listenRooms)).map((r) => r.endedAt!.getTime()));
    await sweepRooms(last + ROOM_KEEP_MS - 60_000);
    expect(await db.select().from(listenRooms)).toHaveLength(1);
    await sweepRooms(last + ROOM_KEEP_MS + 60_000);
    expect(await db.select().from(listenRooms)).toEqual([]);
    expect(await db.select().from(listenMembers)).toEqual([]);
    expect(await db.select().from(listenInvites)).toEqual([]);
  });

  it("count a host alone in it from its opening and each time all the others are out, not while anyone is in; inviting starts it over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b, c } = await cast();
    const aloneOf = async (id: string) => (await roomRow(id))!.aloneSince?.getTime() ?? null;
    const t0 = Date.now();
    const room = await opened(host, b, c);
    // from its opening: those invited are nobody yet; nobody else sees it
    expect(await aloneOf(room.id)).toBe(t0);
    expect(room.aloneSince).toBe(t0);
    vi.setSystemTime(t0 + 60_000);
    const bIn = await goIn(b);
    expect(await aloneOf(room.id)).toBeNull();
    expect(bIn.aloneSince).toBeNull();
    expect((await roomOf(host))!.aloneSince).toBeNull();
    await goIn(c);
    // one of the two out: not alone
    vi.setSystemTime(t0 + 120_000);
    expect((await post(c, "leave")).status).toBe(200);
    expect(await aloneOf(room.id)).toBeNull();
    // the last one out: alone from then, the host told
    const hostHeard = hear(host);
    vi.setSystemTime(t0 + 180_000);
    expect((await post(b, "leave")).status).toBe(200);
    expect(await aloneOf(room.id)).toBe(t0 + 180_000);
    expect(toldOf(hostHeard, "members")).toHaveLength(1);
    expect((await roomOf(host))!.aloneSince).toBe(t0 + 180_000);
    // in again: not alone; asked to leave: alone from then
    await goIn(b);
    expect(await aloneOf(room.id)).toBeNull();
    vi.setSystemTime(t0 + 240_000);
    expect((await post(host, "kick", { h: bIn.you })).status).toBe(200);
    expect(await aloneOf(room.id)).toBe(t0 + 240_000);
    // inviting, even one invited already, gives TA 5 minutes from now to come
    vi.setSystemTime(t0 + 300_000);
    const again = await post(host, "invite", { friends: [friendKey(host.id, c.id)] });
    expect(again.body!.room).toMatchObject({ aloneSince: t0 + 300_000 });
    expect(await aloneOf(room.id)).toBe(t0 + 300_000);
    // parted by a block, either way: as though TA left
    await goIn(c);
    expect(await aloneOf(room.id)).toBeNull();
    const { separateBlocked } = await import("@/lib/server/listenRooms");
    vi.setSystemTime(t0 + 360_000);
    await separateBlocked(host.id, c.id);
    expect(await aloneOf(room.id)).toBe(t0 + 360_000);
    // another room, B in it: inviting counts nothing meanwhile; B blocking the host takes TA out, as leaving would
    const other = await opened(host, b);
    await goIn(b);
    expect((await post(host, "invite", { friends: [friendKey(host.id, c.id)] })).body!.room).toMatchObject({ aloneSince: null });
    expect(await aloneOf(other.id)).toBeNull();
    vi.setSystemTime(t0 + 420_000);
    await separateBlocked(b.id, host.id);
    expect(await aloneOf(other.id)).toBe(t0 + 420_000);
  });

  it("end a room its host has been alone in for 5 minutes, not seconds before; the host's own page at 0 only once it is so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    const t0 = Date.now();
    const one = await opened(host, b);
    const hostHeard = hear(host);
    // the sweep a few seconds short of it: nothing
    expect(await sweepRooms(t0 + ALONE_MS - 3_000)).toBe(0);
    expect(await roomRow(one.id)).toMatchObject({ endedAt: null });
    // the page's own, short of it by more than a few seconds: as though never sent
    vi.setSystemTime(t0 + ALONE_MS - ALONE_EARLY_MS - 1_000);
    expect(await post(host, "end", { alone: true })).toMatchObject({ status: 200, body: { ended: false } });
    expect(await roomRow(one.id)).toMatchObject({ endedAt: null });
    expect(toldOf(hostHeard, "end")).toEqual([]);
    // within a few seconds of it: over, as the sweep would end it, those it was told to hearing why
    vi.setSystemTime(t0 + ALONE_MS - 2_000);
    expect(await post(host, "end", { alone: true })).toMatchObject({ status: 200, body: { ended: true } });
    expect(await roomRow(one.id)).toMatchObject({ endReason: "alone" });
    expect(toldOf(hostHeard, "end")).toEqual([{ t: "end", room: one.id, why: "alone" }]);
    // an invitation to it not answered yet: over, as for any room that ended
    expect(await post(b, "join", { invite: await inviteOf(b) })).toMatchObject({ status: 410, body: { error: "这次一起听已经结束了。" } });

    // by the sweep: the first minute 5 minutes after the last one went out
    const two = await opened(host, b);
    await goIn(b);
    expect(await post(b, "end", { alone: true })).toMatchObject({ status: 403 });
    const t1 = Date.now() + 60_000;
    vi.setSystemTime(t1);
    expect((await post(b, "leave")).status).toBe(200);
    expect(await sweepRooms(t1 + ALONE_MS - 1_000)).toBe(0);
    expect(await sweepRooms(t1 + ALONE_MS)).toBe(1);
    expect(await roomRow(two.id)).toMatchObject({ endReason: "alone" });

    // never with anyone else in it, whatever was counted (two going at once): put right instead
    vi.setSystemTime(t1 + ALONE_MS + 60_000);
    const three = await opened(host, b);
    await goIn(b);
    await db
      .update(listenRooms)
      .set({ aloneSince: new Date(Date.now() - ALONE_MS - 60_000) })
      .where(eq(listenRooms.id, three.id));
    expect((await roomOf(host))!.aloneSince).toBeNull();
    expect(await post(host, "end", { alone: true })).toMatchObject({ body: { ended: false } });
    expect(await roomRow(three.id)).toMatchObject({ endedAt: null, aloneSince: null });
    // a host alone and not counted (each of two going saw the other still in): from the next sweep on, the host told
    await db
      .update(listenMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(listenMembers.roomId, three.id), eq(listenMembers.userId, b.id)));
    const heard = hear(host);
    const t2 = Date.now();
    expect(await sweepRooms(t2)).toBe(0);
    expect((await roomRow(three.id))!.aloneSince!.getTime()).toBe(t2);
    expect(toldOf(heard, "members")).toEqual([{ t: "members", room: three.id }]);
    expect(await sweepRooms(t2 + ALONE_MS)).toBe(1);
    expect(await roomRow(three.id)).toMatchObject({ endReason: "alone" });
  });

  it("let those in a room that ended go on with its song alone at once, as the same play, however many listen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b, c } = await cast();
    const owner = await account("owner@example.com");
    const room = await opened(host, b);
    await goIn(b);
    const started = (await post(host, "queue", { start: true })).body!.room as ListenRoom;
    vi.setSystemTime(started.startedAt! + 40_000);
    for (const u of [host, b]) expect((await post(u, "play", { song: "s1", at: 40, next: started.queue[1] })).status).toBe(200);
    const was = (await db.select().from(listenNow).where(eq(listenNow.userId, b.id)))[0];
    expect(was.roomId).toBe(room.id);
    // as many listen as may: nobody else gets in
    await setListen(owner.id, { cap: 2 });
    forgetListeningCount();
    expect(await post(c, "play", { song: "s1" })).toMatchObject({ status: 503 });
    expect((await post(host, "end")).status).toBe(200);
    // within the half minute they are still counted for: the same song from the same second, alone
    vi.setSystemTime(Date.now() + 1_000);
    for (const u of [host, b]) expect((await post(u, "play", { song: "s1", at: 41, next: started.queue[1] })).status).toBe(200);
    const now = (await db.select().from(listenNow).where(eq(listenNow.userId, b.id)))[0];
    expect(now).toMatchObject({ song: "s1", roomId: null, startedAt: was.startedAt });
    expect(now.until.getTime()).toBeGreaterThan(Date.now() + 100_000);
    expect(await post(c, "play", { song: "s1" })).toMatchObject({ status: 503 });
  });

  it("let the host alone change its songs, and tell everyone in it at once what to play, nothing of who", async () => {
    const { host, b } = await cast();
    const room = await opened(host, b);
    await goIn(b);
    const bHeard = hear(b);
    expect(await post(b, "queue", { start: true })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    expect((await post(host, "queue", {})).status).toBe(400);
    expect((await post(host, "queue", { add: "s3" })).status).toBe(404);

    const before = Date.now();
    const started = (await post(host, "queue", { start: true })).body!.room as ListenRoom;
    expect(started.startedAt).toBeGreaterThanOrEqual(before + 1_000);
    // its one song started, 待播 given one more in the same change (s2, all there is besides): told once, as the start;
    // who put each in by their number in the room (the host's first, 待播's own nobody's)
    const [state] = toldOf(bHeard, "state");
    expect(state).toEqual({ t: "state", room: room.id, how: "start", queue: ["s1", "s2"], by: [1, 0], idx: 0, startedAt: started.startedAt, version: 2 });
    // starting again changes nothing
    expect((await post(host, "queue", { start: true })).body!.room).toMatchObject({ version: 2 });
    expect((await post(host, "queue", { add: "s1" })).body!.room).toMatchObject({ queue: ["s1", "s2", "s1"], by: [1, 0, 1], startedAt: started.startedAt, version: 3 });
    const next = (await post(host, "queue", { next: true })).body!.room as ListenRoom;
    expect(next).toMatchObject({ queue: ["s2", "s1"], by: [0, 1], idx: 0, version: 4 });
    expect((await post(host, "queue", { restart: true })).body!.room).toMatchObject({ queue: ["s2", "s1"], version: 5 });
    expect(toldOf(bHeard, "state").map((s) => s.how)).toEqual(["start", "add", "next", "restart"]);
    for (const s of toldOf(bHeard, "state")) expect(Object.keys(s).sort()).toEqual(["by", "how", "idx", "queue", "room", "startedAt", "t", "version"]);
    // 30 songs at most
    for (let i = 2; i < QUEUE_MAX; i++) await changeSongs(host, { add: "s1" });
    expect(await post(host, "queue", { add: "s1" })).toMatchObject({ status: 409, body: { error: `一起听的歌单最多 ${QUEUE_MAX} 首。` } });
    // what is played in it is the room's
    expect((await post(b, "play", { song: "s2" })).status).toBe(200);
    expect((await db.select().from(listenNow).where(eq(listenNow.userId, b.id)))[0].roomId).toBe(room.id);
  });

  it("let the host alone add 10 songs at random: none twice, none in it already, none gone; told as any song added", async () => {
    const { host, b } = await cast();
    const room = await opened(host, b);
    await goIn(b);
    const bHeard = hear(b);
    expect(await post(b, "queue", { random: true })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    // s2 is all there is to add (s3 is gone), then nothing
    expect((await post(host, "queue", { random: true })).body!.room).toMatchObject({ queue: ["s1", "s2"], version: 2 });
    expect((await post(host, "queue", { random: true })).body!.room).toMatchObject({ queue: ["s1", "s2"], version: 2 });
    expect(toldOf(bHeard, "state")).toEqual([{ t: "state", room: room.id, how: "add", queue: ["s1", "s2"], by: [1, 0], idx: 0, startedAt: null, version: 2 }]);

    await db.insert(songs).values(
      Array.from({ length: 40 }, (_, i) => ({
        id: `r${i}`,
        game: "arknights",
        name: `More ${i}`,
        albumId: "a2",
        album: "More",
        artists: ["塞壬唱片-MSR"],
        seconds: 100,
        file: `${String(i + 10).padStart(16, "0")}.m4a`,
        bytes: 1000,
        albumOrder: 1,
        track: i,
        addedAt: new Date(),
      })),
    );
    await loadSongs();
    const once = ((await post(host, "queue", { random: true })).body!.room as ListenRoom).queue;
    expect(once).toHaveLength(12);
    expect(once.slice(0, 2)).toEqual(["s1", "s2"]);
    expect(once.slice(2).every((id) => /^r\d+$/.test(id))).toBe(true);
    expect(new Set(once).size).toBe(12);
    const twice = ((await post(host, "queue", { random: true })).body!.room as ListenRoom).queue;
    expect(twice.slice(0, 12)).toEqual(once);
    expect(new Set(twice).size).toBe(22);
    // up to 30, then no more
    const full = ((await post(host, "queue", { random: true })).body!.room as ListenRoom).queue;
    expect(full.slice(0, 22)).toEqual(twice);
    expect(new Set(full).size).toBe(QUEUE_MAX);
    expect(await post(host, "queue", { random: true })).toMatchObject({ status: 409, body: { error: `一起听的歌单最多 ${QUEUE_MAX} 首。` } });
    expect(toldOf(bHeard, "state").map((s) => s.how)).toEqual(["add", "add", "add", "add"]);
  });

  it("never run out of songs: one more at random once the last plays, in the host's change or within a minute, told as added", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    await db.insert(songs).values(
      Array.from({ length: 6 }, (_, i) => ({
        id: `r${i}`,
        game: "arknights",
        name: `More ${i}`,
        albumId: "a2",
        album: "More",
        artists: ["塞壬唱片-MSR"],
        seconds: 100,
        file: `${String(i + 10).padStart(16, "0")}.m4a`,
        bytes: 1000,
        albumOrder: 1,
        track: i,
        addedAt: new Date(),
      })),
    );
    await loadSongs();
    const len = (id: string) => (id === "s1" ? 200 : id === "s2" ? 201 : 100);
    const room = await opened(host, b);
    await goIn(b);
    const bHeard = hear(b);
    // not started: nothing added, however long
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await sweepRooms();
    expect(await roomRow(room.id)).toMatchObject({ queue: ["s1"], version: 1 });

    // started with its one song: one more at once, in the same change, told once as the start
    const started = (await post(host, "queue", { start: true })).body!.room as ListenRoom;
    expect(started).toMatchObject({ idx: 0, version: 2 });
    expect(started.queue).toHaveLength(2);
    expect(started.queue[0]).toBe("s1");
    expect(started.queue[1]).not.toBe("s1");
    expect(toldOf(bHeard, "state")).toEqual([
      { t: "state", room: room.id, how: "start", queue: started.queue, by: [1, 0], idx: 0, startedAt: started.startedAt, version: 2 },
    ]);
    // s1 plays: nothing more yet
    vi.setSystemTime(started.startedAt! + 100_000);
    expect(await sweepRooms()).toBe(0);
    expect(await roomRow(room.id)).toMatchObject({ queue: started.queue, version: 2 });

    // the second, the last, plays: the sweep gives one more, none played there, told as added (s1 dropped, as played)
    const second = started.startedAt! + 200_000 + 2_000;
    vi.setSystemTime(second + 10_000);
    expect(await sweepRooms()).toBe(0);
    const row = (await roomRow(room.id))!;
    expect(row).toMatchObject({ idx: 0, version: 3, startedAt: new Date(second) });
    expect(row.queue).toHaveLength(2);
    expect(row.queue[0]).toBe(started.queue[1]);
    expect(["s1", started.queue[1]]).not.toContain(row.queue[1]);
    expect(row.queueBy).toEqual([0, 0]);
    expect(toldOf(bHeard, "state").at(-1)).toEqual({ t: "state", room: room.id, how: "add", queue: row.queue, by: [0, 0], idx: 0, startedAt: second, version: 3 });
    // a minute on, the third waiting its turn: nothing more
    vi.setSystemTime(Date.now() + 60_000);
    await sweepRooms();
    expect((await roomRow(room.id))!.version).toBe(3);

    // ⏭ to the last: one more after it in the same change, one version more, told once as 下一首
    const next = (await post(host, "queue", { next: true })).body!.room as ListenRoom;
    expect(next).toMatchObject({ idx: 0, version: 4 });
    expect(next.queue).toHaveLength(2);
    expect(next.queue[0]).toBe(row.queue[1]);
    expect(["s1", ...row.queue]).not.toContain(next.queue[1]);
    expect(toldOf(bHeard, "state").map((s) => s.how)).toEqual(["start", "add", "next"]);

    // a room of before with nothing after its last (ROOM_IDLE_MS left to end it): ⏭ to the one 待播 gives it
    await db.update(listenRooms).set({ queue: [next.queue[0]] }).where(eq(listenRooms.id, room.id));
    const on = (await post(host, "queue", { next: true })).body!.room as ListenRoom;
    expect(on).toMatchObject({ idx: 0, version: 5 });
    expect(on.queue[0]).not.toBe(next.queue[0]);
    expect(on.queue).toHaveLength(2);

    // all over, a sweep missed: on at once with one more, instead of ending 10 minutes on
    const over = on.startedAt! + (len(on.queue[0]) + len(on.queue[1])) * 1000 + 2_000 + 5 * 60_000;
    vi.setSystemTime(over);
    expect(await sweepRooms()).toBe(0);
    const again = (await roomRow(room.id))!;
    expect(again).toMatchObject({ idx: 0, version: 6, startedAt: new Date(over + 1_000) });
    expect(again.queue).toHaveLength(1);
    expect(on.queue).not.toContain(again.queue[0]);
    expect(toldOf(bHeard, "state").at(-1)).toMatchObject({ how: "add", queue: again.queue, startedAt: over + 1_000, version: 6 });
    expect(await roomRow(room.id)).toMatchObject({ endedAt: null });
  });

  it("let the host alone move everyone to a second of the song playing (its last at most), told as a seek, nothing between songs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    const room = await opened(host, b);
    await goIn(b);
    const bHeard = hear(b);
    expect(await post(b, "queue", { seek: 30 })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    for (const seek of [-1, "30", 86_400, null]) expect((await post(host, "queue", { seek })).status, String(seek)).toBe(400);
    // not started, then within its first second: nothing plays yet, nothing changes
    expect((await post(host, "queue", { seek: 30 })).body!.room).toMatchObject({ startedAt: null, version: 1 });
    const started = (await post(host, "queue", { start: true })).body!.room as ListenRoom;
    expect((await post(host, "queue", { seek: 30 })).body!.room).toMatchObject({ startedAt: started.startedAt, version: 2 });

    vi.setSystemTime(started.startedAt! + 40_000);
    const moved = (await post(host, "queue", { seek: 120.5 })).body!.room as ListenRoom;
    // s2 as 待播 gave it at the start, after it
    expect(moved).toMatchObject({ queue: ["s1", "s2"], idx: 0, startedAt: Date.now() - 120_500, version: 3 });
    // s1 lasts 200 s: past its end is its last second
    expect((await post(host, "queue", { seek: 5_000 })).body!.room).toMatchObject({ startedAt: Date.now() - 199_000, version: 4 });
    const told = toldOf(bHeard, "state");
    expect(told.map((s) => s.how)).toEqual(["start", "seek", "seek"]);
    expect(told[1]).toEqual({ t: "state", room: room.id, how: "seek", queue: ["s1", "s2"], by: [1, 0], idx: 0, startedAt: moved.startedAt, version: 3 });
    // over: nothing to move
    vi.setSystemTime(Date.now() + 2_000);
    expect((await post(host, "queue", { seek: 10 })).body!.room).toMatchObject({ version: 4 });
  });

  it("let anyone in it but the host ask for a song, 3 waiting each at most: the host sees them all and is told, each asker only their own", async () => {
    const { host, b, c } = await cast();
    await moreSongs(6);
    const room = await opened(host, b, c);
    const bIn = await goIn(b);
    const cIn = await goIn(c);
    const hostHeard = hear(host);
    const cHeard = hear(c);
    // not in it, its host, a song not there (or gone), one in 待播 already (the first, before the start)
    const d = await account("d@example.com");
    expect(await post(d, "request", { song: "r0" })).toMatchObject({ status: 409, body: { error: "你现在不在一起听里。" } });
    expect(await post(host, "request", { song: "r0" })).toMatchObject({ status: 409, body: { error: "你是发起人，点 ＋ 直接加进待播就行。" } });
    for (const song of ["s3", "nope", 5, null]) expect((await post(b, "request", { song })).status, String(song)).toBe(404);
    expect(await post(b, "request", { song: "s1" })).toMatchObject({ status: 409, body: { error: "这首已经在待播里了。" } });

    for (const song of ["r0", "r1", "r2"]) expect((await post(b, "request", { song })).status).toBe(200);
    expect(await post(b, "request", { song: "r3" })).toMatchObject({ status: 409, body: { error: `同时最多等 ${REQUESTS_EACH} 首，等房主回了再点。` } });
    // one somebody asked for already
    expect(await post(c, "request", { song: "r1" })).toMatchObject({ status: 409, body: { error: "这首已经有人点了，等房主回。" } });
    const mine = (await post(c, "request", { song: "r3" })).body!.room as ListenRoom;
    // the host sees all of them, the oldest first; each who asked only their own, by their own number
    expect(mine.requests).toEqual([{ id: expect.any(Number), h: cIn.you, song: "r3" }]);
    expect((await roomOf(b))!.requests.map((q) => [q.h, q.song])).toEqual([
      [bIn.you, "r0"],
      [bIn.you, "r1"],
      [bIn.you, "r2"],
    ]);
    expect((await roomOf(host))!.requests.map((q) => [q.h, q.song])).toEqual([
      [bIn.you, "r0"],
      [bIn.you, "r1"],
      [bIn.you, "r2"],
      [cIn.you, "r3"],
    ]);
    // the host is told each time (nothing of what: TA asks for the room again); nobody else is told anything
    expect(toldOf(hostHeard, "asks")).toEqual(Array.from({ length: 4 }, () => ({ t: "asks", room: room.id })));
    expect(toldOf(cHeard)).toEqual([]);

    // 撤回: one's own alone, while it waits
    const [r0, r1, r2] = (await roomOf(b))!.requests;
    for (const id of ["x", String(r1.id), true, 0]) expect((await post(b, "withdraw", { id })).status).toBe(400);
    expect(await post(c, "withdraw", { id: r1.id })).toMatchObject({ status: 409, body: { error: "这首已经不在点歌里了。" } });
    expect(((await post(b, "withdraw", { id: r1.id })).body!.room as ListenRoom).requests.map((q) => q.song)).toEqual(["r0", "r2"]);
    expect(toldOf(hostHeard, "asks")).toHaveLength(5);
    expect((await post(b, "withdraw", { id: r1.id })).status).toBe(409);

    // the host alone answers
    expect(await post(b, "answer", { id: r0.id, yes: true })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    for (const bad of [{ id: r0.id }, { id: r0.id, yes: "yes" }, { id: 0, yes: true }, { id: String(r0.id), yes: true }])
      expect((await post(host, "answer", bad)).status).toBe(400);
    const bHeard = hear(b);
    // 不要: told to the one who asked alone; 待播 as it was
    const no = (await post(host, "answer", { id: mine.requests[0].id, yes: false })).body!.room as ListenRoom;
    expect(no).toMatchObject({ queue: ["s1"], version: 1 });
    expect(toldOf(cHeard)).toEqual([{ t: "answered", room: room.id, song: "r3", yes: false }]);
    expect(toldOf(bHeard)).toEqual([]);
    // 同意: at the end of 待播 as b's, told to everyone as a song added, and to b alone that it was let in
    const yes = (await post(host, "answer", { id: r0.id, yes: true })).body!.room as ListenRoom;
    expect(yes).toMatchObject({ queue: ["s1", "r0"], by: [1, bIn.you], version: 2 });
    expect(yes.requests.map((q) => q.song)).toEqual(["r2"]);
    const added = { t: "state", room: room.id, how: "add", queue: ["s1", "r0"], by: [1, bIn.you], idx: 0, startedAt: null, version: 2 };
    expect(toldOf(bHeard)).toEqual([added, { t: "answered", room: room.id, song: "r0", yes: true }]);
    expect(toldOf(cHeard).slice(1)).toEqual([added]);
    expect((await roomOf(b))!.by).toEqual([1, bIn.you]);
    // answered once only; in 待播 now, it is not to be asked for
    expect(await post(host, "answer", { id: r0.id, yes: true })).toMatchObject({ status: 409, body: { error: "这首已经不在点歌里了。" } });
    expect(await post(c, "request", { song: "r0" })).toMatchObject({ status: 409, body: { error: "这首已经在待播里了。" } });
    // b waits on one now: room for two more (a minute on, past the 10 asks a minute each, refused ones too)
    forgetHits();
    expect((await post(b, "request", { song: "r1" })).status).toBe(200);
    expect((await post(b, "request", { song: "r4" })).status).toBe(200);
    expect((await post(b, "request", { song: "r5" })).status).toBe(409);
    expect((await roomOf(b))!.requests.map((q) => q.id)).toEqual([r2.id, expect.any(Number), expect.any(Number)]);
  });

  it("let one in nothing when 待播 is full: no asking, and the host's 同意 refused with what was asked for kept", async () => {
    const { host, b } = await cast();
    await moreSongs(3);
    await opened(host, b);
    await goIn(b);
    for (let i = 1; i < QUEUE_MAX - 1; i++) await changeSongs(host, { add: "s1" });
    expect((await post(b, "request", { song: "r0" })).status).toBe(200);
    await changeSongs(host, { add: "s2" });
    expect(await post(b, "request", { song: "r1" })).toMatchObject({ status: 409, body: { error: `待播满 ${QUEUE_MAX} 首了。` } });
    const [asked] = (await roomOf(host))!.requests;
    expect(await post(host, "answer", { id: asked.id, yes: true })).toMatchObject({ status: 409, body: { error: `一起听的歌单最多 ${QUEUE_MAX} 首。` } });
    expect((await roomOf(host))!.requests).toEqual([asked]);
    // the host takes one out: in it goes
    const room = (await roomOf(host))!;
    const out = (await post(host, "queue", { remove: QUEUE_MAX - 1, song: "s2" })).body!.room as ListenRoom;
    expect(out.queue).toHaveLength(QUEUE_MAX - 1);
    expect(out.version).toBe(room.version + 1);
    const yes = (await post(host, "answer", { id: asked.id, yes: true })).body!.room as ListenRoom;
    expect(yes.queue).toHaveLength(QUEUE_MAX);
    expect(yes.queue.at(-1)).toBe("r0");
    expect(yes.requests).toEqual([]);
  });

  it("drop what someone asked for once TA leaves, is asked to leave, blocks the host or the room ends", async () => {
    const { host, b, c } = await cast();
    await moreSongs(4);
    const one = await opened(host, b, c);
    const bIn = await goIn(b);
    const cIn = await goIn(c);
    const waiting = async (roomId: string) => (await db.select().from(listenRequests).where(eq(listenRequests.roomId, roomId))).map((r) => [r.handle, r.song]);
    expect((await post(b, "request", { song: "r0" })).status).toBe(200);
    expect((await post(c, "request", { song: "r1" })).status).toBe(200);
    expect((await post(c, "request", { song: "r2" })).status).toBe(200);
    expect((await post(b, "leave")).status).toBe(200);
    expect(await waiting(one.id)).toEqual([
      [cIn.you, "r1"],
      [cIn.you, "r2"],
    ]);
    expect((await post(host, "kick", { h: cIn.you })).status).toBe(200);
    expect(await waiting(one.id)).toEqual([]);
    expect(bIn.you).not.toBe(cIn.you);

    // blocking the host, or the host blocking one: as though TA left
    const { separateBlocked } = await import("@/lib/server/listenRooms");
    await post(host, "end");
    const two = await opened(host, b, c);
    await goIn(b);
    await goIn(c);
    expect((await post(b, "request", { song: "r0" })).status).toBe(200);
    expect((await post(c, "request", { song: "r1" })).status).toBe(200);
    await separateBlocked(b.id, host.id);
    await separateBlocked(host.id, c.id);
    expect(await waiting(two.id)).toEqual([]);

    // over: all of them go
    await post(host, "end");
    const three = await opened(host, b);
    await goIn(b);
    expect((await post(b, "request", { song: "r3" })).status).toBe(200);
    expect(await waiting(three.id)).toHaveLength(1);
    expect((await post(host, "end")).status).toBe(200);
    expect(await waiting(three.id)).toEqual([]);
  });

  it("keep who put each song in lined up with 待播: as songs play on, after 下一首, a song taken out; the host's × alone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    await moreSongs(4);
    const room = await opened(host, b);
    const bIn = await goIn(b);
    const bHeard = hear(b);
    const ask = async (song: string) => {
      expect((await post(b, "request", { song })).status).toBe(200);
      const q = (await roomOf(host))!.requests.find((x) => x.song === song)!;
      return (await post(host, "answer", { id: q.id, yes: true })).body!.room as ListenRoom;
    };
    await ask("r0");
    await changeSongs(host, { add: "r1" });
    await ask("r2");
    const row = (await roomRow(room.id))!;
    expect(row.queue).toEqual(["s1", "r0", "r1", "r2"]);
    expect(row.queueBy).toEqual([1, bIn.you, 1, bIn.you]);
    // started: s1 plays, then r0 (b's); a change as r0 plays drops s1 and who put it in
    const started = (await post(host, "queue", { start: true })).body!.room as ListenRoom;
    vi.setSystemTime(started.startedAt! + 200_000 + ROOM_GAP_MS + 5_000);
    await changeSongs(host, { add: "r3" });
    expect(await roomRow(room.id)).toMatchObject({ queue: ["r0", "r1", "r2", "r3"], queueBy: [bIn.you, 1, bIn.you, 1] });
    // 下一首: r1 (the host's) plays
    await changeSongs(host, { next: true });
    expect(await roomRow(room.id)).toMatchObject({ queue: ["r1", "r2", "r3"], queueBy: [1, bIn.you, 1] });
    // × on r2 (b's), by its place in the room's songs: told as taken out, nothing else changed
    expect(await post(b, "queue", { remove: 1, song: "r2" })).toMatchObject({ status: 403, body: { error: "只有发起人能点。" } });
    for (const bad of [{ remove: -1, song: "r2" }, { remove: "1", song: "r2" }, { remove: 1 }]) expect((await post(host, "queue", bad)).status).toBe(400);
    const before = (await roomRow(room.id))!;
    const out = (await post(host, "queue", { remove: 1, song: "r2" })).body!.room as ListenRoom;
    expect(out).toMatchObject({ queue: ["r1", "r3"], by: [1, 1], startedAt: before.startedAt!.getTime(), version: before.version + 1 });
    expect(toldOf(bHeard, "state").at(-1)).toEqual({ t: "state", room: room.id, how: "remove", queue: ["r1", "r3"], by: [1, 1], idx: 0, startedAt: out.startedAt, version: out.version });
    // the one playing, or one not in 待播: nothing
    expect((await post(host, "queue", { remove: 0, song: "r1" })).body!.room).toMatchObject({ version: out.version });
    expect((await post(host, "queue", { remove: 1, song: "r0" })).body!.room).toMatchObject({ version: out.version });
    // b's own song, b gone: it stays, nobody's in particular (the page says 已离开的人点的)
    await ask("r0");
    expect((await post(b, "leave")).status).toBe(200);
    expect(await roomRow(room.id)).toMatchObject({ queue: ["r1", "r3", "r0"], queueBy: [1, 1, bIn.you] });
    // a room open from before who put each in was kept: its songs are the host's (not 随机放的), what comes after as it is
    await db.update(listenRooms).set({ queueBy: [] }).where(eq(listenRooms.id, room.id));
    expect((await roomOf(host))!.by).toEqual([1, 1, 1]);
    await changeSongs(host, { random: true });
    const row2 = (await roomRow(room.id))!;
    expect(row2.queue).toHaveLength(6);
    expect(row2.queueBy).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it("take 短评 by their number alone, one every 3 s and 10 a song each, sent together to everyone in it a second later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    const room = await opened(host, b);
    await goIn(b);
    const hostHeard = hear(host);
    expect((await post(b, "react", { r: 19 })).status).toBe(400);
    expect((await post(b, "react", { r: "kksk" })).status).toBe(400);
    expect((await post(b, "react", { r: 8 })).body).toMatchObject({ sent: true });
    expect((await post(b, "react", { r: 8 })).body).toMatchObject({ sent: false });
    expect((await post(host, "react", { r: 15 })).body).toMatchObject({ sent: true });
    // nothing yet: they go out together
    expect(toldOf(hostHeard, "rx")).toEqual([]);
    await flushRxNow();
    expect(toldOf(hostHeard, "rx")).toEqual([
      {
        t: "rx",
        room: room.id,
        items: [
          { h: 2, r: 8 },
          { h: 1, r: 15 },
        ],
      },
    ]);
    for (let i = 1; i < 10; i++) {
      vi.setSystemTime(Date.now() + RX_EVERY_MS);
      expect((await post(b, "react", { r: 0 })).body, `the ${i + 1}th`).toMatchObject({ sent: true });
    }
    vi.setSystemTime(Date.now() + RX_EVERY_MS);
    expect((await post(b, "react", { r: 0 })).body).toMatchObject({ sent: false, full: true });
    // out of a room with no song of their own playing, there is nothing to say it to (friends.test.ts: alone)
    await post(b, "leave");
    expect(await post(b, "react", { r: 0 })).toMatchObject({ status: 409, body: { error: "先放一首歌，再发短评。", code: "NOT_LISTENING" } });
    expect(await post(b, "react", { r: 15 })).toMatchObject({ status: 409, body: { error: "你现在不在一起听里。" } });
    await flushRxNow();
    expect(await counted(COUNTED.listenRx)).toBe(11);
  });

  it("let one whose 互动 is paused listen alone, not with others", async () => {
    const { host, b } = await cast();
    await opened(host, b);
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, b.id));
    expect((await post(b, "play", { song: "s1" })).status).toBe(200);
    for (const [op, body] of [
      ["join", { invite: await inviteOf(b) }],
      ["open", { song: "s1" }],
      ["react", { r: 0 }],
    ] as const) {
      expect(await post(b, op, body), op).toMatchObject({ status: 403, body: { error: expect.stringContaining("暂停") } });
    }
    expect((await post(b, "later", { invite: await inviteOf(b) })).status).toBe(200);
  });

  it("all end when 听歌 is paused in the 管理台 or the site goes gray, and none open meanwhile", async () => {
    const { host, b } = await cast();
    const owner = await account("owner@example.com");
    const one = await opened(host, b);
    await goIn(b);
    const bHeard = hear(b);
    await setListen(owner.id, { paused: true });
    expect(await endAllRooms("admin")).toBe(1);
    expect(toldOf(bHeard, "end")).toEqual([{ t: "end", room: one.id, why: "admin" }]);
    expect(await post(host, "open", { song: "s1" })).toMatchObject({ status: 503 });
    await setListen(owner.id, { paused: false });

    const two = await opened(host, b);
    await setGray(owner.id, Date.now() + 86_400_000);
    expect(await post(host, "open", { song: "s1" })).toMatchObject({ status: 403 });
    expect(await post(b, "join", { invite: await inviteOf(b) })).toMatchObject({ status: 403 });
    // the sweep ends what is left, as the 管理台 did at once
    expect(await sweepRooms()).toBe(1);
    expect(await roomRow(two.id)).toMatchObject({ endReason: "gray" });
  });

  it("end the host's room when TA deletes the account, telling everyone in it", async () => {
    const { host, b } = await cast();
    const room = await opened(host, b);
    await goIn(b);
    const bHeard = hear(b);
    const { deleteAccount } = await import("@/lib/server/account");
    await deleteAccount(host);
    expect(toldOf(bHeard, "end")).toEqual([{ t: "end", room: room.id, why: "host" }]);
    expect(await db.select().from(listenRooms)).toEqual([]);
    expect(await roomOf(b)).toBeNull();
  });

  // last: it leaves this process listening to the others
  it("reach the pages on the other processes, in parts that fit a NOTIFY, and hear theirs", async () => {
    vi.stubEnv("LIVE_ACROSS", "1");
    await hearOthers();
    const payloads: string[] = [];
    const sub = await pg.listen("live_nudge", (p) => payloads.push(p));
    try {
      const ids = Array.from({ length: 400 }, () => crypto.randomUUID());
      tellListen(ids, { t: "members", room: "r1" });
      await vi.waitFor(() => expect(payloads.flatMap((p) => (JSON.parse(p) as { ids: string[] }).ids).sort()).toEqual([...ids].sort()));
      expect(payloads.length).toBeGreaterThan(1);
      for (const p of payloads) {
        expect(Buffer.byteLength(p)).toBeLessThanOrEqual(7_500);
        expect(JSON.parse(p)).toMatchObject({ e: "listen", d: { t: "members", room: "r1" } });
      }
      // what another process tells a room reaches a page here
      const someone = { id: crypto.randomUUID() };
      const got = hear(someone);
      await pg.notify("live_nudge", JSON.stringify({ p: "another-process", e: "listen", ids: [someone.id], d: { t: "rx", room: "r1", items: [{ h: 1, r: 0 }] } }));
      await vi.waitFor(() => expect(toldOf(got, "rx")).toEqual([{ t: "rx", room: "r1", items: [{ h: 1, r: 0 }] }]));
    } finally {
      await sub.unlisten();
    }
  });
});

describe("一起听's 人走了", () => {
  /** How long each song lasts: s1, s2, and the r ones of moreSongs */
  const lengthOf = (id: string) => (id === "s1" ? 200 : id === "s2" ? 201 : 100);
  const scheduleOfRow = (r: NonNullable<Awaited<ReturnType<typeof roomRow>>>) => ({ queue: r.queue, idx: r.idx, startedAt: r.startedAt?.getTime() ?? null });

  /** Pages playing along in the room: each plays each of its songs once, as it starts or as they first see it */
  function playing(roomId: string, ...us: User[]) {
    const last = new Map<string, string>();
    return async () => {
      const r = (await roomRow(roomId))!;
      const at = roomAt(scheduleOfRow(r), lengthOf, Date.now());
      if (at.phase !== "playing") return;
      const key = `${r.queue[at.i]}@${at.start}`;
      for (const u of us) {
        if (last.get(u.id) === key) continue;
        last.set(u.id, key);
        const res = await post(u, "play", { song: r.queue[at.i], at: Math.max(0, Math.floor(at.offset)), next: r.queue[at.i + 1] });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }
    };
  }

  /** The main process's sweep each minute from `from` on, and at `to` last, the pages given doing their part first; how many rooms it ended */
  async function minutes(from: number, to: number, pages?: () => Promise<void>) {
    let ended = 0;
    for (let t = from; ; t = Math.min(t + 60_000, to)) {
      vi.setSystemTime(t);
      await pages?.();
      ended += await sweepRooms(t);
      if (t >= to) return ended;
    }
  }

  /** The host and B and C in a room the host just started, with songs to go on to; when it started */
  async function playingRoom() {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b, c } = await cast();
    await moreSongs(12);
    const room = await opened(host, b, c);
    await goIn(b);
    await goIn(c);
    expect((await post(host, "queue", { start: true })).status).toBe(200);
    return { host, b, c, room, t0: Date.now() };
  }

  it("take out one who neither plays its songs nor does anything in it 10 minutes as it plays, told so alone; never one playing along", async () => {
    const { host, b, c, room, t0 } = await playingRoom();
    const bHeard = hear(b);
    const cHeard = hear(c);
    // the host and B play along, song after song; C paused at once (a pause asks nothing of the server)
    const along = playing(room.id, host, b);
    expect(await minutes(t0, t0 + IDLE_MS - 1_000, along)).toBe(0);
    expect(await inNow(room.id)).toHaveLength(3);
    expect(toldOf(cHeard, "you")).toEqual([]);
    // 10 minutes on: C is out, told so alone; the others told who is in it changed, and see TA 走了
    expect(await minutes(t0 + IDLE_MS + 1_000, t0 + IDLE_MS + 1_000, along)).toBe(0);
    expect(new Set(await inNow(room.id))).toEqual(new Set([host.id, b.id]));
    expect(toldOf(cHeard, "you")).toEqual([{ t: "you", room: room.id, why: "idle" }]);
    expect(toldOf(bHeard, "members")).toHaveLength(1);
    expect(toldOf(bHeard, "you")).toEqual([]);
    expect((await roomOf(host))!.members.map((m) => m.state)).toEqual(["in", "in", "left"]);
    // C's page, asleep as it was told, asks again naming the room it was in: out for doing nothing there
    expect((await post(c, "room", { was: room.id })).body).toEqual({ room: null, out: "idle", now: Date.now() });
    expect((await post(c, "room")).body).toEqual({ room: null, now: Date.now() });
    // in again at the invitation, still good: as anyone coming in, the room going on
    await goIn(c);
    expect((await post(c, "room", { was: room.id })).body!.room).toMatchObject({ id: room.id });
    // the two playing along all the while: in, long after
    expect(await minutes(t0 + IDLE_MS + 60_000, t0 + 3 * IDLE_MS, playing(room.id, host, b, c))).toBe(0);
    expect(await inNow(room.id)).toHaveLength(3);
    expect(await roomRow(room.id)).toMatchObject({ endedAt: null });
  });

  it("keep one paused who does anything in it; count a pause from the end of the song paused; reading the room again is nothing", async () => {
    const { host, b, c, room, t0 } = await playingRoom();
    const along = playing(room.id, host);
    // B and C play s1 (200 s) from its start, and pause it at once
    await playing(room.id, b, c)();
    const s1End = (await roomRow(room.id))!.startedAt!.getTime() + 200_000;
    // C's page reads the room again now and then, by itself; B says a 短评 8 minutes on
    expect(await minutes(t0, t0 + 8 * 60_000, async () => void (await post(c, "room")))).toBe(0);
    expect((await post(b, "react", { r: 0 })).status).toBe(200);
    const said = Date.now();
    // 10 minutes after s1 ended, not after the pause: C out, B in
    expect(await minutes(t0 + 9 * 60_000, s1End + IDLE_MS - 61_000, along)).toBe(0);
    expect(await inNow(room.id)).toContain(c.id);
    await minutes(s1End + IDLE_MS + 1_000, s1End + IDLE_MS + 1_000, along);
    expect(await inNow(room.id)).not.toContain(c.id);
    expect(await inNow(room.id)).toContain(b.id);
    // B, 10 minutes after TA said anything
    await minutes(s1End + IDLE_MS + 60_000, said + IDLE_MS - 1_000, along);
    expect(await inNow(room.id)).toContain(b.id);
    await minutes(said + IDLE_MS + 1_000, said + IDLE_MS + 1_000, along);
    expect(await inNow(room.id)).toEqual([host.id]);
  });

  it("keep a host who does nothing in it 10 minutes as it plays: TA's room goes on, TA in it", async () => {
    const { host, b, c, room, t0 } = await playingRoom();
    const hostHeard = hear(host);
    // B and C play along; the host paused at once
    const along = playing(room.id, b, c);
    expect(await minutes(t0, t0 + 2 * IDLE_MS, along)).toBe(0);
    expect(new Set(await inNow(room.id))).toEqual(new Set([host.id, b.id, c.id]));
    expect(await roomRow(room.id)).toMatchObject({ endedAt: null });
    expect(toldOf(hostHeard, "you")).toEqual([]);
  });

  it("take nobody out before the host starts it; starting it gives everyone in it 10 minutes from then", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { host, b } = await cast();
    await moreSongs(12);
    const room = await opened(host, b);
    await goIn(b);
    const t0 = Date.now();
    // waiting for 开始 20 minutes, nobody doing anything: nobody out
    expect(await minutes(t0, t0 + 2 * IDLE_MS)).toBe(0);
    expect(await inNow(room.id)).toHaveLength(2);
    // started: B, in for 20 minutes and yet to play, has 10 minutes from now
    expect((await post(host, "queue", { start: true })).status).toBe(200);
    const along = playing(room.id, host);
    expect(await minutes(t0 + 2 * IDLE_MS, t0 + 3 * IDLE_MS - 1_000, along)).toBe(0);
    expect(await inNow(room.id)).toContain(b.id);
    await minutes(t0 + 3 * IDLE_MS + 1_000, t0 + 3 * IDLE_MS + 1_000, along);
    expect(await inNow(room.id)).toEqual([host.id]);
  });
});
