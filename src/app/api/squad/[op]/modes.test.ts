import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SquadRoom } from "@/lib/squad";
import { DANCE_LEAD_MS, type SoloDance } from "@/lib/squadMode";
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

// 玩点什么 on the server (卫戍碎片时间玩法 ⑥), and 龙门广场舞's song for one to dance alone

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
  it("opens only the matches; 龙门广场舞 is no mode, and one of before is cleared, never in the way", async () => {
    const { host, a, b, room } = await cast();
    const heard = told(b);
    expect((await post(a, "mode", { kind: "chess" })).status).toBe(400);
    expect((await post(a, "mode", { kind: "dance" })).status).toBe(400);
    // a dance of before, open in the room as the new code comes
    const before = { mode: "dance", modeBy: 2, modeAt: new Date(clock), modeSong: "s1", modeSongAt: new Date(clock + 3_000), modeUntil: new Date(clock + 200_000), modeLast: new Date(clock), modeData: null };
    await db.update(squadRooms).set(before).where(eq(squadRooms.id, room.id));
    await db.update(squadMembers).set({ modeIn: true }).where(eq(squadMembers.roomId, room.id));
    expect((await viewOf(b)).mode).toBeNull();
    expect((await post(b, "modein", { in: true })).status).toBe(409);
    // a match opened over it at once
    expect((await post(host, "mode", { kind: "quiz" })).status).toBe(200);
    expect((await viewOf(b)).mode).toMatchObject({ kind: "quiz", wait: true, by: 1 });
    // one left alone: cleared on the sweep, the room told
    await db.update(squadRooms).set(before).where(eq(squadRooms.id, room.id));
    expect(await sweepModes(clock)).toBe(1);
    expect(heard).toContainEqual({ t: "room", room: room.id, what: { kind: "mode", on: false } });
    expect((await post(a, "mode", { kind: "race" })).status).toBe(200);
  });
});

describe("龙门广场舞, danced alone", () => {
  it("gives a song with beats at random (not the last), from three seconds on, its link to one 听歌 is open to; the room has nothing of it", async () => {
    const { a, b } = await cast();
    const heard = told(b);
    const got = (await post(a, "dance")).body as unknown as SoloDance;
    expect(["s1", "s2"]).toContain(got.song);
    expect(got).toMatchObject({ name: got.song === "s1" ? "Song 1" : "Song 2", seconds: 200, dance: BEATS, songAt: clock + DANCE_LEAD_MS, now: clock });
    expect(got.url).toMatch(/^\/music\//);
    expect(got).not.toHaveProperty("bots");
    for (let i = 0; i < 6; i++) expect(((await post(a, "dance", { not: ["s1"] })).body as unknown as SoloDance).song).toBe("s2");
    expect((await viewOf(b)).mode).toBeNull();
    await flushSaysNow();
    expect(heard).toEqual([]);
    vi.stubEnv("LISTEN", "off");
    const quiet = (await post(a, "dance")).body as unknown as SoloDance;
    expect(quiet.dance).toBe(BEATS);
    expect(quiet.url).toBeUndefined();
  });

  it("dances to 卫戍的一起听's song from where it is while enough of it is left; one alone in the room gets two 人机 beside them", async () => {
    vi.stubEnv("SQUAD", "on");
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const host = await player("owner");
    const room = (await post(host, "open", { key: KEY, server: "cn", level: 3 })).body!.room as SquadRoom;
    const alone = (await post(host, "dance")).body as unknown as SoloDance;
    expect(alone.bots?.map((x) => x.h)).toEqual([-100, -101]);
    // a 人机 of the room's: not alone
    expect((await post(host, "bot", { do: "add" })).status).toBe(200);
    expect((await post(host, "dance")).body).not.toHaveProperty("bots");
    // with a in the room, 卫戍的一起听 playing s2 for 30 s now
    const a = await player("a");
    expect((await post(a, "join", { room: room.id })).status).toBe(200);
    expect((await hear(host, "squad", { song: "s2" })).status).toBe(200);
    const started = clock - 30_000;
    await db.update(listenRooms).set({ startedAt: new Date(started) });
    expect((await post(host, "dance", { not: ["s2"] })).body).toMatchObject({ song: "s2", songAt: started });
    // nearly over: one at random instead
    at(started + 200_000 - 10_000);
    expect((await post(host, "dance", { not: ["s2"] })).body).toMatchObject({ song: "s1", songAt: clock + DANCE_LEAD_MS });
  });

  it("is refused out of a room, and with no song that has beats", async () => {
    const { a } = await cast();
    const out = await player("c");
    expect((await post(out, "dance")).status).toBe(409);
    await db.delete(songs).where(sql`${songs.id} in ('s1', 's2')`);
    await loadSongs();
    forgetDanceBeats();
    expect(await post(a, "dance")).toMatchObject({ status: 409, body: { error: "现在没有能跳的歌。" } });
  });
});
