import { describe, expect, it } from "vitest";
import {
  clock,
  freshSongs,
  indexCatalog,
  LISTEN_GRACE_MS,
  listeningUntil,
  nextOnAlbum,
  NEW_MAX,
  songMatches,
  type ListenAlbum,
  type ListenCatalog,
} from "./listen";

const album = (id: string, name: string, n: number, artists?: string[]): ListenAlbum => ({
  id,
  name,
  songs: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i + 1}`, name: `${name} ${i + 1}`, seconds: 100 + i, ...(artists ? { artists } : {}) })),
});

describe("听歌's list", () => {
  it("puts the songs of the two newest albums first as 新歌, at most twelve", () => {
    expect(freshSongs([album("a", "A", 2), album("b", "B", 3), album("c", "C", 4)])).toEqual(["a-1", "a-2", "b-1", "b-2", "b-3"]);
    const many = freshSongs([album("a", "A", 9), album("b", "B", 9)]);
    expect(many).toHaveLength(NEW_MAX);
    expect(many.at(-1)).toBe("b-3");
    expect(freshSongs([])).toEqual([]);
  });

  it("fills in each song's album and artists, the list's usual ones where it names none, the first album keeping a song on two", () => {
    const first = album("a", "A", 2);
    const guest = album("b", "B", 1, ["塞壬唱片-MSR", "Guest"]);
    const twice = { ...album("c", "C", 0), songs: [{ id: "a-1", name: "again", seconds: 5 }] };
    const c: ListenCatalog = { albums: [first, guest, twice], artists: ["塞壬唱片-MSR"], fresh: [] };
    const t = indexCatalog(c);
    expect([...t.keys()]).toEqual(["a-1", "a-2", "b-1"]);
    expect(t.get("a-1")).toMatchObject({ name: "A 1", seconds: 100, artists: ["塞壬唱片-MSR"], album: { id: "a" } });
    expect(t.get("b-1")?.artists).toEqual(["塞壬唱片-MSR", "Guest"]);
  });

  it("goes on to the next song of the album, and to nothing after its last", () => {
    const t = indexCatalog({ albums: [album("a", "A", 3), album("b", "B", 1)], artists: [], fresh: [] });
    expect(nextOnAlbum(t.get("a-1")!)).toBe("a-2");
    expect(nextOnAlbum(t.get("a-2")!)).toBe("a-3");
    expect(nextOnAlbum(t.get("a-3")!)).toBeNull();
    expect(nextOnAlbum(t.get("b-1")!)).toBeNull();
  });

  it("finds a song by its name or its album's, whatever the case, the spaces or full-width letters", () => {
    const a: ListenAlbum = { id: "x", name: "卫戍协议：规程OST", songs: [{ id: "s", name: "Ens Inexorabile", seconds: 1 }] };
    const t = indexCatalog({ albums: [a], artists: [], fresh: [] }).get("s")!;
    for (const q of ["ens", "ENS INEX", "ensinexorabile", "Ｅｎｓ", "规程", "卫戍 协议", "ost", ""]) expect(songMatches(t, q), q).toBe(true);
    for (const q of ["exo rab ile x", "终末地"]) expect(songMatches(t, q), q).toBe(false);
  });

  it("writes how long as m:ss", () => {
    expect([0, 5.9, 59, 60, 65.4, 600, 3599].map(clock)).toEqual(["0:00", "0:05", "0:59", "1:00", "1:05", "10:00", "59:59"]);
    expect([-3, Number.NaN, Number.POSITIVE_INFINITY].map(clock)).toEqual(["0:00", "0:00", "0:00"]);
  });

  it("counts a player until the song should end from where it started, and two minutes more", () => {
    const now = 1_000_000;
    expect(listeningUntil(100, 0, now)).toBe(now + 100_000 + LISTEN_GRACE_MS);
    expect(listeningUntil(100, 40.5, now)).toBe(now + 59_500 + LISTEN_GRACE_MS);
    expect(listeningUntil(100, 500, now)).toBe(now + LISTEN_GRACE_MS);
    expect(listeningUntil(100, -5, now)).toBe(now + 100_000 + LISTEN_GRACE_MS);
    expect(listeningUntil(100, Number.NaN, now)).toBe(now + 100_000 + LISTEN_GRACE_MS);
  });
});
