import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  STACK_REBUILD_MS,
  STACK_SWING_MS,
  stackHeight,
  stackNow,
  stackPut,
  stackSwing,
  type LobbyMode,
  type RaceMode,
  type SquadStack,
  type StackBoard,
  type StackMine,
} from "@/lib/squadMode";
import { StackBoardView, towerSay } from "./SquadStackBoard";
import { blockOf, boardWay, gearTag, mateLine, modeStrip, stackLine, towerBelow, towerShift, StackView } from "./SquadStack";
import {
  closeSquadModeCard,
  closeSquadStack,
  forgetSquadPage,
  heardSquad,
  loadSquadRoom,
  openSquadModeCard,
  openSquadStack,
  squadModeCardNow,
  squadRoomNow,
  squadStackBehindNow,
  squadStackDrop,
  squadStackOpenNow,
} from "./squading";

const NOW = Date.parse("2026-11-20T18:00:00+08:00");
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
/** Round 2, begun 10 s ago, three blocks up (企鹅物流's, yours, 漏勺本勺's), the room's highest 5 */
const tower = (more: Partial<SquadStack> = {}): SquadStack => ({
  round: 2,
  at: NOW - 10_000,
  n: 3,
  sum: 18,
  top: [
    { h: 2, x: 0, at: NOW - 9_000 },
    { h: 1, x: 8, at: NOW - 6_000 },
    { h: 3, x: 10, at: NOW - 5_000 },
  ],
  swingAt: NOW - 10_000,
  best: 5,
  busy: [1, 2, 3],
  ...more,
});
const room = (more: Partial<SquadRoom> = {}): SquadRoom => ({
  id: "r1",
  server: "cn",
  level: 3,
  tags: [],
  state: "wait",
  friendsOnly: false,
  stopped: false,
  key: "k",
  keyAt: NOW,
  keyLeft: 3,
  you: 1,
  host: true,
  staff: false,
  members: [member(1), member(2), member(3, { avatar: "doctor" }), member(4)],
  wentAt: null,
  waitedAt: NOW,
  fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
  stack: tower(),
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
const view = (r: SquadRoom, now = NOW, more: { slow?: boolean; msg?: string | null; board?: StackBoard | null; mine?: { round: number } | null } = {}) =>
  renderToStaticMarkup(
    createElement(StackView, {
      room: r,
      tower: stackNow(r.stack, now),
      now,
      slow: more.slow ?? false,
      msg: more.msg ?? null,
      board: more.board ?? null,
      mine: more.mine ?? null,
      onClose: nothing,
      onDrop: nothing,
      onBoard: nothing,
      onMode: nothing,
    }),
  );
const mine = (more: Partial<StackMine> = {}): StackMine => ({ rank: 37, peak: 53, names: [{ name: "你", you: true }, { name: "企鹅物流" }], say: "below", d: 4, ...more });
const boardOf = (more: Partial<StackBoard> = {}): StackBoard => ({ week: "this", rows: [], holders: 0, left: 86_400_000, mine: null, now: NOW, ...more });

describe("基建加盖's rules", () => {
  it("swings 60 px each way and back each 1.6 s under 10 layers, the same for everyone from where its swing starts", () => {
    const at = NOW;
    expect(stackSwing(at, 0, at)).toBe(-60);
    expect(stackSwing(at, 0, at + 400)).toBeCloseTo(0, 9);
    expect(stackSwing(at, 9, at + 800)).toBe(60);
    expect(stackSwing(at, 0, at + STACK_SWING_MS)).toBe(-60);
    // 10 layers up: 1440 ms
    expect(stackSwing(at, 10, at + 720)).toBe(60);
    expect(Math.round(stackSwing(at, 0, at + 487))).toBe(20);
  });

  it("falls with one more than 40 px off the one under it or the middle more than 30 px off the plank's, sways over 18 px off", () => {
    const on = (xs: number[]) => ({ n: xs.length, sum: xs.reduce((a, b) => a + b, 0), top: xs.map((x) => ({ x })) });
    expect(stackPut(on([]), 0)).toEqual({ off: 0, falls: false, wobbles: false });
    expect(stackPut(on([]), 19)).toMatchObject({ falls: false, wobbles: true });
    expect(stackPut(on([]), 31)).toMatchObject({ falls: true });
    expect(stackPut(on([0]), 40)).toMatchObject({ off: 40, falls: false, wobbles: true });
    expect(stackPut(on([0]), -41)).toMatchObject({ off: -41, falls: true });
    expect(stackPut(on([0, 20, 50]), 60)).toMatchObject({ off: 10, falls: true, wobbles: false });
    // only the top kept: the middle from all of them
    expect(stackPut({ n: 20, sum: 600, top: [{ x: 30 }] }, 30)).toMatchObject({ falls: false });
    expect(stackPut({ n: 20, sum: 600, top: [{ x: 30 }] }, 60)).toMatchObject({ off: 30, falls: true });
    expect(stackHeight(tower())).toBe(3);
    expect(stackHeight(tower({ n: 4, fell: { at: NOW, height: 3 } }))).toBe(3);
  });

  it("is rebuilt on the page 3 s after it fell, as on the server", () => {
    const fell = tower({ n: 4, fell: { at: NOW - 1_000, height: 3 } });
    expect(stackNow(fell, NOW)).toBe(fell);
    expect(stackNow(fell, NOW - 1_000 + STACK_REBUILD_MS)).toEqual({ round: 3, at: NOW + 2_000, n: 0, sum: 0, top: [], swingAt: NOW + 2_000, best: 5, busy: [1, 2, 3] });
  });
});

describe("基建加盖's card", () => {
  it("shows its round, those building, the tower's height, the room's highest, the swing's gear and the way to 基建周榜", () => {
    const html = view(room());
    expect(html).toContain("<b>基建加盖 · 第 2 轮</b>");
    expect(html).toContain('<span class="ppl">3 人在搭</span>');
    expect(html).toContain("<b>3<small> 层</small></b><span>房间纪录 5 层</span>");
    expect(html).toContain('<div class="gear"><em>晃速 第 1 档</em><small>每高 10 层快一点</small></div>');
    // three blocks, each the roach of the one who put it, where they were put
    expect(html.match(/class="blk/g)).toHaveLength(3);
    expect(html).toContain('style="left:calc(50% + -32px);bottom:122px"');
    expect(html).toContain('style="left:calc(50% + -24px);bottom:156px"');
    expect(html).toContain('style="left:calc(50% + -22px);bottom:190px"');
    expect(html).toContain('class="base" style="bottom:112px"');
    expect(html).not.toContain('class="smsg"');
    expect(html).not.toContain('class="below"');
    // no hand, nothing to join or leave, no 再来一轮
    expect(html).not.toMatch(/手里|加入一起搭|去围观|再来一轮|没人放就结束/);
    expect(html).toContain('<button type="button" class="way"><b>你这周还没上榜</b><span>至少 2 个人各放够 5 块 · 看基建周榜 ›</span></button>');
    expect(html).toContain('塔一直在，谁都能随时放，不用轮流');
  });

  it("swings your roach over the top by the server's clock, with 放 always there", () => {
    const html = view(room(), NOW);
    // 10 s from the swing's start: 10000 % 1600 = 400 ms, the middle
    expect(html).toContain('class="swing" style="bottom:230px"');
    expect(html).toContain('style="transform:translateX(0px)"');
    expect(html).toContain('aria-label="放下你的蟑螂"');
    expect(html).toContain(">放</button>");
    expect(view(room(), NOW + 400)).toContain('style="transform:translateX(60px)"');
  });

  it("says the gear, and 最快了 at the last; 高了 10 层 as it goes faster, 歪了 as it sways, 慢点 to one tapping too soon", () => {
    expect(gearTag(9)).toBe("晃速 第 1 档");
    expect(gearTag(10)).toBe("晃速 第 2 档");
    expect(gearTag(69)).toBe("晃速 第 7 档");
    expect(gearTag(70)).toBe("晃速 第 8 档 · 最快了");
    const ten = tower({ n: 10, top: [{ h: 2, x: 0, at: NOW - 3_000 }, { h: 1, x: 0, at: NOW - 500 }] });
    expect(stackLine(ten, NOW)).toBe("高了 10 层，晃得快一点了");
    expect(stackLine(ten, NOW + 1_000)).toBeNull();
    // at 80 it goes no faster: nothing said
    expect(stackLine(tower({ n: 80, top: ten.top }), NOW)).toBeNull();
    const top = [
      { h: 2, x: 0, at: NOW - 9_000 },
      { h: 1, x: 25, at: NOW - 300 },
    ];
    const sway = view(room({ stack: tower({ n: 2, top }) }));
    expect(sway).toContain('<span class="smsg" role="status">歪了，塔在晃</span>');
    expect(sway).toContain('class="tw sway"');
    expect(view(room(), NOW, { slow: true })).toContain('<span class="smsg" role="status">慢点，每秒只收 1 块</span>');
    // a block just put drops onto the tower
    expect(view(room({ stack: tower({ n: 2, top }) }), NOW - 200)).toContain('class="blk drop"');
  });

  it("says a teammate's block a moment after it lands, not your own", () => {
    const top = [
      { h: 1, x: 0, at: NOW - 5_000 },
      { h: 2, x: 4, at: NOW - 300 },
    ];
    const r = room({ stack: tower({ n: 2, top }) });
    expect(mateLine(r, r.stack, NOW)).toEqual({ text: "企鹅物流 也放了一块", at: NOW - 300 });
    expect(view(r)).toContain('<span class="mate" role="status">企鹅物流 也放了一块</span>');
    expect(mateLine(r, r.stack, NOW + 1_000)).toBeNull();
    const yours = room({ stack: tower({ n: 2, top: [top[1], { h: 1, x: 4, at: NOW - 100 }] }) });
    expect(mateLine(yours, yours.stack, NOW)).toMatchObject({ text: "企鹅物流 也放了一块" });
    expect(mateLine(yours, yours.stack, NOW + 1_000)).toBeNull();
  });

  it("tumbles the tower as it falls, says how high it was till its new plank is laid, 放 grey meanwhile; then round 3 by itself", () => {
    const top = [
      { h: 2, x: 0, at: NOW - 9_000 },
      { h: 1, x: 8, at: NOW - 6_000 },
      { h: 2, x: 52, at: NOW - 100 },
    ];
    const r = room({ stack: tower({ n: 3, top, fell: { at: NOW - 100, height: 2 } }) });
    const html = view(r);
    expect(html).toContain('<span class="smsg" role="status">塌了！这一轮 2 层 · 3 秒后打新地基</span>');
    expect(html.match(/class="blk f[lr]"/g)).toHaveLength(3);
    expect(html).toContain("<b>0<small> 层</small></b>");
    expect(html).toContain('<button type="button" class="put" disabled="">在打地基</button>');
    expect(html).toContain('class="swing dim" style="bottom:128px"');
    // the blocks gone once they fell, the line on till the plank is laid
    const later = view(r, NOW + 2_000);
    expect(later).not.toContain('class="blk');
    expect(later).toContain("3 秒后打新地基");
    // the new plank: round 3, 放 again
    const next = view(r, NOW - 100 + STACK_REBUILD_MS);
    expect(next).toContain("<b>基建加盖 · 第 3 轮</b>");
    expect(next).not.toContain('class="smsg"');
    expect(next).toContain(">放</button>");
  });

  it("goes down as the tower grows past five, saying how many layers are out of sight below", () => {
    const top = Array.from({ length: 12 }, (_, i) => ({ h: (i % 4) + 1, x: 0, at: NOW - 20_000 }));
    expect(towerShift(5)).toBe(0);
    expect(towerShift(8)).toBe(102);
    expect(towerBelow(9)).toBe(0);
    expect(towerBelow(30)).toBe(21);
    const eight = view(room({ stack: tower({ n: 8, sum: 0, top: top.slice(0, 8) }) }));
    expect(eight).toContain('class="base" style="bottom:10px"');
    expect(eight).toContain('style="left:calc(50% + -32px);bottom:20px"');
    expect(eight).toContain('class="ground" style="height:21px"');
    expect(eight).toContain('class="swing" style="bottom:298px"');
    expect(eight).not.toContain('class="below"');
    // thirty up, the top twelve drawn: the twelfth from the top at its place, 21 below out of sight
    const thirty = view(room({ stack: tower({ n: 30, sum: 0, top }) }));
    expect(thirty.match(/class="blk/g)).toHaveLength(12);
    expect(thirty).toContain('<span class="below">↓ 下面还有 21 层</span>');
    expect(thirty).toContain(`bottom:${122 + 18 * 34 - 25 * 34}px`);
    expect(thirty).toContain('class="ground" style="height:0px"');
    expect(blockOf(room(), 9)).toMatchObject({ h: 9, name: "", you: false, avatar: "hood" });
    expect(blockOf(room(), 2).name).toBe("企鹅物流");
  });

  it("shows where you are on 基建周榜: named (a new highest when this tower, yours, is higher), not yet, or this tower last week's", () => {
    const t = tower();
    expect(boardWay(null, t, null)).toEqual(["你这周还没上榜", "至少 2 个人各放够 5 块 · 看基建周榜 ›"]);
    expect(boardWay(boardOf({ mine: mine() }), t, null)).toEqual(["你这周最高 53 层", "周榜第 37 名 · 看基建周榜 ›"]);
    // short of 5 on a listed tower: not named yet
    expect(boardWay(boardOf({ mine: mine({ names: [{ name: "企鹅物流" }], say: "short", k: 2 }) }), t, null)[0]).toBe("你这周还没上榜");
    // this tower higher than your highest, and you put a block on it
    const tall = tower({ n: 60 });
    expect(boardWay(boardOf({ mine: mine() }), tall, { round: 2 })).toEqual(["你这周最高 60 层（新纪录！）", "周榜第 37 名 · 看基建周榜 ›"]);
    expect(boardWay(boardOf({ mine: mine() }), tall, { round: 1 })[0]).toBe("你这周最高 53 层");
    expect(boardWay(boardOf({ mine: mine(), old: true }), tall, { round: 2 })).toEqual(["这座塔算在上周的榜里", "塌了以后新的一座算这周 · 看基建周榜 ›"]);
    expect(view(room(), NOW, { board: boardOf({ mine: mine() }) })).toContain("<b>你这周最高 53 层</b><span>周榜第 37 名 · 看基建周榜 ›</span>");
  });

  it("leads back to the mode you are in from its top: what it is doing, your lane in a race, a match waiting", () => {
    const race = { kind: "race", by: 1, at: NOW - 5_000, in: [{ h: 1, combo: 0 }], endsAt: NOW + 60_000, until: NOW + 60_000, begun: NOW - 5_000, played: 0, next: [3], start: NOW - 2_000, seed: 1, lanes: [{ h: -100, taps: [], jumps: [] }, { h: 1, taps: [], jumps: [] }], obs: [], bots: [] } as unknown as RaceMode;
    expect(modeStrip(room({ mode: race }), NOW)).toBe("企鹅物流急件赛在跑 · 你在第 2 道");
    // one in the next round only: no lane yet
    expect(modeStrip(room({ you: 3, members: [member(1), member(3, { you: true })], mode: race }), NOW)).toBe("企鹅物流急件赛在跑");
    // one not in it at all: nothing
    expect(modeStrip(room({ you: 4, members: [member(1), member(4, { you: true })], mode: race }), NOW)).toBeNull();
    const wait: LobbyMode = { kind: "quiz", wait: true, played: 0, by: 2, at: NOW - 5_000, in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }], endsAt: NOW + 100_000, until: NOW + 100_000 };
    expect(modeStrip(room({ mode: wait }), NOW)).toBe("凯尔希随堂测在等人 2/4");
    expect(modeStrip(room({ mode: { ...wait, in: [{ h: 2, combo: 0 }] } }), NOW)).toBeNull();
    const html = view(room({ mode: race }));
    expect(html).toContain('<button type="button" class="sq-back"><span>企鹅物流急件赛在跑 · 你在第 2 道</span><b>回去 ›</b></button>');
    expect(view(room())).not.toContain("sq-back");
  });
});

describe("基建周榜's page", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ rank: i + 1, peak: 200 - i, names: [{ name: `p${i}`, look: { color: "cyan", avatar: "hood" } }, { name: "一位舟P" }] }));
  const page = (b: StackBoard | null, week: "this" | "last" = "this", more: { failed?: boolean; title?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(StackBoardView, { week, board: b, failed: more.failed ?? false, title: more.title ?? false, onWeek: nothing, onTitle: nothing, onRetry: nothing, onBack: nothing, onClose: nothing }),
    );

  it("lists the towers, a line under the 100th with how many win, twenty more, and 你们这座 pinned with what to say of it", () => {
    const html = page(boardOf({ rows: rows(103), holders: 200, mine: mine({ rank: 101, say: "below", d: 9 }) }));
    expect(html).toContain("<b>基建周榜</b>");
    expect(html).toContain("这周 · 周一凌晨 4 点（北京时间）结算 · 还有 1 天 0 小时");
    expect(html).toContain("<b>前 100 座塔，写着的人都拿一周限定称号</b><strong>「基建狂魔」</strong>");
    expect(html.match(/class="fb-row/g)).toHaveLength(104);
    expect(html).toContain('<p class="fb-line"><span>称号线 · 前 100 座塔，这周 200 人</span></p>');
    expect(html).toContain("200 层");
    expect(html).toContain('class="sq-tower"');
    expect(html).toContain("<small>你们这座</small>");
    expect(html).toContain("<p>离前 100 还差 9 层</p>");
    expect(html.indexOf("称号线")).toBeLessThan(html.indexOf(">101<"));
  });

  it("says each thing of 你们这座, and that you put no block this week when there is none", () => {
    expect(towerSay(mine({ say: "in", n: 3 }))).toBe("在前 100 座里：照现在这样，你们 3 个这周能拿称号");
    expect(towerSay(mine({ say: "short", k: 2 }))).toBe("在前 100 座里：你在这座再放 2 块就能写上名字");
    expect(towerSay(mine({ say: "below", d: 9 }))).toBe("离前 100 还差 9 层");
    expect(towerSay(mine({ say: "off" }))).toBe("还没上榜：至少 2 个人各放够 5 块才上榜");
    expect(towerSay(mine({ say: "old" }))).toBe("这座塔算在上周的榜里");
    const none = page(boardOf({ rows: rows(2), holders: 4 }));
    expect(none).toContain("<p>你这周还没往塔上放过块</p>");
    expect(page(boardOf())).toContain("这周还没有塔上榜：至少 2 个人各放够 5 块就能上。");
  });

  it("shows last week as settled: a small tower by the names that won, how many did, nothing to say under 你们这座", () => {
    const last = boardOf({ week: "last", rows: rows(2).map((r) => ({ ...r, got: true as const })), holders: 4, left: undefined, mine: mine({ rank: 1, say: "old" }) });
    const html = page(last, "last");
    expect(html).toContain("上周 · 结算完发了称号，戴到下周一凌晨 4 点");
    expect(html).toContain("上周已经结算，称号发好了：名字旁边有小塔的就是。");
    expect(html).toContain("上周 4 人拿到「基建狂魔」（前 100 座塔上写着的人）。");
    expect(html.match(/aria-label="基建狂魔"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("这座塔算在上周的榜里");
    expect(page(boardOf({ week: "last", left: undefined }), "last")).toContain("上周没有塔上榜。");
  });

  it("opens what 基建狂魔 is from its banner, and says so when the board could not be read", () => {
    const title = page(boardOf(), "this", { title: true });
    expect(title).toContain("限定称号「基建狂魔」");
    expect(title).toContain("卫戍房间里，名字旁边一个小塔");
    expect(title).toContain("「没有图纸，没有地基，照样盖到了天上。」");
    expect(page(null, "this", { failed: true })).toContain("没看到榜，连不上服务器。");
    expect(page(null)).toContain("正在看榜…");
  });
});

describe("基建加盖 on the page", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function server(r: SquadRoom, answer: (body: Record<string, unknown>) => { status: number; json: unknown }) {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      sent.push({ url, body });
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      const res = answer(body);
      return new Response(JSON.stringify(res.json), { status: res.status });
    });
    return { sent };
  }

  it("puts your roach on the tower at once where the swing is, and sends when, in which round", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { sent } = server(room(), () => ({ status: 200, json: { now: NOW, round: 2, n: 4, x: 0, falls: false, wobbles: false, best: 5, swingAt: NOW - 10_000 } }));
    await loadSquadRoom();
    const put = squadStackDrop();
    const s = squadRoomNow()!.stack;
    expect(s.top.at(-1)).toEqual({ h: 1, x: 0, at: NOW });
    expect(s).toMatchObject({ round: 2, n: 4, sum: 18, best: 5, busy: [1, 2, 3] });
    await put;
    expect(sent.find((x) => x.url === "/api/squad/stack")?.body).toEqual({ do: "drop", round: 2, at: NOW });
  });

  it("knocks it down here at once when it will fall, and reads the room again when refused; sends nothing while its plank is laid", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 800 ms into the swing: 60 px out, 50 off the top block
    vi.setSystemTime(NOW + 400);
    const { sent } = server(room({ now: NOW + 400 }), () => ({ status: 429, json: { error: "慢点，每秒只收 1 块。" } }));
    await loadSquadRoom();
    const put = squadStackDrop();
    const s = squadRoomNow()!.stack;
    expect(s.top.at(-1)).toMatchObject({ x: 60 });
    expect(s.fell).toEqual({ at: NOW + 400, height: 3 });
    expect(s.best).toBe(5);
    await expect(put).rejects.toThrow("慢点，每秒只收 1 块。");
    await Promise.resolve();
    expect(sent.filter((x) => x.url === "/api/squad/room")).toHaveLength(2);
    const { sent: none } = server(room({ stack: tower({ n: 4, fell: { at: NOW, height: 3 } }), now: NOW + 400 }), () => ({ status: 200, json: {} }));
    await loadSquadRoom();
    expect(await squadStackDrop()).toBeNull();
    expect(none.filter((x) => x.url === "/api/squad/stack")).toHaveLength(0);
  });

  it("puts the first block of a tower rebuilt here, nothing of the round before kept", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const fellAt = NOW - STACK_REBUILD_MS - 400;
    vi.setSystemTime(NOW);
    const { sent } = server(room({ stack: tower({ n: 4, fell: { at: fellAt, height: 3 } }) }), () => ({ status: 200, json: { now: NOW } }));
    await loadSquadRoom();
    const put = squadStackDrop();
    const s = squadRoomNow()!.stack;
    await put;
    expect(s).toMatchObject({ round: 3, n: 1, at: fellAt + STACK_REBUILD_MS });
    expect(s.fell).toBeUndefined();
    expect(s.top).toEqual([{ h: 1, x: 0, at: NOW }]);
    expect(sent.find((x) => x.url === "/api/squad/stack")?.body).toEqual({ do: "drop", round: 3, at: NOW });
  });

  it("takes the others' blocks as the room is told them, yours not twice, and reads the room again when out of step", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { sent } = server(room(), () => ({ status: 200, json: { now: NOW } }));
    await loadSquadRoom();
    const roomReads = () => sent.filter((x) => x.url === "/api/squad/room").length;
    heardSquad(JSON.stringify({ t: "stack", room: "r1", items: [{ h: 2, x: 12, at: NOW - 50, round: 2, n: 4, swingAt: NOW - 10_000 }] }));
    let s = squadRoomNow()!.stack;
    expect(s).toMatchObject({ n: 4, sum: 30 });
    expect(s.top.at(-1)).toEqual({ h: 2, x: 12, at: NOW - 50 });
    expect(roomReads()).toBe(1);
    // yours, put here first: kept as it is
    void squadStackDrop();
    s = squadRoomNow()!.stack;
    const yours = s.top.at(-1)!;
    heardSquad(JSON.stringify({ t: "stack", room: "r1", items: [{ h: 1, x: yours.x, at: yours.at, round: 2, n: 5, swingAt: NOW - 10_000 }] }));
    expect(squadRoomNow()!.stack.n).toBe(5);
    expect(roomReads()).toBe(1);
    // the one that felled it, 3 sitting
    heardSquad(JSON.stringify({ t: "stack", room: "r1", items: [{ h: 3, x: 60, at: NOW + 10, round: 2, n: 6, falls: true, swingAt: NOW - 10_000 }] }));
    expect(squadRoomNow()!.stack.fell).toEqual({ at: NOW + 10, height: 5 });
    expect(roomReads()).toBe(1);
    // a block two layers on from this page's top: out of step
    heardSquad(JSON.stringify({ t: "stack", room: "r1", items: [{ h: 2, x: 0, at: NOW + 20, round: 2, n: 8, swingAt: NOW - 10_000 }] }));
    await Promise.resolve();
    expect(roomReads()).toBe(2);
  });

  it("keeps one card open: the tower's shuts a mode's; a mode's folds the tower's behind it, × on it shuts both", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const wait: LobbyMode = { kind: "quiz", wait: true, played: 0, by: 1, at: NOW - 5_000, in: [{ h: 1, combo: 0 }], endsAt: NOW + 100_000, until: NOW + 100_000 };
    server(room({ mode: wait }), () => ({ status: 200, json: { now: NOW } }));
    await loadSquadRoom();
    openSquadModeCard();
    expect(squadModeCardNow()).toBe(NOW - 5_000);
    openSquadStack();
    expect([squadStackOpenNow(), squadModeCardNow(), squadStackBehindNow()]).toEqual([true, null, false]);
    // back to the match from the tower's strip: the tower folded behind it
    openSquadModeCard();
    expect([squadStackOpenNow(), squadModeCardNow(), squadStackBehindNow()]).toEqual([false, NOW - 5_000, true]);
    // and back again from the match's
    openSquadStack();
    expect([squadStackOpenNow(), squadModeCardNow(), squadStackBehindNow()]).toEqual([true, null, false]);
    openSquadModeCard();
    closeSquadModeCard();
    expect([squadStackOpenNow(), squadModeCardNow(), squadStackBehindNow()]).toEqual([false, null, false]);
    openSquadStack();
    closeSquadStack();
    expect([squadStackOpenNow(), squadStackBehindNow()]).toEqual([false, false]);
  });
});
