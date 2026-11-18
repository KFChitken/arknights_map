import { describe, expect, it } from "vitest";
import {
  barSecond,
  changeQueue,
  clock,
  dragLetGo,
  DRIFT_RATE,
  freshSongs,
  heardAfter,
  indexCatalog,
  isRx,
  isSeek,
  keepUp,
  keySecond,
  LISTEN_GRACE_MS,
  listeningUntil,
  drawAny,
  drawRound,
  needsTopUp,
  NEW_MAX,
  QUEUE_MAX,
  RECENT_AVOID,
  restOfAlbum,
  restOfList,
  ROOM_GAP_MS,
  ROOM_LEAD_MS,
  roomAt,
  RX_COUNT,
  RX_ROOM_FROM,
  RX_ROWS,
  SEEK_KEY_S,
  SEEK_PAGE_S,
  seekBarKey,
  songMatches,
  type ListenAlbum,
  type ListenCatalog,
  type RoomSchedule,
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
    expect(restOfAlbum(t.get("a-1")!)).toEqual(["a-2", "a-3"]);
    expect(restOfAlbum(t.get("a-2")!)).toEqual(["a-3"]);
    expect(restOfAlbum(t.get("a-3")!)).toEqual([]);
    expect(restOfAlbum(t.get("b-1")!)).toEqual([]);
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

describe("一起听's schedule", () => {
  // three songs of 100, 50 and 30 seconds; z is not known (it lasts nothing)
  const len: Record<string, number> = { a: 100, b: 50, c: 30 };
  const seconds = (id: string) => len[id] ?? Number.NaN;
  const t0 = 1_000_000;
  const room = (queue: string[], startedAt: number | null, idx = 0, version = 1): RoomSchedule => ({ queue, idx, startedAt, version });

  it("waits for the host, then plays each song after the one before and two seconds", () => {
    expect(roomAt(room(["a", "b"], null), seconds, t0)).toEqual({ phase: "ready" });
    expect(roomAt(room(["a", "b"], t0 + 1000), seconds, t0)).toEqual({ phase: "playing", i: 0, start: t0 + 1000, offset: -1 });
    expect(roomAt(room(["a", "b"], t0), seconds, t0 + 40_500)).toEqual({ phase: "playing", i: 0, start: t0, offset: 40.5 });
    const second = t0 + 100_000 + ROOM_GAP_MS;
    // in the gap the next one is the one to come, not yet started
    expect(roomAt(room(["a", "b"], t0), seconds, t0 + 101_000)).toEqual({ phase: "playing", i: 1, start: second, offset: -1 });
    expect(roomAt(room(["a", "b"], t0), seconds, second + 10_000)).toEqual({ phase: "playing", i: 1, start: second, offset: 10 });
    expect(roomAt(room(["a", "b"], t0), seconds, second + 50_000)).toEqual({ phase: "done", end: second + 50_000 });
  });

  it("goes from idx on, and passes over a song it does not know", () => {
    expect(roomAt(room(["a", "b", "c"], t0, 1), seconds, t0 + 49_000)).toMatchObject({ phase: "playing", i: 1, offset: 49 });
    expect(roomAt(room(["a", "z", "c"], t0), seconds, t0 + 100_000 + 2 * ROOM_GAP_MS + 5_000)).toMatchObject({ phase: "playing", i: 2, offset: 5 });
    expect(roomAt(room(["z"], t0), seconds, t0)).toEqual({ phase: "done", end: t0 });
  });

  it("starts the room, the next song or this one again a second from now, as everyone counts from", () => {
    const now = t0 + 30_000;
    expect(changeQueue(room(["a", "b"], null), "start", seconds, now)).toEqual(room(["a", "b"], now + ROOM_LEAD_MS, 0, 2));
    expect(changeQueue(room(["a", "b"], t0), "start", seconds, now)).toBe("same");
    expect(changeQueue(room(["a", "b", "c"], t0), "next", seconds, now)).toEqual(room(["b", "c"], now + ROOM_LEAD_MS, 0, 2));
    expect(changeQueue(room(["a", "b", "c"], t0), "restart", seconds, now)).toEqual(room(["a", "b", "c"], now + ROOM_LEAD_MS, 0, 2));
    expect(changeQueue(room(["a"], t0), "next", seconds, now)).toBe("noNext");
    expect(changeQueue(room(["a"], null), "restart", seconds, now)).toBe("same");
  });

  it("drops what has played as the host changes it, so every phone goes on where it was", () => {
    // b plays (from t0 + 102 s); a is dropped, and b keeps its start
    const now = t0 + 120_000;
    const b = t0 + 100_000 + ROOM_GAP_MS;
    const added = changeQueue(room(["a", "b"], t0), { add: "c" }, seconds, now);
    expect(added).toEqual(room(["b", "c"], b, 0, 2));
    expect(roomAt(added as RoomSchedule, seconds, now)).toEqual({ phase: "playing", i: 0, start: b, offset: 18 });
    expect(roomAt(room(["a", "b"], t0), seconds, now)).toEqual({ phase: "playing", i: 1, start: b, offset: 18 });
  });

  it("adds at the end while songs are left, and plays one added after all of them at once", () => {
    expect(changeQueue(room(["a"], null), { add: "b" }, seconds, t0)).toEqual(room(["a", "b"], null, 0, 2));
    const over = t0 + 200_000;
    expect(changeQueue(room(["a", "b"], t0), { add: "c" }, seconds, over)).toEqual(room(["c"], over + ROOM_LEAD_MS, 0, 2));
    expect(changeQueue(room(["a", "b"], t0), "restart", seconds, over)).toEqual(room(["b"], over + ROOM_LEAD_MS, 0, 2));
    const full = room(Array.from({ length: QUEUE_MAX }, () => "a"), null);
    expect(changeQueue(full, { add: "b" }, seconds, t0)).toBe("full");
  });

  it("adds several at once (随机加) as far as the queue holds them, at once after all were over, and nothing for none", () => {
    expect(changeQueue(room(["a"], t0), { adds: ["b", "c"] }, seconds, t0 + 1_000)).toEqual(room(["a", "b", "c"], t0, 0, 2));
    const over = t0 + 200_000;
    expect(changeQueue(room(["a"], t0), { adds: ["b", "c"] }, seconds, over)).toEqual(room(["b", "c"], over + ROOM_LEAD_MS, 0, 2));
    const nearly = room(Array.from({ length: QUEUE_MAX - 2 }, () => "a"), null);
    expect(changeQueue(nearly, { adds: ["b", "c", "z"] }, seconds, t0)).toMatchObject({ queue: [...nearly.queue, "b", "c"] });
    expect(changeQueue(room(Array.from({ length: QUEUE_MAX }, () => "a"), null), { adds: ["b"] }, seconds, t0)).toBe("full");
    expect(changeQueue(room(["a"], t0), { adds: [] }, seconds, t0)).toBe("same");
  });

  it("tops up 待播 once the last song plays (or is next, between two), or all are over; never before the start", () => {
    const b = t0 + 100_000 + ROOM_GAP_MS;
    expect(needsTopUp(room(["a", "b"], null), seconds, t0)).toBe(false);
    expect(needsTopUp(room(["a"], null), seconds, t0)).toBe(false);
    expect(needsTopUp(room(["a", "b"], t0), seconds, t0 + 50_000)).toBe(false);
    // b is the last: between a and b, and as b plays
    expect(needsTopUp(room(["a", "b"], t0), seconds, t0 + 101_000)).toBe(true);
    expect(needsTopUp(room(["a", "b"], t0), seconds, b + 10_000)).toBe(true);
    expect(needsTopUp(room(["a"], t0 + 1_000), seconds, t0)).toBe(true);
    // a played already (idx past it): b is all that is left
    expect(needsTopUp(room(["a", "b", "c"], t0, 1), seconds, t0 + 10_000)).toBe(false);
    expect(needsTopUp(room(["a", "b", "c"], t0, 2), seconds, t0 + 10_000)).toBe(true);
    expect(needsTopUp(room(["a", "b"], t0), seconds, b + 60_000)).toBe(true);
  });

  it("moves the song playing to the host's second (its last at most), the songs after it with it, and nothing with none playing", () => {
    // a plays from t0; at 40 s the host goes to 75 s of it
    const now = t0 + 40_000;
    const to = changeQueue(room(["a", "b"], t0), { seek: 75 }, seconds, now);
    expect(to).toEqual(room(["a", "b"], now - 75_000, 0, 2));
    expect(roomAt(to as RoomSchedule, seconds, now)).toEqual({ phase: "playing", i: 0, start: now - 75_000, offset: 75 });
    // b after it, ROOM_GAP_MS after a's new end
    expect(roomAt(to as RoomSchedule, seconds, now + 25_000 + ROOM_GAP_MS + 1_000)).toMatchObject({ phase: "playing", i: 1, offset: 1 });
    // back to its start, and past its end: its last second
    expect(changeQueue(room(["a", "b"], t0), { seek: 0 }, seconds, now)).toEqual(room(["a", "b"], now, 0, 2));
    expect(changeQueue(room(["a", "b"], t0), { seek: 500 }, seconds, now)).toEqual(room(["a", "b"], now - 99_000, 0, 2));
    // b playing: a is dropped, as for any change
    const inB = t0 + 100_000 + ROOM_GAP_MS + 10_000;
    expect(changeQueue(room(["a", "b"], t0), { seek: 30 }, seconds, inB)).toEqual(room(["b"], inB - 30_000, 0, 2));
    // before the start, between two songs, after the last
    expect(changeQueue(room(["a", "b"], null), { seek: 10 }, seconds, now)).toBe("same");
    expect(changeQueue(room(["a", "b"], t0 + 60_000), { seek: 10 }, seconds, now)).toBe("same");
    expect(changeQueue(room(["a", "b"], t0), { seek: 10 }, seconds, t0 + 101_000)).toBe("same");
    expect(changeQueue(room(["a", "b"], t0), { seek: 10 }, seconds, t0 + 500_000)).toBe("same");
    expect([0, 12.5, 3599, 86_399].map(isSeek)).toEqual([true, true, true, true]);
    expect([-1, 86_400, Number.NaN, Number.POSITIVE_INFINITY, "10", null, undefined].map(isSeek)).toEqual([false, false, false, false, false, false, false]);
  });

  it("finds the second under a finger on the bar, and where its keys go, its start to its last second", () => {
    // a bar from 100 px, 200 px wide, for a song of 180 seconds
    expect(barSecond(100, 100, 200, 180)).toBe(0);
    expect(barSecond(200, 100, 200, 180)).toBe(90);
    expect(barSecond(150, 100, 200, 180)).toBe(45);
    expect(barSecond(300, 100, 200, 180)).toBe(179);
    expect(barSecond(20, 100, 200, 180)).toBe(0);
    expect(barSecond(900, 100, 200, 180)).toBe(179);
    expect(barSecond(150, 100, 0, 180)).toBe(0);
    expect(barSecond(150, 100, 200, 0)).toBe(0);
    expect(barSecond(Number.NaN, 100, 200, 180)).toBe(0);
    expect(keySecond("ArrowRight", 60, 180)).toBe(60 + SEEK_KEY_S);
    expect(keySecond("ArrowUp", 60, 180)).toBe(60 + SEEK_KEY_S);
    expect(keySecond("ArrowLeft", 60, 180)).toBe(60 - SEEK_KEY_S);
    expect(keySecond("ArrowDown", 2, 180)).toBe(0);
    expect(keySecond("PageUp", 60, 180)).toBe(60 + SEEK_PAGE_S);
    expect(keySecond("PageUp", 170, 180)).toBe(179);
    expect(keySecond("PageDown", 60, 180)).toBe(60 - SEEK_PAGE_S);
    expect(keySecond("Home", 60, 180)).toBe(0);
    expect(keySecond("End", 60, 180)).toBe(179);
    expect(keySecond("Enter", 60, 180)).toBeNull();
    expect(keySecond("toString", 60, 180)).toBeNull();
  });

  it("keeps the bar a finger drags through a seek answered, and ends a mouse's drag let go of where the bar never heard", () => {
    // its song and whether it may be dragged, and nothing of where the song started, which each seek moves
    expect(seekBarKey("s1", true)).toBe("s1:true");
    expect(new Set([seekBarKey("s1", true), seekBarKey("s2", true), seekBarKey("s1", false)]).size).toBe(3);
    // a mouse back over the bar with no button down was let go of somewhere else
    expect(dragLetGo("mouse", 0)).toBe(true);
    expect(dragLetGo("mouse", 1)).toBe(false);
    expect(dragLetGo("mouse", 2)).toBe(false);
    // a finger or a pen lifted says so itself
    expect(dragLetGo("touch", 0)).toBe(false);
    expect(dragLetGo("touch", 1)).toBe(false);
    expect(dragLetGo("pen", 0)).toBe(false);
  });

  it("keeps a phone in step: a little faster or slower when a little off, until close, and a jump when far off", () => {
    expect(keepUp(0.1)).toEqual({ rate: 1 });
    expect(keepUp(0.4)).toEqual({ rate: 1 - DRIFT_RATE });
    expect(keepUp(-1.9)).toEqual({ rate: 1 + DRIFT_RATE });
    // once catching up, on until within a twentieth of a second
    expect(keepUp(0.1, true)).toEqual({ rate: 1 - DRIFT_RATE });
    expect(keepUp(-0.04, true)).toEqual({ rate: 1 });
    expect(keepUp(2.5)).toBe("seek");
    expect(keepUp(-30, true)).toBe("seek");
    expect(keepUp(Number.NaN)).toEqual({ rate: 1 });
  });

  it("knows 短评 by number: nineteen in three rows, the last row only for a room", () => {
    expect(RX_ROWS.reduce((n, x) => n + x, 0)).toBe(RX_COUNT);
    expect(RX_ROOM_FROM).toBe(RX_ROWS[0] + RX_ROWS[1]);
    expect([0, 18, 5].map(isRx)).toEqual([true, true, true]);
    expect([-1, 19, 1.5, "3", null].map(isRx)).toEqual([false, false, false, false, false]);
  });
});

describe("收藏, 热播榜 and 随机播放", () => {
  it("go on to the songs after this one in a list, none after its last or for a song not in it", () => {
    expect(restOfList(["a", "b", "c"], "a")).toEqual(["b", "c"]);
    expect(restOfList(["a", "b", "c"], "c")).toEqual([]);
    expect(restOfList(["a", "b"], "z")).toEqual([]);
  });

  it("shuffle: a round of the list drawn ahead, each song once, never the one playing", () => {
    const ids = ["a", "b", "c", "d"];
    for (let i = 0; i < 20; i++) {
      const round = drawRound(ids, "a");
      expect([...round].sort()).toEqual(["b", "c", "d"]);
    }
    // drawn one after another, as random says: the first, or the last, of those left each time
    expect(drawRound(ids, "a", () => 0)).toEqual(["b", "c", "d"]);
    expect(drawRound(ids, "a", () => 0.999999)).toEqual(["d", "c", "b"]);
    // a song twice in the list is drawn once; one playing that is not in it changes nothing
    expect([...drawRound(["a", "b", "a"], "z")].sort()).toEqual(["a", "b"]);
    // a list of one: nothing else to go to
    expect(drawRound(["a"], "a")).toEqual([]);
    expect(drawRound([], "a")).toEqual([]);
  });

  it("go on from all of them at random once a list played through: those played lately last, the longest ago first", () => {
    const all = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const recent = ["s3", "s1", "s7"];
    for (let i = 0; i < 20; i++) {
      const any = drawAny(all, "s7", recent);
      expect(any).toHaveLength(29);
      expect(new Set(any).size).toBe(29);
      expect(any).not.toContain("s7");
      // the ones played lately after all the others, in the order they were played
      expect(any.slice(-2)).toEqual(["s3", "s1"]);
    }
    // the last 20 played are held back, no more (here one of them gone from the list, never drawn): s6 to s24, as played
    const played = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const any = drawAny([...all, "x"], "x", [...played, "gone"]);
    expect(RECENT_AVOID).toBe(20);
    expect(any.slice(-19)).toEqual(played.slice(6));
    expect(any).toHaveLength(30);
    expect(any).not.toContain("gone");
    expect(any).not.toContain("x");
    // nothing else but the song playing: nothing
    expect(drawAny(["a"], "a", ["a"])).toEqual([]);
  });

  it("count a song heard after 30 seconds of it, a shorter one all but its last second", () => {
    expect(heardAfter(200)).toBe(30);
    expect(heardAfter(31)).toBe(30);
    expect(heardAfter(20)).toBe(19);
    expect(heardAfter(0.5)).toBe(0);
  });
});
