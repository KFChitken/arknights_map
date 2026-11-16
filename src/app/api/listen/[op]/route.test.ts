import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAV_MAX, LISTEN_GRACE_MS } from "@/lib/listen";
import { loadMods } from "@/lib/server/admins";
import { AGE_CHECK } from "@/lib/server/consent";
import { db } from "@/lib/server/db";
import { forgetListeningCount, listenMe, sweepListening } from "@/lib/server/listen";
import { linkGood } from "@/lib/server/musicLinks";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, listenNow, sessions, siteSettings, songFavourites, songHeard, songPlays, songs, statCounts, users } from "@/lib/server/schema";
import { endGray, loadSettings, setGray, setListen } from "@/lib/server/siteSettings";
import { forgetHot, loadSongs, saveSongHeard, saveSongPlays } from "@/lib/server/songs";
import { forgetStatCounts, saveStatCounts } from "@/lib/server/stats";
import { GET as ok } from "../ok/route";
import { GET, POST } from "./route";

vi.mock("@/lib/server/env", async (original) => ({ ...(await original<typeof import("@/lib/server/env")>()), ADMIN_EMAILS: ["owner@example.com"] }));

// the route reads its cookie as any page does; here, the one this test signed in with
const jar = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "sid" && jar.token ? { name, value: jar.token } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

type Answer = { status: number; body: Record<string, unknown> | null; headers: Headers };

async function call(method: "GET" | "POST", op: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const url = `http://localhost/api/listen/${op}`;
  const req =
    method === "GET"
      ? new NextRequest(url, { headers })
      : new NextRequest(url, {
          method,
          headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", ...headers },
          body: JSON.stringify(body ?? {}),
        });
  const res = await { GET, POST }[method](req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, headers: res.headers };
}

/** What Caddy's forward_auth asks before a song's file goes out */
const asked = (uri: string | null) => ok(new Request("http://localhost/api/listen/ok", { headers: uri === null ? {} : { "x-forwarded-uri": uri } })).status;

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

/** Signed in as the player: the requests from here on are theirs */
async function signIn(userId: string | null) {
  if (!userId) {
    jar.token = null;
    return;
  }
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  jar.token = token;
}

const FILES = ["0000000000000001.m4a", "0000000000000002.m4a", "0000000000000003.m4a"];
/** The second song's smaller copy (省流量) */
const LITE = "00000000000000a2.m4a";

/** Three songs on one album, the last one gone; the second with a smaller copy */
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
      file: FILES[i],
      bytes: 1000,
      liteFile: i === 1 ? LITE : null,
      albumOrder: 0,
      track: i,
      addedAt: new Date(),
      goneAt: i === 2 ? new Date() : null,
    })),
  );
  await loadSongs();
}

const nowRow = async (userId: string) => (await db.select().from(listenNow).where(eq(listenNow.userId, userId)))[0] ?? null;
const counted = async (name: string) => {
  await saveStatCounts();
  const got = await db.select({ n: statCounts.n }).from(statCounts).where(eq(statCounts.name, name));
  return got.reduce((a, r) => a + Number(r.n), 0);
};

beforeEach(async () => {
  // what an earlier test counted and did not save goes before the tables are emptied
  await saveSongPlays();
  forgetHot();
  await db.execute(
    sql`truncate ${users}, ${sessions}, ${songs}, ${songPlays}, ${songHeard}, ${songFavourites}, ${listenNow}, ${siteSettings}, ${statCounts}, ${admins} cascade`,
  );
  await loadSettings();
  await loadMods();
  await loadSongs();
  forgetListeningCount();
  forgetStatCounts();
  forgetHits();
  jar.token = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("听歌's requests, by who may listen", () => {
  it("are answered 404 while LISTEN is off, as if nothing were here, and no song goes out", async () => {
    vi.stubEnv("LISTEN", "off");
    await seedSongs();
    expect((await call("GET", "songs")).status).toBe(404);
    const owner = await account("owner@example.com");
    await signIn(owner.id);
    expect(await call("GET", "songs")).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });
    expect((await call("POST", "play", { song: "s1" })).status).toBe(404);
    expect((await call("POST", "stop")).status).toBe(404);
    expect(await listenMe(owner)).toBeUndefined();
    expect(await nowRow(owner.id)).toBeNull();
    // unset is off
    vi.stubEnv("LISTEN", "");
    expect((await call("GET", "songs")).status).toBe(404);
  });

  it("are only for the 站长 and the admins while LISTEN is admins; anyone else, visitors too, gets 404", async () => {
    vi.stubEnv("LISTEN", "admins");
    await seedSongs();
    expect((await call("GET", "songs")).status).toBe(404);
    const player = await account("someone@example.com");
    await signIn(player.id);
    expect((await call("GET", "songs")).status).toBe(404);
    expect((await call("POST", "play", { song: "s1" })).status).toBe(404);
    expect(await listenMe(player)).toBeUndefined();

    const owner = await account("owner@example.com");
    await signIn(owner.id);
    expect((await call("GET", "songs")).status).toBe(200);
    expect(await listenMe(owner)).toEqual({ paused: false, room: false, roomMax: 20, mode: "admins" });

    const mod = await account("mod@example.com");
    await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小管" });
    await loadMods();
    await signIn(mod.id);
    expect((await call("POST", "play", { song: "s1" })).status).toBe(200);
  });

  it("are for every signed-in player while LISTEN is on, and ask a visitor to sign in", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    expect(await call("GET", "songs")).toMatchObject({ status: 401, body: { error: expect.any(String) } });
    expect((await call("POST", "play", { song: "s1" })).status).toBe(401);
    const player = await account("someone@example.com");
    await signIn(player.id);
    expect((await call("GET", "songs")).status).toBe(200);
    expect(await listenMe(player)).toEqual({ paused: false, room: false, roomMax: 20, mode: "on" });
    // only the ways in that exist, each by its own method
    expect((await call("POST", "songs")).status).toBe(404);
    expect((await call("GET", "play")).status).toBe(404);
    expect((await call("POST", "nothing")).status).toBe(404);
    expect((await call("POST", "toString")).status).toBe(404);
  });

  it("wait while the admin asks the player to say again they are 18 or older", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const player = await account("someone@example.com");
    await db.update(users).set({ ageCheckAt: new Date() }).where(eq(users.id, player.id));
    await signIn(player.id);
    expect(await call("POST", "play", { song: "s1" })).toMatchObject({ status: 428, body: { code: AGE_CHECK } });
    expect(await nowRow(player.id)).toBeNull();
  });
});

describe("听歌's list of songs", () => {
  it("comes with an ETag, so a browser that holds it already gets 304, until it changes", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const player = await account("someone@example.com");
    await signIn(player.id);
    const first = await call("GET", "songs");
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{16}"$/);
    expect(first.body).toEqual({
      albums: [
        {
          id: "a1",
          name: "Album",
          songs: [
            { id: "s1", name: "Song 1", seconds: 200 },
            { id: "s2", name: "Song 2", seconds: 201 },
          ],
        },
      ],
      artists: ["塞壬唱片-MSR"],
      fresh: ["s1", "s2"],
      // Two has a smaller copy: the panel offers 省流量
      lite: true,
    });
    expect(await call("GET", "songs", undefined, { "if-none-match": etag })).toMatchObject({ status: 304, body: null });
    // as a proxy may hand it back: weak, or with what it compressed it with
    expect((await call("GET", "songs", undefined, { "if-none-match": `W/${etag}` })).status).toBe(304);
    expect((await call("GET", "songs", undefined, { "if-none-match": `${etag.slice(0, -1)}-zstd"` })).status).toBe(304);

    await db.update(songs).set({ goneAt: new Date() }).where(eq(songs.id, "s2"));
    await loadSongs();
    const after = await call("GET", "songs", undefined, { "if-none-match": etag });
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
  });
});

describe("a song played", () => {
  it("gives its link and the next one's, and keeps what the player listens to now till it should end and 2 minutes more", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const player = await account("someone@example.com");
    await signIn(player.id);
    const before = Date.now();
    const res = await call("POST", "play", { song: "s1", next: "s2" });
    expect(res).toMatchObject({ status: 200, body: { url: expect.any(String), nextUrl: expect.any(String), until: expect.any(Number), now: expect.any(Number) } });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = res.body as { url: string; nextUrl: string; until: number; now: number };
    expect(b.url.startsWith(`/music/${FILES[0]}?k=`)).toBe(true);
    expect(b.nextUrl.startsWith(`/music/${FILES[1]}?k=`)).toBe(true);
    expect(linkGood(b.url)).toBe(true);
    expect(linkGood(b.nextUrl)).toBe(true);
    // the next one's smaller copy too (省流量); this one has none yet
    expect(b).not.toHaveProperty("lite");
    const nextLite = (res.body as { nextLite: string }).nextLite;
    expect(nextLite.startsWith(`/music/${LITE}?k=`)).toBe(true);
    expect(linkGood(nextLite)).toBe(true);
    expect(b.now).toBeGreaterThanOrEqual(before);
    expect(b.until).toBe(b.now + 200_000 + LISTEN_GRACE_MS);
    expect(await nowRow(player.id)).toEqual({ userId: player.id, song: "s1", roomId: null, until: new Date(b.until), startedAt: expect.any(Date), heard: false });
    // the song plays, counted for the song and for the day, never who
    await saveSongPlays();
    expect(await db.select().from(songPlays)).toEqual([{ song: "s1", plays: 1 }]);
    expect(await counted("listen.play")).toBe(1);

    // going on from 150 seconds in (after a pause, or a link past its time): no new play, and it ends sooner
    const on = (await call("POST", "play", { song: "s1", at: 150 })).body as { until: number; now: number; nextUrl?: string };
    expect(on.until).toBe(on.now + 50_000 + LISTEN_GRACE_MS);
    expect(on.nextUrl).toBeUndefined();
    expect(await counted("listen.play")).toBe(1);

    // the last song of its album: nothing after it; a song gone, or never there, is no song
    const last = (await call("POST", "play", { song: "s2", next: "s3" })).body as { lite?: string };
    expect(last).not.toHaveProperty("nextUrl");
    expect(last).not.toHaveProperty("nextLite");
    expect(last.lite?.startsWith(`/music/${LITE}?k=`)).toBe(true);
    expect(await call("POST", "play", { song: "s3" })).toMatchObject({ status: 404, body: { code: "NO_SONG", error: "这首歌现在放不了，换一首吧。" } });
    expect(await call("POST", "play", { song: "nope" })).toMatchObject({ status: 404, body: { code: "NO_SONG" } });
    expect(await call("POST", "play", { song: ["s1"] })).toMatchObject({ status: 404, body: { code: "NO_SONG" } });
    expect((await nowRow(player.id))?.song).toBe("s2");
  });

  it("is refused while the site is gray, and while 听歌 is paused, when no song goes out either", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const owner = await account("owner@example.com");
    await signIn(owner.id);
    const link = ((await call("POST", "play", { song: "s1" })).body as { url: string }).url;
    expect(asked(link)).toBe(204);

    await setGray(owner.id, Date.now() + 3_600_000);
    expect(await call("POST", "play", { song: "s2" })).toMatchObject({ status: 403, body: { code: "LISTEN_GRAY", error: "全站变灰的时候不放歌。" } });
    await endGray();

    await setListen(owner.id, { paused: true });
    expect(await listenMe(owner)).toEqual({ paused: true, room: false, roomMax: 20, mode: "on" });
    expect(await call("POST", "play", { song: "s2" })).toMatchObject({ status: 503, body: { code: "LISTEN_PAUSED" } });
    expect(asked(link)).toBe(403);
    // stopping still works
    expect((await call("POST", "stop")).status).toBe(200);
    await setListen(owner.id, { paused: false });
    expect(asked(link)).toBe(204);
    expect((await call("POST", "play", { song: "s2" })).status).toBe(200);
  });

  it("is refused to a player not yet listening once as many as the cap are, while those listening play on", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const owner = await account("owner@example.com");
    await setListen(owner.id, { cap: 2 });
    const [a, b, c, d] = await Promise.all(["a", "b", "c", "d"].map((x) => account(`${x}@example.com`)));
    for (const p of [a, b]) {
      await signIn(p.id);
      expect((await call("POST", "play", { song: "s1" })).status).toBe(200);
    }
    await signIn(c.id);
    expect(await call("POST", "play", { song: "s1" })).toMatchObject({ status: 503, body: { code: "LISTEN_FULL", error: "听歌的人有点多，过几分钟再来。" } });
    expect(await nowRow(c.id)).toBeNull();
    expect(await counted("listen.full")).toBe(1);
    // the next song, for one listening already
    await signIn(a.id);
    expect((await call("POST", "play", { song: "s2" })).status).toBe(200);
    // one stops: a place for the next
    await signIn(b.id);
    expect((await call("POST", "stop")).status).toBe(200);
    expect(await nowRow(b.id)).toBeNull();
    await signIn(c.id);
    expect((await call("POST", "play", { song: "s1" })).status).toBe(200);
    await signIn(d.id);
    expect((await call("POST", "play", { song: "s1" })).status).toBe(503);
    // a player whose song should have ended long ago no longer counts, once the count is read again
    await db.update(listenNow).set({ until: new Date(Date.now() - 1000) }).where(eq(listenNow.userId, a.id));
    forgetListeningCount();
    expect((await call("POST", "play", { song: "s1" })).status).toBe(200);
    expect(await counted("listen.full")).toBe(2);
  });
});

describe("a song stopped", () => {
  it("leaves nothing of what the player listened to; a page going keeps it 2 minutes at most, for a page coming straight back", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const player = await account("someone@example.com");
    await signIn(player.id);
    await call("POST", "play", { song: "s1" });
    const t = Date.now();
    expect(await call("POST", "stop", { away: true })).toMatchObject({ status: 200, body: { now: expect.any(Number) } });
    const row = await nowRow(player.id);
    expect(row?.until.getTime()).toBeGreaterThanOrEqual(t + LISTEN_GRACE_MS);
    expect(row?.until.getTime()).toBeLessThanOrEqual(Date.now() + LISTEN_GRACE_MS);
    // a beacon twice changes nothing more
    const until = row!.until.getTime();
    await call("POST", "stop", { away: true });
    expect((await nowRow(player.id))?.until.getTime()).toBeLessThanOrEqual(until + 1000);
    expect((await call("POST", "stop")).status).toBe(200);
    expect(await nowRow(player.id)).toBeNull();
    // nothing to stop is no trouble
    expect((await call("POST", "stop")).status).toBe(200);
  });

  it("is swept away by the main process once past", async () => {
    const [a, b] = await Promise.all(["a", "b"].map((x) => account(`${x}@example.com`)));
    const now = Date.now();
    await db.insert(listenNow).values([
      { userId: a.id, song: "s1", until: new Date(now - 1) },
      { userId: b.id, song: "s1", until: new Date(now + 60_000) },
    ]);
    expect(await sweepListening(now)).toBe(1);
    expect(await nowRow(a.id)).toBeNull();
    expect(await nowRow(b.id)).not.toBeNull();
  });
});

describe("热播榜", () => {
  /** The player began the song this long ago, as the server has it */
  const begunAgo = (userId: string, ms: number) => db.update(listenNow).set({ startedAt: new Date(Date.now() - ms) }).where(eq(listenNow.userId, userId));
  const heard = async (song: string) => (await call("POST", "heard", { song })).body;

  it("counts a song heard once each time it is played, only 30 s after it began (3 s less, for the network), nothing of who", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const player = await account("someone@example.com");
    await signIn(player.id);
    // nothing played: nothing to count
    expect(await heard("s1")).toMatchObject({ counted: false });
    expect(await call("POST", "heard", { song: "s3" })).toMatchObject({ status: 404, body: { code: "NO_SONG" } });
    await call("POST", "play", { song: "s1", next: "s2" });
    expect(await heard("s1")).toMatchObject({ counted: false });
    await begunAgo(player.id, 26_000);
    expect(await heard("s1")).toMatchObject({ counted: false });
    // another song than the one playing
    await begunAgo(player.id, 28_000);
    expect(await heard("s2")).toMatchObject({ counted: false });
    expect(await heard("s1")).toMatchObject({ counted: true });
    expect(await heard("s1")).toMatchObject({ counted: false });
    // gone on with from where it got to: the same time it is played
    await call("POST", "play", { song: "s1", at: 100 });
    expect(await heard("s1")).toMatchObject({ counted: false });
    // from its start again: once more, 30 s on (and a new minute's worth of asking: 10 a minute)
    forgetHits();
    await call("POST", "play", { song: "s1" });
    expect(await heard("s1")).toMatchObject({ counted: false });
    await begunAgo(player.id, 31_000);
    expect(await heard("s1")).toMatchObject({ counted: true });
    // another song from part way (a page opened again) is begun now
    await call("POST", "play", { song: "s2", at: 100 });
    await begunAgo(player.id, 10_000);
    expect(await heard("s2")).toMatchObject({ counted: false });

    await saveSongHeard();
    const rows = await db.select().from(songHeard);
    expect(rows.map((r) => ({ song: r.song, n: r.n }))).toEqual([{ song: "s1", n: 2 }]);
    // the chart: songs and how many times, never who
    const hot = await call("POST", "hot");
    expect(hot).toMatchObject({ status: 200, body: { hot: [{ song: "s1", n: 2 }] } });
    expect(Object.keys((hot.body!.hot as object[])[0]).sort()).toEqual(["n", "song"]);
  });
});

describe("收藏", () => {
  const favs = async () => (await call("POST", "favs")).body!.favs;

  it("keeps each player's songs, the latest first, theirs alone; out of it, any song; gone with the account", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const a = await account("a@example.com");
    const b = await account("b@example.com");
    await signIn(a.id);
    expect(await favs()).toEqual([]);
    expect(await call("POST", "fav", { song: "s1", on: true })).toMatchObject({ status: 200, body: { favs: ["s1"] } });
    expect((await call("POST", "fav", { song: "s2", on: true })).body!.favs).toEqual(["s2", "s1"]);
    // put in again: as it was
    expect((await call("POST", "fav", { song: "s1", on: true })).body!.favs).toEqual(["s2", "s1"]);
    // a song gone from the list is not put in, and is taken out
    expect(await call("POST", "fav", { song: "s3", on: true })).toMatchObject({ status: 404, body: { code: "NO_SONG" } });
    await db.insert(songFavourites).values({ userId: a.id, song: "s3", createdAt: new Date(Date.now() - 60_000) });
    expect(await favs()).toEqual(["s2", "s1", "s3"]);
    expect((await call("POST", "fav", { song: "s3", on: false })).body!.favs).toEqual(["s2", "s1"]);
    expect((await call("POST", "fav", { song: "s2", on: false })).body!.favs).toEqual(["s1"]);
    expect((await call("POST", "fav", { song: "s1" })).status).toBe(400);
    expect((await call("POST", "fav", { song: "../x", on: false })).status).toBe(400);

    await signIn(b.id);
    expect(await favs()).toEqual([]);
    await call("POST", "fav", { song: "s2", on: true });
    await signIn(a.id);
    expect(await favs()).toEqual(["s1"]);

    await db.delete(users).where(eq(users.id, a.id));
    expect((await db.select().from(songFavourites)).map((r) => r.song)).toEqual(["s2"]);
  });

  it("holds 2000 songs at most", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const a = await account("a@example.com");
    await signIn(a.id);
    await db.insert(songFavourites).values(Array.from({ length: FAV_MAX }, (_, i) => ({ userId: a.id, song: `x${i}` })));
    expect(await call("POST", "fav", { song: "s1", on: true })).toMatchObject({ status: 409, body: { error: "收藏最多 2000 首，先取消几首再收藏。" } });
    expect((await call("POST", "fav", { song: "x1", on: false })).status).toBe(200);
    expect((await call("POST", "fav", { song: "s1", on: true })).status).toBe(200);
  });

  it("is only for those who may listen", async () => {
    vi.stubEnv("LISTEN", "admins");
    await seedSongs();
    const a = await account("a@example.com");
    await signIn(a.id);
    for (const op of ["favs", "fav", "hot", "heard"]) expect((await call("POST", op, { song: "s1", on: true })).status).toBe(404);
  });
});

describe("/api/listen/ok, which Caddy asks before a song goes out", () => {
  it("lets out a good link only, while LISTEN is not off", async () => {
    vi.stubEnv("LISTEN", "admins");
    await seedSongs();
    const owner = await account("owner@example.com");
    await signIn(owner.id);
    const link = ((await call("POST", "play", { song: "s1" })).body as { url: string }).url;
    const res = await ok(new Request("http://localhost/api/listen/ok", { headers: { "x-forwarded-uri": link } }));
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(asked(null)).toBe(403);
    expect(asked(`/music/${FILES[0]}`)).toBe(403);
    expect(asked(link.replace(FILES[0], FILES[1]))).toBe(403);
    vi.stubEnv("LISTEN", "off");
    expect(asked(link)).toBe(403);
    vi.stubEnv("LISTEN", "on");
    expect(asked(link)).toBe(204);
  });
});
