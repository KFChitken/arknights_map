import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  DANCE_IDLE_MS,
  DANCE_MATE_MAX,
  DANCE_MATE_MIN,
  DANCE_TAP_EVERY_MS,
  danceJudge,
  danceMove,
  mateAim,
  mateCombo,
  type LobbyMode,
  type QuizMode,
  type SoloDance,
} from "@/lib/squadMode";
import { DanceView, beatsBy, danceMates, danceNow, danceSeed, musicWords } from "./SquadDance";
import { PlayGrid, fireLook, modeRow, type FishLook } from "./SquadPlays";
import { closeSquadDance, forgetSquadPage, loadSquadRoom, soloEnds, squadDanceOpen, squadDanceTap, squadSoloNow, type SoloDanceNow } from "./squading";

// 「玩」's tiles, and 龙门广场舞 danced alone, on the page

const NOW = Date.parse("2026-11-20T13:00:00+08:00");
const member = (h: number, more: Partial<SquadMember> = {}): SquadMember => ({
  h,
  name: ["", "银灰厨", "企鹅物流", "漏勺本勺", "小龙"][h] ?? `人机 ${-h}`,
  host: h === 1,
  you: h === 1,
  friend: false,
  inGame: true,
  pose: 0,
  avatar: "hood",
  color: "cyan",
  core: 0,
  strategy: null,
  extras: [],
  ...more,
});
/** 凯尔希随堂测 picked by 企鹅物流 (h 2), TA alone ready */
const lobby = (more: Partial<LobbyMode> = {}): LobbyMode => ({
  kind: "quiz",
  wait: true,
  by: 2,
  at: NOW - 20_000,
  in: [{ h: 2, combo: 0 }],
  played: 0,
  endsAt: NOW + 160_000,
  until: NOW + 160_000,
  ...more,
});
const room = (more: Partial<SquadRoom> = {}): SquadRoom => ({
  id: "r1",
  server: "cn",
  level: 3,
  tags: [],
  state: "go",
  friendsOnly: false,
  stopped: false,
  key: "k",
  keyAt: NOW,
  keyLeft: 3,
  you: 1,
  host: true,
  staff: false,
  members: [member(1), member(2), member(3), member(4)],
  wentAt: NOW - 600_000,
  waitedAt: NOW,
  fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
  stack: { round: 1, at: NOW, n: 0, sum: 0, top: [], swingAt: NOW, best: 0, busy: [] },
  mode: null,
  endsAt: NOW + 3_600_000,
  endsWhy: "idle",
  declared: false,
  invited: [],
  hear: true,
  listen: null,
  now: NOW,
  ...more,
});
const nothing = () => {};

describe("「玩」's tiles", () => {
  it("offers a match to pick while nothing plays, and once the one playing is over; another waits for it", () => {
    expect(modeRow(room(), "race", NOW)).toEqual({ kind: "race", label: "发起", does: "open" });
    expect(modeRow(room({ mode: lobby({ endsAt: NOW }) }), "quiz", NOW).does).toBe("open");
    expect(modeRow(room({ mode: lobby() }), "race", NOW)).toEqual({ kind: "race", label: "等凯尔希随堂测这局完（一次只能玩一个）", does: null });
  });

  const grid = (r: SquadRoom, fish: FishLook = "rest", msg: string | null = null) =>
    renderToStaticMarkup(createElement(PlayGrid, { room: r, now: NOW, fish, busy: false, msg, onFish: nothing, onFire: nothing, onStack: nothing, onDance: nothing, onMode: nothing }));

  it("shows every game as an icon and its name, nothing more", () => {
    const html = grid(room());
    expect(html.match(/<button type="button" class="tile/g)).toHaveLength(7);
    for (const name of ["钓鳞", "添柴", "基建加盖", "龙门广场舞", "凯尔希随堂测", "W 的礼物", "企鹅物流急件赛"]) expect(html).toContain(`<b>${name}</b>`);
    expect(html).toContain('class="tile k-dance"');
    expect(html).toContain('class="pg-ico dance"');
    expect(html).toContain('class="pg-ico race"');
    expect(html).toContain('class="tile k-stack"');
    expect(html).not.toContain("<small>");
    expect(html).not.toContain('class="now"');
  });

  it("puts 钓鳞, 添柴, 基建加盖 and 龙门广场舞 under 随时能玩, the three matches under 一次玩一个, the tower's tile saying how high it is", () => {
    const html = grid(room({ stack: { round: 3, at: NOW, n: 23, sum: 0, top: [], swingAt: NOW, best: 30, busy: [] }, mode: lobby() }));
    const at = (s: string) => html.indexOf(s);
    expect(at('<p class="grp">随时能玩</p>')).toBeGreaterThanOrEqual(0);
    expect(at("随时能玩")).toBeLessThan(at("<b>钓鳞</b>"));
    expect(at("<b>基建加盖</b>")).toBeLessThan(at("<b>龙门广场舞</b>"));
    expect(at("<b>龙门广场舞</b>")).toBeLessThan(at('<p class="grp">一次玩一个 · 比赛要先等人</p>'));
    expect(at("一次玩一个")).toBeLessThan(at("<b>凯尔希随堂测</b>"));
    expect(html).toContain('<em class="lv">23 层</em>');
    expect(html).toContain('aria-label="基建加盖 · 23 层"');
    // a match playing leaves the tower's tile and the dance's as they are
    expect(html).toContain('class="tile k-stack"');
    expect(html).toContain('class="tile k-dance"');
    // a tower that fell, till its new plank: 0
    expect(grid(room({ stack: { round: 3, at: NOW, n: 9, sum: 0, top: [], fell: { at: NOW - 1_000, height: 8 }, swingAt: NOW, best: 30, busy: [] } }))).toContain('<em class="lv">0 层</em>');
  });

  it("draws 钓鳞 as its line stands, and the fire as it burns with its level and the sticks in your hand", () => {
    expect(grid(room(), "rest")).toContain('class="pg-ico fish rest"');
    expect(grid(room(), "line")).toContain('class="pg-ico fish line"');
    const bite = grid(room(), "bite");
    expect(bite).toContain('class="pg-ico fish bite"');
    expect(bite).toContain('class="tile k-fish alert"');
    expect(bite).toContain('aria-label="钓鳞：咬钩了"');
    expect([0, 1, 9, 10, 49, 50, 300].map(fireLook)).toEqual(["out", "small", "small", "big", "big", "roar", "roar"]);
    const fire = (level: number, wood?: number) =>
      grid(
        room({
          fire: { level, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
          members: [member(1, wood === undefined ? {} : { wood, woodAt: NOW }), member(2), member(3), member(4)],
        }),
      );
    const out = fire(0, 0);
    expect(out).toContain('class="pg-ico fire out"');
    expect(out).not.toContain(">Lv.");
    expect(out).toContain('<em class="wood"><i aria-hidden="true"></i>0</em>');
    const big = fire(23, 2);
    expect(big).toContain('class="pg-ico fire big"');
    expect(big).toContain('<em class="lv">Lv.23</em>');
    expect(big).toContain('<em class="wood"><i aria-hidden="true"></i>2</em>');
    expect(big).toContain('aria-label="篝火 Lv.23 · 手里 2 根柴"');
    // a full hand never used
    expect(fire(60)).toContain('<em class="wood"><i aria-hidden="true"></i>3</em>');
  });

  it("marks the match playing, the others off till it ends; says why the last tap did not go", () => {
    const waiting = grid(room({ mode: lobby() }));
    expect(waiting).toContain('<em class="tag join">等人 1/4</em>');
    expect(waiting).toContain('class="tile k-race off"');
    expect(waiting).toContain('<p class="now">正在等人：凯尔希随堂测（1/4 准备了）· 一次只能玩一个</p>');
    const free = grid(room());
    expect(free).not.toContain('<em class="tag">');
    expect(free).toContain('aria-label="凯尔希随堂测 · 发起"');
    expect(grid(room(), "rest", "比赛中，跑完再跳")).toContain('<p class="pmsg" role="status">比赛中，跑完再跳</p>');
  });
});

describe("龙门广场舞's rule", () => {
  it("gets fancier every five on the beat: 晃, 跳, 转圈, 左右横跳, 甩头, 后空翻, 群魔乱舞", () => {
    expect([0, 4, 5, 9, 10, 14, 15, 19, 20, 24, 25, 29, 30, 99].map(danceMove)).toEqual([
      "sway",
      "sway",
      "hop",
      "hop",
      "spin",
      "spin",
      "side",
      "side",
      "bang",
      "bang",
      "flip",
      "flip",
      "wild",
      "wild",
    ]);
  });

  it("judges a tap against the beats: on one the combo up, off back to 0, one too soon after the last counting for nothing", () => {
    const beats = [0.5, 1, 1.5, 2, 2.5, 3];
    expect(danceJudge(beats, NOW, 0, null, NOW + 1_000)).toEqual({ combo: 1, ok: true, counted: true });
    expect(danceJudge(beats, NOW, 1, NOW + 1_000, NOW + 1_140)).toEqual({ combo: 1, ok: false, counted: false });
    expect(danceJudge(beats, NOW, 1, NOW + 1_000, NOW + 1_000 + DANCE_TAP_EVERY_MS)).toMatchObject({ counted: true });
    expect(danceJudge(beats, NOW, 1, NOW + 1_000, NOW + 1_510)).toEqual({ combo: 2, ok: true, counted: true });
    expect(danceJudge(beats, NOW, 2, NOW + 1_510, NOW + 1_760)).toEqual({ combo: 0, ok: false, counted: true });
    expect(danceJudge(null, NOW, 5, null, NOW + 1_000)).toEqual({ combo: 0, ok: false, counted: true });
  });

  it("has each one beside you hit the beats at their own accuracy, 80% to 97%, the same every time for the same dance", () => {
    for (const seed of [1, 22, 333, 4444, 55555, 0x9e3779b1]) {
      const aim = mateAim(seed);
      expect(aim).toBeGreaterThanOrEqual(DANCE_MATE_MIN);
      expect(aim).toBeLessThanOrEqual(DANCE_MATE_MAX);
      const run = Array.from({ length: 200 }, (_, k) => mateCombo(seed, k));
      expect(Array.from({ length: 200 }, (_, k) => mateCombo(seed, k))).toEqual(run);
      const hits = run.filter((c, k) => c === (k ? run[k - 1] : 0) + 1).length / run.length;
      expect(Math.abs(hits - aim)).toBeLessThan(0.1);
    }
    expect(danceSeed(2, NOW)).toBe(danceSeed(2, NOW));
    expect(danceSeed(2, NOW)).not.toBe(danceSeed(3, NOW));
    expect(danceSeed(2, NOW)).not.toBe(danceSeed(2, NOW + 200_000));
  });

  it("dances 群魔乱舞 as one of the six by the seed, a new one every four bars; one in a climax, or beside you in it, too", () => {
    const seed = danceSeed(2, NOW);
    expect(danceNow(3, seed, 5, false)).toEqual({ mv: "sway", wild: false });
    expect(danceNow(17, seed, 5, false)).toEqual({ mv: "side", wild: false });
    const bars = Array.from({ length: 24 }, (_, i) => danceNow(30, seed, i * 16 + 3, false));
    expect(bars.every((x) => x.wild)).toBe(true);
    expect(new Set(bars.map((x) => x.mv)).size).toBeGreaterThanOrEqual(3);
    // the same within four bars
    expect(danceNow(30, seed, 32, false)).toEqual(danceNow(30, seed, 47.9, false));
    expect(danceNow(2, seed, 40, true)).toEqual(danceNow(30, seed, 40, false));
    expect(beatsBy([0.5, 1, 1.5], 1)).toBe(2);
    expect(beatsBy([0.5, 1, 1.5], 0.2)).toBe(0);
  });
});

describe("龙门广场舞's card", () => {
  const song = (more: Partial<SoloDance> = {}): SoloDance => ({ song: "s1", name: "Operation Pyrite", seconds: 150, dance: "", songAt: NOW - 17_000, url: "/music/a.m4a", now: NOW, ...more });
  const solo = (more: Partial<SoloDanceNow> = {}): SoloDanceNow => ({
    key: 1,
    song: song(),
    beats: null,
    combo: 0,
    best: 0,
    last: null,
    tapAt: NOW - 1_000,
    judge: null,
    wildAt: null,
    err: null,
    ...more,
  });
  const view = (r: SquadRoom, d: SoloDanceNow, more: { now?: number; judge?: { ok: boolean; at: number } | null; wild?: number | null } = {}) =>
    renderToStaticMarkup(
      createElement(DanceView, {
        room: r,
        d,
        now: more.now ?? NOW,
        mates: danceMates(r, d.song?.bots),
        plan: null,
        judge: more.judge ?? null,
        wild: more.wild ?? null,
        music: "on",
        onClose: nothing,
        onTap: nothing,
        onTapClick: nothing,
        onMusic: nothing,
        onAgain: nothing,
      }),
    );

  it("puts you leading in the middle, the room's others round you (three at most); alone, the two 人机 given", () => {
    const html = view(room(), solo());
    const at = (name: string) => html.indexOf(`<span class="nm">${name}</span>`);
    expect(at("小龙")).toBeLessThan(at("企鹅物流"));
    expect(at("企鹅物流")).toBeLessThan(at("你"));
    expect(at("你")).toBeLessThan(at("漏勺本勺"));
    expect(html).toContain("<b>龙门广场舞 · 4 人</b>");
    expect(html).toContain("<em>领舞</em>");
    const bots: SoloDance["bots"] = [
      { h: -100, no: 1, avatar: "imp", color: "red" },
      { h: -101, no: 2, avatar: "gugu", color: "gold" },
    ];
    const alone = view(room({ members: [member(1)] }), solo({ song: song({ bots }) }));
    expect(alone).toContain('<span class="nm">人机 1</span>');
    expect(alone).toContain('<span class="nm">人机 2</span>');
    expect(alone).toContain("<b>龙门广场舞 · 3 人</b>");
    expect(danceMates(room({ members: [member(1), member(2)] }), bots).map((m) => m.h)).toEqual([2]);
  });

  it("says your COMBO and your move, 准！ or 歪了, 群魔乱舞！ as it comes, everyone in it with you and the stage lit", () => {
    const html = view(room(), solo({ combo: 12 }));
    expect(html).toContain("<b>12</b><small>COMBO</small>");
    expect(html).toContain("连击 10 以上：转圈");
    expect(html).toContain('data-mv="spin"');
    expect(html).not.toContain('class="sq-dance wild"');
    const wild = view(room(), solo({ combo: 31 }), { judge: { ok: true, at: 5 }, wild: 9 });
    expect(wild).toContain('class="sq-dance wild"');
    expect(wild).toContain("连击 30 以上：群魔乱舞");
    expect(wild).toContain(">群魔乱舞！</span>");
    expect(wild).toContain(">准！</span>");
    expect(wild.match(/class="dancer[^"]* wild"/g)).toHaveLength(4);
  });

  it("counts down to its song, says why there is none, and once over gives your best and fanciest with 再跳一首", () => {
    expect(view(room(), solo({ song: song({ songAt: NOW + 2_400 }) }))).toContain("♪ Operation Pyrite · 3 秒后开始");
    expect(view(room(), solo({ song: null }))).toContain("正在挑歌…");
    expect(view(room(), solo({ song: null, err: "现在没有能跳的歌。" }))).toContain("现在没有能跳的歌。");
    expect(view(room(), solo())).toContain(">跳</button>");
    const over = view(room(), solo({ combo: 0, best: 23, tapAt: NOW - DANCE_IDLE_MS - 1 }));
    expect(over).toContain("这首跳完了：最高连击 23，最花跳到「甩头」");
    expect(over).toContain(">再跳一首</button>");
    expect(over).not.toContain(">跳</button>");
  });

  it("ends with its song, or 15 s with no tap (from its song's start, with none)", () => {
    const d = solo({ song: song({ songAt: NOW, seconds: 100 }), tapAt: null });
    expect(soloEnds(d)).toBe(NOW + DANCE_IDLE_MS);
    expect(soloEnds({ ...d, tapAt: NOW + 50_000 })).toBe(NOW + 50_000 + DANCE_IDLE_MS);
    expect(soloEnds({ ...d, tapAt: NOW + 99_000 })).toBe(NOW + 100_000);
    expect(soloEnds({ ...d, song: null })).toBe(Number.POSITIVE_INFINITY);
  });

  it("says what the music does: the player's own switch, none without 听歌, 听歌 playing it or another, a tap needed first", () => {
    expect(musicWords("on")).toEqual({ line: "音乐：开", sub: "只关你自己的", off: false });
    expect(musicWords("off")).toEqual({ line: "音乐：关", sub: "只关你自己的", off: false });
    expect(musicWords("none")).toEqual({ line: "音乐：没有", sub: "听歌还没开给你", off: true });
    expect(musicWords("here")).toEqual({ line: "音乐：听歌在放", sub: "就是一起听这首", off: true });
    expect(musicWords("else")).toEqual({ line: "音乐：先不放", sub: "听歌在放别的歌", off: true });
    expect(musicWords("blocked")).toEqual({ line: "音乐：点一下放", sub: "只关你自己的", off: false });
  });
});

describe("the dance on the page", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Beats every half second from half a second in, for 200 s */
  const BEATS = `{"v":1,"bpm":120,"bar":0,"t":"${Array(400).fill("50").join(",")}","e":"${"9".repeat(400)}"}`;
  /** The room as the server gives it, and the dance's song as given; what was asked, kept */
  function page(r: SquadRoom, dance: (body: Record<string, unknown>) => { status: number; json: unknown }) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const asked: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      asked.push({ url, body });
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      const res = dance(body);
      return new Response(JSON.stringify(res.json), { status: res.status });
    });
    return asked;
  }

  it("asks for a song not the one just danced, opens at once, and judges each 跳 here against its beats, sending nothing", async () => {
    const asked = page(room({ state: "wait" }), () => ({ status: 200, json: { song: "s1", name: "Song 1", seconds: 200, dance: BEATS, songAt: NOW + 3_000, now: NOW } }));
    await loadSquadRoom();
    const opening = squadDanceOpen();
    expect(squadSoloNow()).toMatchObject({ song: null, combo: 0 });
    await opening;
    expect(asked.find((x) => x.url === "/api/squad/dance")?.body).toEqual({ not: [] });
    expect(squadSoloNow()!.song?.song).toBe("s1");
    // the song's 0 at NOW + 3 s, its beats every half second from half a second in
    const tap = (t: number) => {
      vi.setSystemTime(NOW + 3_000 + t);
      squadDanceTap();
    };
    tap(1_000);
    expect(squadSoloNow()).toMatchObject({ combo: 1, best: 1, judge: { ok: true } });
    tap(1_100);
    expect(squadSoloNow()!.combo).toBe(1);
    tap(1_500);
    expect(squadSoloNow()).toMatchObject({ combo: 2, best: 2 });
    tap(1_750);
    expect(squadSoloNow()).toMatchObject({ combo: 0, best: 2, judge: { ok: false } });
    expect(asked.filter((x) => x.url !== "/api/squad/room" && x.url !== "/api/squad/dance")).toEqual([]);
    // 再跳一首: another song, the last one not asked for
    await squadDanceOpen();
    expect(asked.filter((x) => x.url === "/api/squad/dance").at(-1)?.body).toEqual({ not: ["s1"] });
    expect(squadSoloNow()).toMatchObject({ combo: 0, best: 0 });
    closeSquadDance();
    expect(squadSoloNow()).toBeNull();
  });

  it("is refused while a match's round you are in plays: run it first", async () => {
    const round = { ...lobby(), wait: undefined, begun: NOW - 5_000, next: [], questions: [], in: [{ h: 1, combo: 0 }, { h: 2, combo: 0 }] } as unknown as QuizMode;
    const asked = page(room({ mode: round }), () => ({ status: 200, json: {} }));
    await loadSquadRoom();
    await expect(squadDanceOpen()).rejects.toThrow("比赛中，跑完再跳");
    expect(squadSoloNow()).toBeNull();
    expect(asked.some((x) => x.url === "/api/squad/dance")).toBe(false);
  });
});
