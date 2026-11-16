import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED } from "@/lib/dashboard";
import { AWAY_MS, INVITE_MS, QUEUE_MAX, ROOM_IDLE_MS, ROOM_KEEP_MS, ROOM_LIFE_MS, RX_EVERY_MS, type ListenFriend, type ListenRoom } from "@/lib/listen";
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
import { friendKey } from "@/lib/server/world";
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

  it("invite the same 触须之交 3 times a site day at most, none of the day's touches; never one who is not, blocked, or may not listen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 03:00 in Beijing: the site's day turns at 04:00
    const day = siteDayStart(siteDay(Date.parse("2026-11-16T12:00:00+08:00")));
    vi.setSystemTime(day - 3_600_000);
    const { host, b, c } = await cast();
    const d = await account("d@example.com");
    await befriend(host, d);
    await db.insert(blocks).values({ blockerId: d.id, blockedId: host.id });
    const bKey = friendKey(host.id, b.id);
    for (let i = 0; i < 3; i++) {
      await opened(host, b);
      // an invitation still good is not sent again
      expect((await post(host, "invite", { friends: [bKey] })).body!.sent).toEqual([{ id: bKey, ok: true }]);
      expect((await post(host, "end")).status).toBe(200);
    }
    expect(await db.select().from(listenInvites)).toHaveLength(3);
    const room = await opened(host);
    const sent = (await post(host, "invite", { friends: [bKey, friendKey(host.id, d.id), friendKey(b.id, c.id)] })).body!.sent;
    expect(sent).toEqual([
      { id: bKey, ok: false, why: "今天已经邀请 TA 3 次了，北京时间凌晨 4 点以后再邀请吧。" },
      { id: friendKey(host.id, d.id), ok: false, why: "TA 现在用不了听歌。" },
      { id: friendKey(b.id, c.id), ok: false, why: "你们已经不是触须之交了。" },
    ]);
    // both anonymous, so of one name: in the order of their ids
    expect((await post(host, "friends")).body!.friends).toMatchObject(
      [
        { id: bKey, left: 0, inRoom: false },
        { id: friendKey(host.id, c.id), left: 3, inRoom: false },
      ].sort((x, y) => (x.id < y.id ? -1 : 1)),
    );
    // a new site day
    vi.setSystemTime(day + 60_000);
    forgetHits();
    expect((await post(host, "invite", { friends: [bKey] })).body!.sent).toEqual([{ id: bKey, ok: true }]);
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

    // songs over: 10 minutes on, without a new one
    const three = await opened(host);
    expect((await post(host, "queue", { start: true })).status).toBe(200);
    const end = (await roomRow(three.id))!.startedAt!.getTime() + 200_000;
    expect(await sweepRooms(end + ROOM_IDLE_MS - 60_000)).toBe(0);
    expect(await sweepRooms(end + ROOM_IDLE_MS + 1_000)).toBe(1);
    expect(await roomRow(three.id)).toMatchObject({ endReason: "idle" });

    // never started, the host there all along: 6 hours at most
    const four = await opened(host);
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
    const [state] = toldOf(bHeard, "state");
    expect(state).toEqual({ t: "state", room: room.id, how: "start", queue: ["s1"], idx: 0, startedAt: started.startedAt, version: 2 });
    // starting again changes nothing
    expect((await post(host, "queue", { start: true })).body!.room).toMatchObject({ version: 2 });
    expect(await post(host, "queue", { next: true })).toMatchObject({ status: 409, body: { error: "歌单里没有下一首了，先点「点歌」加几首。" } });
    expect((await post(host, "queue", { add: "s2" })).body!.room).toMatchObject({ queue: ["s1", "s2"], startedAt: started.startedAt, version: 3 });
    const next = (await post(host, "queue", { next: true })).body!.room as ListenRoom;
    expect(next).toMatchObject({ queue: ["s2"], idx: 0, version: 4 });
    expect((await post(host, "queue", { restart: true })).body!.room).toMatchObject({ queue: ["s2"], version: 5 });
    expect(toldOf(bHeard, "state").map((s) => s.how)).toEqual(["start", "add", "next", "restart"]);
    for (const s of toldOf(bHeard, "state")) expect(Object.keys(s).sort()).toEqual(["how", "idx", "queue", "room", "startedAt", "t", "version"]);
    // 30 songs at most
    for (let i = 1; i < QUEUE_MAX; i++) await changeSongs(host, { add: "s1" });
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
    expect(toldOf(bHeard, "state")).toEqual([{ t: "state", room: room.id, how: "add", queue: ["s1", "s2"], idx: 0, startedAt: null, version: 2 }]);

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
    expect(moved).toMatchObject({ queue: ["s1"], idx: 0, startedAt: Date.now() - 120_500, version: 3 });
    // s1 lasts 200 s: past its end is its last second
    expect((await post(host, "queue", { seek: 5_000 })).body!.room).toMatchObject({ startedAt: Date.now() - 199_000, version: 4 });
    const told = toldOf(bHeard, "state");
    expect(told.map((s) => s.how)).toEqual(["start", "seek", "seek"]);
    expect(told[1]).toEqual({ t: "state", room: room.id, how: "seek", queue: ["s1"], idx: 0, startedAt: moved.startedAt, version: 3 });
    // over: nothing to move
    vi.setSystemTime(Date.now() + 2_000);
    expect((await post(host, "queue", { seek: 10 })).body!.room).toMatchObject({ version: 4 });
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
