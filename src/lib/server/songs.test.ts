import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { ListenCatalog } from "../listen";
import { db } from "./db";
import { siteSettings, songPlays, songs } from "./schema";
import { catalogRows, countPlay, forgetSynced, loadSongs, MUSIC_KEY, saveSongPlays, songList, songOf, syncCatalog } from "./songs";

// Runs against the database named in vitest.config.mts; the catalogue and its files in a folder of their own

const root = mkdtempSync(path.join(tmpdir(), "music-"));
const filesDir = path.join(root, "files");
const catalogFile = path.join(root, "catalog.json");
const MSR = "塞壬唱片-MSR";
const NOW = Date.UTC(2026, 10, 15, 2);

/** A song's file name, by number */
const f = (n: number) => `${n.toString(16).padStart(16, "0")}.m4a`;

type Entry = Record<string, unknown>;
const entry = (n: number, over: Entry = {}): Entry => ({
  name: `Song ${n}`,
  album: "Album",
  artists: [MSR],
  seconds: 180 + n,
  file: f(n),
  bytes: 1000 + n,
  game: "arknights",
  added: "2026-11-15T00:00:00.000Z",
  ...over,
});
const album = (id: string, name: string, ids: string[]) => ({ id, name, order: 0, songs: ids });
const text = (albums: unknown[], all: Record<string, Entry>, more: Entry = {}) =>
  JSON.stringify({ v: 1, updated: "2026-11-15T01:00:00.000Z", albums, songs: all, ...more });

// each change gets a time of its own, so the catalogue's stamp (its time, its size, its folder's time) changes with it
let clock = 1_700_000_000;
const touch = (where: string) => {
  clock += 60;
  utimesSync(where, clock, clock);
};
function writeCatalog(body: string) {
  writeFileSync(catalogFile, body);
  touch(catalogFile);
}
function putFiles(...ns: number[]) {
  for (const n of ns) writeFileSync(path.join(filesDir, f(n)), "x");
  touch(filesDir);
}
function dropFile(n: number) {
  rmSync(path.join(filesDir, f(n)));
  touch(filesDir);
}

const rows = async () =>
  (await db.select().from(songs).orderBy(songs.albumOrder, songs.track)).map((r) => ({ id: r.id, album: r.albumOrder, track: r.track, gone: r.goneAt !== null }));

beforeEach(async () => {
  await db.execute(sql`truncate ${songs}, ${songPlays}, ${siteSettings}`);
  rmSync(filesDir, { recursive: true, force: true });
  rmSync(catalogFile, { force: true });
  mkdirSync(filesDir);
  forgetSynced();
  await loadSongs();
});

describe("听歌's catalogue, read", () => {
  it("lists the songs whose file is there, album by album in the site's order, each album's in its own", () => {
    const all = {
      s1: entry(1, { name: "  Spaced  ", artists: [" A ", "", 3, "B"], seconds: 200.126 }),
      s2: entry(2),
      s3: entry(3),
      s4: entry(4),
    };
    const got = catalogRows(text([album("a1", " First ", ["s2", "s1"]), album("a2", "Second", ["s3", "s4"])], all), new Set([f(1), f(2), f(3)]));
    expect(got.map((r) => [r.id, r.albumId, r.album, r.albumOrder, r.track])).toEqual([
      ["s2", "a1", "First", 0, 0],
      ["s1", "a1", "First", 0, 1],
      ["s3", "a2", "Second", 1, 0],
    ]);
    expect(got[1]).toMatchObject({ name: "Spaced", artists: ["A", "B"], seconds: 200.13, file: f(1), bytes: 1001, game: "arknights", goneAt: null });
    expect(got[1].liteFile).toBeNull();
    expect(got[1].addedAt).toEqual(new Date("2026-11-15T00:00:00.000Z"));
  });

  it("leaves out a song that makes no sense, and one listed twice after the first time", () => {
    const all: Record<string, Entry> = {
      ok: entry(1),
      other: entry(2, { game: "other" }),
      badFile: entry(3, { file: "../x.m4a" }),
      noName: entry(4, { name: " " }),
      noTime: entry(5, { seconds: 0 }),
      tooLong: entry(6, { seconds: 25 * 3600 }),
      noBytes: entry(7, { bytes: 1.5 }),
      noDay: entry(8, { added: "someday" }),
      odd: null as unknown as Entry,
    };
    const present = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(f));
    const got = catalogRows(
      text([album("a1", "First", [...Object.keys(all), "missing", "ok", "bad id!"]), album("a2", "Again", ["ok"]), album("a3", "", ["ok"]), { id: "x" }], all),
      present,
    );
    expect(got.map((r) => r.id)).toEqual(["ok"]);
  });

  it("is refused whole when it is not a catalogue this reads", () => {
    expect(() => catalogRows("{", new Set())).toThrow();
    expect(() => catalogRows(JSON.stringify({ v: 2, albums: [], songs: {} }), new Set())).toThrow();
    expect(() => catalogRows(JSON.stringify({ v: 1, albums: {}, songs: {} }), new Set())).toThrow();
    expect(catalogRows(text([], {}), new Set())).toEqual([]);
  });
});

describe("听歌's songs in the database and in memory", () => {
  it("are read in from the catalogue when it or the files change, and the others kept as gone", async () => {
    expect(await syncCatalog(root, NOW)).toBe("missing");
    putFiles(1, 2, 3);
    writeCatalog(text([album("a1", "First", ["s1", "s2"]), album("a2", "Second", ["s3"])], { s1: entry(1), s2: entry(2), s3: entry(3) }));
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect(await rows()).toEqual([
      { id: "s1", album: 0, track: 0, gone: false },
      { id: "s2", album: 0, track: 1, gone: false },
      { id: "s3", album: 1, track: 0, gone: false },
    ]);
    const [kept] = await db.select().from(siteSettings).where(eq(siteSettings.key, MUSIC_KEY));
    expect(kept.value).toEqual({ updated: "2026-11-15T01:00:00.000Z", readAt: new Date(NOW).toISOString(), songs: 3 });
    expect(await syncCatalog(root, NOW)).toBe("same");
    // the list every process holds was read again
    expect((await songList()).byId.size).toBe(3);

    // a song's file gone: kept, as gone, and no longer in the list
    dropFile(2);
    expect(await syncCatalog(root, NOW + 1)).toBe("updated");
    expect((await rows()).find((r) => r.id === "s2")).toMatchObject({ gone: true });
    expect(await songOf("s2")).toBeUndefined();
    expect((await songOf("s1"))?.file).toBe(f(1));

    // a new album first, and the file back: back in the list, where the catalogue puts it
    putFiles(2, 4);
    writeCatalog(
      text([album("a0", "Newest", ["s4"]), album("a1", "First", ["s1", "s2"]), album("a2", "Second", ["s3"])], {
        s1: entry(1),
        s2: entry(2),
        s3: entry(3),
        s4: entry(4),
      }),
    );
    expect(await syncCatalog(root, NOW + 2)).toBe("updated");
    expect(await rows()).toEqual([
      { id: "s4", album: 0, track: 0, gone: false },
      { id: "s1", album: 1, track: 0, gone: false },
      { id: "s2", album: 1, track: 1, gone: false },
      { id: "s3", album: 2, track: 0, gone: false },
    ]);
    expect((await songList()).catalog.albums.map((a) => a.id)).toEqual(["a0", "a1", "a2"]);
  });

  it("stay as they were when the catalogue cannot be read, until it changes again", async () => {
    putFiles(1, 2);
    writeCatalog(text([album("a1", "First", ["s1", "s2"])], { s1: entry(1), s2: entry(2) }));
    expect(await syncCatalog(root, NOW)).toBe("updated");
    const before = await songList();

    writeCatalog('{"v": 1, "albums": [');
    expect(await syncCatalog(root, NOW + 1)).toBe("bad");
    expect(await syncCatalog(root, NOW + 2)).toBe("bad");
    expect(await rows()).toEqual([
      { id: "s1", album: 0, track: 0, gone: false },
      { id: "s2", album: 0, track: 1, gone: false },
    ]);
    expect((await songList()).etag).toBe(before.etag);

    writeCatalog(text([album("a1", "First", ["s1"])], { s1: entry(1) }));
    expect(await syncCatalog(root, NOW + 3)).toBe("updated");
    expect((await songList()).byId.has("s2")).toBe(false);
  });

  it("go to the page as one list: the usual artists once, a song's own where they differ, and 新歌 on top", async () => {
    putFiles(...Array.from({ length: 16 }, (_, i) => i + 1));
    const all: Record<string, Entry> = {};
    for (let n = 1; n <= 16; n++) all[`s${n}`] = entry(n, n === 3 ? { artists: [MSR, "Guest"] } : {});
    const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `s${from + i}`);
    writeCatalog(text([album("a1", "Newest", ids(1, 8)), album("a2", "Before", ids(9, 14)), album("a3", "Oldest", ids(15, 16))], all));
    expect(await syncCatalog(root, NOW)).toBe("updated");
    const list = await songList();
    const c = JSON.parse(list.json) as ListenCatalog;
    expect(c).toEqual(list.catalog);
    expect(c.artists).toEqual([MSR]);
    expect(c.albums.map((a) => [a.id, a.name, a.songs.length])).toEqual([
      ["a1", "Newest", 8],
      ["a2", "Before", 6],
      ["a3", "Oldest", 2],
    ]);
    expect(c.albums[0].songs[0]).toEqual({ id: "s1", name: "Song 1", seconds: 181 });
    expect(c.albums[0].songs[2]).toEqual({ id: "s3", name: "Song 3", seconds: 183, artists: [MSR, "Guest"] });
    // 新歌: the two newest albums, twelve songs at most
    expect(c.fresh).toEqual(ids(1, 12));
    // nothing of where the files are, or how big
    expect(list.json).not.toMatch(/m4a|bytes|file/);
    expect(list.etag).toMatch(/^"[A-Za-z0-9_-]{16}"$/);

    writeCatalog(text([album("a1", "Newest", ids(1, 8))], all));
    expect(await syncCatalog(root, NOW + 1)).toBe("updated");
    expect((await songList()).etag).not.toBe(list.etag);
  });

  it("carry each song's smaller copy (省流量) once its file is there, and the list says there are some", async () => {
    putFiles(1, 2, 3, 101);
    writeCatalog(
      text([album("a1", "First", ["s1", "s2", "s3"])], {
        s1: entry(1, { lite: f(101), liteBytes: 500 }),
        // its copy not there yet, and one whose name makes no sense
        s2: entry(2, { lite: f(102), liteBytes: 500 }),
        s3: entry(3, { lite: "../x.m4a" }),
      }),
    );
    expect(await syncCatalog(root, NOW)).toBe("updated");
    expect((await db.select({ id: songs.id, lite: songs.liteFile }).from(songs).orderBy(songs.track)).map((r) => [r.id, r.lite])).toEqual([
      ["s1", f(101)],
      ["s2", null],
      ["s3", null],
    ]);
    expect((await songOf("s1"))?.lite).toBe(f(101));
    expect((await songOf("s2"))?.lite).toBeNull();
    const list = await songList();
    expect(list.catalog.lite).toBe(true);
    expect(list.json).not.toMatch(/m4a|bytes|file/);

    // its copy made: read in with the files' folder changed
    putFiles(102);
    expect(await syncCatalog(root, NOW + 1)).toBe("updated");
    expect((await songOf("s2"))?.lite).toBe(f(102));
    // and gone again: the song plays on, without one
    dropFile(101);
    expect(await syncCatalog(root, NOW + 2)).toBe("updated");
    expect(await songOf("s1")).toMatchObject({ file: f(1), lite: null });

    // none at all: the list does not offer it
    writeCatalog(text([album("a1", "First", ["s1"])], { s1: entry(1) }));
    expect(await syncCatalog(root, NOW + 3)).toBe("updated");
    expect((await songList()).catalog.lite).toBeUndefined();
  });

  it("are counted as they are played, everyone's together, and added to song_plays a minute at a time", async () => {
    countPlay("s1");
    countPlay("s1");
    countPlay("s2");
    await saveSongPlays();
    countPlay("s1");
    await saveSongPlays();
    await saveSongPlays();
    const got = await db.select().from(songPlays).orderBy(songPlays.song);
    expect(got).toEqual([
      { song: "s1", plays: 3 },
      { song: "s2", plays: 1 },
    ]);
  });
});
