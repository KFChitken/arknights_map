import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { GIFT_HOLD_MS, RACE_LEAD_MS, type GiftMode, type QuizAsk, type QuizMode, type RaceMode, type SquadStack } from "@/lib/squadMode";
import { MINI_H, MINI_W, miniWanted, pipSupported } from "./miniState";
import { headOf, lastLines, MiniView, soloStrip, stackStrip, stripOf } from "./SquadMini";
import type { QuizPicks, SoloDanceNow, SquadLine } from "./squading";

const NOW = Date.parse("2026-11-20T20:00:00+08:00");
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
  wentAt: NOW - (32 * 60 + 10) * 1000,
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
const base = { by: 1, at: NOW - 30_000, endsAt: NOW + 50_000, until: NOW + 3_000_000 };
/** 基建加盖's tower: round 2, two blocks up */
const tower = (more: Partial<SquadStack> = {}): SquadStack => ({
  round: 2,
  at: NOW - 10_000,
  n: 2,
  sum: 8,
  top: [
    { h: 2, x: 0, at: NOW - 9_000 },
    { h: 1, x: 8, at: NOW - 6_000 },
  ],
  swingAt: NOW - 10_000,
  best: 5,
  busy: [1, 2],
  ...more,
});
/** 龙门广场舞, 企鹅物流 (h 2) dancing */
/** W 的礼物's first round going since 1 s ago, its gift starting at your seat (0) */
/** A match's round: begun as it was opened, the first of it, nobody asking for the next */
const round = { begun: base.at, played: 0, next: [] as number[] };
const gift = (more: Partial<GiftMode> = {}): GiftMode => ({
  kind: "gift",
  ...base,
  ...round,
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  song: "s1",
  name: "Song",
  songAt: NOW - 3_000,
  seed: 1,
  rounds: [{ at: NOW - 1_000, seats: [1, 2, -100, -101], from: 0, taps: [] }],
  bots: [
    { h: -100, no: 1, avatar: "imp", color: "red" },
    { h: -101, no: 2, avatar: "gugu", color: "gold" },
  ],
  ...more,
});
const race = (more: Partial<RaceMode> = {}): RaceMode => ({
  kind: "race",
  ...base,
  ...round,
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  start: NOW - 5_000,
  seed: 0,
  lanes: [
    { h: 1, taps: [], jumps: [] },
    { h: 2, taps: [], jumps: [] },
    { h: -100, taps: [], jumps: [] },
    { h: -101, taps: [], jumps: [] },
  ],
  obs: [],
  bots: [
    { h: -100, no: 1, avatar: "imp", color: "red" },
    { h: -101, no: 2, avatar: "gugu", color: "gold" },
  ],
  ...more,
});
const quiz = (more: Partial<QuizMode> = {}): QuizMode => ({
  kind: "quiz",
  ...base,
  ...round,
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  questions: [{ n: 0, kind: "sil", at: NOW - 1_000, ends: NOW + 2_000 }],
  ...more,
});
const nothing = () => {};
const view = (r: SquadRoom, more: Partial<Parameters<typeof MiniView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(MiniView, {
      room: r,
      now: NOW,
      fish: { line: null, bite: false },
      lines: [],
      moves: [],
      picks: null,
      ask: undefined,
      panel: null,
      mate: null,
      busy: false,
      msg: null,
      where: "page",
      onAct: nothing,
      onPick: nothing,
      onPull: nothing,
      onFish: nothing,
      onPanel: nothing,
      onMate: nothing,
      onListen: nothing,
      onToast: nothing,
      ...more,
    }),
  );

describe("when the room shows small", () => {
  it("in a room only, the page shorter than 500 or narrower than 340; a phone held upright never", () => {
    expect([MINI_H, MINI_W]).toEqual([500, 340]);
    // a phone upright (iPhone 390 × 844, a small Android 360 × 640): as before
    expect(miniWanted(390, 844, true)).toBe(false);
    expect(miniWanted(360, 640, true)).toBe(false);
    // the same phone on its side, a phone's floating window, a squeezed window on a computer
    expect(miniWanted(844, 390, true)).toBe(true);
    expect(miniWanted(300, 520, true)).toBe(true);
    expect(miniWanted(1200, 480, true)).toBe(true);
    // out of a room: never
    expect(miniWanted(844, 390, false)).toBe(false);
    // no window over everything here (no Document Picture-in-Picture)
    expect(pipSupported()).toBe(false);
  });
});

describe("the small room's strip", () => {
  it("asks one not in a round for the next, saying how many play", () => {
    const s = stripOf(room(), race({ in: [{ h: 2, combo: 0 }], lanes: race().lanes.slice(1) }), NOW);
    expect(s).toEqual({ kind: "race", text: "急件赛 · 1 人在玩", lit: false, acts: [{ act: "join", label: "下一局算我", on: true }] });
  });

  it("lights W 的礼物 while the gift is in your hands, with 传", () => {
    expect(stripOf(room(), gift(), NOW)).toEqual({ kind: "gift", text: "W 的礼物 · 在你手上！", lit: true, acts: [{ act: "pass", label: "传", on: true }] });
    // passed on two seconds after it came
    const later = stripOf(room(), gift(), NOW - 1_000 + GIFT_HOLD_MS + 10);
    expect(later).toMatchObject({ text: "W 的礼物 · 等礼物转回来…", lit: false, acts: [{ act: "pass", on: false }] });
  });

  it("gives 急件赛 its place and metres with 跳 and 加油, the countdown before it, your place after it", () => {
    const run = stripOf(room(), race(), NOW);
    expect(run.lit).toBe(true);
    expect(run.text).toMatch(/^急件赛 · 第 \d · 还差 \d+ m$/);
    expect(run.acts.map((a) => a.act)).toEqual(["jump", "cheer"]);
    expect(stripOf(room(), race({ start: NOW + 2_200 }), NOW).text).toBe("急件赛 · 3 秒后开跑");
    const end = race({ end: { at: NOW - 1_000, order: [1, 0, 2, 3], times: [21_000, 20_000, null, null], metres: [300, 300, 280, 270] } });
    expect(stripOf(room(), end, NOW)).toMatchObject({ text: "急件赛 · 你第 2", acts: [] });
    // in it with no lane: the next one
    expect(stripOf(room(), race({ lanes: race().lanes.slice(1), start: NOW - RACE_LEAD_MS }), NOW).text).toBe("急件赛 · 下一场你在里面");
  });

  it("gives 基建加盖 its height with 放 while no mode plays nor waits; 放 grey for the 3 s its plank is laid", () => {
    expect(stackStrip(room({ stack: tower() }), NOW)).toEqual({ kind: "stack", text: "基建加盖 · 2 层", lit: false, acts: [{ act: "drop", label: "放", on: true }] });
    const fell = room({ stack: tower({ n: 3, fell: { at: NOW - 1_000, height: 2 } }) });
    expect(stackStrip(fell, NOW)).toEqual({ kind: "stack", text: "塌了！2 层 · 3 秒后打新地基", lit: false, acts: [{ act: "drop", label: "放", on: false }] });
    expect(stackStrip(fell, NOW + 2_000)).toMatchObject({ text: "基建加盖 · 0 层", acts: [{ act: "drop", on: true }] });
  });

  it("lights 随堂测 while a question waits for your answer, not once you picked", () => {
    expect(stripOf(room(), quiz(), NOW)).toMatchObject({ text: "随堂测 · 第 1 / 1 题", lit: true, acts: [] });
    const picked: QuizPicks = { at: base.at, picks: { 0: { pick: 1 } } };
    expect(stripOf(room(), quiz(), NOW, picked).lit).toBe(false);
  });

  it("shows one's own dance before all else: its song coming, its combo and 跳, its best once over", () => {
    const song = { song: "s1", name: "Song", seconds: 100, dance: "", songAt: NOW - 1_000, now: NOW };
    const d: SoloDanceNow = { key: 1, song, beats: null, combo: 7, best: 9, last: NOW - 500, tapAt: NOW - 500, judge: null, wildAt: null, err: null };
    expect(soloStrip(d, NOW)).toEqual({ kind: "dance", text: "广场舞 · COMBO 7", lit: true, acts: [{ act: "danceTap", label: "跳", on: true }] });
    expect(soloStrip({ ...d, song: { ...song, songAt: NOW + 2_100 } }, NOW)).toMatchObject({ text: "广场舞 · 3 秒后开始", lit: false, acts: [{ act: "danceTap", on: false }] });
    expect(soloStrip(d, NOW + 20_000)).toEqual({ kind: "dance", text: "广场舞 · 最高连击 9", lit: false, acts: [] });
    expect(soloStrip({ ...d, song: null }, NOW)).toMatchObject({ text: "广场舞 · 正在挑歌…", acts: [] });
  });
});

describe("the small room", () => {
  it("says the room as the bar does, and how long the round has gone", () => {
    expect(headOf(room(), NOW)).toEqual({ text: "开打中 · 险境 · 官服 4/4", clock: "32:10" });
    expect(headOf(room({ state: "wait", wentAt: null }), NOW).clock).toBeNull();
    expect(headOf(room({ wentAt: NOW - 3_725_000 }), NOW).clock).toBe("1:02:05");
  });

  it("keeps the last two lines said, yours as 你", () => {
    const lines: SquadLine[] = [
      { key: 1, h: 2, p: 1, at: NOW - 3_000 },
      { key: 2, h: 3, p: 2, at: NOW - 2_000 },
      { key: 3, h: 1, p: 3, at: NOW - 1_000 },
    ];
    const got = lastLines(room(), lines);
    expect(got.map((l) => l.who)).toEqual(["漏勺本勺", "你"]);
    const html = view(room(), { lines });
    expect(html).toContain('<div class="ml">');
    expect(html.match(/<span>[^<]+：/g)).toHaveLength(2);
  });

  it("shows the four with their names, the strip, 钓鳞 as it stands, and 说话 · 扔东西 · 跟着听", () => {
    const html = view(room({ stack: tower() }));
    expect(html).toContain("开打中 · 险境 · 官服 4/4");
    expect(html).toContain('<span class="clk">32:10</span>');
    expect(html).toContain('class="ms k-stack"');
    expect(html).toContain('class="trk"');
    expect(html.match(/class="mr( you)?( edge-[lr])?"/g)).toHaveLength(4);
    expect(html).toContain('<span class="nm">你</span>');
    expect(html).toContain('<span class="nm">企鹅物流</span>');
    // 钓鳞: none in the water, in the water, bitten
    expect(html).toContain("钓鳞 · 浮漂在手里");
    expect(html).toContain('class="cast"');
    expect(view(room(), { fish: { line: "pond", bite: false } })).toContain("卫戍池塘 · 浮漂在水里");
    const bite = view(room(), { fish: { line: "pond", bite: true } });
    expect(bite).toContain('class="mf bite"');
    expect(bite).toContain("咕咚！");
    expect(bite).toContain('<button type="button" class="pull">收竿</button>');
    expect(html).toContain(">说话</button>");
    expect(html).toContain(">扔东西</button>");
    expect(html).toContain(">跟着听</button>");
    // 跟着听 only to one 听歌 is open to
    expect(view(room({ hear: false }))).not.toContain("跟着听");
    // a mode playing or waiting: its strip in the tower's place
    const quizzing = view(room({ mode: quiz() }));
    expect(quizzing).toContain('class="ms k-quiz');
    expect(quizzing).not.toContain('class="trk"');
    // the tower fell: no track till it is rebuilt
    expect(view(room({ stack: tower({ n: 3, fell: { at: NOW - 1_000, height: 2 } }) }))).not.toContain('class="trk"');
  });

  it("puts the quiz's picture and three on its strip, yours marked once picked", () => {
    const ask: QuizAsk = { n: 0, kind: "sil", at: NOW - 1_000, ends: NOW + 2_000, options: ["能天使", "德克萨斯", "可颂"], pic: "data:image/png;base64,AAAA", now: NOW };
    const html = view(room({ mode: quiz() }), { ask });
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt=""/>');
    expect(html).toContain("这是谁的剪影？");
    expect(html).toContain("<b>A</b><span>能天使</span>");
    expect(html.match(/<button type="button"><b>/g)).toHaveLength(3);
    const picked = view(room({ mode: quiz() }), { ask, picks: { at: base.at, picks: { 0: { pick: 1 } } } });
    expect(picked).toContain('class="mine" disabled=""><b>B</b>');
  });

  it("opens 说话, the teammates to throw at, and 跟着听 in place of the rest, with 返回", () => {
    const say = view(room(), { panel: "say" });
    expect(say).toContain("‹ 返回");
    expect(say).toContain('class="sq-say2"');
    expect(say).not.toContain('class="mr4"');
    const who = view(room({ members: [member(1), member(2), member(3, { noThrow: true })] }), { panel: "throw" });
    expect(who).toContain("<b>扔给谁？</b>");
    expect(who).toContain("<span>企鹅物流</span>");
    // one who turned 别人扔我 off: not to be picked
    expect(who).toMatch(/<button type="button" disabled="">.*<span>漏勺本勺<\/span><small>TA 关了「别人扔我」<\/small><\/button>/);
    expect(view(room(), { panel: "throw", mate: 2 })).toContain("扔给 企鹅物流");
    expect(view(room({ host: true, listen: null }), { panel: "listen" })).toContain("邀请大家一起听");
  });
});
