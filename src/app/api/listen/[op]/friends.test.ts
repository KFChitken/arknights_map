import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLang } from "@/i18n/server";
import { COUNTED } from "@/lib/dashboard";
import { INVITE_MS, LISTEN_ASK, QUIET_AFTER_LATER_MS, RX_EVERY_MS, RX_PER_SONG, SAID_MIN, type ListenRoom } from "@/lib/listen";
import { EMPTY_PROFILE } from "@/lib/profile";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { friendlyInbox, KEEP_LISTEN_ASK_MS, pruneFriendly } from "@/lib/server/friendly";
import { forgetListeningCount } from "@/lib/server/listen";
import { flushRxNow, listenInbox } from "@/lib/server/listenRooms";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { allRoaches } from "@/lib/server/roachFeed";
import {
  admins,
  blocks,
  friendNotes,
  friendships,
  listenInvites,
  listenMembers,
  listenNow,
  listenRooms,
  roaches,
  sessions,
  siteSettings,
  songPlays,
  songReactions,
  songs,
  squadInvites,
  squadRooms,
  statCounts,
  users,
} from "@/lib/server/schema";
import { loadSettings, setGray, setListen } from "@/lib/server/siteSettings";
import { forgetSaid, loadSongs, saveSongPlays, saveSongReactions } from "@/lib/server/songs";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { friendKey, friends, inbox, saveProfile } from "@/lib/server/world";
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

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

const tokens = new Map<string, string>();
/** A request to /api/listen/<op> as the player */
async function post(u: Pick<User, "id">, op: string, body: unknown = {}): Promise<Answer> {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    // runs out by the database's clock, as the site checks it, not the faked one
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: sql`now() + interval '7 days'` });
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
      name: ["逐星河", "Speed of Light"][i],
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

async function befriend(x: User, y: User) {
  await db.insert(friendships).values(x.id < y.id ? { a: x.id, b: y.id } : { a: y.id, b: x.id });
}

/** What reaches a player's open pages (the event stream), from here on */
const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: string[] = [];
  offs.push(listen(u.id, (event) => got.push(event)));
  return got;
}

/** 桐, who listens, a 触须之交 of 岚's; and 陌生人, who is not one; LISTEN on, the songs there, a main roach each */
async function cast() {
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const tong = await account("tong@example.com");
  const lan = await account("lan@example.com");
  const stranger = await account("stranger@example.com");
  await befriend(tong, lan);
  for (const u of [tong, lan, stranger]) await db.insert(roaches).values({ userId: u.id, slot: 0, lng: 121.47, lat: 31.23 });
  return { tong, lan, stranger };
}

/** How u sees TA in u's list of 触须之交 */
const seen = async (u: User, ta: User) => (await friends(u.id)).find((f) => f.id === friendKey(u.id, ta.id));
const asksTo = async (u: User, now = Date.now()) =>
  (await friendlyInbox((await db.select().from(users).where(eq(users.id, u.id)))[0], new Set(), now)).filter(
    (i): i is Extract<InboxItem, { kind: "listenAsk" }> => i.kind === "listenAsk",
  );
const invitesTo = async (u: User, now = Date.now()) =>
  (await listenInbox(u.id, new Set(), now)).filter((i): i is Extract<InboxItem, { kind: "listenInvite" }> => i.kind === "listenInvite");
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((a, r) => a + Number(r.n), 0);
};

beforeEach(async () => {
  await saveSongPlays();
  await saveSongReactions();
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${songs}, ${songPlays}, ${songReactions}, ${listenNow}, ${listenRooms}, ${listenMembers}, ${listenInvites}, ${friendships}, ${friendNotes}, ${roaches}, ${blocks}, ${siteSettings}, ${statCounts}, ${admins} cascade`,
  );
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetListeningCount();
  forgetStatCounts();
  forgetHits();
  forgetSaid();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushRxNow();
  for (const off of offs.splice(0)) off();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("在听", () => {
  it("shows a 触须之交 what TA listens to while TA plays it, with nothing of it for anyone else", async () => {
    const { tong, lan, stranger } = await cast();
    expect((await seen(lan, tong))?.listening).toBeUndefined();
    expect((await post(tong, "play", { song: "s1" })).status).toBe(200);
    expect((await seen(lan, tong))?.listening).toEqual({ song: "s1", name: "逐星河", asked: false });
    // TA's own list, the stranger's and the map's shared roaches say nothing of it
    expect((await seen(tong, lan))?.listening).toBeUndefined();
    expect((await friends(stranger.id)).some((f) => f.listening)).toBe(false);
    expect(JSON.stringify(await allRoaches())).not.toMatch(/s1|逐星河|listen/);
    // stopped: gone at once
    await post(tong, "stop");
    expect((await seen(lan, tong))?.listening).toBeUndefined();
    // a row that ran out says nothing, before the sweep takes it
    await post(tong, "play", { song: "s2" });
    await db.update(listenNow).set({ until: new Date(Date.now() - 1000) }).where(eq(listenNow.userId, tong.id));
    expect((await seen(lan, tong))?.listening).toBeUndefined();
  });

  it("is kept from 触须之交 by TA's 让触须之交看到我在听什么, off, and goes while 听歌 is closed to either, paused or gray", async () => {
    const { tong, lan } = await cast();
    const owner = await account("owner@example.com");
    await post(tong, "play", { song: "s1" });
    await saveProfile(tong.id, { ...EMPTY_PROFILE, showListening: false });
    expect((await db.select({ on: users.showListening }).from(users).where(eq(users.id, tong.id)))[0].on).toBe(false);
    expect((await seen(lan, tong))?.listening).toBeUndefined();
    expect(await post(lan, "ask", { friend: friendKey(lan.id, tong.id) })).toMatchObject({ status: 409, body: { error: "TA 现在没在听歌了。" } });
    await saveProfile(tong.id, { ...EMPTY_PROFILE, showListening: true });
    expect((await seen(lan, tong))?.listening).toMatchObject({ song: "s1" });
    // only the 站长 and the admins listen: neither of them is one
    vi.stubEnv("LISTEN", "admins");
    expect((await seen(lan, tong))?.listening).toBeUndefined();
    vi.stubEnv("LISTEN", "on");
    await setListen(owner.id, { paused: true });
    expect((await seen(lan, tong))?.listening).toBeUndefined();
    await setListen(owner.id, { paused: false });
    await setGray(owner.id, Date.now() + 3_600_000);
    expect((await seen(lan, tong))?.listening).toBeUndefined();
  });
});

describe("想一起听", () => {
  it("asks TA once a site day, in TA's 消息, and TA's 一起听 opens a room with TA's song and invites the one who asked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 18:00 in Beijing: the site day turns at 04:00
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    const { tong, lan, stranger } = await cast();
    await post(tong, "play", { song: "s1" });
    const heard = hear(tong);
    const key = friendKey(lan.id, tong.id);
    expect(await post(stranger, "ask", { friend: friendKey(stranger.id, tong.id) })).toMatchObject({ status: 404 });
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 200 });
    expect(heard).toContain("inbox");
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 409, body: { error: "今天已经请过 TA 了，北京时间凌晨 4 点以后再请吧。" } });
    expect((await seen(lan, tong))?.listening).toEqual({ song: "s1", name: "逐星河", asked: true });
    expect(await counted(COUNTED.listenAsk)).toBe(1);
    const [ask] = await asksTo(tong);
    expect(ask).toMatchObject({ id: expect.stringMatching(/^c:/), song: "逐星河", state: "open", replied: false, seen: false, friendId: friendKey(tong.id, lan.id) });
    // nothing of it to anyone else, and not one of the day's invitations
    expect(await asksTo(lan)).toEqual([]);
    expect(await invitesTo(lan)).toEqual([]);

    const res = await post(tong, "askOk", { item: ask.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const room = res.body!.room as ListenRoom;
    expect(room).toMatchObject({ host: true, queue: ["s1"] });
    expect(res.body!.sent).toEqual([{ id: friendKey(tong.id, lan.id), ok: true }]);
    const [invite] = await invitesTo(lan);
    expect(invite).toMatchObject({ state: "open", song: "逐星河", friendId: key });
    expect((await asksTo(tong))[0]).toMatchObject({ state: "done", replied: true });
    // again: the room as it is, nobody invited twice
    const again = await post(tong, "askOk", { item: ask.id });
    expect(again).toMatchObject({ status: 200, body: { sent: [] } });
    expect((again.body!.room as ListenRoom).id).toBe(room.id);
    expect(await invitesTo(lan)).toHaveLength(1);
    // and the one who asked goes in at it as at any other
    expect((await post(lan, "join", { invite: invite.id.slice(3) })).status).toBe(200);
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 409 });

    // the next site day: once more, and yesterday's is over
    await post(lan, "leave");
    await post(tong, "end");
    vi.setSystemTime(new Date("2026-11-15T21:00:00Z"));
    await post(tong, "play", { song: "s2" });
    expect((await seen(lan, tong))?.listening).toEqual({ song: "s2", name: "Speed of Light", asked: false });
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 200 });
    expect((await asksTo(tong)).map((a) => [a.song, a.state])).toEqual(
      expect.arrayContaining([
        ["逐星河", "done"],
        ["Speed of Light", "open"],
      ]),
    );
  });

  it("is answered into the room TA hosts, coming up as any though TA said 下次吧 to its host; over the next day; never from someone else's room", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T10:00:00Z"));
    const { tong, lan } = await cast();
    const third = await account("third@example.com");
    await befriend(tong, third);
    // 桐 invites 岚, who says 下次吧: 桐's next would go quietly, but never one answering 岚's own 想一起听
    const opened = await post(tong, "open", { song: "s2", invite: [friendKey(tong.id, lan.id)] });
    const roomId = (opened.body!.room as ListenRoom).id;
    vi.setSystemTime(Date.now() + 1000);
    expect((await post(lan, "later", { invite: (await invitesTo(lan))[0].id.slice(3) })).status).toBe(200);
    await post(tong, "play", { song: "s2" });
    await post(lan, "ask", { friend: friendKey(lan.id, tong.id) });
    const [ask] = await asksTo(tong);
    const lanHeard = hear(lan);
    const res = await post(tong, "askOk", { item: ask.id });
    expect(res.body).toMatchObject({ sent: [{ id: friendKey(tong.id, lan.id), ok: true }] });
    expect((res.body!.room as ListenRoom).id).toBe(roomId);
    const open = (await invitesTo(lan)).filter((i) => i.state === "open");
    expect(open).toHaveLength(1);
    // a red dot, and TA's page told
    expect(open[0].seen).toBe(false);
    expect(lanHeard).toContain("inbox");

    // over once its site day is
    await post(tong, "end");
    await post(third, "play", { song: "s1" });
    await post(tong, "ask", { friend: friendKey(tong.id, third.id) });
    const [late] = await asksTo(third);
    vi.setSystemTime(new Date("2026-11-15T21:00:00Z"));
    expect((await asksTo(third))[0]).toMatchObject({ state: "over", replied: true });
    expect(await post(third, "askOk", { item: late.id })).toMatchObject({ status: 410, body: { error: "这条过了一天，已经过期了。想一起听的话，邀请 TA 吧。" } });

    // in someone else's room: out of it first
    await post(third, "play", { song: "s1" });
    await post(tong, "ask", { friend: friendKey(tong.id, third.id) });
    const [today] = (await asksTo(third)).filter((a) => a.state === "open");
    await post(lan, "open", { song: "s1", invite: [] });
    await befriend(lan, third);
    await post(lan, "invite", { friends: [friendKey(lan.id, third.id)] });
    await post(third, "join", { invite: (await invitesTo(third))[0].id.slice(3) });
    expect(await post(third, "askOk", { item: today.id })).toMatchObject({ status: 409, body: { error: "你正在别人的一起听里，先离开那场，再邀请 TA。" } });
    // and only TA's own: nobody else answers it
    expect(await post(lan, "askOk", { item: today.id })).toMatchObject({ status: 404 });
    expect(await post(lan, "askOk", { item: "c:not-an-id" })).toMatchObject({ status: 400 });
  });

  it("goes quietly for 30 minutes from the host TA said 下次吧 to: in 消息 and good to go in at, never pushed, the same to the host", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.parse("2026-11-15T10:00:00Z");
    vi.setSystemTime(t0);
    const { tong, lan } = await cast();
    const third = await account("third@example.com");
    await befriend(third, lan);
    const key = friendKey(tong.id, lan.id);
    // 下次吧 to 桐's 一起卫戍 a minute ago: nothing to 一起听
    const [squad] = await db.insert(squadRooms).values({ hostId: tong.id, server: "cn", level: 3, key: "8di6kbgf9neg7e", endedAt: new Date(t0) }).returning();
    await db.insert(squadInvites).values({ roomId: squad.id, fromUserId: tong.id, toUserId: lan.id, answer: "later", answeredAt: new Date(t0 - 60_000) });
    const lanHeard = hear(lan);
    const pushed = () => lanHeard.filter((e) => e === "inbox").length;
    const latest = async () => (await invitesTo(lan)).sort((x, y) => y.at - x.at)[0];
    const room = (await post(tong, "open", { song: "s1", invite: [key] })).body!.room as ListenRoom;
    expect(pushed()).toBe(1);
    vi.setSystemTime(t0 + 1_000);
    expect((await post(lan, "later", { invite: (await latest()).id.slice(3) })).status).toBe(200);

    // within 30 minutes: sent, but quietly; the host sees it waiting as any
    vi.setSystemTime(t0 + 60_000);
    const res = await post(tong, "invite", { friends: [key] });
    expect(res.body!.sent).toEqual([{ id: key, ok: true }]);
    expect((res.body!.room as ListenRoom).invited.map((i) => i.state)).toEqual(["waiting"]);
    expect(pushed()).toBe(1);
    expect(await latest()).toMatchObject({ state: "open", seen: true });
    expect(await counted(COUNTED.listenInvite)).toBe(2);

    // 下次吧 to the quiet one: 30 minutes from then; another host's comes up as any meanwhile
    const again = t0 + 20 * 60_000;
    vi.setSystemTime(again);
    await post(lan, "later", { invite: (await latest()).id.slice(3) });
    vi.setSystemTime(again + 60_000);
    await post(third, "open", { song: "s2", invite: [friendKey(third.id, lan.id)] });
    expect(pushed()).toBe(2);
    expect(await latest()).toMatchObject({ seen: false });
    // well past the first 下次吧's 30 minutes, within the second's: quiet, and TA goes in at it
    vi.setSystemTime(again + QUIET_AFTER_LATER_MS - 10 * 60_000);
    await post(tong, "invite", { friends: [key] });
    expect(pushed()).toBe(2);
    const quiet = await latest();
    expect(quiet).toMatchObject({ seen: true, state: "open" });
    const joined = await post(lan, "join", { invite: quiet.id.slice(3) });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect((joined.body!.room as ListenRoom).id).toBe(room.id);
    expect((await post(lan, "leave")).status).toBe(200);

    // past those 30 minutes: as any again
    vi.setSystemTime(again + QUIET_AFTER_LATER_MS + 1_000);
    await post(tong, "invite", { friends: [key] });
    expect(pushed()).toBe(3);
    expect(await latest()).toMatchObject({ seen: false });
    expect(await counted(COUNTED.listenInvite)).toBe(5);
    expect(QUIET_AFTER_LATER_MS).toBeLessThanOrEqual(INVITE_MS);
  });

  it("and invitations to 一起听 are left out of 消息 on the English site, which has no 一起听", async () => {
    const { tong, lan } = await cast();
    await post(tong, "play", { song: "s1" });
    expect(await post(lan, "ask", { friend: friendKey(lan.id, tong.id) })).toMatchObject({ status: 200 });
    expect((await post(tong, "open", { song: "s1", invite: [friendKey(tong.id, lan.id)] })).status).toBe(200);
    const kinds = async (u: User) => (await inbox(u.id)).map((i) => i.kind);
    expect(await kinds(tong)).toContain("listenAsk");
    expect(await kinds(lan)).toContain("listenInvite");
    await withLang("en", async () => {
      expect(await kinds(tong)).not.toContain("listenAsk");
      expect(await kinds(lan)).not.toContain("listenInvite");
    });
  });

  it("is not for one in the same room already, nor while 互动 is paused, nor when TA stopped", async () => {
    const { tong, lan } = await cast();
    const key = friendKey(lan.id, tong.id);
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 409, body: { error: "TA 现在没在听歌了。", code: "NOT_LISTENING" } });
    await post(tong, "open", { song: "s1", invite: [friendKey(tong.id, lan.id)] });
    await post(tong, "play", { song: "s1" });
    await post(lan, "join", { invite: (await invitesTo(lan))[0].id.slice(3) });
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 409, body: { error: "你们已经在一起听了。" } });
    await post(lan, "leave");
    await db.update(users).set({ suspendedUntil: new Date(Date.now() + 86_400_000) }).where(eq(users.id, lan.id));
    expect(await post(lan, "ask", { friend: key })).toMatchObject({ status: 403, body: { error: expect.stringContaining("暂停") } });
    expect(await db.select().from(friendNotes)).toEqual([]);
  });

  it("goes with its song a little after its day (the privacy page), with the rest of the old notes", async () => {
    const { tong, lan } = await cast();
    const now = Date.now();
    const at = (ms: number) => new Date(now - ms);
    await db.insert(friendNotes).values([
      { fromUserId: lan.id, toUserId: tong.id, kind: LISTEN_ASK, period: "2026-11-11", song: "s1", createdAt: at(KEEP_LISTEN_ASK_MS + 60_000) },
      { fromUserId: lan.id, toUserId: tong.id, kind: LISTEN_ASK, period: "2026-11-13", song: "s1", createdAt: at(KEEP_LISTEN_ASK_MS - 60_000) },
      { fromUserId: lan.id, toUserId: tong.id, kind: "hug", period: "2026-11-11#1", createdAt: at(KEEP_LISTEN_ASK_MS + 60_000) },
    ]);
    await pruneFriendly(at(30 * 86_400_000), now);
    expect((await db.select({ kind: friendNotes.kind, period: friendNotes.period }).from(friendNotes)).sort((x, y) => x.period.localeCompare(y.period))).toEqual([
      { kind: "hug", period: "2026-11-11#1" },
      { kind: LISTEN_ASK, period: "2026-11-13" },
    ]);
  });
});

describe("短评 listening alone", () => {
  it("take the first two rows only, while a song plays, as often as in a room; only how many of each the song got is kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { lan } = await cast();
    expect(await post(lan, "react", { r: 0 })).toMatchObject({ status: 409, body: { error: "先放一首歌，再发短评。", code: "NOT_LISTENING" } });
    await post(lan, "play", { song: "s1" });
    // the room's own four are a room's
    expect(await post(lan, "react", { r: 15 })).toMatchObject({ status: 409, body: { error: "你现在不在一起听里。" } });
    expect((await post(lan, "react", { r: 8 })).body).toMatchObject({ sent: true });
    expect((await post(lan, "react", { r: 8 })).body).toMatchObject({ sent: false });
    for (let i = 1; i < RX_PER_SONG; i++) {
      vi.setSystemTime(Date.now() + RX_EVERY_MS);
      expect((await post(lan, "react", { r: i % 2 ? 0 : 8 })).body, `the ${i + 1}th`).toMatchObject({ sent: true });
    }
    vi.setSystemTime(Date.now() + RX_EVERY_MS);
    expect((await post(lan, "react", { r: 0 })).body).toMatchObject({ sent: false, full: true });
    // another song, another ten
    await post(lan, "play", { song: "s2" });
    vi.setSystemTime(Date.now() + RX_EVERY_MS);
    expect((await post(lan, "react", { r: 3 })).body).toMatchObject({ sent: true });
    expect(await db.select().from(songReactions)).toEqual([]);
    await saveSongReactions();
    const rows = await db.select().from(songReactions).orderBy(songReactions.song, songReactions.phrase);
    expect(rows).toEqual([
      { song: "s1", phrase: 0, n: 5 },
      { song: "s1", phrase: 8, n: 5 },
      { song: "s2", phrase: 3, n: 1 },
    ]);
    // added to what was there
    await post(lan, "play", { song: "s1" });
    vi.setSystemTime(Date.now() + 300_000);
    await post(lan, "play", { song: "s1" });
    expect((await post(lan, "react", { r: 0 })).body).toMatchObject({ sent: true });
    await saveSongReactions();
    expect((await db.select().from(songReactions).where(and(eq(songReactions.song, "s1"), eq(songReactions.phrase, 0))))[0].n).toBe(6);
    expect(await counted(COUNTED.listenRxAlone)).toBe(12);
    expect(await counted(COUNTED.listenRx)).toBe(0);
  });

  it("make 大家都在说 under a song: its three said most, each more than ten times, with each play", async () => {
    const { lan } = await cast();
    await db.insert(songReactions).values([
      { song: "s1", phrase: 8, n: 128 },
      { song: "s1", phrase: 0, n: 52 },
      { song: "s1", phrase: 3, n: SAID_MIN + 3 },
      { song: "s1", phrase: 5, n: SAID_MIN + 1 },
      { song: "s1", phrase: 6, n: SAID_MIN },
      { song: "s2", phrase: 1, n: SAID_MIN },
    ]);
    expect((await post(lan, "play", { song: "s1" })).body!.said).toEqual([
      { r: 8, n: 128 },
      { r: 0, n: 52 },
      { r: 3, n: SAID_MIN + 3 },
    ]);
    expect((await post(lan, "play", { song: "s2" })).body).not.toHaveProperty("said");
    // read once a minute at most
    await db.update(songReactions).set({ n: 500 }).where(and(eq(songReactions.song, "s1"), eq(songReactions.phrase, 6)));
    expect(((await post(lan, "play", { song: "s1" })).body!.said as unknown[])[0]).toEqual({ r: 8, n: 128 });
    forgetSaid();
    expect(((await post(lan, "play", { song: "s1" })).body!.said as unknown[])[0]).toEqual({ r: 6, n: 500 });
  });
});
