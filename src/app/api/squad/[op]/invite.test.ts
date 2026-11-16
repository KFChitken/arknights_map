import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED, declName } from "@/lib/dashboard";
import { INVITE_MS, INVITES_PER_DAY } from "@/lib/listen";
import { siteDay, siteDayStart } from "@/lib/siteDay";
import type { SquadFriend, SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import {
  admins,
  blocks,
  declarations,
  declarationSpots,
  friendships,
  roaches,
  sessions,
  siteSettings,
  squadInvites,
  squadMembers,
  squadRooms,
  statCounts,
  users,
} from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { flushSaysNow, forgetSquad, inviteToSquad } from "@/lib/server/squad";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { friendKey, inbox } from "@/lib/server/world";
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
const KEY = "8di6kbgf9neg7e";

/** 人民广场, a place 2 km off, and Beijing */
const HERE = { lng: 121.4737, lat: 31.2304 };
const NEAR = { lng: 121.4737, lat: 31.2484 };
const FAR = { lng: 116.4074, lat: 39.9042 };

/** A player with a name and a 卫戍名片, of no game yet unless some are given */
async function player(name: string, games: string[] = []) {
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
      games,
      squadCore: 0,
    })
    .returning();
  return u;
}
async function befriend(x: User, y: User) {
  await db.insert(friendships).values(x.id < y.id ? { a: x.id, b: y.id } : { a: y.id, b: x.id });
}
/** Their main roach */
async function roachOf(u: User, at: { lng: number; lat: number }) {
  await db.insert(roaches).values({ userId: u.id, slot: 0, lng: at.lng, lat: at.lat });
}

const tokens = new Map<string, string>();
async function post(u: Pick<User, "id">, op: string, body: unknown = {}) {
  let token = tokens.get(u.id);
  if (!token) {
    token = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    tokens.set(u.id, token);
  }
  jar.token = token;
  const req = new NextRequest(`http://localhost/api/squad/${op}`, {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}
const roomOf = (r: { body: Record<string, unknown> | null }) => r.body!.room as SquadRoom;
const open = async (host: User, more: Record<string, unknown> = {}) => roomOf(await post(host, "open", { key: KEY, server: "cn", level: 3, ...more }));

type Invite = Extract<InboxItem, { kind: "squadInvite" }>;
type Call = Extract<InboxItem, { kind: "declaration" }>;
const invitesTo = async (u: User) => (await inbox(u.id)).filter((i): i is Invite => i.kind === "squadInvite");
const callsTo = async (u: User) => (await inbox(u.id)).filter((i): i is Call => i.kind === "declaration");

/** What reaches a player's open pages of 一起卫戍 (the event stream's "squad"), and whether 消息 was nudged */
const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got = { squad: [] as Record<string, unknown>[], inbox: 0 };
  offs.push(
    listen(u.id, (event, data) => {
      if (event === "squad") got.squad.push(JSON.parse(data!) as Record<string, unknown>);
      if (event === "inbox") got.inbox++;
    }),
  );
  return got;
}
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((acc, r) => acc + Number(r.n), 0);
};

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadInvites}, ${declarations}, ${declarationSpots}, ${friendships}, ${blocks}, ${roaches}, ${siteSettings}, ${statCounts}, ${admins} cascade`);
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

describe("invitations to 一起卫戍", () => {
  it("go from anyone in a room to their 触须之交 of 明日方舟, show in 消息 with the room's server, and let TA in past 只给触须之交", async () => {
    const host = await player("host");
    const a = await player("a");
    const b = await player("b", ["arknights"]);
    const c = await player("c", ["endfield"]);
    await befriend(host, a);
    await befriend(a, b);
    await befriend(a, c);
    // b's 资料 names B服: listed last, said so, and may still be invited (another account, perhaps)
    await db.update(users).set({ uidServerArknights: "bili" }).where(eq(users.id, b.id));
    const room = await open(host, { friendsOnly: true });
    expect((await post(a, "join", { room: room.id })).status).toBe(200);
    expect((await post(b, "join", { room: room.id })).status).toBe(403);

    // a's 触须之交 to invite: the host (in it already), then b; c plays 终末地 alone
    const { friends } = (await post(a, "friends")).body as { friends: SquadFriend[] };
    expect(friends.map((f) => f.card.displayName)).toEqual(["host", "b"]);
    expect(friends[0]).toMatchObject({ id: friendKey(a.id, host.id), inRoom: true });
    expect(friends[1]).toMatchObject({ id: friendKey(a.id, b.id), server: "bili", left: INVITES_PER_DAY, inRoom: false, waiting: false });

    const bHeard = hear(b);
    const sent = await post(a, "invite", { friends: [friendKey(a.id, b.id), "not-a-friend"] });
    expect(sent.body!.sent).toEqual([
      { id: friendKey(a.id, b.id), ok: true },
      { id: "not-a-friend", ok: false, why: "你们已经不是触须之交了。" },
    ]);
    expect(roomOf(sent).invited).toEqual([{ card: expect.objectContaining({ displayName: "b" }), state: "waiting" }]);
    expect(bHeard.inbox).toBe(1);
    expect(((await post(a, "friends")).body!.friends as SquadFriend[])[1]).toMatchObject({ waiting: true, left: INVITES_PER_DAY - 1 });
    // the host sees none of a's invitations as theirs
    expect(roomOf(await post(host, "room")).invited).toEqual([]);

    // in b's 消息 (触须之交): who, the room as it is now, good for 30 minutes
    const [invite] = await invitesTo(b);
    expect(invite).toMatchObject({
      id: expect.stringMatching(/^qi:/),
      state: "open",
      seen: false,
      friendId: friendKey(b.id, a.id),
      from: { displayName: "a" },
      call: { state: "open", n: 2, server: "cn", level: 3 },
    });
    expect(invite.until - invite.at).toBe(INVITE_MS);

    // in at it, though the room is only for the host's 触须之交
    const joined = await post(b, "join", { invite: invite.id.slice(3) });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(roomOf(joined).members.map((m) => m.name)).toEqual(["host", "a", "b"]);
    expect(roomOf(await post(a, "room")).invited).toEqual([]);
    expect((await invitesTo(b))[0]).toMatchObject({ state: "in", seen: true, call: { state: "in", n: 3 } });
    expect(await counted(COUNTED.squadInvite)).toBe(1);
    expect(await counted(COUNTED.squadJoin)).toBe(2);

    // full: nobody more is called
    const d = await player("d");
    await befriend(host, d);
    expect((await post(d, "join", { room: room.id })).status).toBe(200);
    expect(await post(a, "invite", { friends: [friendKey(a.id, c.id)] })).toMatchObject({ status: 409, body: { error: "房间满了，不用再叫人了。" } });
  });

  it("lists 触须之交 of one name in the order of their ids, whatever order the database reads them in", async () => {
    const host = await player("host");
    await open(host);
    // all of one name; put in with ids rising and keys falling, so both orders the database may read them in (as put
    // in, or by id) are the list's own backwards
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      let id: string;
      do {
        id = `0000000${i}${crypto.randomUUID().slice(8)}`;
      } while (keys.length && friendKey(host.id, id) > keys[keys.length - 1]);
      keys.push(friendKey(host.id, id));
      const now = new Date();
      const [twin] = await db
        .insert(users)
        .values({
          id,
          email: `twin${i}@example.com`,
          name: "同名",
          anonymous: false,
          ageConfirmedAt: now,
          policyAcceptedAt: now,
          crossBorderAcceptedAt: now,
          publicPlaceAcceptedAt: now,
          squadCore: 0,
        })
        .returning();
      await befriend(host, twin);
    }
    const friends = (await post(host, "friends")).body!.friends as SquadFriend[];
    expect(new Set(friends.map((f) => f.card.displayName)).size).toBe(1);
    expect(friends.map((f) => f.id)).toEqual([...keys].sort());
  });

  it("say 下次吧 to whoever sent it as 没来; three a day each; none to one blocked, nor while it plays", async () => {
    const host = await player("host");
    const b = await player("b");
    const d = await player("d");
    await befriend(host, b);
    await befriend(host, d);
    await db.insert(blocks).values({ blockerId: d.id, blockedId: host.id });
    const room = await open(host);
    const bKey = friendKey(host.id, b.id);
    const dKey = friendKey(host.id, d.id);
    // one who blocked the host, or was blocked, is never invited, and never told why
    expect((await post(host, "invite", { friends: [dKey] })).body!.sent).toEqual([{ id: dKey, ok: false, why: "TA 现在用不了一起卫戍。" }]);

    // now, unless the site day ends within two hours: then an hour into the next, for all four to be of one day
    const now = Date.now();
    const dayEnds = siteDayStart(siteDay(now)) + 86_400_000;
    const t = dayEnds - now > 2 * 3_600_000 ? now : dayEnds + 3_600_000;
    await inviteToSquad(host, { friends: [bKey] }, t);
    // while it is good, another is none
    await inviteToSquad(host, { friends: [bKey] }, t + 1_000);
    expect(await db.select().from(squadInvites)).toHaveLength(1);

    const hostHeard = hear(host);
    const [invite] = await invitesTo(b);
    expect((await post(b, "later", { invite: invite.id.slice(3) })).status).toBe(200);
    expect(hostHeard.squad).toContainEqual({ t: "room", room: room.id });
    expect(roomOf(await post(host, "room")).invited).toEqual([{ card: expect.objectContaining({ displayName: "b" }), state: "missed" }]);
    expect((await invitesTo(b))[0]).toMatchObject({ state: "later", seen: true });
    // someone else's 下次吧 is nothing
    expect((await post(d, "later", { invite: invite.id.slice(3) })).status).toBe(200);

    // after 下次吧 a second may go; a third once that one ran out; not a fourth that day
    expect((await inviteToSquad(host, { friends: [bKey] }, t + 2_000)).sent).toEqual([{ id: bKey, ok: true }]);
    expect((await inviteToSquad(host, { friends: [bKey] }, t + 3_000 + INVITE_MS)).sent).toEqual([{ id: bKey, ok: true }]);
    expect((await inviteToSquad(host, { friends: [bKey] }, t + 4_000 + 2 * INVITE_MS)).sent).toEqual([
      { id: bKey, ok: false, why: "今天已经邀请 TA 3 次了，北京时间凌晨 4 点以后再邀请吧。" },
    ]);

    // playing (开打): nobody is called
    expect((await post(host, "state", { to: "go" })).status).toBe(200);
    expect(await post(host, "invite", { friends: [bKey] })).toMatchObject({ status: 409, body: { error: "房间在「等人」的时候才能叫人。" } });
  });
});

describe("宣言招人", () => {
  it("calls those near the host who may use 一起卫戍, once a room; they go in from 消息", async () => {
    const host = await player("host");
    const b = await player("b", ["arknights"]);
    const c = await player("c", ["endfield"]);
    const far = await player("far");
    await roachOf(host, HERE);
    await roachOf(b, NEAR);
    await roachOf(c, NEAR);
    await roachOf(far, FAR);
    const room = await open(host, { server: "bili", level: 4 });
    const hostHeard = hear(host);
    const res = await post(host, "declare", {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(roomOf(res)).toMatchObject({ declared: true });
    expect(res.body!.reach).toEqual(expect.any(String));
    expect(hostHeard.squad).toContainEqual({ t: "room", room: room.id });
    const [row] = await db.select().from(declarations);
    expect(row).toMatchObject({ senderId: host.id, template: "squad", squadRoomId: room.id, squadCall: "bili:4:3", recipients: 1 });

    // b near hears it, with its room as it is now; c (终末地 alone) and one far do not
    const [call] = await callsTo(b);
    expect(call).toMatchObject({ text: "卫戍协议，启动！还差 3 个，来吗？", squad: { state: "open", n: 1, server: "bili", level: 4 } });
    expect(call.from).toBeFalsy();
    expect(await callsTo(c)).toEqual([]);
    expect(await callsTo(far)).toEqual([]);

    // once a room
    expect(await post(host, "declare", {})).toMatchObject({ status: 409, body: { error: "这个房间已经发过宣言了，一个房间只能发一次。" } });
    expect(await db.select().from(declarations)).toHaveLength(1);

    // in at it from 消息
    const joined = await post(b, "join", { declaration: call.id.slice(2) });
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect((await callsTo(b))[0]).toMatchObject({ squad: { state: "in", n: 2 } });
    expect(await counted(COUNTED.squadJoinDecl)).toBe(1);
    expect(await counted(declName("squad"))).toBe(1);
    // its host's alone
    expect((await post(b, "declare", {})).status).toBe(403);
    // one that is not of a 宣言招人 lets nobody in
    expect((await post(far, "join", { declaration: call.id.slice(2) })).status).toBe(404);
  });

  it("is not for a room only for 触须之交, and one refused leaves the room free to call again", async () => {
    const host = await player("host");
    await roachOf(host, HERE);
    await open(host, { friendsOnly: true });
    expect(await post(host, "declare", {})).toMatchObject({ status: 409, body: { error: "这个房间只给房主的触须之交，不能发宣言招附近的人。" } });

    // no main roach yet: refused as any declaration, and the room may call once one is placed
    const other = await player("other");
    await open(other);
    expect((await post(other, "declare", {})).status).toBe(400);
    expect((await db.select().from(squadRooms).where(eq(squadRooms.hostId, other.id)))[0].declaredAt).toBeNull();
    await roachOf(other, HERE);
    expect((await post(other, "declare", {})).status).toBe(200);
  });
});
