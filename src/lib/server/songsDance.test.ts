import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { siteSettings, songs } from "./schema";
import { danceTables, forgetSynced, loadSongs, songList, songOf, syncCatalog } from "./songs";

// Runs against the database named in vitest.config.mts: the catalogue, its files and the disco's tables
// (music/dance.json, scripts/beat-music.mjs) in a folder of their own

const root = mkdtempSync(path.join(tmpdir(), "music-dance-"));
const filesDir = path.join(root, "files");
const catalogFile = path.join(root, "catalog.json");
const dancesFile = path.join(root, "dance.json");
const NOW = Date.UTC(2026, 10, 16, 9);

const f = (n: number) => `${n.toString(16).padStart(16, "0")}.m4a`;
const entry = (n: number) => ({
  name: `Song ${n}`,
  album: "Album",
  artists: ["塞壬唱片-MSR"],
  seconds: 180 + n,
  file: f(n),
  bytes: 1000 + n,
  game: "arknights",
  added: "2026-11-15T00:00:00.000Z",
});
const CATALOG = JSON.stringify({
  v: 1,
  updated: "2026-11-16T01:00:00.000Z",
  albums: [{ id: "a1", name: "Album", order: 0, songs: ["s1", "s2", "s3"] }],
  songs: { s1: entry(1), s2: entry(2), s3: entry(3) },
});

const beats = (bpm: number) => `{"v":1,"bpm":${bpm},"bar":1,"t":"50,50,50,50","e":"5678"}`;
const NONE = '{"v":1,"none":"tempo","s":"0011"}';

// each change gets a time of its own, so the stamps change with it
let clock = 1_800_000_000;
const touch = (where: string) => {
  clock += 60;
  utimesSync(where, clock, clock);
};
function writeDances(body: unknown) {
  writeFileSync(dancesFile, typeof body === "string" ? body : JSON.stringify(body));
  touch(dancesFile);
}
const tables = async () => Object.fromEntries((await db.select({ id: songs.id, dance: songs.dance }).from(songs).orderBy(songs.id)).map((r) => [r.id, r.dance]));

beforeEach(async () => {
  await db.execute(sql`truncate ${songs}, ${siteSettings}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(filesDir, { recursive: true });
  for (const n of [1, 2, 3]) writeFileSync(path.join(filesDir, f(n)), "x");
  touch(filesDir);
  writeFileSync(catalogFile, CATALOG);
  touch(catalogFile);
  forgetSynced();
  await loadSongs();
});

describe("the disco's tables, read in with the catalogue", () => {
  it("go to each song by its file; a song whose file has none there has none, and a file of no song is passed over", async () => {
    writeDances({ v: 1, updated: "2026-11-16T08:00:00.000Z", songs: { [f(1)]: beats(120), [f(3)]: NONE, [f(9)]: beats(99) } });
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect(await tables()).toEqual({ s1: beats(120), s2: null, s3: NONE });
    // every process holds them with the songs, and the list goes without them
    await loadSongs();
    expect((await songOf("s1"))?.dance).toBe(beats(120));
    expect((await songOf("s2"))?.dance).toBeNull();
    expect((await songList()).json).not.toContain("bpm");
    expect(await syncCatalog(root, NOW)).toBe("same");
  });

  it("are read in when they alone changed, as after a run that found no new song", async () => {
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect(await tables()).toEqual({ s1: null, s2: null, s3: null });
    expect(await syncCatalog(root, NOW)).toBe("same");
    writeDances({ v: 1, updated: null, songs: { [f(2)]: beats(128) } });
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect(await tables()).toEqual({ s1: null, s2: beats(128), s3: null });
    // a table taken out since: that song has none
    writeDances({ v: 1, updated: null, songs: { [f(1)]: beats(100) } });
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect(await tables()).toEqual({ s1: beats(100), s2: null, s3: null });
  });

  it("stay as they were when the file is gone, cannot be read, or is not one this reads; the catalogue is read all the same", async () => {
    writeDances({ v: 1, updated: null, songs: { [f(1)]: beats(120), [f(2)]: beats(90) } });
    await syncCatalog(root, NOW);
    const was = await tables();
    expect(was).toEqual({ s1: beats(120), s2: beats(90), s3: null });

    for (const bad of ["{not json", JSON.stringify({ v: 2, songs: { [f(1)]: beats(60) } }), JSON.stringify({ v: 1, songs: [beats(60)] }), JSON.stringify([1])]) {
      writeDances(bad);
      expect(await syncCatalog(root, NOW), bad).toBe("updated");
      expect(await tables(), bad).toEqual(was);
    }
    rmSync(dancesFile);
    // a song renamed meanwhile is read in, its table as it was
    writeFileSync(catalogFile, CATALOG.replace("Song 1", "Song One"));
    touch(catalogFile);
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect(await tables()).toEqual(was);
    expect((await db.select({ name: songs.name }).from(songs).orderBy(songs.id))[0].name).toBe("Song One");
  });

  it("leave out a table that makes no sense, and a name that is not a song's file", () => {
    const got = danceTables(
      JSON.stringify({
        v: 1,
        songs: {
          [f(1)]: beats(120),
          [f(2)]: '{"v":1,"bpm":120,"bar":1,"t":"50,50","e":"5678"}',
          [f(3)]: 42,
          "../x.m4a": beats(120),
          [f(4)]: NONE,
        },
      }),
    );
    expect([...got]).toEqual([
      [f(1), beats(120)],
      [f(4), NONE],
    ]);
    expect(() => danceTables("{}")).toThrow();
    expect(() => danceTables("null")).toThrow();
  });
});
