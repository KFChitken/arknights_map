import { describe, expect, it } from "vitest";
import {
  addSong,
  albumsToCheck,
  clean,
  cleanList,
  emptyCatalog,
  isArknights,
  isCid,
  isFileName,
  keepAlbum,
  orderAlbums,
  readCatalog,
  songsToFetch,
  totals,
  type Catalog,
  type SiteAlbum,
  type SiteAlbumDetail,
  type SiteSong,
} from "../../scripts/msr-music.mjs";

// scripts/fetch-msr-music.mjs, without the fetching: a made-up site of three albums, one of them another game's

const FILE = (n: number) => `${n.toString(16).padStart(16, "0")}.m4a`;

const SITE_ALBUMS: SiteAlbum[] = [
  { cid: "5182", name: "卫戍协议：规程OST", artistes: ["塞壬唱片-MSR"] },
  { cid: "7001", name: " 来自星尘OST ", artistes: ["塞壬唱片-MSR"] },
  { cid: "4527", name: "明日方舟OST1", artistes: ["塞壬唱片-MSR"] },
];
const DETAILS: Record<string, SiteAlbumDetail> = {
  "5182": {
    cid: "5182",
    name: "卫戍协议：规程OST",
    belong: "arknights",
    songs: [
      { cid: "306861", name: "Kernel Overflow", artistes: ["塞壬唱片-MSR"] },
      { cid: "953932", name: "Ens Inexorabile", artistes: ["塞壬唱片-MSR"] },
      { cid: "880380", name: "Systematic Violation", artistes: ["塞壬唱片-MSR"] },
    ],
  },
  "7001": { cid: "7001", name: "来自星尘OST", belong: "exastris", songs: [{ cid: "700101", name: "Star", artistes: [] }] },
  "4527": { cid: "4527", name: "明日方舟OST1", belong: "arknights", songs: [{ cid: "048703", name: "Arknights", artistes: [" 塞壬唱片-MSR ", ""] }] },
};
const siteSongs = (details: Record<string, SiteAlbumDetail>): SiteSong[] =>
  Object.values(details).flatMap((d) => (d.songs ?? []).map((s) => ({ cid: s.cid, name: s.name, albumCid: d.cid, artists: s.artistes })));

/** What a run does with what the site says, each song "fetched" into a made-up file */
function runOnce(catalog: Catalog, albums: SiteAlbum[], details: Record<string, SiteAlbumDetail>, files: Set<string>, now: Date) {
  const hasFile = (f: string) => files.has(f);
  const looked: string[] = [];
  const fetched: string[] = [];
  for (const id of albumsToCheck(albums, siteSongs(details), catalog, hasFile)) {
    looked.push(id);
    const detail = details[id];
    if (!isArknights(detail)) continue;
    for (const cid of songsToFetch(detail, catalog, hasFile)) {
      const file = FILE(Number(cid) + 1);
      files.add(file);
      const song = detail.songs!.find((s) => s.cid === cid)!;
      addSong(catalog, cid, { name: song.name, album: id, artists: song.artistes, seconds: 100 + Number(cid) / 1e6, file, bytes: 1000 }, now);
      fetched.push(cid);
    }
    keepAlbum(catalog, detail);
  }
  orderAlbums(catalog, albums);
  return { looked, fetched };
}

describe("fetching the songs of the Monster Siren Records site", () => {
  it("takes only the albums whose detail says they are Arknights'", () => {
    expect(isArknights({ belong: "arknights" })).toBe(true);
    for (const belong of ["exastris", "popucom", "endfield", "", undefined]) expect(isArknights({ belong }), String(belong)).toBe(false);
    expect(isArknights(null)).toBe(false);

    const files = new Set<string>();
    const catalog = emptyCatalog();
    const { looked, fetched } = runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    // every album is new, so every one is looked at; another game's songs are not fetched
    expect(looked).toEqual(["5182", "7001", "4527"]);
    expect(fetched).toEqual(["306861", "953932", "880380", "048703"]);
    expect(catalog.albums.map((a) => [a.id, a.order, a.songs])).toEqual([
      ["5182", 0, ["306861", "953932", "880380"]],
      ["4527", 1, ["048703"]],
    ]);
    expect(Object.keys(catalog.songs).sort()).toEqual(["048703", "306861", "880380", "953932"]);
  });

  it("writes each song as the site reads it: names trimmed, seconds to 0.01, the game, when it came", () => {
    const catalog = emptyCatalog();
    addSong(catalog, "048703", { name: " Arknights ", album: "4527", artists: [" 塞壬唱片-MSR ", "", 3], seconds: 129.98765, file: FILE(1), bytes: 1_234_567 }, new Date("2026-11-16T19:00:00Z"));
    expect(catalog.songs["048703"]).toEqual({
      name: "Arknights",
      album: "4527",
      artists: ["塞壬唱片-MSR"],
      seconds: 129.99,
      file: FILE(1),
      bytes: 1_234_567,
      game: "arknights",
      added: "2026-11-16T19:00:00.000Z",
    });
    expect(clean(undefined)).toBe("");
    expect(cleanList("x")).toEqual([]);
  });

  it("only adds on a run after another: nothing fetched twice, nothing taken out", () => {
    const files = new Set<string>();
    const catalog = emptyCatalog();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    const first = structuredClone(catalog);

    // the same site a week later: only another game's album is looked at again (only its detail tells), nothing fetched
    const again = runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-23T20:30:00Z"));
    expect(again).toEqual({ looked: ["7001"], fetched: [] });
    expect(catalog.songs).toEqual(first.songs);

    // then a new album first, a song taken off an album, and an album taken down
    const albums: SiteAlbum[] = [{ cid: "9369", name: "时间啊，向前！" }, SITE_ALBUMS[0], SITE_ALBUMS[1]];
    const details: Record<string, SiteAlbumDetail> = {
      "9369": { cid: "9369", name: "时间啊，向前！", belong: "arknights", songs: [{ cid: "119501", name: "火与尘" }] },
      "5182": { ...DETAILS["5182"], songs: DETAILS["5182"].songs!.filter((s) => s.cid !== "953932") },
      "7001": DETAILS["7001"],
    };
    const later = runOnce(catalog, albums, details, files, new Date("2026-11-30T20:30:00Z"));
    expect(later).toEqual({ looked: ["9369", "7001"], fetched: ["119501"] });
    // the new album first, as on the site; the song taken off stays on its album, after the others; the album taken
    // down stays, after those the site lists
    expect(catalog.albums.map((a) => [a.id, a.order, a.songs])).toEqual([
      ["9369", 0, ["119501"]],
      ["5182", 1, ["306861", "953932", "880380"]],
      ["4527", 2, ["048703"]],
    ]);
    expect(catalog.songs["953932"]).toEqual(first.songs["953932"]);
    expect(catalog.songs["048703"]).toEqual(first.songs["048703"]);
    expect(catalog.songs["119501"].added).toBe("2026-11-30T20:30:00.000Z");
    // once 5182 is looked at again, the song taken off still comes after the ones the site lists
    keepAlbum(catalog, details["5182"]);
    expect(catalog.albums[1].songs).toEqual(["306861", "880380", "953932"]);
    expect(totals(catalog)).toEqual({ albums: 3, songs: 5, bytes: 5000 });
  });

  it("fetches a song again whose file is gone, keeping when it first came", () => {
    const files = new Set<string>();
    const catalog = emptyCatalog();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    files.delete(catalog.songs["880380"].file);
    const { looked, fetched } = runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-23T20:30:00Z"));
    expect(looked).toEqual(["5182", "7001"]);
    expect(fetched).toEqual(["880380"]);
    expect(catalog.songs["880380"].added).toBe("2026-11-16T19:00:00.000Z");
  });

  it("looks at every album when the site's list of songs could not be read", () => {
    const catalog = emptyCatalog();
    const files = new Set<string>();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    expect(albumsToCheck(SITE_ALBUMS, null, catalog, (f) => files.has(f))).toEqual(["5182", "7001", "4527"]);
  });

  it("leaves a song that failed off its album until a later run gets it, and an album with none out", () => {
    const catalog = emptyCatalog();
    addSong(catalog, "306861", { name: "Kernel Overflow", album: "5182", artists: [], seconds: 158, file: FILE(9), bytes: 10 });
    keepAlbum(catalog, DETAILS["5182"]);
    keepAlbum(catalog, DETAILS["4527"]);
    expect(catalog.albums).toEqual([{ id: "5182", name: "卫戍协议：规程OST", order: 0, songs: ["306861"] }]);
    expect(songsToFetch(DETAILS["5182"], catalog, (f) => f === FILE(9))).toEqual(["953932", "880380"]);
  });

  it("uses only ids and file names that are safe in a path", () => {
    for (const id of ["5182", "048703", "a_b-C"]) expect(isCid(id), id).toBe(true);
    for (const id of ["", "../x", "a/b", "1 2", 5182, null, "x".repeat(33)]) expect(isCid(id), String(id)).toBe(false);
    expect(isFileName("0123456789abcdef.m4a")).toBe(true);
    for (const f of ["0123456789ABCDEF.m4a", "0123456789abcdef.wav", "../0123456789abcdef.m4a", "123.m4a"]) expect(isFileName(f), f).toBe(false);
    const odd: SiteAlbum[] = [{ cid: "../etc", name: "x" }, ...SITE_ALBUMS];
    expect(albumsToCheck(odd, null, emptyCatalog(), () => false)).toEqual(["5182", "7001", "4527"]);
    expect(songsToFetch({ cid: "1", name: "x", songs: [{ cid: "a/b", name: "y" }, { cid: "12", name: "z" }] }, emptyCatalog(), () => false)).toEqual(["12"]);
  });

  it("refuses a catalogue it does not know, rather than write over it", () => {
    const c = emptyCatalog();
    expect(readCatalog(JSON.stringify(c))).toEqual(c);
    for (const text of ['{"v":2,"albums":[],"songs":{}}', '{"v":1,"songs":{}}', "[]", "null"]) expect(() => readCatalog(text), text).toThrow();
    expect(() => readCatalog("{")).toThrow();
  });
});
