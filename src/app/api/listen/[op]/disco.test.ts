import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMods } from "@/lib/server/admins";
import { db } from "@/lib/server/db";
import { discoOpen, forgetListeningCount, listenMe } from "@/lib/server/listen";
import { forgetHits } from "@/lib/server/rateLimit";
import { admins, listenNow, sessions, siteSettings, songPlays, songs, statCounts, users } from "@/lib/server/schema";
import { loadSettings } from "@/lib/server/siteSettings";
import { loadSongs, saveSongPlays } from "@/lib/server/songs";
import { forgetStatCounts } from "@/lib/server/stats";
import { GET, POST } from "./route";

// 听歌's disco on the server: each song's table of beats goes out with the song (play) to those it is open to
// (DISCO), and me() says whom; the list of songs never carries them

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

async function call(method: "GET" | "POST", op: string, body?: unknown) {
  const url = `http://localhost/api/listen/${op}`;
  const req =
    method === "GET"
      ? new NextRequest(url)
      : new NextRequest(url, {
          method,
          headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
  const res = await { GET, POST }[method](req, { params: Promise.resolve({ op }) });
  const text = await res.text();
  return { status: res.status, text, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

async function account(email: string) {
  const now = new Date();
  const [u] = await db
    .insert(users)
    .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now, publicPlaceAcceptedAt: now })
    .returning();
  return u;
}

async function signIn(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ id: createHash("sha256").update(token).digest("base64url"), userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
  jar.token = token;
}

/** Each song's table, as scripts/beat-music.mjs writes them: the first and the third have one, the second none yet */
const TABLES = ['{"v":1,"bpm":120,"bar":0,"t":"50,50,50","e":"999"}', null, '{"v":1,"none":"clear","s":"0123"}', '{"v":1,"none":"tempo","s":"9"}'];

/** Four songs on one album, the last one gone */
async function seedSongs() {
  await db.insert(songs).values(
    ["s1", "s2", "s3", "s4"].map((id, i) => ({
      id,
      game: "arknights",
      name: `Song ${i + 1}`,
      albumId: "a1",
      album: "Album",
      artists: ["塞壬唱片-MSR"],
      seconds: 200 + i,
      file: `000000000000000${i + 1}.m4a`,
      bytes: 1000,
      dance: TABLES[i],
      albumOrder: 0,
      track: i,
      addedAt: new Date(),
      goneAt: i === 3 ? new Date() : null,
    })),
  );
  await loadSongs();
}

/** Who plays: the 站长, an admin, and a player */
async function people() {
  const owner = await account("owner@example.com");
  const mod = await account("mod@example.com");
  await db.insert(admins).values({ userId: mod.id, role: "mod", alias: "小管" });
  await loadMods();
  const player = await account("someone@example.com");
  return { owner, mod, player };
}

/** What play gives a player of the tables, for this song and the next */
async function tablesFor(userId: string, song: string, next?: string) {
  await signIn(userId);
  const res = await call("POST", "play", { song, ...(next ? { next } : {}) });
  expect(res.status).toBe(200);
  const b = res.body as { dance?: string; nextDance?: string };
  return { dance: b.dance ?? null, nextDance: b.nextDance ?? null };
}

beforeEach(async () => {
  await saveSongPlays();
  await db.execute(sql`truncate ${users}, ${sessions}, ${songs}, ${songPlays}, ${listenNow}, ${siteSettings}, ${statCounts}, ${admins} cascade`);
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

describe("听歌's disco, by who it is open to", () => {
  it("is open to nobody while DISCO is off or unset: no table goes out, and me() says nothing of it", async () => {
    vi.stubEnv("LISTEN", "on");
    await seedSongs();
    const { owner, mod, player } = await people();
    for (const mode of ["off", "", "yes"]) {
      vi.stubEnv("DISCO", mode);
      for (const u of [owner, mod, player]) {
        expect(discoOpen(u)).toBe(false);
        expect(await tablesFor(u.id, "s1", "s3")).toEqual({ dance: null, nextDance: null });
        const me = await listenMe(u);
        expect(me).toBeDefined();
        expect(me).not.toHaveProperty("disco");
      }
    }
  });

  it("is open to the 站长 and the admins alone while DISCO is admins, each song with its table and the next one's", async () => {
    vi.stubEnv("LISTEN", "on");
    vi.stubEnv("DISCO", "admins");
    await seedSongs();
    const { owner, mod, player } = await people();
    for (const u of [owner, mod]) {
      expect(await tablesFor(u.id, "s1", "s3")).toEqual({ dance: TABLES[0], nextDance: TABLES[2] });
      expect(await listenMe(u)).toMatchObject({ disco: true });
    }
    expect(await tablesFor(player.id, "s1", "s3")).toEqual({ dance: null, nextDance: null });
    expect(await listenMe(player)).not.toHaveProperty("disco");
  });

  it("is open to everyone who may listen while DISCO is on, and never to someone who may not", async () => {
    vi.stubEnv("DISCO", "on");
    vi.stubEnv("LISTEN", "admins");
    await seedSongs();
    const { owner, player } = await people();
    expect(discoOpen(player)).toBe(false);
    expect(await listenMe(player)).toBeUndefined();
    await signIn(player.id);
    expect((await call("POST", "play", { song: "s1" })).status).toBe(404);
    expect(await tablesFor(owner.id, "s1")).toEqual({ dance: TABLES[0], nextDance: null });

    vi.stubEnv("LISTEN", "on");
    expect(await tablesFor(player.id, "s3", "s1")).toEqual({ dance: TABLES[2], nextDance: TABLES[0] });
    expect(await listenMe(player)).toMatchObject({ disco: true, mode: "on" });

    vi.stubEnv("LISTEN", "off");
    expect(discoOpen(owner)).toBe(false);
    await signIn(owner.id);
    expect((await call("POST", "play", { song: "s1" })).status).toBe(404);
  });
});

describe("a song's table", () => {
  it("goes out only where the song has one, the next one's with the next song, a song gone's never", async () => {
    vi.stubEnv("LISTEN", "on");
    vi.stubEnv("DISCO", "on");
    await seedSongs();
    const { player } = await people();
    expect(await tablesFor(player.id, "s1", "s2")).toEqual({ dance: TABLES[0], nextDance: null });
    expect(await tablesFor(player.id, "s2", "s3")).toEqual({ dance: null, nextDance: TABLES[2] });
    expect(await tablesFor(player.id, "s3", "s4")).toEqual({ dance: TABLES[2], nextDance: null });
    // going on from where it got to, with no next song asked for
    await signIn(player.id);
    const on = (await call("POST", "play", { song: "s1", at: 100 })).body!;
    expect(on.dance).toBe(TABLES[0]);
    expect(on).not.toHaveProperty("nextDance");
  });

  it("never comes with the list of songs, which stays small", async () => {
    vi.stubEnv("LISTEN", "on");
    vi.stubEnv("DISCO", "on");
    await seedSongs();
    const { player } = await people();
    await signIn(player.id);
    const list = await call("GET", "songs");
    expect(list.status).toBe(200);
    expect(list.text).not.toContain("bpm");
    expect(list.text).not.toContain("dance");
    expect(list.text).not.toContain("none");
  });
});
