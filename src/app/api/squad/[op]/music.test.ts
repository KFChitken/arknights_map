import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTED } from "@/lib/dashboard";
import { REQUEST_EVERY_MS, REQUESTS_EACH, type SquadList, type SquadRoom } from "@/lib/squad";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { listen } from "@/lib/server/live";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, listenNow, sessions, siteSettings, songs, squadMembers, squadRequests, squadRooms, statCounts, users } from "@/lib/server/schema";
import { loadSettings, setListen } from "@/lib/server/siteSettings";
import { loadSongs } from "@/lib/server/songs";
import { flushSaysNow, forgetSquad, requestSong } from "@/lib/server/squad";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
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
const KEY = "8di6kbgf9neg7e";

async function player(name: string) {
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
      squadCore: 0,
    })
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
async function post(u: Pick<User, "id">, op: string, body: unknown = {}) {
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
async function list(u: Pick<User, "id">) {
  await signIn(u);
  forgetSquad();
  const res = await GET(new NextRequest("http://localhost/api/squad/list"), { params: Promise.resolve({ op: "list" }) });
  return (await res.json()) as SquadList;
}
const roomOf = (r: { body: Record<string, unknown> | null }) => r.body!.room as SquadRoom;

/** Three songs on one album */
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
    })),
  );
  await loadSongs();
}

/** A host's room with a and b in it, SQUAD and LISTEN on, the songs there */
async function cast() {
  vi.stubEnv("SQUAD", "on");
  vi.stubEnv("LISTEN", "on");
  await seedSongs();
  const host = await player("host");
  const a = await player("a");
  const b = await player("b");
  const room = roomOf(await post(host, "open", { key: KEY, server: "cn", level: 3 }));
  for (const u of [a, b]) expect((await post(u, "join", { room: room.id })).status).toBe(200);
  return { host, a, b, room };
}

/** What reaches a player's open pages (the event stream), from here on */
const offs: (() => void)[] = [];
function hear(u: Pick<User, "id">) {
  const got: Record<string, unknown>[] = [];
  offs.push(listen(u.id, (event, data) => event === "squad" && got.push(JSON.parse(data!) as Record<string, unknown>)));
  return got;
}
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((acc, r) => acc + Number(r.n), 0);
};

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${squadRooms}, ${squadMembers}, ${squadRequests}, ${songs}, ${listenNow}, ${siteSettings}, ${statCounts}, ${admins} cascade`,
  );
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetListeningCount();
  forgetStatCounts();
  forgetHits();
  forgetSquad();
  tokens.clear();
  jar.token = null;
});

afterEach(async () => {
  await flushSaysNow();
  for (const off of offs.splice(0)) off();
  vi.unstubAllEnvs();
});

describe("the host's songs", () => {
  it("are the host's to start, skip, add to and stop; everyone in it is told, and the list shows ♪", async () => {
    const { host, a, room } = await cast();
    expect(room).toMatchObject({ dj: true, queue: [], startedAt: null, listening: 0 });
    const heard = hear(a);
    expect((await post(a, "music", { add: "s1" })).status).toBe(403);
    // added with none playing, then started
    expect(roomOf(await post(host, "music", { add: "s1" }))).toMatchObject({ queue: ["s1"], startedAt: null });
    const started = roomOf(await post(host, "music", { start: true }));
    expect(started.startedAt).not.toBeNull();
    expect(heard).toContainEqual(expect.objectContaining({ t: "songs", room: room.id, how: "start", queue: ["s1"] }));
    expect((await list(a)).rooms[0].music).toBe(true);
    expect(await counted(COUNTED.squadPlay)).toBe(1);
    await post(host, "music", { add: "s2" });
    expect(roomOf(await post(host, "music", { next: true }))).toMatchObject({ queue: ["s2"] });
    const stopped = roomOf(await post(host, "music", { stop: true }));
    expect(stopped).toMatchObject({ queue: ["s2"], startedAt: null });
    expect(heard).toContainEqual(expect.objectContaining({ t: "songs", how: "stop", startedAt: null }));
    expect((await list(a)).rooms[0].music).toBe(false);
    expect((await post(host, "music", { nope: true })).status).toBe(400);
  });

  it("counts for the host how many hear them now, from 听歌's own row of what each plays", async () => {
    const { host, a, b } = await cast();
    await post(host, "music", { add: "s1" });
    await post(host, "music", { start: true });
    const until = new Date(Date.now() + 60_000);
    await db.insert(listenNow).values([
      { userId: a.id, song: "s1", until },
      { userId: b.id, song: "s3", until },
    ]);
    expect(roomOf(await post(host, "room"))).toMatchObject({ listening: 1 });
    expect(roomOf(await post(a, "room"))).toMatchObject({ listening: null });
  });

  it("are not there for one 听歌 is closed to, nor while it is paused", async () => {
    const { host, a } = await cast();
    vi.stubEnv("LISTEN", "admins");
    expect(roomOf(await post(a, "room"))).toMatchObject({ dj: false });
    expect((await post(host, "music", { add: "s1" })).status).toBe(403);
    vi.stubEnv("LISTEN", "on");
    await setListen(host.id, { paused: true });
    expect(roomOf(await post(a, "room"))).toMatchObject({ dj: false });
    expect((await post(host, "music", { add: "s1" })).status).toBe(503);
  });
});

describe("点歌", () => {
  it("goes to the host alone, three waiting each at most, one every 20 s; taken in or dropped unsaid", async () => {
    const { host, a, room } = await cast();
    const hostHeard = hear(host);
    const aHeard = hear(a);
    expect(roomOf(await post(a, "request", { song: "s2" })).requests).toEqual([{ id: expect.any(Number), song: "s2" }]);
    expect(hostHeard).toContainEqual({ t: "room", room: room.id, what: { kind: "ask" } });
    expect(aHeard.filter((x) => (x.what as { kind?: string } | undefined)?.kind === "ask")).toEqual([]);
    expect((await post(a, "request", { song: "s3" })).status).toBe(429);
    expect((await post(host, "request", { song: "s3" })).status).toBe(409);
    const t = Date.now();
    await requestSong(a, { song: "s3" }, t + REQUEST_EVERY_MS);
    await requestSong(a, { song: "s1" }, t + 2 * REQUEST_EVERY_MS);
    await expect(requestSong(a, { song: "s1" }, t + 3 * REQUEST_EVERY_MS)).rejects.toMatchObject({ status: 429 });
    const asked = roomOf(await post(host, "room")).requests;
    expect(asked).toHaveLength(REQUESTS_EACH);
    expect(asked[0]).toMatchObject({ song: "s2", name: "a" });
    // taken: in the songs, no longer asked; dropped: gone, nobody told
    expect(roomOf(await post(host, "take", { id: asked[0].id }))).toMatchObject({ queue: ["s2"] });
    await post(host, "drop", { id: asked[1].id });
    expect(roomOf(await post(a, "room")).requests.map((r) => r.song)).toEqual(["s1"]);
    expect((await post(host, "take", { id: asked[1].id })).status).toBe(409);
    // what one asked for goes with them
    await post(a, "leave");
    expect(await db.select().from(squadRequests)).toEqual([]);
  });
});
