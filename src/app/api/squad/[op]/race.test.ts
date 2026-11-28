import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import type { LobbyMode } from "@/lib/squadMode";
import {
  RACE_CROWN_MS,
  RACE_LATE_MS,
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
import { forgetDanceBeats, openMode, runRace, settleRaceDue, settleRaceRoom, startMatch, sweepModes } from "@/lib/server/squadModes";
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
const dataOf = async (roomId: string) => (await db.select({ d: squadRooms.modeData }).from(squadRooms).where(eq(squadRooms.id, roomId)))[0].d as RaceData;
const setData = (roomId: string, d: RaceData) => db.update(squadRooms).set({ modeData: d }).where(eq(squadRooms.id, roomId));
/** Always the first: the first look, the seed 0 */
const first = () => 0;
const handleOf = (room: SquadRoom, name: string) => room.members.find((m) => m.name === name)!.h;
const headOf = async (u: Pick<User, "id">, name: string) => (await viewOf(u)).members.find((m) => m.name === name)!.head;
/** A race picked by its initiator, those given ready, and started (the seed 0) */
async function play(u: Pick<User, "id">, ready: Pick<User, "id">[] = []) {
  await openMode(u, { kind: "race" }, clock, first);
  for (const r of ready) expect((await post(r, "modein", { in: true })).status).toBe(200);
  await startMatch(u, clock, first);
}
/** 加油 at full rate from the start to its end: two every quarter second */
const flatOut = (start: number) => Array.from({ length: 120 }, (_, k): [number, number] => [start + k * 250, 2]);

describe("企鹅物流急件赛", () => {
  it("lines up its initiator, those ready as they readied, the room's 人机 and its own, with its obstacles and seed; starts three seconds on", async () => {
    const { host, a, b } = await cast();
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    await openMode(a, { kind: "race" }, clock, first);
    const v = await viewOf(b);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const bot = v.members.find((m) => m.bot)!.h;
    // waiting for people: no race yet
    expect(v.mode).toMatchObject({ kind: "race", wait: true, by: aH, in: [{ h: aH, combo: 0 }], played: 0 });
    expect(v.mode).not.toHaveProperty("lanes");
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    const t0 = clock + 2_000;
    at(t0);
    await startMatch(a, clock, first);
    const mode = await raceOf(b);
    expect(mode).toMatchObject({ kind: "race", by: aH, begun: t0, played: 0, next: [], start: t0 + RACE_LEAD_MS, seed: 0 });
    expect(mode.in.map((m) => m.h).sort()).toEqual([aH, bH].sort());
    expect(mode.lanes.map((l) => l.h)).toEqual([aH, bH, bot, -100]);
    expect(mode.obs.map((o) => o.k).sort()).toEqual(["bar", "potion", "slug", "water", "water"]);
    expect(mode.until).toBe(t0 + RACE_LEAD_MS + RACE_MAX_MS + RACE_RESULT_MS);
    expect(mode).not.toHaveProperty("end");
    // the host in after its start, even before it runs: no lane, in the next one
    expect((await post(host, "modein", { in: true })).status).toBe(200);
    const later = await raceOf(b);
    expect(later.lanes.map((l) => l.h)).toEqual([aH, bH, bot, -100]);
    expect(later.next).toEqual([1]);
    expect(later.in.map((m) => m.h)).not.toContain(1);
  });

  it("keeps a racer's reports in their lane on the server's clock, tells the room each quarter second how far each is known, refuses the rest", async () => {
    const { host, a, room } = await cast();
    await play(a);
    const aH = handleOf(await viewOf(a), "a");
    const { start } = await raceOf(a);
    expect(await post(a, "run", { taps: [[start, 3]], jumps: [] })).toMatchObject({ status: 409, body: { error: "还没开跑。" } });
    const heard = told(host);
    at(start + 2_500);
    // counts rounded into 1..6; one too long ago (or not yet) taken as now; those before the start dropped
    expect(
      await post(a, "run", {
        taps: [
          [start + 400, 9],
          [start + 600, 0.4],
          [start - 100, 2],
          [start - 9_000, 1],
        ],
        jumps: [start + 500],
      }),
    ).toMatchObject({ status: 200, body: { taps: [[start + 400, 6], [start + 600, 1], [start + 2_500, 1]], jumps: [start + 500] } });
    // a 跳 while still in the air: kept, counting for nothing (the rule's: squadMode.ts raceJumps)
    at(start + 2_600);
    expect((await post(a, "run", { taps: [], jumps: [start + 600] })).status).toBe(200);
    await flushRacesNow();
    expect(heard).toContainEqual({
      t: "race",
      room: room.id,
      items: [
        { h: aH, taps: [[start + 400, 6], [start + 600, 1], [start + 2_500, 1]], jumps: [start + 500], upTo: start + 2_500 },
        { h: aH, taps: [], jumps: [start + 600], upTo: start + 2_600 },
      ],
    });
    const data = await dataOf(room.id);
    expect(data.lanes[0]).toEqual({ h: aH, taps: [[start + 400, 6], [start + 600, 1], [start + 2_500, 1]], jumps: [start + 500, start + 600] });
    const once = { ...data, lanes: data.lanes.map((l, i) => (i ? l : { ...l, jumps: [start + 500] })) };
    expect(raceRun(data, start + 5_000)).toEqual(raceRun(once, start + 5_000));
    // too many at once, or not as asked
    expect(await post(a, "run", { taps: Array.from({ length: 17 }, () => [start + 2_600, 1]), jumps: [] })).toMatchObject({ status: 400 });
    expect(await post(a, "run", { taps: [[start + 2_600, "2"]], jumps: [] })).toMatchObject({ status: 400 });
    expect(await post(a, "run", { taps: [], jumps: Array.from({ length: 9 }, () => start + 2_600) })).toMatchObject({ status: 400 });
    // the host is in the room, not in it
    expect(await post(host, "run", { taps: [[start + 2_600, 1]], jumps: [] })).toMatchObject({ status: 409, body: { error: "先加入才能跑。" } });
  });

  it("comes to the same lane and run with eight counts at once or one at a time, and keeps two racers reporting at once", async () => {
    const { a, b, room } = await cast();
    await play(a, [b]);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const { start } = await raceOf(a);
    at(start + 2_000);
    const cells = Array.from({ length: 8 }, (_, k): [number, number] => [start + k * 250, 1 + (k % 3)]);
    expect((await post(a, "run", { taps: cells, jumps: [start + 300] })).status).toBe(200);
    for (const [k, cell] of cells.entries()) expect((await post(b, "run", { taps: [cell], jumps: k === 1 ? [start + 300] : [] })).status).toBe(200);
    const data = await dataOf(room.id);
    const ia = data.lanes.findIndex((l) => l.h === aH);
    const ib = data.lanes.findIndex((l) => l.h === bH);
    expect(data.lanes[ib].taps).toEqual(data.lanes[ia].taps);
    expect(data.lanes[ib].jumps).toEqual(data.lanes[ia].jumps);
    const run = raceRun(data, start + 6_000);
    expect(run.x[ib]).toBe(run.x[ia]);
    expect(run.x[ia]).toBeGreaterThan(0);
    // both at once: neither lost
    at(start + 2_500);
    await Promise.all([runRace(a, { taps: [[start + 2_250, 2]], jumps: [] }, clock), runRace(b, { taps: [[start + 2_300, 3]], jumps: [start + 2_300] }, clock)]);
    const after = await dataOf(room.id);
    expect(after.lanes[ia].taps.at(-1)).toEqual([start + 2_250, 2]);
    expect(after.lanes[ib].taps.at(-1)).toEqual([start + 2_300, 3]);
    expect(after.lanes[ib].jumps.at(-1)).toBe(start + 2_300);
  });

  it("drops what came after its time, settles at once as one says they are in with everyone in, then refuses more", async () => {
    const { a, b, room } = await cast();
    await play(a, [b]);
    const data = await dataOf(room.id);
    const { start } = data;
    // its time up a moment ago: what came before its end kept, what after dropped; not settled for the last reports yet
    at(start + RACE_MAX_MS + 1_000);
    expect(
      await post(a, "run", {
        taps: [
          [start + RACE_MAX_MS - 250, 2],
          [start + RACE_MAX_MS + 500, 2],
        ],
        jumps: [],
      }),
    ).toMatchObject({ status: 200, body: { taps: [[start + RACE_MAX_MS - 250, 2]] } });
    expect(await settleRaceDue(room.id, clock)).toEqual({ over: false, ended: false });
    expect((await raceOf(a)).end).toBeUndefined();
    at(start + RACE_MAX_MS + RACE_LATE_MS);
    await settleRaceDue(room.id, clock);
    expect((await raceOf(a)).end).toMatchObject({ at: start + RACE_MAX_MS });
    expect(await post(a, "run", { taps: [], jumps: [] })).toMatchObject({ status: 409, body: { error: "这一场已经跑完了。" } });
  });

  it("settles as the last one in says so (in), not before everyone is", async () => {
    const { a, b, room } = await cast();
    await play(a, [b]);
    const data = await dataOf(room.id);
    const { start } = data;
    // a and b flat out from the start, as reported
    for (const i of [0, 1]) data.lanes[i].taps = flatOut(start).filter(([t]) => t < start + RACE_MAX_MS);
    await setData(room.id, data);
    const run = raceRun(data, start + RACE_MAX_MS);
    expect(run.done.every((d) => d !== null)).toBe(true);
    const last = Math.max(...run.done.map((d) => d!));
    // before the last is in: in says nothing yet
    at(start + Math.min(...run.done.map((d) => d!)) + 50);
    expect((await post(a, "run", { taps: [], jumps: [], in: true })).status).toBe(200);
    expect((await raceOf(a)).end).toBeUndefined();
    at(start + last + 50);
    expect((await post(b, "run", { taps: [], jumps: [], in: true })).status).toBe(200);
    expect((await raceOf(a)).end).toMatchObject({ at: start + last, order: raceOrder(run) });
  });

  it("settles the order once all are in, the first wearing the crown with two or more playing, and waits again after the results", async () => {
    const { a, b, room } = await cast();
    await play(a, [b]);
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
    expect(await settleRaceRoom(room.id, clock)).toEqual({ over: false, ended: false });
    expect((await raceOf(a)).end).toBeUndefined();
    const heard = told(b);
    // its time up: the last reports waited for a moment
    at(data.start + RACE_MAX_MS + 100);
    expect(await settleRaceRoom(room.id, clock)).toEqual({ over: false, ended: false });
    at(data.start + RACE_MAX_MS + RACE_LATE_MS);
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
    expect(await post(a, "run", { taps: [[clock, 1]], jumps: [] })).toMatchObject({ status: 409 });
    // its end: waiting again, both still ready, a its initiator, a round played
    at(ended.until + 1);
    expect(await sweepModes(clock)).toBe(1);
    const back = (await viewOf(a)).mode as LobbyMode;
    expect(back).toMatchObject({ kind: "race", wait: true, by: aH, played: 1 });
    expect(back.in.map((m) => m.h)).toEqual([aH, bH]);
    expect(await viewOf(a)).not.toHaveProperty("modeAgain");
    // 再来一局: its initiator starts the next at once
    expect((await post(a, "start")).status).toBe(200);
    expect(((await raceOf(a)) as RaceMode).lanes.map((l) => l.h).slice(0, 2)).toEqual([aH, bH]);
  });

  it("puts one coming in during it into the next round; the results over, it waits again with them ready for 再来一局", async () => {
    const { host, a, b, room } = await cast();
    await play(a);
    const v = await viewOf(a);
    const [aH, bH] = [handleOf(v, "a"), handleOf(v, "b")];
    const data = await dataOf(room.id);
    at(data.start + 1_000);
    // b comes in during it: no lane, in the next one
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await raceOf(b)).lanes.map((l) => l.h)).toEqual([aH, -100, -101, -102]);
    expect((await raceOf(b)).in.map((m) => m.h)).toEqual([aH]);
    expect((await raceOf(b)).next).toEqual([bH]);
    // over and settled: no new race while its results show
    at(data.start + RACE_MAX_MS + 100);
    expect(await settleRaceRoom(room.id, clock)).toEqual({ over: false, ended: false });
    expect(await post(host, "mode", { kind: "race" })).toMatchObject({ status: 409, body: { error: "正在玩一个，玩完才能开下一个。" } });
    // its results over: waiting, a and b ready; only a starts it
    at(data.start + RACE_MAX_MS + RACE_RESULT_MS + 100);
    expect(await settleRaceRoom(room.id, clock)).toEqual({ over: true, ended: true });
    expect(((await viewOf(a)).mode as LobbyMode).in.map((m) => m.h)).toEqual([aH, bH]);
    expect(await post(b, "start")).toMatchObject({ status: 409, body: { error: "只有发起人能点开始。" } });
    expect((await post(a, "start")).status).toBe(200);
    expect(await post(a, "start")).toMatchObject({ status: 409, body: { error: "已经开始了。" } });
    const next = await raceOf(a);
    expect(next.lanes.map((l) => l.h).slice(0, 2)).toEqual([aH, bH]);
    expect(next.played).toBe(1);
  });

  it("puts no crown on one alone, gives a lane back to a 人机 when one goes out before the start, and never lets the crown be thrown", async () => {
    const { a, b, room } = await cast();
    await play(a, [b]);
    const aH = handleOf(await viewOf(a), "a");
    expect((await raceOf(a)).lanes.map((l) => l.h)).toEqual([aH, handleOf(await viewOf(a), "b"), -100, -101]);
    expect((await post(b, "modein", { in: false })).status).toBe(200);
    expect((await raceOf(a)).lanes.map((l) => l.h)).toEqual([aH, -102, -100, -101]);
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
