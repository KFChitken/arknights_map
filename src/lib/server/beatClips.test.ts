import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { BEAT_KEY, beatClip, type BeatClip, beatClipsOf, forgetBeatSynced, loadBeatClips, syncBeatClips } from "./beatClips";
import { db } from "./db";
import { linkGood } from "./musicLinks";
import { siteSettings, songs, users } from "./schema";
import { endGray, loadSettings, setGray, setListen } from "./siteSettings";
import { loadSongs } from "./songs";

// Runs against the database named in vitest.config.mts; the list and the clips' files in a folder of their own

const root = mkdtempSync(path.join(tmpdir(), "beat-"));
const filesDir = path.join(root, "files");
const listFile = path.join(root, "beat.json");
const NOW = Date.UTC(2026, 10, 16, 2);

/** A file's name, by number */
const f = (n: number) => `${n.toString(16).padStart(16, "0")}.m4a`;
/** A clip as the list has it: of song s<n>, in file n, at 120 a minute */
const clip = (n: number, over: Record<string, unknown> = {}) => ({ song: `s${n}`, file: f(100 + n), beat: 500, first: 1500, bar: 1, ms: 43_000, bytes: 350_000, ...over });
const list = (clips: unknown[], more: Record<string, unknown> = {}) => JSON.stringify({ v: 1, updated: "2026-11-16T01:00:00.000Z", clips, ...more });

// each change gets a time of its own, so the list's stamp (its time, its size, its folder's time) changes with it
let clock = 1_700_000_000;
const touch = (where: string) => {
  clock += 60;
  utimesSync(where, clock, clock);
};
function writeList(body: string) {
  writeFileSync(listFile, body);
  touch(listFile);
}
function putFiles(...ns: number[]) {
  for (const n of ns) writeFileSync(path.join(filesDir, f(n)), "x");
  touch(filesDir);
}

const kept = async () => (await db.select().from(siteSettings).where(eq(siteSettings.key, BEAT_KEY)))[0]?.value as { clips: BeatClip[]; readAt: string } | undefined;

/** Songs s1 to s4 in the list of songs, s4 gone */
async function seedSongs() {
  await db.insert(songs).values(
    [1, 2, 3, 4].map((n) => ({
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
      goneAt: n === 4 ? new Date() : null,
    })),
  );
  await loadSongs();
}

/** The clips the database holds, as the main process would have written them, read in by every process */
async function holdClips(clips: unknown[]) {
  await db.insert(siteSettings).values({ key: BEAT_KEY, value: { clips, readAt: new Date(NOW).toISOString() } });
  await loadBeatClips();
}

const owner = async () => (await db.insert(users).values({ email: "owner@example.com" }).returning())[0];

beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${songs}, ${siteSettings} cascade`);
  rmSync(filesDir, { recursive: true, force: true });
  rmSync(listFile, { force: true });
  mkdirSync(filesDir);
  forgetBeatSynced();
  await loadSettings();
  await loadSongs();
  await loadBeatClips();
});

describe("325 节拍's list of clips, read", () => {
  it("keeps the clips whose file is there, in the list's order, each with its beats", () => {
    const got = beatClipsOf(list([clip(2), clip(1, { beat: 444.444, first: 0, bar: 0, ms: 30_000 }), clip(3)]), new Set([f(101), f(102)]));
    expect(got).toEqual([
      { song: "s2", file: f(102), beat: 500, first: 1500, bar: 1, ms: 43_000 },
      { song: "s1", file: f(101), beat: 444.444, first: 0, bar: 0, ms: 30_000 },
    ]);
  });

  it("leaves out a clip that makes no sense, and a song's after its first", () => {
    const clips = [
      clip(1),
      clip(1, { file: f(102) }),
      clip(3, { song: "bad id!" }),
      clip(4, { file: "../x.m4a" }),
      clip(5, { beat: 60_000 / 140 }),
      clip(6, { beat: 60_000 / 95 }),
      clip(7, { first: -1 }),
      clip(8, { first: 5001 }),
      clip(9, { bar: 4 }),
      clip(10, { bar: 1.5 }),
      clip(11, { ms: 29_000 }),
      clip(12, { ms: 61_000 }),
      clip(13, { beat: "fast" }),
      null,
      "s14",
    ];
    const present = new Set(Array.from({ length: 20 }, (_, i) => f(100 + i)));
    expect(beatClipsOf(list(clips), present).map((c) => c.song)).toEqual(["s1"]);
    // at the ends of what makes sense, all in
    const ends = [clip(1, { beat: 60_000 / 135 }), clip(2, { beat: 60_000 / 100 }), clip(3, { first: 5000, bar: 3, ms: 60_000 })];
    expect(beatClipsOf(list(ends), present)).toHaveLength(3);
  });

  it("keeps two hundred clips at most", () => {
    const many = Array.from({ length: 250 }, (_, i) => clip(i, { file: f(1) }));
    expect(beatClipsOf(list(many), new Set([f(1)]))).toHaveLength(200);
  });

  it("is refused whole when it is not a list this reads", () => {
    expect(() => beatClipsOf("{", new Set())).toThrow();
    expect(() => beatClipsOf(JSON.stringify({ v: 2, clips: [] }), new Set())).toThrow();
    expect(() => beatClipsOf(JSON.stringify({ v: 1, clips: {} }), new Set())).toThrow();
    expect(() => beatClipsOf("null", new Set())).toThrow();
    expect(beatClipsOf(list([]), new Set())).toEqual([]);
  });
});

describe("325 节拍's clips in the database and in memory", () => {
  it("are read in from the list when it or the files change; a list missing or bad changes nothing", async () => {
    await seedSongs();
    const u = await owner();
    expect(await syncBeatClips(root, NOW)).toBe("missing");
    putFiles(101, 102);
    writeList(list([clip(1), clip(2), clip(3)]));
    expect(await syncBeatClips(root, NOW)).toBe("updated");
    expect(await kept()).toEqual({ clips: [expect.objectContaining({ song: "s1" }), expect.objectContaining({ song: "s2" })], readAt: new Date(NOW).toISOString() });
    expect(await syncBeatClips(root, NOW)).toBe("same");
    // every process holds them now: a round gets one of them
    expect((await beatClip(u, {}, NOW)).clip?.song).toMatch(/^s[12]$/);

    // the third clip's file put there: it is in
    putFiles(103);
    expect(await syncBeatClips(root, NOW + 1)).toBe("updated");
    expect((await kept())?.clips.map((c) => c.song)).toEqual(["s1", "s2", "s3"]);

    // a list that cannot be read: nothing changes, and it is not read again until it changes
    writeList('{"v": 1, "clips": [');
    expect(await syncBeatClips(root, NOW + 2)).toBe("bad");
    expect(await syncBeatClips(root, NOW + 3)).toBe("bad");
    expect((await kept())?.clips).toHaveLength(3);
    writeList(list([clip(2)]));
    expect(await syncBeatClips(root, NOW + 4)).toBe("updated");
    expect((await kept())?.clips.map((c) => c.song)).toEqual(["s2"]);
    expect((await beatClip(u, {}, NOW)).clip?.song).toBe("s2");

    // the list taken away: the clips stay as they were
    rmSync(listFile);
    expect(await syncBeatClips(root, NOW + 5)).toBe("missing");
    expect((await kept())?.clips).toHaveLength(1);
  });

  it("are none while the database holds none, or holds something else", async () => {
    await seedSongs();
    const u = await owner();
    expect(await beatClip(u, {}, NOW)).toEqual({ clip: null, now: NOW });
    await db.insert(siteSettings).values({ key: BEAT_KEY, value: { clips: "many" } });
    await loadBeatClips();
    expect((await beatClip(u, {}, NOW)).clip).toBeNull();
  });
});

describe("a clip for a round of 325 节拍", () => {
  it("is one of the clips at random, with its song's name and album, a link that lets it out, and its beats", async () => {
    await seedSongs();
    const u = await owner();
    await holdClips([clip(1, { file: f(101) }), clip(2, { file: f(102), beat: 470.5, first: 1200, bar: 3, ms: 42_000 })]);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const { clip: c, now } = await beatClip(u, {}, NOW);
      expect(now).toBe(NOW);
      seen.add(c!.song);
      if (c!.song === "s2") {
        expect(c).toEqual({ song: "s2", name: "Song 2", album: "Album", link: expect.stringMatching(/^\/music\/0{14}66\.m4a\?k=/), beat: 470.5, first: 1200, bar: 3, ms: 42_000 });
        expect(linkGood(c!.link, NOW)).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual(["s1", "s2"]);
  });

  it("is of a song not among those named while another is left, and of a song still in 听歌's list", async () => {
    await seedSongs();
    const u = await owner();
    // s4's song is gone, s9 was never in the list
    await holdClips([clip(1), clip(2), clip(3), clip(4), clip(9)]);
    const songsOf = async (body: Record<string, unknown>) => {
      const got = new Set<string>();
      for (let i = 0; i < 60; i++) got.add((await beatClip(u, body, NOW)).clip!.song);
      return [...got].sort();
    };
    expect(await songsOf({})).toEqual(["s1", "s2", "s3"]);
    expect(await songsOf({ not: ["s1", "s3"] })).toEqual(["s2"]);
    // all of them named: any of them, rather than none
    expect(await songsOf({ not: ["s1", "s2", "s3"] })).toEqual(["s1", "s2", "s3"]);
    // what is not a list of songs' ids is let go
    expect(await songsOf({ not: "s1" })).toEqual(["s1", "s2", "s3"]);
    expect(await songsOf({ not: [1, { s: "s1" }, "s2", "bad id!"] })).toEqual(["s1", "s3"]);
  });

  it("is none while the site is gray and while 听歌 is paused", async () => {
    await seedSongs();
    const u = await owner();
    await holdClips([clip(1)]);
    await setGray(u.id, NOW + 3_600_000, NOW);
    expect(await beatClip(u, {}, NOW)).toEqual({ clip: null, now: NOW });
    await endGray();
    await setListen(u.id, { paused: true });
    expect((await beatClip(u, {}, NOW)).clip).toBeNull();
    await setListen(u.id, { paused: false });
    expect((await beatClip(u, {}, NOW)).clip?.song).toBe("s1");
  });
});
