import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import type { SquadMode } from "@/lib/squadMode";
import { DanceView, danceRow, musicWords, type DanceMusic } from "./SquadDance";
import { InviteLine, inviteOf } from "./SquadModeInvite";
import { ModesCard, modeRow } from "./SquadModes";
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
const dance = (more: Partial<SquadMode> = {}): SquadMode => ({
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
  fire: { level: 0, at: NOW, by: null, best: 0, last: null },
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

describe("玩点什么", () => {
  it("offers 开 while nothing plays, and says how long one who opened the last waits", () => {
    expect(modeRow(room(), "dance", NOW)).toEqual({ kind: "dance", label: "开", does: "open" });
    expect(modeRow(room({ modeAgain: NOW + 44_200 }), "dance", NOW)).toEqual({ kind: "dance", label: "45 秒后能再开", does: null });
    // its minute over, or the mode playing over (its end passed): 开 again
    expect(modeRow(room({ modeAgain: NOW - 1 }), "dance", NOW).does).toBe("open");
    expect(modeRow(room({ mode: dance({ endsAt: NOW }) }), "dance", NOW).does).toBe("open");
  });

  it("has the one playing joined, or its card opened by one in it, and says who opened it and how many are in it", () => {
    expect(modeRow(room({ mode: dance() }), "dance", NOW)).toEqual({ kind: "dance", label: "正在玩 · 加入", does: "join" });
    const mine = room({ mode: dance({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 3 }] }) });
    expect(modeRow(mine, "dance", NOW)).toEqual({ kind: "dance", label: "在玩 · 打开", does: "look" });
    const html = (r: SquadRoom) => renderToStaticMarkup(createElement(ModesCard, { room: r, now: NOW, busy: false, msg: null, onAct: nothing, onClose: nothing }));
    const out = html(room({ mode: dance() }));
    expect(out).toContain("正在玩：龙门广场舞（企鹅物流开的，1 人）");
    expect(out).toContain("<small>随时能加入</small>");
    expect(out).toContain('<span class="btn join">正在玩 · 加入</span>');
    // in it: no 随时能加入; its opener gone from the room: no name
    expect(html(mine)).not.toContain("随时能加入");
    expect(html(room({ mode: dance(), members: [member(1), member(3)] }))).toContain("正在玩：龙门广场舞（1 人）");
  });

  it("says, while the room waits for its round, that one may play from coming in and how one joins late; in a round, how each ends", () => {
    const html = (r: SquadRoom) => renderToStaticMarkup(createElement(ModesCard, { room: r, now: NOW, busy: false, msg: null, onAct: nothing, onClose: nothing }));
    const waiting = html(room({ state: "wait", wentAt: null }));
    expect(waiting).toContain("进房间就能玩，1 个人也能开");
    expect(waiting).toContain("<em>随时加入</em>");
    expect(waiting).toContain("1 个人就能跳，后来的人插进队里接着跳");
    expect(waiting).toContain("开打时正在玩的不打断");
    expect(waiting).not.toContain("一首歌");
    const playing = html(room());
    expect(playing).toContain("同一时间只玩一个，别人自己选加不加入");
    expect(playing).toContain("<small>一首歌</small>");
    expect(playing).toContain("广场舞：踩方舟歌的拍子跳，自己的音乐能关");
    expect(playing).not.toContain("<em>");
  });
});

describe("the line asking one to join", () => {
  it("asks everyone in the room not in it, never its opener, nor one who put it away, joined or went to watch, nor over its card or 玩点什么", () => {
    const m = dance();
    expect(inviteOf(room({ mode: m }), null, null, false)).toBe(m);
    expect(inviteOf(room({ mode: m }), m.at, null, false)).toBeNull();
    expect(inviteOf(room({ mode: m }), null, m.at, false)).toBeNull();
    expect(inviteOf(room({ mode: m }), null, null, true)).toBeNull();
    expect(inviteOf(room({ mode: dance({ by: 1, in: [{ h: 1, combo: 0 }] }) }), null, null, false)).toBeNull();
    expect(inviteOf(room({ mode: dance({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }] }) }), null, null, false)).toBeNull();
    // a dance put away, and another opened later: asked again
    expect(inviteOf(room({ mode: dance({ at: m.at + 90_000 }) }), m.at, null, false)).not.toBeNull();
    expect(inviteOf(room(), null, null, false)).toBeNull();
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
    const html = (m: SquadMode, more: { now?: number; music?: DanceMusic; judge?: { ok: boolean; at: number } | null } = {}) =>
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
