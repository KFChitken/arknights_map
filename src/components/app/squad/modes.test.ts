import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import type { DanceMode, SquadMode } from "@/lib/squadMode";
import { DanceView, danceRow, musicWords, type DanceMusic } from "./SquadDance";
import { InviteLine, inviteOf } from "./SquadModeInvite";
import { PlayGrid, fireLook, modeRow, type FishLook } from "./SquadPlays";
import { forgetSquadPage, heardSquad, loadSquadRoom, squadDanceJudgeNow, squadDanceTap, squadRoomNow } from "./squading";

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
const dance = (more: Partial<DanceMode> = {}): DanceMode => ({
  kind: "dance",
  by: 2,
  at: NOW - 20_000,
  in: [{ h: 2, combo: 0 }],
  endsAt: NOW + 10_000,
  song: "s1",
  name: "Operation Pyrite",
  songAt: NOW - 17_000,
  until: NOW + 150_000,
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
  it("offers 开 while nothing plays, to its last opener too (no wait), and once the mode playing is over", () => {
    expect(modeRow(room(), "dance", NOW)).toEqual({ kind: "dance", label: "开", does: "open" });
    // a match's: 发起 (you its initiator)
    expect(modeRow(room(), "race", NOW)).toEqual({ kind: "race", label: "发起", does: "open" });
    expect(modeRow(room({ mode: dance({ endsAt: NOW }) }), "dance", NOW).does).toBe("open");
    expect(modeRow(room({ mode: dance() }), "dance", NOW)).toEqual({ kind: "dance", label: "正在玩 · 加入", does: "join", tag: "加入" });
    const mine = room({ mode: dance({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 3 }] }) });
    expect(modeRow(mine, "dance", NOW)).toEqual({ kind: "dance", label: "在玩 · 打开", does: "look", tag: "在玩" });
    expect(modeRow(mine, "quiz", NOW)).toEqual({ kind: "quiz", label: "等龙门广场舞这局完（一次只能玩一个）", does: null });
  });

  const grid = (r: SquadRoom, fish: FishLook = "rest", msg: string | null = null) =>
    renderToStaticMarkup(createElement(PlayGrid, { room: r, now: NOW, fish, busy: false, msg, onFish: nothing, onFire: nothing, onStack: nothing, onMode: nothing }));

  it("shows every game as an icon and its name, nothing more", () => {
    const html = grid(room({ fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 } }));
    expect(html.match(/<button type="button" class="tile/g)).toHaveLength(7);
    expect(html).toContain("<b>钓鳞</b>");
    expect(html).toContain("<b>添柴</b>");
    expect(html).toContain("<b>龙门广场舞</b>");
    expect(html).toContain("<b>凯尔希随堂测</b>");
    expect(html).toContain("<b>W 的礼物</b>");
    expect(html).toContain("<b>企鹅物流急件赛</b>");
    expect(html).toContain('class="pg-ico race"');
    expect(html).toContain("<b>基建加盖</b>");
    expect(html).toContain('class="tile k-stack"');
    expect(html).toContain('class="pg-ico stack"');
    expect(html).not.toContain("<small>");
    expect(html).not.toContain('class="now"');
  });

  it("puts 钓鳞, 添柴 and 基建加盖 under 随时能玩, the four modes under 一次玩一个, the tower's tile saying how high it is", () => {
    const html = grid(room({ stack: { round: 3, at: NOW, n: 23, sum: 0, top: [], swingAt: NOW, best: 30, busy: [] }, mode: dance() }));
    const at = (s: string) => html.indexOf(s);
    expect(at('<p class="grp">随时能玩</p>')).toBeGreaterThanOrEqual(0);
    expect(at("随时能玩")).toBeLessThan(at("<b>钓鳞</b>"));
    expect(at("<b>基建加盖</b>")).toBeLessThan(at('<p class="grp">一次玩一个 · 比赛要先等人</p>'));
    expect(at("一次玩一个")).toBeLessThan(at("<b>龙门广场舞</b>"));
    expect(html).toContain('<em class="lv">23 层</em>');
    expect(html).toContain('aria-label="基建加盖 · 23 层"');
    // a mode playing leaves the tower's tile as it is
    expect(html).toContain('class="tile k-stack"');
    expect(html).not.toContain("k-stack off");
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

  it("marks the mode playing (in it, or to join), the others off till it ends, and no wait after one", () => {
    const playing = grid(room({ mode: dance() }));
    expect(playing).toContain('<em class="tag join">加入</em>');
    expect(playing).toContain('class="tile k-quiz off"');
    expect(playing).toContain('<p class="now">正在玩：龙门广场舞（1 人）· 一次只能玩一个</p>');
    const mine = grid(room({ mode: dance({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 3 }] }) }));
    expect(mine).toContain('<em class="tag in">在玩</em>');
    const free = grid(room());
    expect(free).not.toContain('<em class="tag">');
    expect(free).toContain('aria-label="龙门广场舞 · 开"');
    expect(grid(room(), "rest", "等这局完")).toContain('<p class="pmsg" role="status">等这局完</p>');
  });
});

describe("the line asking one to join", () => {
  it("asks everyone in the room not in it, never its opener, nor one who put it away, joined or went to watch, nor over its card", () => {
    const m = dance();
    expect(inviteOf(room({ mode: m }), null, null)).toBe(m);
    expect(inviteOf(room({ mode: m }), m.at, null)).toBeNull();
    expect(inviteOf(room({ mode: m }), null, m.at)).toBeNull();
    expect(inviteOf(room({ mode: dance({ by: 1, in: [{ h: 1, combo: 0 }] }) }), null, null)).toBeNull();
    expect(inviteOf(room({ mode: dance({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }) }), null, null)).toBeNull();
    // a dance put away, and another opened later: asked again
    expect(inviteOf(room({ mode: dance({ at: m.at + 90_000 }) }), m.at, null)).not.toBeNull();
    expect(inviteOf(room(), null, null)).toBeNull();
  });

  it("names its opener and the mode, and how many dance", () => {
    const html = (r: SquadRoom) =>
      renderToStaticMarkup(createElement(InviteLine, { room: r, mode: r.mode!, busy: false, note: null, onJoin: nothing, onNo: nothing }));
    const out = html(room({ mode: dance({ in: [{ h: 2, combo: 0 }, { h: 3, combo: 4 }] }) }));
    expect(out).toContain('<b>企鹅物流</b> 开了<b class="md">龙门广场舞</b>（2 人在跳），加入？');
    expect(out).toContain(">加入</button>");
    expect(out).toContain('aria-label="不加入龙门广场舞">不了</button>');
    expect(html(room({ mode: dance(), members: [member(1), member(3)] }))).toContain('<b class="md">龙门广场舞</b>正在跳（1 人），加入？');
  });
});

describe("龙门广场舞", () => {
  it("puts the one leading in the middle and the others round TA, the rest of the room watching", () => {
    const r = room();
    const order = (m: SquadMode) => danceRow(r, m).row.map((d) => [d.m.h, d.lead]);
    expect(order(dance({ by: 1, in: [{ h: 1, combo: 0 }] }))).toEqual([[1, true]]);
    expect(order(dance({ by: 1, in: [{ h: 1, combo: 0 }, { h: 2, combo: 0 }] }))).toEqual([[2, false], [1, true]]);
    expect(order(dance({ by: 1, in: [1, 2, 3].map((h) => ({ h, combo: 0 })) }))).toEqual([[2, false], [1, true], [3, false]]);
    expect(order(dance({ by: 1, in: [1, 2, 3, 4].map((h) => ({ h, combo: 0 })) }))).toEqual([[4, false], [2, false], [1, true], [3, false]]);
    // the one leading gone to watch: the rest as they are
    expect(order(dance({ by: 1, in: [{ h: 3, combo: 0 }, { h: 2, combo: 0 }] }))).toEqual([[3, false], [2, false]]);
    expect(danceRow(r, dance({ by: 1, in: [{ h: 1, combo: 0 }, { h: 3, combo: 0 }] })).watchers.map((m) => m.h)).toEqual([2, 4]);
  });

  it("dances each as their combo has it, your COMBO and your move in words, 跳 and 不跳了 to you in it, 加入一起跳 to you watching", () => {
    const html = (m: DanceMode, more: { now?: number; music?: DanceMusic; judge?: { ok: boolean; at: number } | null } = {}) =>
      renderToStaticMarkup(
        createElement(DanceView, {
          room: room({ mode: m }),
          mode: m,
          now: more.now ?? NOW,
          judge: more.judge ?? null,
          music: more.music ?? "on",
          busy: false,
          msg: null,
          onClose: nothing,
          onTap: nothing,
          onTapClick: nothing,
          onJoin: nothing,
          onMusic: nothing,
          onLeave: nothing,
        }),
      );
    const m = dance({ by: 2, in: [{ h: 2, combo: 12 }, { h: 1, combo: 6 }, { h: 3, combo: 0 }] });
    const out = html(m, { judge: { ok: true, at: 1 } });
    expect(out).toContain("龙门广场舞 · 3 人");
    expect(out).toContain("♪ Operation Pyrite · 0:17 / 2:47");
    expect(out).toContain("<b>6</b><small>COMBO</small>");
    expect(out).toContain('data-mv="spin"');
    expect(out).toContain('data-mv="hop"');
    expect(out).toContain('data-mv="sway"');
    expect(out).toContain("<em>领舞</em>");
    expect(out).toContain("连击 5 以上：跳起来");
    expect(out).toContain('<span class="judge ok" role="status">准！</span>');
    expect(out).toContain('aria-label="在拍子上点一下：跳">跳</button>');
    expect(out).toContain("不跳了，去围观");
    expect(out).toContain("<small>围观</small>");
    expect(html(m, { judge: { ok: false, at: 2 } })).toContain('<span class="judge" role="status">歪了</span>');
    // watching: no COMBO, 加入一起跳, no 不跳了
    const watching = html(dance({ in: [{ h: 2, combo: 3 }] }));
    expect(watching).not.toContain("COMBO");
    expect(watching).toContain(">加入一起跳</button>");
    expect(watching).not.toContain("不跳了");
    expect(watching).toContain("你在围观");
    expect(watching).toContain("<small>你 · 围观</small>");
  });

  it("counts down to its song, and once it is over says so with 跳 shut", () => {
    const m = dance({ by: 1, in: [{ h: 1, combo: 0 }], songAt: NOW + 2_100, until: NOW + 182_100 });
    const html = (now: number, mm = m) =>
      renderToStaticMarkup(
        createElement(DanceView, {
          room: room({ mode: mm }),
          mode: mm,
          now,
          judge: null,
          music: "off",
          busy: false,
          msg: null,
          onClose: nothing,
          onTap: nothing,
          onTapClick: nothing,
          onJoin: nothing,
          onMusic: nothing,
          onLeave: nothing,
        }),
      );
    expect(html(NOW)).toContain("♪ Operation Pyrite · 3 秒后开始");
    expect(html(NOW)).toContain("连击 5 以下：原地晃");
    const over = html(NOW + 20_000, { ...m, endsAt: NOW + 20_000 });
    expect(over).toContain("广场舞散场了");
    expect(over).toMatch(/<button type="button" class="tap" disabled=""/);
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
  });

  /** The room as the server gives it, and taps answered as given; what was asked, kept */
  function server(r: SquadRoom, tap: (body: { at: number }) => { status: number; json: unknown }) {
    const asked: string[] = [];
    // a page: its words, and timers that never go off (the floats)
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(url);
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      const res = tap(JSON.parse(String(init?.body)) as { at: number });
      return new Response(JSON.stringify(res.json), { status: res.status });
    });
    return asked;
  }

  it("takes the room's dance tells as they come, your own combo kept as your taps' answers have it", async () => {
    const t0 = Date.now();
    const m = dance({ by: 2, in: [{ h: 2, combo: 0 }, { h: 1, combo: 5 }], endsAt: t0 + 5_000, songAt: t0 - 10_000, until: t0 + 60_000 });
    server(room({ mode: m, now: t0 }), () => ({ status: 200, json: {} }));
    await loadSquadRoom();
    heardSquad(JSON.stringify({ t: "dance", room: "r1", items: [{ h: 2, combo: 7, ok: true, at: t0 + 1_000 }, { h: 1, combo: 0, ok: false, at: t0 + 900 }] }));
    const after = squadRoomNow()!.mode!;
    expect(after.in).toEqual([{ h: 2, combo: 7 }, { h: 1, combo: 5 }]);
    // alive 15 s from the last tap, as the server keeps it
    expect(after.endsAt).toBe(t0 + 16_000);
    // another room's: nothing
    heardSquad(JSON.stringify({ t: "dance", room: "r2", items: [{ h: 2, combo: 1, ok: true, at: t0 }] }));
    expect(squadRoomNow()!.mode!.in[0].combo).toBe(7);
  });

  it("judges your tap at once against the song's beats, puts it right by the server's answer, and sends taps no closer than the server counts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = NOW;
    vi.setSystemTime(t0);
    // beats every half second from the song's start, 10 s in now: now is on one
    const beats = Array.from({ length: 200 }, (_, i) => i * 0.5);
    const m = dance({ by: 1, in: [{ h: 1, combo: 2 }], songAt: t0 - 10_000, until: t0 + 60_000, endsAt: t0 + 15_000 });
    let answer: { status: number; json: unknown } = { status: 200, json: { now: t0, combo: 3, ok: true, counted: true } };
    const sent: number[] = [];
    const asked = server(room({ mode: m, now: t0 }), (body) => {
      sent.push(body.at);
      return answer;
    });
    await loadSquadRoom();
    const going = squadDanceTap(beats);
    // before the answer: 准！ and the combo one up, here
    expect(squadDanceJudgeNow()).toEqual({ ok: true, at: t0 });
    expect(squadRoomNow()!.mode!.in[0].combo).toBe(3);
    expect(await going).toMatchObject({ combo: 3, ok: true, counted: true });
    // sent at the server's clock as the room's answer put it
    expect(sent).toEqual([t0]);
    // a second tap 50 ms on: one with the first, nothing sent
    vi.setSystemTime(t0 + 50);
    expect(await squadDanceTap(beats)).toBeNull();
    expect(sent).toHaveLength(1);
    // on the next beat here, but the server judged it off: its answer stands
    vi.setSystemTime(t0 + 500);
    answer = { status: 200, json: { now: t0 + 500, combo: 0, ok: false, counted: true } };
    const second = squadDanceTap(beats);
    expect(squadDanceJudgeNow()?.ok).toBe(true);
    await second;
    expect(squadDanceJudgeNow()).toEqual({ ok: false, at: t0 + 500 });
    expect(squadRoomNow()!.mode!.in[0].combo).toBe(0);
    // off the beat here; refused (the dance over meanwhile): no judge, the room read again, the refusal given on
    vi.setSystemTime(t0 + 1_230);
    answer = { status: 409, json: { error: "现在没有在玩的。" } };
    const refused = squadDanceTap(beats);
    expect(squadDanceJudgeNow()).toEqual({ ok: false, at: t0 + 1_230 });
    await expect(refused).rejects.toThrow("现在没有在玩的。");
    expect(squadDanceJudgeNow()).toBeNull();
    expect(asked.filter((u) => u === "/api/squad/room").length).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });
});
