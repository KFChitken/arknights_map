import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMods } from "@/lib/server/admins";
import { BEAT_KEY, loadBeatClips } from "@/lib/server/beatClips";
import { db } from "@/lib/server/db";
import { forgetListeningCount } from "@/lib/server/listen";
import { linkGood } from "@/lib/server/musicLinks";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, listenNow, sessions, siteSettings, songPlays, songs, users } from "@/lib/server/schema";
import { endGray, loadSettings, setGray, setListen } from "@/lib/server/siteSettings";
import { loadSongs, saveSongPlays } from "@/lib/server/songs";
import { POST } from "./route";

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
type Clip = { song: string; name: string; album: string; link: string; beat: number; first: number; bar: number; ms: number };

/** POST /api/listen/beat as whoever is signed in */
async function beat(body: unknown = {}): Promise<Answer> {
  const req = new NextRequest("http://localhost/api/listen/beat", {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ op: "beat" }) });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null, headers: res.headers };
}
const clipOf = async (body: unknown = {}) => (await beat(body)).body?.clip as Clip | null;

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

/** Signed in as the player: the requests from here on are theirs */
async function signIn(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  jar.token = token;
}

const f = (n: number) => `${n.toString(16).padStart(16, "0")}.m4a`;

/** Two songs, and a clip of each as the main process reads them in from scripts/beat-music.mjs's list */
async function seed() {
  await db.insert(songs).values(
    [1, 2].map((n) => ({
      id: `s${n}`,
      game: "arknights",
      name: `Song ${n}`,
      albumId: "a1",
      album: "Album",
      artists: ["塞壬唱片-MSR"],
      seconds: 200,
      file: f(n),
      bytes: 1000,
      albumOrder: 0,
      track: n,
      addedAt: new Date(),
    })),
  );
  await loadSongs();
  const clips = [1, 2].map((n) => ({ song: `s${n}`, file: f(100 + n), beat: 480 + n, first: 1500, bar: n, ms: 43_000 }));
  await db.insert(siteSettings).values({ key: BEAT_KEY, value: { clips, readAt: new Date().toISOString() } });
  await loadBeatClips();
}

beforeEach(async () => {
  await saveSongPlays();
  await db.execute(sql`truncate ${users}, ${sessions}, ${songs}, ${songPlays}, ${listenNow}, ${siteSettings}, ${admins} cascade`);
  await loadSettings();
  await loadMods();
  await loadSongs();
  await loadBeatClips();
  forgetListeningCount();
  forgetHits();
  jar.token = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a clip for a round of 325 节拍 (POST /api/listen/beat)", () => {
  it("is for whoever may listen, as LISTEN says: the 站长 and the admins while it is admins; anyone else gets 404", async () => {
    vi.stubEnv("LISTEN", "admins");
    await seed();
    expect((await beat()).status).toBe(404);
    const player = await account("someone@example.com");
    await signIn(player.id);
    expect(await beat()).toMatchObject({ status: 404, body: { error: "没有这个功能。" } });

    const owner = await account("owner@example.com");
    await signIn(owner.id);
    const res = await beat();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const c = res.body!.clip as Clip;
    expect(c).toMatchObject({ song: expect.stringMatching(/^s[12]$/), name: expect.stringMatching(/^Song [12]$/), album: "Album", first: 1500, ms: 43_000 });
    expect(c.link.startsWith(`/music/${f(100 + Number(c.song.slice(1)))}?k=`)).toBe(true);
    expect(linkGood(c.link)).toBe(true);
    expect(res.body!.now).toEqual(expect.any(Number));

    const mod = await account("mod@example.com");
    await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小管" });
    await loadMods();
    await signIn(mod.id);
    expect((await beat()).status).toBe(200);

    vi.stubEnv("LISTEN", "off");
    expect((await beat()).status).toBe(404);
    vi.stubEnv("LISTEN", "on");
    await signIn(player.id);
    expect((await beat()).status).toBe(200);
  });

  it("is of a song the device did not play to lately while another is left, 20 a minute, and is not counted as listening", async () => {
    vi.stubEnv("LISTEN", "on");
    await seed();
    const player = await account("someone@example.com");
    await signIn(player.id);
    for (let i = 0; i < 19; i++) expect((await clipOf({ not: ["s1"] }))?.song).toBe("s2");
    expect((await clipOf({ not: ["s1", "s2"] }))?.song).toMatch(/^s[12]$/);
    expect(await beat()).toMatchObject({ status: 429, body: { error: expect.any(String) } });
    // nobody listening, and no song played
    await saveSongPlays();
    expect(await db.select().from(listenNow)).toEqual([]);
    expect(await db.select().from(songPlays)).toEqual([]);
  });

  it("is none while 听歌 is paused or the site gray, and none before any clip is cut", async () => {
    vi.stubEnv("LISTEN", "on");
    const owner = await account("owner@example.com");
    await signIn(owner.id);
    expect(await beat()).toMatchObject({ status: 200, body: { clip: null } });
    await seed();
    expect(await clipOf()).not.toBeNull();
    await setListen(owner.id, { paused: true });
    expect(await beat()).toMatchObject({ status: 200, body: { clip: null } });
    await setListen(owner.id, { paused: false });
    await setGray(owner.id, Date.now() + 3_600_000);
    expect(await clipOf()).toBeNull();
    await endGray();
    expect(await clipOf()).not.toBeNull();
  });
});
