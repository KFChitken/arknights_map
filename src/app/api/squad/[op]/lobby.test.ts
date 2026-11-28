import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { LOBBY_IDLE_MS, RACE_MAX_MS, RACE_RESULT_MS, type LobbyMode, type RaceData, type RaceMode } from "@/lib/squadMode";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { listenInvites, listenMembers, listenNow, listenRooms, sessions, siteSettings, songs, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { answerBotsNow, flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetDanceBeats, openMode, settleRaceRoom, startMatch, sweepModes } from "@/lib/server/squadModes";
import { forgetRace } from "@/lib/server/squadRace";
import { flushRacesNow } from "@/lib/server/squad";
import { POST } from "./route";

// The matches (凯尔希随堂测, W 的礼物, 企鹅物流急件赛) waiting for people on the server: 发起, 准备, 开始, rounds,
// the initiator handed on, gone; 喊一声 and 来一起玩？

// the owner is an admin
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
    // runs out by the database's clock, as the site checks it, not the faked one
    await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId: u.id, expiresAt: sql`now() + interval '7 days'` });
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
const post = (u: Pick<User, "id">, op: string, body: unknown = {}) => ask(POST, "squad", u, op, body);
const viewOf = async (u: Pick<User, "id">) => (await post(u, "room")).body!.room as SquadRoom;

/** Beats every half second from half a second in, for 200 s */
const BEATS = `{"v":1,"bpm":120,"bar":0,"t":"${Array(400).fill("50").join(",")}","e":"${"9".repeat(400)}"}`;
/** Two songs with beats to dance to, one with none (never picked) */
async function seedSongs() {
  await db.insert(songs).values(
    ["s1", "s2", "s3"].map((id, i) => ({
      id,
      game: "arknights",
      name: `Song ${i + 1}`,
      albumId: "a1",
      album: "Album",
      artists: ["塞壬唱片-MSR"],
      seconds: 200,
      file: `000000000000000${i + 1}.m4a`,
      bytes: 1000,
      dance: i === 2 ? '{"v":1,"none":"tempo","s":"9"}' : BEATS,
      albumOrder: 0,
      track: i,
      addedAt: new Date(),
    })),
  );
  await loadSongs();
}

/** The 站长's room with a and b in it, SQUAD and LISTEN on, the songs there */
async function cast() {
  vi.stubEnv("SQUAD", "on");
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const host = await player("owner");
  const a = await player("a");
  const b = await player("b");
  const room = (await post(host, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
  for (const u of [a, b]) expect((await post(u, "join", { room: room.id })).status).toBe(200);
  return { host, a, b, room };
}

const offs: (() => void)[] = [];
function told(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}

let clock = 0;
const at = (ms: number) => {
  clock = ms;
  vi.setSystemTime(new Date(ms));
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(Date.parse("2026-11-20T08:00:00Z"));
  await db.execute(sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadBots}, ${songs}, ${listenNow}, ${listenRooms}, ${listenMembers}, ${listenInvites}, ${siteSettings} cascade`);
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetDanceBeats();
  forgetRace();
  forgetListeningCount();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  forgetRace();
  await flushRacesNow();
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const raceOf = async (u: Pick<User, "id">) => (await viewOf(u)).mode as RaceMode;
const lobbyOf = async (u: Pick<User, "id">) => (await viewOf(u)).mode as LobbyMode;
const dataOf = async (roomId: string) => (await db.select({ d: squadRooms.modeData }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0].d as RaceData;
/** Always the first: the first look, the seed 0 */
const first = () => 0;
const handleOf = (room: SquadRoom, name: string) => room.members.find((m) => m.name === name)!.h;
const ready = (u: Pick<User, "id">, into = true) => post(u, "modein", { in: into });

describe("a match waiting for people", () => {
  it("waits as it is picked: its initiator ready, nobody else, no round; no other mode meanwhile", async () => {
    const { host, a, b, room } = await cast();
    const heard = told(b);
    expect((await post(a, "mode", { kind: "race" })).status).toBe(200);
    const v = await viewOf(b);
    const aH = handleOf(v, "a");
    expect(v.mode).toEqual({ kind: "race", wait: true, by: aH, at: clock, in: [{ h: aH, combo: 0 }], played: 0, endsAt: clock + LOBBY_IDLE_MS, until: clock + LOBBY_IDLE_MS });
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", h: aH, on: true, lobby: "open", mode: "race" } });
    for (const kind of ["quiz", "gift", "race"]) expect(await post(host, "mode", { kind })).toMatchObject({ status: 409, body: { error: "正在玩一个，玩完才能开下一个。" } });
    // nothing of a round to play
    expect(await post(a, "run", { tap: 1 })).toMatchObject({ status: 409, body: { error: "现在没有在玩的。" } });
  });

  it("takes 准备 and 不玩了, each putting its end three minutes on; shouts do not; gone after three minutes with nobody doing anything", async () => {
    const { host, a, b, room } = await cast();
    await openMode(a, { kind: "gift" }, clock, first);
    const [aH, bH] = [handleOf(await viewOf(a), "a"), handleOf(await viewOf(a), "b")];
    at(clock + 60_000);
    const heard = told(host);
    expect((await ready(b)).status).toBe(200);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", h: bH, on: true, lobby: "ready", mode: "gift" } });
    expect(await lobbyOf(a)).toMatchObject({ in: [{ h: aH, combo: 0 }, { h: bH, combo: 0 }], until: clock + LOBBY_IDLE_MS });
    // again: nothing more
    expect((await ready(b)).status).toBe(200);
    at(clock + 60_000);
    expect((await ready(b, false)).status).toBe(200);
    const readyAt = clock;
    expect(await lobbyOf(a)).toMatchObject({ in: [{ h: aH, combo: 0 }], until: readyAt + LOBBY_IDLE_MS });
    // a shout keeps nothing alive
    at(clock + 100_000);
    expect((await post(b, "say", { p: 44 })).body).toMatchObject({ sent: true });
    expect((await lobbyOf(a)).until).toBe(readyAt + LOBBY_IDLE_MS);
    at(readyAt + LOBBY_IDLE_MS - 1);
    expect(await sweepModes(clock)).toBe(0);
    at(readyAt + LOBBY_IDLE_MS);
    expect((await viewOf(a)).mode).toBeNull();
    expect(await sweepModes(clock)).toBe(1);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", on: false, lobby: "idle", mode: "gift" } });
    // anyone may pick one then
    expect((await post(host, "mode", { kind: "race" })).status).toBe(200);
  });

  it("starts only by its initiator while it waits, with those ready; one alone practises with three 人机", async () => {
    const { host, a, b } = await cast();
    expect(await post(a, "start")).toMatchObject({ status: 409, body: { error: "现在没有在玩的。" } });
    await openMode(a, { kind: "race" }, clock, first);
    const aH = handleOf(await viewOf(a), "a");
    expect(await post(b, "start")).toMatchObject({ status: 409, body: { error: "只有发起人能点开始。" } });
    expect(await post(host, "start")).toMatchObject({ status: 409, body: { error: "只有发起人能点开始。" } });
    expect((await post(a, "start")).status).toBe(200);
    const mode = await raceOf(b);
    expect(mode.lanes.map((l) => l.h)).toEqual([aH, -100, -101, -102]);
    expect(mode).toMatchObject({ begun: clock, played: 0, in: [{ h: aH, combo: 0 }], next: [] });
    expect(await post(a, "start")).toMatchObject({ status: 409, body: { error: "已经开始了。" } });
  });

  it("hands it to the one ready first when its initiator goes (the lower number first at the same time), and goes with nobody ready", async () => {
    const { host, a, b, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    // b and the host ready at the same moment: the host (1) before b
    expect((await ready(b)).status).toBe(200);
    expect((await ready(host)).status).toBe(200);
    const heard = told(b);
    expect((await ready(a, false)).status).toBe(200);
    expect((await lobbyOf(b)).by).toBe(1);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", h: aH, by: 1, lobby: "hand", mode: "race" } });
    // the host (its initiator now) goes out: b's
    expect((await ready(host, false)).status).toBe(200);
    expect(await lobbyOf(b)).toMatchObject({ by: bH, in: [{ h: bH, combo: 0 }] });
    // b goes out, nobody ready: gone
    expect((await ready(b, false)).status).toBe(200);
    expect((await viewOf(b)).mode).toBeNull();
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", h: bH, on: false, lobby: "gone", mode: "race" } });
  });

  it("hands it on when its initiator leaves the room, is asked out, or hands the room over and leaves", async () => {
    const { host, a, b, room } = await cast();
    await openMode(a, { kind: "quiz" }, clock, first);
    const [aH, bH] = [handleOf(await viewOf(a), "a"), handleOf(await viewOf(a), "b")];
    expect((await ready(b)).status).toBe(200);
    const heard = told(host);
    expect((await post(a, "leave")).status).toBe(200);
    expect((await lobbyOf(b)).by).toBe(bH);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", h: aH, by: bH, lobby: "hand", mode: "quiz" } });
    // the host readies, b is asked out: the host's
    expect((await ready(host)).status).toBe(200);
    expect((await post(host, "kick", { h: bH })).status).toBe(200);
    expect((await lobbyOf(host)).by).toBe(1);
    // the host hands the room to a newcomer and leaves: nobody ready, it goes
    const c = await player("c");
    expect((await post(c, "join", { room: room.id })).status).toBe(200);
    expect((await post(host, "leave", { to: handleOf(await viewOf(c), "c") })).status).toBe(200);
    expect((await viewOf(c)).mode).toBeNull();
  });

  it("plays its round on when its initiator goes during it, hands it to one in it or asking for the next, and waits again after with those ready", async () => {
    const { host, a, b, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    const [aH, bH] = [handleOf(await viewOf(a), "a"), handleOf(await viewOf(a), "b")];
    expect((await ready(b)).status).toBe(200);
    await startMatch(a, clock, first);
    // the host asks for the next one; a goes to watch: b (ready first) its initiator, the round going on
    expect((await ready(host)).status).toBe(200);
    expect((await ready(a, false)).status).toBe(200);
    const mode = await raceOf(b);
    expect(mode).toMatchObject({ by: bH, next: [1] });
    expect(mode.in.map((m) => m.h)).toEqual([bH]);
    expect(mode.lanes.map((l) => l.h)).toEqual([-102, bH, -100, -101]);
    // its end: b and the host ready, a not
    const data = await dataOf(room.id);
    at(data.start + RACE_MAX_MS + RACE_RESULT_MS + 100);
    expect(await settleRaceRoom(room.id, clock)).toEqual({ over: true, ended: true });
    expect(await lobbyOf(a)).toMatchObject({ by: bH, played: 1, in: [{ h: bH, combo: 0 }, { h: 1, combo: 0 }] });
    void aH;
  });

  it("goes when its round ends with nobody ready, its initiator gone in it", async () => {
    const { a, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    await startMatch(a, clock, first);
    expect((await ready(a, false)).status).toBe(200);
    expect((await raceOf(a)).kind).toBe("race");
    const data = await dataOf(room.id);
    at(data.start + RACE_MAX_MS + RACE_RESULT_MS + 100);
    expect(await sweepModes(clock)).toBe(1);
    expect((await viewOf(a)).mode).toBeNull();
  });
});

describe("喊一声 and 来一起玩？", () => {
  it("are said only while a match waits or plays; 来一起玩？ while the room plays too, to a player alone; a 人机 never answers it", async () => {
    const { host, a, b, room } = await cast();
    const bH = handleOf(await viewOf(a), "b");
    expect(await post(a, "say", { p: 44 })).toMatchObject({ status: 409, body: { error: "现在没有在等人的小游戏。" } });
    expect(await post(a, "say", { p: 45, to: bH })).toMatchObject({ status: 409, body: { error: "现在没有在等人的小游戏。" } });
    expect(await post(a, "say", { p: 44, to: bH })).toMatchObject({ status: 400 });
    expect(await post(a, "say", { p: 45 })).toMatchObject({ status: 400 });
    await openMode(a, { kind: "race" }, clock, first);
    expect((await post(a, "say", { p: 44 })).body).toMatchObject({ sent: true });
    at(clock + 5_000);
    expect((await post(a, "say", { p: 45, to: bH })).body).toMatchObject({ sent: true });
    // the room playing: 来一起玩？ still, the other lines to one not
    await db.update(squadRooms).set({ state: "go" }).where(eq(squadRooms.id, room.id));
    at(clock + 5_000);
    expect((await post(a, "say", { p: 45, to: bH })).body).toMatchObject({ sent: true });
    at(clock + 5_000);
    expect(await post(a, "say", { p: 39, to: bH })).toMatchObject({ status: 409 });
    // a 人机: never asked, never answers
    await db.update(squadRooms).set({ state: "wait" }).where(eq(squadRooms.id, room.id));
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    at(clock + 5_000);
    expect(await post(a, "say", { p: 45, to: -1 })).toMatchObject({ status: 400 });
    await answerBotsNow();
    await flushSaysNow();
    void b;
  });
});
