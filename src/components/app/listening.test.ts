import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "@/i18n";
import { heardGray } from "@/lib/grayMode";
import { LISTEN_FULL, LISTEN_PAUSED, type ListenCatalog, type ListenTrack } from "@/lib/listen";
import { playMusic } from "./amiyaMusic";
import {
  forgetListening,
  isListening,
  listenPlayerNow,
  listenSongsNow,
  loadSongs,
  markIntro,
  playTrack,
  skip,
  toggle,
} from "./listening";
import { playPartyMusic } from "./partyMusic";

// The page's player (listening.ts) with the browser's parts stood in for: an <audio> that plays at once, the server
// answering /api/listen, and the window and storage a page has

class FakeAudio extends EventTarget {
  static last: FakeAudio;
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  volume = 1;
  preload = "";
  constructor() {
    super();
    FakeAudio.last = this;
  }
  play() {
    this.paused = false;
    this.ended = false;
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    queueMicrotask(() => this.dispatchEvent(new Event("pause")));
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  /** As far as `s` seconds in */
  to(s: number) {
    this.currentTime = s;
    this.dispatchEvent(new Event("timeupdate"));
  }
  /** To its end */
  end() {
    this.currentTime = this.duration;
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event("pause"));
    this.dispatchEvent(new Event("ended"));
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

class FakeStorage {
  map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, String(v));
  removeItem = (k: string) => void this.map.delete(k);
}

const CATALOG: ListenCatalog = {
  albums: [
    {
      id: "a1",
      name: "First",
      songs: [
        { id: "s1", name: "One", seconds: 100 },
        { id: "s2", name: "Two", seconds: 120 },
      ],
    },
    { id: "a2", name: "Second", songs: [{ id: "s3", name: "Three", seconds: 90 }] },
  ],
  artists: ["塞壬唱片-MSR"],
  fresh: ["s1", "s2", "s3"],
};

const link = (id: string) => `/music/${id}.m4a?k=1.sig`;
/** What the page asked the server, op by op */
let asked: { op: string; body: Record<string, unknown> | null }[] = [];
/** The songs fetched early */
let early: string[] = [];
/** How the server answers play, for the test to change */
let playAnswer: (body: Record<string, unknown>) => { status: number; json: unknown };
const played = (body: Record<string, unknown>) => ({
  status: 200,
  json: { url: link(String(body.song)), ...(body.next ? { nextUrl: link(String(body.next)) } : {}), until: Date.now() + 5 * 60_000, now: Date.now() },
});
const refusing = (code: string, error: string) => () => ({ status: 503, json: { error, code } });

const session = new FakeStorage();
const local = new FakeStorage();
const page = Object.assign(new EventTarget(), { __ZP_I18N: globalThis.__ZP_I18N_SERVER!() });

beforeAll(() => {
  vi.stubGlobal("window", page);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input.startsWith("/music/")) {
      early.push(input);
      return new Response("song");
    }
    const op = input.replace("/api/listen/", "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    asked.push({ op, body });
    const a = op === "songs" ? { status: 200, json: CATALOG } : op === "play" ? playAnswer(body ?? {}) : { status: 200, json: { now: Date.now() } };
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { "content-type": "application/json" } });
  });
});
afterAll(() => vi.unstubAllGlobals());

/** Every answer in, and what the element does after it */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const ops = (op: string) => asked.filter((a) => a.op === op).map((a) => a.body);
const track = (id: string): ListenTrack => {
  const s = listenSongsNow();
  if (s.state !== "ok") throw new Error("no songs");
  return s.tracks.get(id)!;
};
const audio = () => FakeAudio.last;

beforeEach(async () => {
  forgetListening();
  asked = [];
  early = [];
  playAnswer = played;
  session.map.clear();
  local.map.clear();
  loadSongs();
  await settle();
});

describe("听歌 on the page", () => {
  it("plays a song from a tap: the element unlocked with silence in it, then the song; the guides' music keeps quiet", async () => {
    playTrack(track("s1"));
    expect(audio().src).toMatch(/^data:audio\/wav;base64,/);
    expect(isListening()).toBe(true);
    expect(listenPlayerNow()).toMatchObject({ status: "starting", buffering: true });
    await settle();
    expect(ops("play")).toEqual([{ song: "s1", at: 0, next: "s2" }]);
    expect(audio().src).toBe(link("s1"));
    expect(listenPlayerNow()).toMatchObject({ status: "playing", buffering: false, track: { id: "s1", album: { id: "a1" } } });
    expect(await playMusic()).toBeNull();
    expect(await playPartyMusic()).toBeNull();
  });

  it("goes on to the album's next song at once, from the link given ahead, and stops after its last", async () => {
    playTrack(track("s1"));
    await settle();
    audio().end();
    // before the server is told: so a phone in a pocket goes on to it
    expect(audio().src).toBe(link("s2"));
    await settle();
    expect(ops("play")).toEqual([
      { song: "s1", at: 0, next: "s2" },
      { song: "s2", at: 0 },
    ]);
    expect(listenPlayerNow()).toMatchObject({ status: "playing", track: { id: "s2" } });

    audio().end();
    await settle();
    expect(ops("stop")).toEqual([{}]);
    expect(isListening()).toBe(false);
    expect(listenPlayerNow()).toMatchObject({ status: "paused", track: { id: "s2" } });
    // ▶ plays it again, from its start
    toggle();
    await settle();
    expect(ops("play").at(-1)).toEqual({ song: "s2", at: 0 });
    expect(isListening()).toBe(true);
  });

  it("fetches the next song 20 seconds before this one ends, once; ⏭ goes on to it", async () => {
    playTrack(track("s1"));
    await settle();
    audio().duration = 100;
    audio().to(70);
    expect(early).toEqual([]);
    audio().to(81);
    audio().to(90);
    expect(early).toEqual([link("s2")]);
    skip();
    expect(audio().src).toBe(link("s2"));
    await settle();
    expect(listenPlayerNow().track?.id).toBe("s2");
    // the album's last: nothing after it
    skip();
    await settle();
    expect(ops("play")).toHaveLength(2);
  });

  it("goes on after a pause without asking while the server still counts the player, and asks again after a long one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      playTrack(track("s1"));
      await settle();
      audio().duration = 100;
      audio().to(30);
      toggle();
      expect(isListening()).toBe(false);
      expect(listenPlayerNow().status).toBe("paused");
      toggle();
      await settle();
      expect(ops("play")).toHaveLength(1);
      expect(listenPlayerNow().status).toBe("playing");

      toggle();
      vi.setSystemTime(Date.now() + 10 * 60_000);
      toggle();
      await settle();
      expect(ops("play")).toEqual([
        { song: "s1", at: 0, next: "s2" },
        { song: "s1", at: 30, next: "s2" },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes on from where the song got to, once its link is answered, when it starts part way", async () => {
    playTrack(track("s1"), 42);
    await settle();
    expect(ops("play")).toEqual([{ song: "s1", at: 42, next: "s2" }]);
    audio().dispatchEvent(new Event("loadedmetadata"));
    expect(audio().currentTime).toBe(42);
  });

  it("says why a song was refused, plays nothing, and leaves the server counting nobody", async () => {
    playAnswer = refusing(LISTEN_FULL, "听歌的人有点多，过几分钟再来。");
    playTrack(track("s1"));
    await settle();
    expect(listenPlayerNow()).toMatchObject({ status: "idle", track: null, problem: { code: LISTEN_FULL, message: "听歌的人有点多，过几分钟再来。" } });
    expect(isListening()).toBe(false);
    expect(audio().src).toBe("");
    expect(ops("stop")).toEqual([]);

    // paused by the 站长 between two songs: the next does not play, and the player is no longer counted
    playAnswer = played;
    playTrack(track("s1"));
    await settle();
    playAnswer = refusing(LISTEN_PAUSED, "听歌暂时停了，过一会儿再来。");
    audio().end();
    await settle();
    expect(listenPlayerNow()).toMatchObject({ status: "idle", problem: { code: LISTEN_PAUSED } });
    expect(ops("stop")).toEqual([{}]);
  });

  it("plays a song again from where it got to when its link fails, and gives it up after three times in a minute", async () => {
    playTrack(track("s1"));
    await settle();
    audio().to(42);
    for (let i = 0; i < 3; i++) {
      audio().fail();
      await settle();
    }
    expect(ops("play").slice(1)).toEqual([
      { song: "s1", at: 42, next: "s2" },
      { song: "s1", at: 42, next: "s2" },
      { song: "s1", at: 42, next: "s2" },
    ]);
    expect(listenPlayerNow().status).toBe("playing");
    audio().fail();
    await settle();
    expect(ops("play")).toHaveLength(4);
    expect(listenPlayerNow()).toMatchObject({ status: "paused", track: { id: "s1" }, problem: { message: T.listen.broken } });
    expect(ops("stop")).toEqual([{}]);
  });

  it("fades out when the site goes gray, and plays nothing while it is", async () => {
    playTrack(track("s1"));
    await settle();
    heardGray(String(Date.now() + 60_000));
    try {
      expect(isListening()).toBe(false);
      expect(listenPlayerNow().status).toBe("idle");
      await settle();
      expect(ops("stop")).toEqual([{}]);
      await new Promise((r) => setTimeout(r, 800));
      expect(audio().paused).toBe(true);
      expect(audio().volume).toBe(1);
      playTrack(track("s2"));
      await settle();
      expect(ops("play")).toHaveLength(1);
    } finally {
      heardGray("0");
    }
  });

  it("tells the server as the page goes, and offers the song again, from where it got to, on the page opened again", async () => {
    playTrack(track("s1"));
    await settle();
    audio().to(33.6);
    page.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(ops("stop")).toEqual([{ away: true }]);

    forgetListening();
    loadSongs();
    await settle();
    expect(listenPlayerNow()).toMatchObject({ status: "paused", tap: true, track: { id: "s1" } });
    expect(isListening()).toBe(false);
    toggle();
    await settle();
    expect(ops("play").at(-1)).toEqual({ song: "s1", at: 33, next: "s2" });
    expect(isListening()).toBe(true);
  });

  it("shows 新 until the panel is opened, and the line on privacy until it is read", () => {
    const read = () => local.getItem("zhoup.listenIntro");
    expect(read()).toBeNull();
    markIntro("opened");
    expect(read()).toBe("opened");
    markIntro("ok");
    markIntro("opened");
    expect(read()).toBe("ok");
  });
});
