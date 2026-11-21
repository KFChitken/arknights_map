import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import {
  RACE_CROWN_MS,
  RACE_JUMP_MS,
  RACE_LEAD_MS,
  RACE_MAX_MS,
  RACE_RESULT_MS,
  raceOrder,
  raceRun,
  type RaceData,
  type RaceMode,
} from "@/lib/squadMode";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { listenInvites, listenMembers, listenNow, listenRooms, sessions, siteSettings, songs, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetDanceBeats, openMode, settleRaceRoom, sweepModes } from "@/lib/server/squadModes";
import { forgetRace } from "@/lib/server/squadRace";
import { flushRacesNow } from "@/lib/server/squad";
import { POST } from "./route";

// 企鹅物流急件赛 on the server (玩点什么's fourth mode)

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
const dataOf = async (roomId: string) => (await db.select({ d: squadRooms.modeData }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0].d as RaceData;
const setData = (roomId: string, d: RaceData) => db.update(squadRooms).set({ modeData: d }).where(eq(squadRooms.id, roomId));
/** Always the first: the first look, the seed 0 */
const first = () => 0;
const handleOf = (room: SquadRoom, name: string) => room.members.find((m) => m.name === name)!.h;
const headOf = async (u: Pick<User, "id">, name: string) => (await viewOf(u)).members.find((m) => m.name === name)!.head;
/** 加油 at full rate from the start to its end: two every quarter second */
const flatOut = (start: number) => Array.from({ length: 120 }, (_, k): [number, number] => [start + k * 250, 2]);

describe("企鹅物流急件赛", () => {
  it("lines up its opener, the room's 人机 and its own, with its obstacles and seed; starts three seconds on", async () => {
    const { host, a, b } = await cast();
    const t0 = clock;
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    await openMode(a, { kind: "race" }, clock, first);
    const v = await viewOf(b);
    const aH = handleOf(v, "a");
    const bot = v.members.find((m) => m.bot)!.h;
    const mode = v.mode as RaceMode;
    expect(mode).toMatchObject({ kind: "race", by: aH, in: [{ h: aH, combo: 0 }], start: t0 + RACE_LEAD_MS, seed: 0 });
    expect(mode.lanes.map((l) => l.h)).toEqual([aH, bot, -100, -101]);
    expect(mode.obs.map((o) => o.k).sort()).toEqual(["bar", "potion", "slug", "water", "water"]);
    expect(mode.until).toBe(t0 + RACE_LEAD_MS + RACE_MAX_MS + RACE_RESULT_MS);
    expect(mode).not.toHaveProperty("end");
    // b in before it starts: a lane of the mode's own 人机
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await raceOf(b)).lanes.map((l) => l.h)).toEqual([aH, bot, handleOf(v, "b"), -101]);
  });

  it("takes 加油 counts and 跳s from those in it on the server's clock, tells the room each quarter second, refuses the rest", async () => {
    const { host, a, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    const aH = handleOf(await viewOf(a), "a");
    const { start } = await raceOf(a);
    expect(await post(a, "run", { tap: 3 })).toMatchObject({ status: 409, body: { error: "还没开跑。" } });
    const heard = told(host);
    at(start + 500);
    expect(await post(a, "run", { tap: 9, at: start + 400 })).toMatchObject({ status: 200, body: { h: aH, tap: [start + 400, 6] } });
    expect(await post(a, "run", { jump: true })).toMatchObject({ status: 200, body: { jump: start + 500 } });
    at(start + 600);
    expect(await post(a, "run", { jump: true })).toMatchObject({ status: 409, body: { error: "还在空中。" } });
    at(start + 500 + RACE_JUMP_MS);
    expect((await post(a, "run", { jump: true })).status).toBe(200);
    await flushRacesNow();
    expect(heard).toContainEqual({
      t: "race",
      room: room.id,
      items: [
        { h: aH, tap: [start + 400, 6] },
        { h: aH, jump: start + 500 },
        { h: aH, jump: start + 500 + RACE_JUMP_MS },
      ],
    });
    expect((await raceOf(a)).lanes[0]).toEqual({ h: aH, taps: [[start + 400, 6]], jumps: [start + 500, start + 500 + RACE_JUMP_MS] });
    // the host is in the room, not in it
    expect(await post(host, "run", { tap: 1 })).toMatchObject({ status: 409, body: { error: "先加入才能跑。" } });
  });

  it("settles the order once all are in, the first wearing the crown with two or more playing, and ends after the results", async () => {
    const { a, b, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const data = await dataOf(room.id);
    // a flat out, b not at all
    data.lanes[0].taps = flatOut(data.start);
    await setData(room.id, data);
    const run = raceRun(data, data.start + RACE_MAX_MS);
    const order = raceOrder(run);
    // the 人机 and a in by the end, b (lane 1, 7 m/s) not
    expect(data.lanes[1].h).toBe(bH);
    expect(run.done[1]).toBeNull();
    at(data.start + 10_000);
    expect(await settleRaceRoom(room.id, clock)).toEqual({ over: false });
    expect((await raceOf(a)).end).toBeUndefined();
    const heard = told(b);
    at(data.start + RACE_MAX_MS + 100);
    await settleRaceRoom(room.id, clock);
    const ended = await raceOf(a);
    expect(ended.end).toEqual({ at: data.start + RACE_MAX_MS, order, times: run.done, metres: run.x.map((m) => Math.round(m * 10) / 10) });
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "race" } });
    expect(ended.until).toBe(data.start + RACE_MAX_MS + RACE_RESULT_MS);
    const winner = data.lanes[order[0]].h;
    if (winner === aH) expect(await headOf(b, "a")).toEqual({ item: 16, until: data.start + RACE_MAX_MS + RACE_CROWN_MS });
    else expect(await headOf(b, "a")).toBeUndefined();
    expect(await headOf(a, "b")).toBeUndefined();
    // over: no more
    expect(await post(a, "run", { tap: 1 })).toMatchObject({ status: 409 });
    // its end
    at(ended.until + 1);
    expect(await sweepModes(clock)).toBe(1);
    expect((await viewOf(a)).mode).toBeNull();
    expect(await viewOf(a)).not.toHaveProperty("modeAgain");
    // its opener opens the next at once
    expect((await post(a, "mode", { kind: "race" })).status).toBe(200);
    void bH;
  });

  it("puts one coming in during it into the next one, and a settled race gives way to the next at once (再来一场)", async () => {
    const { host, a, b, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const data = await dataOf(room.id);
    at(data.start + 1_000);
    // b comes in during it: no lane, in for the next
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await raceOf(b)).lanes.map((l) => l.h)).toEqual([aH, -100, -101, -102]);
    expect((await raceOf(b)).in.map((m) => m.h).sort()).toEqual([aH, bH].sort());
    // over and settled: the host opens the next while its results show; a (ran it) and b (asked) are in it
    at(data.start + RACE_MAX_MS + 100);
    await settleRaceRoom(room.id, clock);
    expect((await post(host, "mode", { kind: "race" })).status).toBe(200);
    const next = await raceOf(a);
    expect(next.lanes.map((l) => l.h).slice(0, 3).sort()).toEqual([1, aH, bH].sort());
    expect(next.in.map((m) => m.h).sort()).toEqual([1, aH, bH].sort());
    // the next, ended by the sweep: b, who asked during it, is in nothing after it
    const d2 = await dataOf(room.id);
    at(d2.start + RACE_MAX_MS + RACE_RESULT_MS + 100);
    await sweepModes(clock);
    await sweepModes(clock);
    expect((await viewOf(a)).mode).toBeNull();
  });

  it("puts no crown on one alone, gives a lane back to a 人机 when one goes out before the start, and never lets the crown be thrown", async () => {
    const { a, b, room } = await cast();
    await openMode(a, { kind: "race" }, clock, first);
    const aH = handleOf(await viewOf(a), "a");
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await post(b, "modein", { in: false })).status).toBe(200);
    expect((await raceOf(a)).lanes.map((l) => l.h)).toEqual([aH, -100, -101, -102]);
    const data = await dataOf(room.id);
    data.lanes[0].taps = flatOut(data.start);
    await setData(room.id, data);
    // all in: settled just after
    const run = raceRun(data, data.start + RACE_MAX_MS);
    expect(run.done.every((d) => d !== null)).toBe(true);
    at(data.start + Math.max(...run.done.map((d) => d ?? 0)) + 100);
    await settleRaceRoom(room.id, clock);
    expect((await raceOf(a)).end).toBeDefined();
    expect(await headOf(a, "a")).toBeUndefined();
    // 扔东西: the crown is no thing to throw
    expect(await post(a, "throw", { to: handleOf(await viewOf(a), "b"), item: 16 })).toMatchObject({ status: 400 });
  });
});
