import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { DANCE_IDLE_MS, DANCE_LEAD_MS, MODE_AGAIN_MS, type DanceSong } from "@/lib/squadMode";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { listenInvites, listenMembers, listenNow, listenRooms, sessions, siteSettings, songs, squadBots, squadMembers, squadRooms, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { flushSaysNow, forgetSquad } from "@/lib/server/squad";
import { forgetDanceBeats, sweepModes } from "@/lib/server/squadModes";
import { POST as LISTEN } from "../../listen/[op]/route";
import { POST } from "./route";

// 玩点什么 and 龙门广场舞 on the server (卫戍碎片时间玩法 ⑥)

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

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
const hear = (u: Pick<User, "id">, op: string, body: unknown = {}) => ask(LISTEN, "listen", u, op, body);
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
  forgetListeningCount();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("玩点什么", () => {
  it("plays one mode at a time, opened by anyone in the room, its opener in it; the others told, joining or only watching", async () => {
    const { host, a, b, room } = await cast();
    const heard = told(b);
    expect((await post(a, "mode", { kind: "chess" })).status).toBe(400);
    expect((await post(a, "mode", { kind: "dance" })).status).toBe(200);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", h: 2, on: true } });
    const mode = (await viewOf(b)).mode!;
    expect(mode).toMatchObject({ kind: "dance", by: 2, at: clock, in: [{ h: 2, combo: 0 }], songAt: clock + DANCE_LEAD_MS, until: clock + DANCE_LEAD_MS + 200_000 });
    expect(["s1", "s2"]).toContain(mode.song);
    expect(mode.name).toMatch(/^Song [12]$/);
    expect(mode.endsAt).toBe(clock + DANCE_IDLE_MS);
    // one at a time
    expect((await post(host, "mode", { kind: "dance" })).status).toBe(409);
    // b joins, and goes back to watching
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    expect((await viewOf(host)).mode!.in.map((m) => m.h)).toEqual([2, 3]);
    expect((await post(b, "modein", { in: false })).status).toBe(200);
    expect((await viewOf(host)).mode!.in.map((m) => m.h)).toEqual([2]);
    // the host starts the round, and ends it: the dance goes on through both, a's combo with it
    expect((await post(b, "modein", { in: true })).status).toBe(200);
    await db.update(squadMembers).set({ inGame: true, modeCombo: 4 }).where(eq(squadMembers.roomId, room.id));
    await db.update(squadRooms).set({ stateAt: new Date(clock - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await post(host, "state", { to: "go" })).status).toBe(200);
    const going = await viewOf(host);
    expect(going.state).toBe("go");
    expect(going.mode).toMatchObject({ kind: "dance", by: 2, in: [{ h: 2, combo: 4 }, { h: 3, combo: 4 }] });
    await db.update(squadRooms).set({ stateAt: new Date(clock - 120_000) }).where(eq(squadRooms.id, room.id));
    expect((await post(host, "state", { to: "wait" })).status).toBe(200);
    expect((await viewOf(host)).mode).toMatchObject({ kind: "dance", in: [{ h: 2, combo: 4 }, { h: 3, combo: 4 }] });
  });

  it("judges 跳 on the server's clock against the song's beats: on one the combo up, off back to 0, taps too close once; the room told", async () => {
    const { a, b, room } = await cast();
    expect((await post(a, "mode", { kind: "dance" })).status).toBe(200);
    const songAt = (await viewOf(a)).mode!.songAt;
    const heard = told(b);
    // the beats are half a second apart from half a second in
    at(songAt + 1000);
    expect((await post(a, "tap")).body).toMatchObject({ ok: true, combo: 1, counted: true });
    at(songAt + 1530);
    expect((await post(a, "tap")).body).toMatchObject({ ok: true, combo: 2 });
    // too soon after: the same, nothing changed
    at(songAt + 1600);
    expect((await post(a, "tap")).body).toMatchObject({ combo: 2, counted: false });
    // off the beat (250 from one)
    at(songAt + 2250);
    expect((await post(a, "tap")).body).toMatchObject({ ok: false, combo: 0 });
    // the page's own time, a little before the server's now: judged at it
    at(songAt + 2620);
    expect((await post(a, "tap", { at: songAt + 2500 })).body).toMatchObject({ ok: true, combo: 1 });
    // one far from now: the server's now instead (2.8 s in: off)
    at(songAt + 2800);
    expect((await post(a, "tap", { at: songAt + 1000 })).body).toMatchObject({ ok: false, combo: 0 });
    await flushSaysNow();
    expect(heard).toContainEqual({ t: "dance", room: room.id, items: [{ h: 2, combo: 0, ok: false, at: songAt + 2800 }] });
    // only those in it dance
    expect((await post(b, "tap")).status).toBe(409);
    // the combos as the room sees them
    at(songAt + 3000);
    await post(a, "tap");
    expect((await viewOf(b)).mode!.in).toEqual([{ h: 2, combo: 1 }]);
  });

  it("ends with its song, or 15 s after the last tap: cleared and told; then its opener waits a minute, the others do not", async () => {
    const { host, a, b, room } = await cast();
    expect((await post(a, "mode", { kind: "dance" })).status).toBe(200);
    const opened = clock;
    const heard = told(b);
    // nobody tapped: over 15 s on
    at(opened + DANCE_IDLE_MS - 1);
    expect(await sweepModes(clock)).toBe(0);
    expect((await viewOf(b)).mode).not.toBeNull();
    at(opened + DANCE_IDLE_MS);
    expect((await viewOf(b)).mode).toBeNull();
    expect(await sweepModes(clock)).toBe(1);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", on: false } });
    // its opener waits a minute from its end
    const r = await post(a, "mode", { kind: "dance" });
    expect(r.status).toBe(429);
    expect(r.body!.error).toBe("刚开过一个，60 秒后才能再开。");
    expect((await viewOf(a)).modeAgain).toBe(opened + DANCE_IDLE_MS + MODE_AGAIN_MS);
    // anyone else need not
    expect((await post(host, "mode", { kind: "dance" })).status).toBe(200);
    // with its song: taps keep it, the song's end ends it (cleared by the next request to it too)
    const { songAt, until } = (await viewOf(host)).mode!;
    for (let t = songAt + 500; t < until; t += 10_000) {
      at(t);
      await post(host, "tap");
    }
    at(until);
    expect((await viewOf(host)).mode).toBeNull();
    at(until + 1000);
    expect((await post(b, "mode", { kind: "dance" })).status).toBe(200);
    expect((await viewOf(b)).mode!.by).toBe(3);
    expect((await viewOf(host)).modeAgain).toBe(until + MODE_AGAIN_MS);
  });

  it("dances to 卫戍的一起听's song from where it is, and gives each the song: its beats to all, its link to one 听歌 is open to", async () => {
    const { host, a, b } = await cast();
    expect((await hear(host, "squad", { song: "s2" })).status).toBe(200);
    // 一起听 playing s2 for 30 s now
    const started = clock - 30_000;
    await db.update(listenRooms).set({ startedAt: new Date(started) });
    expect((await post(a, "mode", { kind: "dance" })).status).toBe(200);
    expect((await viewOf(a)).mode).toMatchObject({ song: "s2", songAt: started, until: started + 200_000 });
    const song = (await post(b, "song")).body as unknown as DanceSong;
    expect(song).toMatchObject({ song: "s2", dance: BEATS });
    expect(song.url).toMatch(/^\/music\//);
    vi.stubEnv("LISTEN", "off");
    const quiet = (await post(b, "song")).body as unknown as DanceSong;
    expect(quiet.dance).toBe(BEATS);
    expect(quiet.url).toBeUndefined();
    vi.stubEnv("LISTEN", "on");
    // a song nearly over is not danced to
    await post(a, "modein", { in: false });
    at(started + 200_000 - 10_000);
    await sweepModes(clock);
    at(clock + 1);
    await db.update(squadRooms).set({ mode: null, modeBy: null, modeAt: null, modeSong: null, modeSongAt: null, modeUntil: null, modeLast: null });
    expect((await post(host, "mode", { kind: "dance" })).body!.error).toBe("一起听的这首快放完了，下一首开始后再开吧。");
  });
});
