import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "@/i18n";
import { heardGray } from "@/lib/grayMode";
import { DRIFT_RATE, LISTEN_FULL, LISTEN_PAUSED, type ListenCatalog, type ListenRoom, type ListenTrack, type RoomMember } from "@/lib/listen";
import { playMusic } from "./amiyaMusic";
import {
  forgetListening,
  heardListen,
  hostQueue,
  isListening,
  joinAt,
  leaveListen,
  listenBubblesNow,
  listenPlayerNow,
  listenRoomNow,
  listenRxNow,
  listenSongsNow,
  loadRoom,
  loadSongs,
  markIntro,
  onListenSaid,
  openRoomWith,
  playTrack,
  sendRx,
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
  playbackRate = 1;
  readyState = 4;
  seeking = false;
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
/** How far the server's clock is ahead of the page's */
let skew = 0;
const serverClock = () => Date.now() + skew;
type Answer = { status: number; json: unknown };
/** How the server answers play, and the other ops, for the test to change */
let playAnswer: (body: Record<string, unknown>) => Answer;
let answers: Record<string, (body: Record<string, unknown>) => Answer> = {};
const played = (body: Record<string, unknown>) => ({
  status: 200,
  json: {
    url: link(String(body.song)),
    ...(body.next ? { nextUrl: link(String(body.next)) } : {}),
    until: serverClock() + 5 * 60_000,
    now: serverClock(),
  },
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
    const a =
      op === "songs"
        ? { status: 200, json: CATALOG }
        : op === "play"
          ? playAnswer(body ?? {})
          : (answers[op]?.(body ?? {}) ?? { status: 200, json: { now: serverClock() } });
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { "content-type": "application/json" } });
  });
});
afterAll(() => vi.unstubAllGlobals());
/** What the page said in a toast */
let said: string[] = [];
onListenSaid((t) => said.push(t));

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
  said = [];
  skew = 0;
  answers = {};
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

// ---- 一起听 ----

const card = (name: string) => ({ displayName: name, games: [], favourites: { arknights: [], endfield: [] }, avatar: "hood" as const, color: "cyan" as const });
const member = (h: number, name: string, host = false): RoomMember => ({ h, card: card(name), friend: true, host, state: "in" });
/** A room of two: 岚 its host (1), and you (2), with One (100 s) then Two (120 s) */
const roomOf = (over: Partial<ListenRoom> = {}): ListenRoom => ({
  id: "r1",
  queue: ["s1", "s2"],
  idx: 0,
  startedAt: null,
  version: 1,
  max: 20,
  you: 2,
  host: false,
  hostName: "Dr.岚",
  members: [member(1, "Dr.岚", true), member(2, "Dr.桐")],
  invited: [],
  now: serverClock(),
  ...over,
});
const answerRoom = (op: string, r: () => ListenRoom | null) => {
  answers[op] = () => ({ status: 200, json: { room: r(), sent: [], now: serverClock() } });
};
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const silence = /^data:audio\/wav;base64,/;

describe("一起听 on the page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });
  afterEach(() => {
    forgetListening();
    vi.useRealTimers();
  });

  /** In at an invitation to a room whose One started `ago` ms before, by the server's clock */
  async function joinPlaying(ago: number, over: Partial<ListenRoom> = {}) {
    const startedAt = serverClock() - ago;
    answerRoom("join", () => roomOf({ startedAt, ...over }));
    const joined = joinAt("inv-1");
    // within the tap, before any answer: the element plays, silence first
    expect(audio().src).toMatch(silence);
    expect(await joined).toBe(true);
    await tick(0);
    return startedAt;
  }

  it("goes in part way, at the second the room is at by the server's clock, and says so", async () => {
    skew = 10_000;
    await joinPlaying(30_000);
    expect(ops("join")).toEqual([{ invite: "inv-1" }]);
    expect(ops("play")).toEqual([{ song: "s1", at: 30, next: "s2" }]);
    expect(audio().src).toBe(link("s1"));
    await tick(400);
    audio().dispatchEvent(new Event("canplay"));
    expect(audio().currentTime).toBeCloseTo(30.4, 1);
    expect(listenPlayerNow()).toMatchObject({ status: "playing", track: { id: "s1" } });
    expect(said).toEqual(["跟上了：和大家都在 0:30"]);
    expect(listenRoomNow()?.id).toBe("r1");
  });

  it("keeps in step: a little faster or slower when a little off, a jump when far off", async () => {
    await joinPlaying(30_000);
    audio().currentTime = 35.5;
    await tick(5_000);
    expect(audio().playbackRate).toBe(1 - DRIFT_RATE);
    // while catching up it looks every second, and stops once close
    audio().currentTime = 36.02;
    await tick(1_000);
    expect(audio().playbackRate).toBe(1);
    audio().currentTime = 40;
    await tick(5_000);
    expect(audio().playbackRate).toBe(1 + DRIFT_RATE);
    audio().currentTime = 30;
    await tick(1_000);
    expect(audio().currentTime).toBe(42);
    expect(audio().playbackRate).toBe(1);
    // nobody else was asked anything meanwhile
    expect(ops("play")).toHaveLength(1);
  });

  it("goes on to the next song by itself: silence for the two seconds between, then the link given ahead at once", async () => {
    await joinPlaying(99_000);
    audio().duration = 100;
    await tick(1_000);
    audio().end();
    expect(audio().src).toMatch(silence);
    expect(listenPlayerNow()).toMatchObject({ status: "starting", track: { id: "s2" } });
    expect(isListening()).toBe(true);
    await tick(2_050);
    expect(audio().src).toBe(link("s2"));
    await tick(0);
    expect(ops("play")).toEqual([
      { song: "s1", at: 99, next: "s2" },
      { song: "s2", at: 0 },
    ]);
    // the last one over: nothing plays, and the server counts nobody
    audio().duration = 120;
    await tick(120_000);
    expect(listenPlayerNow()).toMatchObject({ status: "paused", track: { id: "s2" } });
    expect(ops("stop")).toEqual([{}]);
  });

  it("pauses only you, and ▶ goes back to where everyone is", async () => {
    await joinPlaying(30_000);
    toggle();
    expect(audio().paused).toBe(true);
    expect(listenPlayerNow().status).toBe("paused");
    expect(said.at(-1)).toBe("只停了你自己，大家还在听。");
    await tick(6_000);
    expect(audio().paused).toBe(true);
    expect(ops("stop")).toEqual([]);
    toggle();
    expect(audio().paused).toBe(false);
    expect(audio().currentTime).toBe(36);
    expect(said.at(-1)).toBe("跳回大家这里了：0:36");
    expect(ops("play")).toHaveLength(1);
  });

  it("waits for the host, and starts with everyone when told to, the room told in a bubble", async () => {
    answerRoom("join", () => roomOf());
    await joinAt("inv-1");
    await tick(0);
    expect(listenPlayerNow()).toMatchObject({ status: "paused", tap: false, track: { id: "s1" } });
    expect(ops("play")).toEqual([]);
    toggle();
    expect(said.at(-1)).toBe("等发起人点开始。");
    // an older word about the room changes nothing
    heardListen(JSON.stringify({ t: "state", room: "r1", how: "start", queue: ["s1"], idx: 0, startedAt: serverClock(), version: 1 }));
    expect(listenRoomNow()?.startedAt).toBeNull();
    heardListen(JSON.stringify({ t: "state", room: "r1", how: "start", queue: ["s1", "s2"], idx: 0, startedAt: serverClock() + 1_000, version: 2 }));
    expect(listenBubblesNow().map((b) => [b.kind, b.text])).toEqual([["sys", "开始一起听：《One》"]]);
    expect(audio().src).toMatch(silence);
    await tick(1_050);
    expect(ops("play")).toEqual([{ song: "s1", at: 0, next: "s2" }]);
    await tick(0);
    expect(audio().src).toBe(link("s1"));
  });

  it("asks for a tap on a page opened again in a room, and goes to the room's second on it", async () => {
    answerRoom("room", () => roomOf({ startedAt: serverClock() - 10_000 }));
    await loadRoom();
    await tick(0);
    expect(listenPlayerNow()).toMatchObject({ status: "paused", tap: true, track: { id: "s1" } });
    expect(ops("play")).toEqual([]);
    toggle();
    expect(audio().src).toMatch(silence);
    expect(said).toEqual(["跟上了：和大家都在 0:10"]);
    await tick(0);
    expect(ops("play")).toEqual([{ song: "s1", at: 10, next: "s2" }]);
    // a song from the list does not play over the room's
    playTrack(track("s3"));
    expect(ops("play")).toHaveLength(1);
  });

  it("shows 短评 at once, one every three seconds, the same one from several as one, ×N", async () => {
    await joinPlaying(30_000);
    sendRx(0);
    sendRx(1);
    expect(ops("react")).toEqual([{ r: 0 }]);
    expect(listenBubblesNow().map((b) => [b.kind, b.text])).toEqual([["me", "你：好听！"]]);
    expect(listenRxNow().cool).toBe(true);
    // yours back from the server is not shown twice; one from a number not in the list yet, without a name
    heardListen({ t: "rx", room: "r1", items: [{ h: 1, r: 0 }, { h: 2, r: 0 }, { h: 3, r: 0 }, { h: 1, r: 99 }] });
    expect(listenBubblesNow().map((b) => [b.kind, b.text])).toEqual([["agg", "好听！ ×3"]]);
    heardListen({ t: "rx", room: "r1", items: [{ h: 1, r: 8 }] });
    expect(listenBubblesNow().map((b) => b.text)).toEqual(["好听！ ×3", "Dr.岚：kksk"]);
    await tick(3_000);
    expect(listenRxNow().cool).toBe(false);
    await tick(300);
    expect(listenBubblesNow()).toEqual([]);
    // this song's used up: the buttons grey
    answers.react = () => ({ status: 200, json: { sent: false, full: true, now: serverClock() } });
    sendRx(2);
    await tick(0);
    expect(listenRxNow().full).toBe(true);
    await tick(3_000);
    sendRx(3);
    expect(ops("react")).toHaveLength(2);
  });

  it("asks who is in the room again a moment after it is told, and floats who came and went", async () => {
    await joinPlaying(30_000);
    answerRoom("room", () => roomOf({ startedAt: serverClock() - 31_000, members: [member(1, "Dr.岚", true), member(2, "Dr.桐"), member(3, "夜班博士")] }));
    heardListen({ t: "members", room: "r1" });
    heardListen({ t: "members", room: "r1" });
    // another room's word is not this one's
    heardListen({ t: "members", room: "r9" });
    await tick(1_600);
    expect(ops("room")).toHaveLength(1);
    expect(listenBubblesNow().map((b) => b.text)).toEqual(["夜班博士 来了！"]);
    answerRoom("room", () => roomOf({ startedAt: serverClock() - 33_000 }));
    heardListen({ t: "members", room: "r1" });
    await tick(1_600);
    expect(listenBubblesNow().map((b) => b.text)).toContain("夜班博士 走了");
  });

  it("fades out when the room ends, says who ended it, and leaves the server counting nobody", async () => {
    await joinPlaying(30_000);
    heardListen({ t: "end", room: "r1", why: "host" });
    expect(listenRoomNow()).toBeNull();
    expect(listenPlayerNow().status).toBe("idle");
    expect(said.at(-1)).toBe("Dr.岚 结束了这次一起听。");
    await tick(0);
    expect(ops("stop")).toEqual([{}]);
    await tick(1_000);
    expect(audio().volume).toBeLessThan(1);
    await tick(1_100);
    expect(audio().paused).toBe(true);
    expect(audio().volume).toBe(1);
  });

  it("leaves, and tells the server as the page goes so the room keeps your place a while", async () => {
    await joinPlaying(30_000);
    page.dispatchEvent(new Event("pagehide"));
    await tick(0);
    expect(ops("stop")).toEqual([{ away: true }]);
    expect(await leaveListen()).toBe(true);
    expect(ops("leave")).toEqual([{}]);
    expect(listenRoomNow()).toBeNull();
    expect(said.at(-1)).toBe("你离开了 Dr.岚 的一起听。");
  });

  it("lets the host skip to the next song, said to everyone once however the change comes back", async () => {
    const startedAt = await joinPlaying(30_000, { host: true, you: 1 });
    const nextAt = serverClock() + 1_000;
    const next = () => roomOf({ host: true, you: 1, queue: ["s2"], startedAt: nextAt, version: 2 });
    answerRoom("queue", next);
    expect(await hostQueue("next")).toBe(true);
    expect(ops("queue")).toEqual([{ next: true }]);
    // the room's own word on it comes after: nothing more
    heardListen({ t: "state", room: "r1", how: "next", ...next(), version: 2 });
    expect(listenBubblesNow().map((b) => b.text)).toEqual(["下一首：《Two》"]);
    expect(audio().src).toMatch(silence);
    await tick(1_050);
    expect(audio().src).toBe(link("s2"));
    expect(startedAt).toBeLessThan(serverClock());
    // a song added while one plays waits its turn: the host is told it is in
    answerRoom("queue", () => roomOf({ host: true, you: 1, queue: ["s2", "s3"], startedAt: nextAt, version: 3 }));
    await hostQueue({ add: "s3" });
    expect(said.at(-1)).toBe("加到一起听：Three");
  });

  it("opens a room of your own within the tap, and its host's ▶ before the start is 开始", async () => {
    answerRoom("open", () => roomOf({ host: true, you: 1, queue: ["s1"] }));
    const opened = openRoomWith(null, ["f1"]);
    // the element is unlocked within the tap, for the room to start by itself later
    expect(audio().src).toMatch(silence);
    expect(await opened).toEqual([]);
    expect(ops("open")).toEqual([{ song: null, invite: ["f1"] }]);
    await tick(0);
    expect(listenPlayerNow()).toMatchObject({ status: "paused", track: { id: "s1" } });
    answerRoom("queue", () => roomOf({ host: true, you: 1, queue: ["s1"], startedAt: serverClock() + 1_000, version: 2 }));
    toggle();
    expect(ops("queue")).toEqual([{ start: true }]);
    await tick(0);
    expect(listenBubblesNow().map((b) => b.text)).toEqual(["开始一起听：《One》"]);
    await tick(1_050);
    expect(ops("play")).toEqual([{ song: "s1", at: 0 }]);
  });

  it("says why it could not go in, and stays out", async () => {
    answers.join = () => ({ status: 409, json: { error: "这场满了。", code: "ROOM_FULL" } });
    expect(await joinAt("inv-1")).toBe(false);
    expect(said).toEqual(["这场满了。"]);
    expect(listenRoomNow()).toBeNull();
  });
});
