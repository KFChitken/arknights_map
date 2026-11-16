import { describe, expect, it } from "vitest";
import {
  addCover,
  addLite,
  addSong,
  albumsToCheck,
  albumsToCover,
  clean,
  cleanList,
  COVER_SIZE,
  coverProblem,
  coverSource,
  emptyCatalog,
  isArknights,
  isCid,
  isCoverName,
  isFileName,
  keepAlbum,
  liteProblem,
  moovFirst,
  orderAlbums,
  pictureKind,
  readCatalog,
  songsToFetch,
  songsToLighten,
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
    expect(totals(catalog)).toEqual({ albums: 3, songs: 5, bytes: 5000, lite: 0, liteBytes: 0, covers: 0 });
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

// scripts/make-lite-music.mjs, without ffmpeg and fdkaac: which songs get a smaller copy, and what will do as one

/** Top-level boxes of an .m4a, each [type, bytes] (bytes: its whole size, header in) */
function boxes(...list: [string, number][]) {
  const out = new Uint8Array(list.reduce((n, [, size]) => n + size, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [type, size] of list) {
    view.setUint32(at, size);
    for (let i = 0; i < 4; i++) out[at + 4 + i] = type.charCodeAt(i);
    at += size;
  }
  return out;
}

const PROBE = {
  streams: [{ codec_type: "audio", codec_name: "aac", profile: "LC", channels: 2 }],
  format: { duration: "158.341224" },
};

describe("making each song's smaller copy (省流量)", () => {
  it("makes one for the songs whose file is there and that have none, in the catalogue's order", () => {
    const files = new Set<string>();
    const catalog = emptyCatalog();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    const hasFile = (f: string) => files.has(f);
    expect(songsToLighten(catalog, hasFile)).toEqual(["306861", "953932", "880380", "048703"]);

    addLite(catalog, "953932", { file: FILE(0xa1), bytes: 400 });
    files.add(FILE(0xa1));
    expect(catalog.songs["953932"]).toMatchObject({ lite: FILE(0xa1), liteBytes: 400, file: FILE(953932 + 1), bytes: 1000 });
    expect(songsToLighten(catalog, hasFile)).toEqual(["306861", "880380", "048703"]);
    expect(totals(catalog)).toMatchObject({ songs: 4, bytes: 4000, lite: 1, liteBytes: 400 });

    // its copy gone: made again; its file gone: none made (the fetch gets the file again first)
    files.delete(FILE(0xa1));
    files.delete(catalog.songs["048703"].file);
    expect(songsToLighten(catalog, hasFile)).toEqual(["306861", "953932", "880380"]);
    // a song on no album (taken off the site, kept) comes last
    catalog.albums[0].songs = catalog.albums[0].songs.filter((cid) => cid !== "306861");
    expect(songsToLighten(catalog, hasFile)).toEqual(["953932", "880380", "306861"]);
    expect(() => addLite(catalog, "999999", { file: FILE(1), bytes: 1 })).toThrow();
  });

  it("loses a song's copy when the fetch gets the song again, so the next run makes it again", () => {
    const files = new Set<string>();
    const catalog = emptyCatalog();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    addLite(catalog, "880380", { file: FILE(0xb2), bytes: 500 });
    files.add(FILE(0xb2));
    // the fetch writes a song only when it gets it, so a run that gets nothing keeps every copy
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-23T20:30:00Z"));
    expect(catalog.songs["880380"].lite).toBe(FILE(0xb2));
    files.delete(catalog.songs["880380"].file);
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-30T20:30:00Z"));
    expect(catalog.songs["880380"].lite).toBeUndefined();
    expect(songsToLighten(catalog, (f) => files.has(f))).toContain("880380");
  });

  it("tells whether a file's moov box comes before its mdat, so a browser can start it before the rest comes", () => {
    expect(moovFirst(boxes(["ftyp", 28], ["moov", 900], ["free", 8], ["mdat", 4000]))).toBe(true);
    expect(moovFirst(boxes(["ftyp", 28], ["free", 8], ["mdat", 4000], ["moov", 900]))).toBe(false);
    // only the first bytes, as many as hold the headers up to the moov
    expect(moovFirst(boxes(["ftyp", 28], ["moov", 900]).subarray(0, 36))).toBe(true);
    expect(moovFirst(new Uint8Array(0))).toBe(false);
    expect(moovFirst(boxes(["ftyp", 28]))).toBe(false);
    // a box of 64-bit size (1, then the size after the type)
    const big = boxes(["ftyp", 28], ["free", 24], ["moov", 100]);
    new DataView(big.buffer).setUint32(28, 1);
    new DataView(big.buffer).setBigUint64(36, 24n);
    expect(moovFirst(big)).toBe(true);
    // a size that makes no sense ends it
    const bad = boxes(["ftyp", 28], ["moov", 100]);
    new DataView(bad.buffer).setUint32(0, 4);
    expect(moovFirst(bad)).toBe(false);
  });

  it("takes as a copy only one audio stream of AAC-LC, two channels, as long as the song", () => {
    expect(liteProblem(PROBE, 158.34)).toBeNull();
    expect(liteProblem({ ...PROBE, format: { duration: "157.5" } }, 158.34)).toBeNull();
    const one = (s: object) => ({ ...PROBE, streams: [{ ...PROBE.streams[0], ...s }] });
    // what was asked of fdkaac (-p 2), and nothing else: not HE-AAC either, should an encoder give it unasked
    expect(liteProblem(one({ profile: "HE-AAC" }), 158.34)).toMatch(/HE-AAC, not AAC-LC/);
    expect(liteProblem(one({ profile: "Main" }), 158.34)).toMatch(/not AAC-LC/);
    expect(liteProblem(one({ codec_name: "mp3", profile: undefined }), 158.34)).toMatch(/not AAC-LC/);
    expect(liteProblem(one({ channels: 1 }), 158.34)).toMatch(/1 channels/);
    expect(liteProblem({ ...PROBE, streams: [...PROBE.streams, { codec_type: "video", codec_name: "mjpeg" }] }, 158.34)).toMatch(/2 streams/);
    expect(liteProblem({ ...PROBE, streams: [] }, 158.34)).toMatch(/0 streams/);
    expect(liteProblem({ ...PROBE, format: { duration: "120.1" } }, 158.34)).toMatch(/120.1 s long/);
    expect(liteProblem({ ...PROBE, format: {} }, 158.34)).toMatch(/NaN s long/);
    expect(liteProblem(null, 158.34)).toMatch(/0 streams/);
  });
});

// scripts/fetch-msr-covers.mjs, without the site and ffmpeg: which albums get a cover, from where, and what will do as one

const COVER = (n: number) => `${n.toString(16).padStart(16, "0")}.jpg`;

describe("getting each album's cover", () => {
  it("gets one for the albums that have none or whose file is gone, in the catalogue's order", () => {
    const files = new Set<string>();
    const catalog = emptyCatalog();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    const hasFile = (f: string) => files.has(f);
    expect(albumsToCover(catalog, hasFile)).toEqual(["5182", "4527"]);

    addCover(catalog, "4527", COVER(0xc1));
    files.add(COVER(0xc1));
    expect(catalog.albums.find((a) => a.id === "4527")).toEqual({ id: "4527", name: "明日方舟OST1", order: 1, songs: ["048703"], cover: COVER(0xc1) });
    expect(albumsToCover(catalog, hasFile)).toEqual(["5182"]);
    expect(totals(catalog)).toMatchObject({ albums: 2, covers: 1 });

    // its file gone, or a name the script never makes: got again
    files.delete(COVER(0xc1));
    expect(albumsToCover(catalog, hasFile)).toEqual(["5182", "4527"]);
    files.add(COVER(0xc1));
    catalog.albums[1].cover = "../x.jpg";
    files.add("../x.jpg");
    expect(albumsToCover(catalog, hasFile)).toEqual(["5182", "4527"]);
    expect(() => addCover(catalog, "7001", COVER(1))).toThrow();
  });

  it("keeps an album's cover through the weekly fetch, a new album and new names", () => {
    const files = new Set<string>();
    const catalog = emptyCatalog();
    runOnce(catalog, SITE_ALBUMS, DETAILS, files, new Date("2026-11-16T19:00:00Z"));
    addCover(catalog, "5182", COVER(0xd4));
    files.add(COVER(0xd4));
    // a week later a new album first, a song of 5182 gone (so its detail is asked for again), and 5182 renamed
    files.delete(catalog.songs["880380"].file);
    const albums: SiteAlbum[] = [{ cid: "9369", name: "时间啊，向前！" }, { ...SITE_ALBUMS[0], name: "卫戍协议OST" }, SITE_ALBUMS[2]];
    const details: Record<string, SiteAlbumDetail> = {
      ...DETAILS,
      "9369": { cid: "9369", name: "时间啊，向前！", belong: "arknights", songs: [{ cid: "119501", name: "火与尘" }] },
      "5182": { ...DETAILS["5182"], name: "卫戍协议OST" },
    };
    expect(runOnce(catalog, albums, details, files, new Date("2026-11-23T20:30:00Z"))).toEqual({ looked: ["9369", "5182"], fetched: ["119501", "880380"] });
    expect(catalog.albums.map((a) => [a.id, a.order, a.name, a.cover])).toEqual([
      ["9369", 0, "时间啊，向前！", undefined],
      ["5182", 1, "卫戍协议OST", COVER(0xd4)],
      ["4527", 2, "明日方舟OST1", undefined],
    ]);
    expect(albumsToCover(catalog, (f) => files.has(f))).toEqual(["9369", "4527"]);
    // and through the catalogue's text, as each script reads what the one before wrote
    expect(readCatalog(JSON.stringify(catalog)).albums[1].cover).toBe(COVER(0xd4));
  });

  it("downloads a cover only over https from the site's own hosts", () => {
    for (const url of [
      "https://web.hycdn.cn/siren/pic/20241018/0c4f4a0f3fa2a1b1a1ab3e1bd3c5c9f4.jpg",
      "https://web.hycdn.cn/siren/pic/20200828/41d2fa2b3f1d4b1d0d4c7e1d6fbc8a31.png",
      "https://monster-siren.hypergryph.com/x.jpg",
      "https://hycdn.cn/x.jpg",
    ]) {
      expect(coverSource({ coverUrl: url }), url).toBe(url);
    }
    for (const url of [
      "http://web.hycdn.cn/siren/pic/x.jpg",
      "https://web.hycdn.cn.example.com/x.jpg",
      "https://xhycdn.cn/x.jpg",
      "https://example.com/web.hycdn.cn/x.jpg",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "/siren/pic/x.jpg",
      "",
    ]) {
      expect(coverSource({ coverUrl: url }), url).toBeNull();
    }
    expect(coverSource({ coverUrl: 5 })).toBeNull();
    expect(coverSource({})).toBeNull();
    expect(coverSource(null)).toBeNull();
    expect(coverSource(undefined)).toBeNull();
  });

  it("keeps as a cover only one JPEG picture of 300×300, named by its content", () => {
    expect(COVER_SIZE).toBe(300);
    const good = { streams: [{ codec_type: "video", codec_name: "mjpeg", width: 300, height: 300 }] };
    expect(coverProblem(good)).toBeNull();
    const one = (s: object) => ({ streams: [{ ...good.streams[0], ...s }] });
    expect(coverProblem(one({ codec_name: "png" }))).toMatch(/png, not JPEG/);
    expect(coverProblem(one({ width: 300, height: 299 }))).toMatch(/300×299, not 300×300/);
    expect(coverProblem(one({ width: 600, height: 600 }))).toMatch(/600×600/);
    expect(coverProblem(one({ codec_type: "audio" }))).toMatch(/not one picture/);
    expect(coverProblem({ streams: [...good.streams, ...good.streams] })).toMatch(/2 streams/);
    expect(coverProblem({ streams: [] })).toMatch(/0 streams/);
    expect(coverProblem({})).toMatch(/0 streams/);
    expect(coverProblem(null)).toMatch(/0 streams/);

    // read only as the picture the bytes say they are, whatever the link's name
    const bytes = (...b: (number | string)[]) => Uint8Array.from(b.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));
    expect(pictureKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, "JFIF"))).toBe("jpeg_pipe");
    expect(pictureKind(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, "IHDR"))).toBe("png_pipe");
    expect(pictureKind(bytes("RIFF", 0x24, 0x10, 0, 0, "WEBPVP8 "))).toBe("webp_pipe");
    for (const odd of [bytes("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\n"), bytes("RIFF", 0, 0, 0, 0, "WAVEfmt "), bytes("GIF89a"), bytes(0xff, 0xd8), bytes("<html>"), bytes()]) {
      expect(pictureKind(odd)).toBeNull();
    }

    expect(isCoverName("0123456789abcdef.jpg")).toBe(true);
    for (const f of ["0123456789ABCDEF.jpg", "0123456789abcdef.png", "0123456789abcdef.m4a", "../0123456789abcdef.jpg", "123.jpg", null]) {
      expect(isCoverName(f), String(f)).toBe(false);
    }
  });
});
