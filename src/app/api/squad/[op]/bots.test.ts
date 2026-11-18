import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED } from "@/lib/dashboard";
import { KEEP_MS, PHRASE_ROWS, type SquadList, type SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { block, report } from "@/lib/server/safety";
import { admins, blocks, friendships, reports, sessions, siteSettings, squadBots, squadMembers, squadRooms, statCounts, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { endSquadRoom, flushSaysNow, forgetSquad, squadCalls, squadDesk, sweepSquad } from "@/lib/server/squad";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { friendKey } from "@/lib/server/world";
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
type Answer = { status: number; body: Record<string, unknown> | null };

const KEY = "8di6kbgf9neg7e";
const CARD = { core: 5, strategy: 18, level: 3 };

/** One with a card filled in; a teammate's strategy none (无偏好) unless given, so a round may start */
async function player(name: string, strategy: number | null = null) {
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
      squadCore: CARD.core,
      squadStrategy: strategy,
      squadLevel: CARD.level,
    })
    .returning();
  return u;
}
/** An admin (not the 站长) */
async function mod(name: string) {
  const u = await player(name, CARD.strategy);
  await db.insert(admins).values({ userId: u.id, role: "mod", alias: name });
  await loadMods();
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

async function post(u: Pick<User, "id">, op: string, body: unknown = {}): Promise<Answer> {
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
const roomOf = (a: Answer) => a.body!.room as SquadRoom;
const bot = (u: User, what: string, h?: number) => post(u, "bot", h === undefined ? { do: what } : { do: what, h });

async function roomsOf(u: Pick<User, "id">): Promise<SquadList["rooms"]> {
  await signIn(u);
  forgetSquad();
  const res = await GET(new NextRequest("http://localhost/api/squad/list"), { params: Promise.resolve({ op: "list" }) });
  return ((await res.json()) as SquadList).rooms;
}

async function opened(host: User) {
  const res = await post(host, "open", { key: KEY, server: "cn", level: 3, tags: [2] });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return roomOf(res);
}
async function goIn(u: User, room: SquadRoom) {
  const res = await post(u, "join", { room: room.id });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return roomOf(res);
}
/** A 人机 added: the room as the host sees it, and the one added */
async function added(host: User) {
  const res = await bot(host, "add");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const room = roomOf(res);
  return { room, bot: room.members.filter((m) => m.bot).at(-1)! };
}
const botRows = async (roomId: string) => db.select().from(squadBots).where(eq(squadBots.roomId, roomId));
/** As if the round's state changed long ago (STATE_EVERY_MS) */
const later = (roomId: string) => db.update(squadRooms).set({ stateAt: new Date(Date.now() - 60_000) }).where(eq(squadRooms.id, roomId));
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((a, r) => a + Number(r.n), 0);
};

const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${friendships}, ${blocks}, ${reports}, ${siteSettings}, ${statCounts}, ${admins} cascade`);
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

describe("人机: putting them in", () => {
  it("is for the 站长 and the admins as host alone, while the room waits and has a seat", async () => {
    const owner = await player("owner", CARD.strategy);
    const someone = await player("someone", CARD.strategy);
    const lin = await mod("lin");
    // anyone else hosting: refused, and so is ＋人机 shown to them (staff false)
    const theirs = await opened(someone);
    expect(theirs.staff).toBe(false);
    expect(await bot(someone, "add")).toMatchObject({ status: 403 });
    // the 站长 and an admin, each as host: yes
    const mine = await opened(owner);
    expect(mine.staff).toBe(true);
    expect((await bot(owner, "add")).status).toBe(200);
    const linRoom = await opened(lin);
    expect(linRoom.staff).toBe(true);
    expect((await bot(lin, "add")).status).toBe(200);
    // an admin in someone else's room, not its host: no
    await post(lin, "leave");
    await goIn(lin, theirs);
    expect(await bot(lin, "add")).toMatchObject({ status: 403 });
    // full with them; and not while it plays
    await bot(owner, "add");
    await bot(owner, "add");
    expect(await bot(owner, "add")).toMatchObject({ status: 409 });
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    await bot(owner, "kick", -1);
    expect(await bot(owner, "add")).toMatchObject({ status: 409 });
    // nothing else asked of it
    expect(await post(owner, "bot", { do: "dance" })).toMatchObject({ status: 400 });
    expect(await post(owner, "bot", { do: "say", h: 2 })).toMatchObject({ status: 400 });
  });

  it("names them by the smallest number free, numbers them below 0 never twice, after everyone, ready, with a strategy nobody has", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    const first = await added(owner);
    expect(first.bot).toMatchObject({ h: -1, name: "人机 1", bot: true, host: false, you: false, friend: false, inGame: true });
    expect(first.bot).not.toHaveProperty("pass");
    const second = await added(owner);
    expect(second.bot).toMatchObject({ h: -2, name: "人机 2" });
    // after the people, in the order they came
    expect(second.room.members.map((m) => m.h)).toEqual([1, 2, -1, -2]);
    // nobody's strategy twice, the host's card's (18) included
    const strategies = second.room.members.map((m) => m.strategy).filter((s) => s !== null);
    expect(strategies).toContain(CARD.strategy);
    expect(new Set(strategies).size).toBe(strategies.length);
    expect(second.room.members.filter((m) => m.bot).every((m) => m.strategy !== null && m.extras.length <= 2)).toBe(true);
    // 人机 1 asked out: its name is free again, its number never
    const out = await bot(owner, "kick", -1);
    expect(roomOf(out).members.map((m) => m.h)).toEqual([1, 2, -2]);
    const third = await added(owner);
    expect(third.bot).toMatchObject({ h: -3, name: "人机 1" });
    // the others see them too, as anyone in it
    const seen = roomOf(await post(a, "room"));
    expect(seen.members.filter((m) => m.bot).map((m) => m.name)).toEqual(["人机 2", "人机 1"]);
    expect(seen.staff).toBe(false);
  });

  it("counts them as anyone in the room: full, 开始游戏 with the host alone and one, strategies that clash", async () => {
    const owner = await player("owner", CARD.strategy);
    const [a, b, c] = await Promise.all([player("a"), player("b"), player("c")]);
    const room = await opened(owner);
    await added(owner);
    // the host and a 人机: enough to start, it is ready
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    await later(room.id);
    expect((await post(owner, "state", { to: "wait" })).status).toBe(200);
    await later(room.id);
    // three people and a 人机: nobody more comes in
    await goIn(a, room);
    await goIn(b, room);
    expect(await post(c, "join", { room: room.id })).toMatchObject({ status: 409 });
    // its 准备 off: the round waits for it
    const unready = await bot(owner, "ready", -1);
    expect(roomOf(unready).members.find((m) => m.h === -1)!.inGame).toBe(false);
    await post(a, "game", { on: true });
    await post(b, "game", { on: true });
    expect(await post(owner, "state", { to: "go" })).toMatchObject({ status: 409 });
    await bot(owner, "ready", -1);
    // a 人机's strategy taken by a teammate: refused at 开始游戏, then marking the round with it
    const strategy = (await botRows(room.id))[0].strategy!;
    await db.update(squadMembers).set({ strategy }).where(eq(squadMembers.userId, b.id));
    expect(await post(owner, "state", { to: "go" })).toMatchObject({ status: 409 });
    await db.update(squadMembers).set({ strategy: null }).where(eq(squadMembers.userId, b.id));
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    await later(room.id);
    expect(await post(a, "prefs", { round: { core: 5, strategy, extras: [] } })).toMatchObject({ status: 409 });
  });

  it("clears its 附加盟约 as the round ends, and has it ready again", async () => {
    const owner = await player("owner", CARD.strategy);
    const room = await opened(owner);
    await added(owner);
    await db.update(squadBots).set({ extras: [1, 2] }).where(eq(squadBots.roomId, room.id));
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    await bot(owner, "ready", -1);
    await later(room.id);
    const back = roomOf(await post(owner, "state", { to: "wait" }));
    expect(back.members.find((m) => m.bot)).toMatchObject({ extras: [], inGame: true });
  });
});

describe("人机: what they do", () => {
  it("say a line of their row to everyone in it, one a few seconds a room, counted nowhere; change pose and strategy as told", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    await added(owner);
    const heard = hear(a);
    expect((await bot(owner, "say", -1)).status).toBe(200);
    expect(await bot(owner, "say", -1)).toMatchObject({ status: 429 });
    await flushSaysNow();
    const said = heard.find((t) => t.t === "say") as { items: { h: number; p: number }[] } | undefined;
    const waiting = PHRASE_ROWS.filter(([row]) => row === "team" || row === "open").flatMap(([, ids]) => ids as readonly number[]);
    expect(said?.items).toHaveLength(1);
    expect(said!.items[0].h).toBe(-1);
    expect(waiting).toContain(said!.items[0].p);
    expect(await counted(COUNTED.squadSay)).toBe(0);
    // while it plays, from 局内
    await post(a, "game", { on: true });
    expect((await post(owner, "state", { to: "go" })).status).toBe(200);
    forgetHits();
    heard.length = 0;
    expect((await bot(owner, "say", -1)).status).toBe(200);
    await flushSaysNow();
    const fight = PHRASE_ROWS.find(([row]) => row === "fight")![1] as readonly number[];
    expect(fight).toContain((heard.find((t) => t.t === "say") as { items: { p: number }[] }).items[0].p);
    // another pose, told as anyone's, or a wave with the lines (whichever comes first)
    const before = (await botRows(room.id))[0];
    for (let i = 0; i < 20 && !heard.some((t) => t.t === "room" && (t.what as { kind?: string })?.kind === "pose"); i++) {
      await bot(owner, "pose", -1);
      await flushSaysNow();
    }
    const posed = (await botRows(room.id))[0].pose;
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "pose", h: -1, pose: posed } });
    expect(heard.filter((t) => t.t === "move")).toEqual(heard.filter((t) => t.t === "move").map(() => ({ t: "move", room: room.id, items: [{ h: -1, move: "wave" }] })));
    // another strategy, nobody's
    const changed = roomOf(await bot(owner, "strategy", -1)).members;
    const s = changed.find((m) => m.h === -1)!.strategy;
    expect(s).not.toBe(before.strategy);
    expect(changed.filter((m) => !m.bot).some((m) => m.strategy === s)).toBe(false);
    expect(heard).toContainEqual(expect.objectContaining({ t: "room", what: expect.objectContaining({ kind: "round", h: -1 }) }));
  });

  it("are asked out from a tile's 请出去 too, and take a teammate's 击掌; never touched, blocked or reported", async () => {
    const owner = await player("owner", CARD.strategy);
    const a = await player("a");
    const room = await opened(owner);
    await goIn(a, room);
    await added(owner);
    // a moves with it as with anyone
    expect(await post(a, "move", { move: "five", to: -1 })).toMatchObject({ status: 200, body: { sent: true } });
    expect(await post(a, "move", { move: "hug", to: -9 })).toMatchObject({ status: 409 });
    // never touched (the page plays it alone), blocked or reported
    expect(await post(a, "touch", { h: -1, bold: false })).toMatchObject({ status: 400 });
    await expect(block(a.id, `sq:${room.id}:-1`)).rejects.toThrow();
    await expect(report(a.id, `sq:${room.id}:-1`, "spam", "")).rejects.toThrow();
    // nobody but the host asks it out, then it is gone
    expect(await post(a, "kick", { h: -1 })).toMatchObject({ status: 403 });
    const out = roomOf(await post(owner, "kick", { h: -1 }));
    expect(out.members.some((m) => m.bot)).toBe(false);
    expect((await botRows(room.id))[0].goneAt).not.toBeNull();
    expect(await bot(owner, "say", -1)).toMatchObject({ status: 409 });
  });
});

describe("人机: the room elsewhere", () => {
  it("is on the list of the 站长 and the admins alone (测试), and of those in it; calls nobody nearby; invites as ever", async () => {
    const owner = await player("owner", CARD.strategy);
    const [a, someone] = await Promise.all([player("a"), player("someone")]);
    const lin = await mod("lin");
    const friend = await player("friend");
    await db.insert(friendships).values(owner.id < friend.id ? { a: owner.id, b: friend.id } : { a: friend.id, b: owner.id });
    const room = await opened(owner);
    await goIn(a, room);
    expect((await roomsOf(someone)).map((r) => r.id)).toEqual([room.id]);
    await added(owner);
    expect(await roomsOf(someone)).toEqual([]);
    const seenByLin = (await roomsOf(lin)).find((r) => r.id === room.id)!;
    expect(seenByLin.test).toBe(true);
    // its seat as a teammate's, never named
    expect(seenByLin.seats.at(-1)).toMatchObject({ role: "mate" });
    expect(seenByLin.seats.at(-1)).not.toHaveProperty("name");
    expect((await roomsOf(a)).find((r) => r.id === room.id)?.test).toBe(true);
    expect(await post(owner, "declare", {})).toMatchObject({ status: 409 });
    const sent = await post(owner, "invite", { friends: [friendKey(owner.id, friend.id)] });
    expect(sent).toMatchObject({ status: 200, body: { sent: [{ ok: true }] } });
    // the invitation's room as TA sees it: the 人机 counted in it
    expect((await squadCalls(friend.id, [room.id])).get(room.id)).toMatchObject({ state: "open", n: 3 });
    await added(owner);
    expect((await squadCalls(friend.id, [room.id])).get(room.id)).toMatchObject({ state: "full", n: 4 });
  });

  it("counts on the 管理台 the rooms with 人机 now, adds nothing to its numbers, and goes with its room", async () => {
    const owner = await player("owner", CARD.strategy);
    const room = await opened(owner);
    expect((await squadDesk()).botRooms).toBe(0);
    await added(owner);
    await added(owner);
    expect((await squadDesk()).botRooms).toBe(1);
    expect(await counted(COUNTED.squadJoin)).toBe(0);
    await endSquadRoom(room.id, "host");
    expect((await squadDesk()).botRooms).toBe(0);
    await sweepSquad(Date.now() + KEEP_MS + 60_000);
    expect(await botRows(room.id)).toEqual([]);
    expect(await db.select().from(squadRooms).where(and(eq(squadRooms.id, room.id), isNull(squadRooms.endedAt)))).toEqual([]);
  });
});
