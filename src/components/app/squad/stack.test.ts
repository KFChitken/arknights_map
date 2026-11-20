import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import {
  modeEnds,
  STACK_HAND_EVERY_MS,
  STACK_IDLE_MS,
  STACK_SWING_MS,
  stackHand,
  stackHeight,
  stackPut,
  stackSwing,
  type StackMode,
} from "@/lib/squadMode";
import { blockOf, stackLine, stackShift, StackView } from "./SquadStack";
import { forgetSquadPage, loadSquadRoom, squadRoomNow, squadStackAgain, squadStackDrop } from "./squading";

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
  fire: { level: 0, prog: 0, at: NOW, by: null, top: 0, last: null, lastTop: 0, bestTop: 0 },
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
/** You (h 1) and 企鹅物流 (h 2) in round 2, begun 10 s ago, three blocks up, the room's highest 5 */
const stack = (more: Partial<StackMode> = {}): StackMode => ({
  kind: "stack",
  by: 1,
  at: NOW - 60_000,
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  endsAt: NOW + 48_000,
  until: NOW + 3_000_000,
  round: 2,
  roundAt: NOW - 10_000,
  blocks: [
    { h: 2, x: 0, at: NOW - 9_000 },
    { h: 1, x: 8, at: NOW - 6_000 },
    { h: 3, x: 10, at: NOW - 12_000 },
  ],
  best: 5,
  ...more,
});
const nothing = () => {};
const view = (r: SquadRoom, m: StackMode, now = NOW, more: { slow?: boolean; msg?: string | null; busy?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(StackView, { room: r, mode: m, now, busy: more.busy ?? false, slow: more.slow ?? false, msg: more.msg ?? null, onClose: nothing, onDrop: nothing, onAgain: nothing, onJoin: nothing, onLeave: nothing }),
  );

describe("基建加盖's rules", () => {
  it("swings 60 px each way and back each 1.6 s, the same for everyone from the round's start", () => {
    const at = NOW;
    expect(stackSwing(at, at)).toBe(-60);
    expect(stackSwing(at, at + 400)).toBeCloseTo(0, 9);
    expect(stackSwing(at, at + 800)).toBe(60);
    expect(stackSwing(at, at + 1_200)).toBeCloseTo(0, 9);
    expect(stackSwing(at, at + STACK_SWING_MS)).toBe(-60);
    expect(stackSwing(at, at + 5 * STACK_SWING_MS + 800)).toBeCloseTo(60);
    expect(Math.round(stackSwing(at, at + 487))).toBe(20);
  });

  it("falls with one more than 40 px off the one under it or the middle more than 30 px off the plank's, sways over 18 px off", () => {
    // the first against the plank's middle
    expect(stackPut([], 0)).toEqual({ off: 0, falls: false, wobbles: false });
    expect(stackPut([], 18)).toMatchObject({ falls: false, wobbles: false });
    expect(stackPut([], 19)).toMatchObject({ falls: false, wobbles: true });
    expect(stackPut([], 30)).toMatchObject({ falls: false, wobbles: true });
    expect(stackPut([], 31)).toMatchObject({ falls: true });
    expect(stackPut([{ x: 0 }], 40)).toMatchObject({ off: 40, falls: false, wobbles: true });
    expect(stackPut([{ x: 0 }], -41)).toMatchObject({ off: -41, falls: true });
    // each near the one under it, but leaning ever further
    expect(stackPut([{ x: 0 }, { x: 20 }, { x: 50 }], 60)).toMatchObject({ off: 10, falls: true, wobbles: false });
    expect(stackPut([{ x: 0 }, { x: 20 }, { x: 50 }], 30)).toMatchObject({ off: -20, falls: false, wobbles: true });
  });

  it("holds three at most, one more each half minute, full till the first is put; counts the tower without the one that made it fall", () => {
    expect(stackHand(undefined, NOW)).toEqual({ n: 3, next: null });
    expect(stackHand({ n: 1, at: NOW }, NOW + 10_000)).toEqual({ n: 1, next: 20_000 });
    expect(stackHand({ n: 1, at: NOW }, NOW + STACK_HAND_EVERY_MS)).toEqual({ n: 2, next: STACK_HAND_EVERY_MS });
    expect(stackHand({ n: 0, at: NOW }, NOW + 3 * STACK_HAND_EVERY_MS + 5)).toEqual({ n: 3, next: null });
    expect(stackHeight(stack())).toBe(3);
    expect(stackHeight(stack({ fell: { at: NOW, height: 2 } }))).toBe(2);
    expect(modeEnds("stack", NOW + 3_000_000, NOW)).toBe(NOW + STACK_IDLE_MS);
    expect(modeEnds("stack", NOW + 1_000, NOW)).toBe(NOW + 1_000);
  });
});

describe("基建加盖's card", () => {
  it("shows the round, those in it, the tower's height, the room's highest, and till it ends with no block put", () => {
    const html = view(room({ mode: stack() }), stack());
    expect(html).toContain("<b>基建加盖 · 第 2 轮</b>");
    expect(html).toContain('<span class="ppl">2 人在搭</span>');
    expect(html).toContain("<b>3<small> 层</small></b><span>房间纪录 5 层</span>");
    expect(html).toContain('<span class="idle">1 分钟没人放就结束 · 还剩 0:48</span>');
    // three blocks, each the roach of the one who put it, where they were put
    expect(html.match(/class="blk/g)).toHaveLength(3);
    expect(html).toContain('style="left:calc(50% + -32px);bottom:122px"');
    expect(html).toContain('style="left:calc(50% + -24px);bottom:156px"');
    expect(html).toContain('style="left:calc(50% + -22px);bottom:190px"');
    expect(html).toContain('class="base" style="bottom:112px"');
    expect(html).not.toContain('class="smsg"');
    // a block put here a moment ahead of the page's clock: never more than the minute
    expect(view(room(), stack({ endsAt: NOW + STACK_IDLE_MS + 300 }))).toContain("还剩 1:00");
  });

  it("swings your roach over the top by the server's clock, with 放 while there are blocks in your hand", () => {
    const html = view(room({ mode: stack() }), stack(), NOW);
    // 10 s into the round: 10000 % 1600 = 400 ms, the middle
    expect(html).toContain('class="swing" style="bottom:230px"');
    expect(html).toContain('style="transform:translateX(0px)"');
    expect(html).toContain('aria-label="放下你的蟑螂"');
    expect(html).toContain(">放</button>");
    expect(html).toContain('aria-label="手里 3 块，最多 3 块"');
    expect(html.match(/<i class="on"><\/i>/g)).toHaveLength(3);
    expect(html).toContain("<span>3 / 3</span>");
    expect(html).toContain('<span class="regen">满了，一口气放完再等</span>');
    expect(html).toContain(">不搭了，去围观</button>");
    expect(view(room({ mode: stack() }), stack(), NOW + 400)).toContain('style="transform:translateX(60px)"');
  });

  it("says when the next block grows, and with an empty hand dims your roach and says 没块了", () => {
    const two = view(room(), stack({ hand: { n: 2, at: NOW - 9_000 } }));
    expect(two.match(/<i class="on"><\/i>/g)).toHaveLength(2);
    expect(two).toContain("<span>2 / 3</span>");
    expect(two).toContain('<span class="regen">下一块 0:21 后长出来</span>');
    const none = view(room(), stack({ hand: { n: 0, at: NOW - 9_000 } }));
    expect(none).toContain('class="swing dim"');
    expect(none).toContain('<button type="button" class="put" disabled="">没块了</button>');
    expect(none).not.toContain("放下你的蟑螂");
  });

  it("says the tower sways when its last block was put more than 18 px off, and 慢点 to one tapping again too soon", () => {
    const blocks = [
      { h: 2, x: 0, at: NOW - 9_000 },
      { h: 1, x: 25, at: NOW - 300 },
    ];
    const sway = view(room(), stack({ blocks }));
    expect(sway).toContain('<span class="smsg" role="status">歪了，塔在晃</span>');
    expect(sway).toContain('class="tw sway"');
    expect(stackLine(stack({ blocks }), NOW + 1_300)).toBeNull();
    expect(view(room(), stack({ blocks }), NOW + 1_600)).toContain('class="tw"');
    expect(view(room(), stack(), NOW, { slow: true })).toContain('<span class="smsg" role="status">慢点，每秒只收 1 块</span>');
    // a block just put drops onto the tower
    expect(view(room(), stack({ blocks }), NOW - 200)).toContain('class="blk drop"');
  });

  it("tumbles the tower as it falls, says how high it was, and offers 再来一轮; 0 层 till the next round", () => {
    const blocks = [
      { h: 2, x: 0, at: NOW - 9_000 },
      { h: 1, x: 8, at: NOW - 6_000 },
      { h: 2, x: 52, at: NOW - 100 },
    ];
    const m = stack({ blocks, fell: { at: NOW - 100, height: 2 } });
    const html = view(room(), m);
    expect(html).toContain('<span class="smsg" role="status">塌了！这一轮 2 层</span>');
    expect(html.match(/class="blk f[lr]"/g)).toHaveLength(3);
    expect(html).toContain("<b>0<small> 层</small></b>");
    expect(html).toContain('<span class="idle">没人接着搭 · 0:48 后散场</span>');
    expect(html).toContain('<button type="button" class="put again">再来一轮</button>');
    expect(html).toContain('class="swing dim" style="bottom:128px"');
    // the blocks gone once they fell, the line too after a while
    const later = view(room(), m, NOW + 3_000);
    expect(later).not.toContain('class="blk');
    expect(later).not.toContain('class="smsg"');
    expect(later).toContain("再来一轮");
  });

  it("goes down as the tower grows past five, and draws one gone from the room as a roach of no one's", () => {
    const blocks = Array.from({ length: 8 }, (_, i) => ({ h: (i % 4) + 1, x: 0, at: NOW - 20_000 }));
    expect(stackShift(5)).toBe(0);
    expect(stackShift(8)).toBe(102);
    const html = view(room(), stack({ blocks }));
    expect(html).toContain('class="base" style="bottom:10px"');
    expect(html).toContain('style="left:calc(50% + -32px);bottom:20px"');
    expect(html).toContain('class="ground" style="height:21px"');
    expect(html).toContain('class="swing" style="bottom:298px"');
    expect(blockOf(room(), 9)).toMatchObject({ h: 9, name: "", you: false, avatar: "hood" });
    expect(blockOf(room(), 2).name).toBe("企鹅物流");
  });

  it("offers one watching to join, with no hand and no roach swinging", () => {
    const watching = stack({ in: [{ h: 2, combo: 0 }] });
    const html = view(room(), watching);
    expect(html).toContain("<span>你在围观，加入就能放块</span>");
    expect(html).toContain(">加入一起搭</button>");
    expect(html).not.toContain('class="hand"');
    expect(html).not.toContain('class="swing');
    expect(html).not.toContain("不搭了");
    expect(view(room(), watching, NOW, { msg: "现在没有在玩的。" })).toContain('<p class="rmsg" role="status">现在没有在玩的。</p>');
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

  it("puts your roach on the tower at once where the swing is, a block out of your hand, and sends when, in which round", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { sent } = server(room({ mode: stack() }), () => ({ status: 200, json: { now: NOW, round: 2, best: 5, x: 0, falls: false, wobbles: false, height: 4 } }));
    await loadSquadRoom();
    const put = squadStackDrop();
    const mode = squadRoomNow()!.mode as StackMode;
    expect(mode.blocks.at(-1)).toEqual({ h: 1, x: 0, at: NOW });
    expect(mode.hand).toEqual({ n: 2, at: NOW });
    expect(mode.endsAt).toBe(NOW + STACK_IDLE_MS);
    await put;
    expect(sent.find((s) => s.url === "/api/squad/stack")?.body).toEqual({ do: "drop", round: 2, at: NOW });
  });

  it("knocks it down here at once when it will fall, and reads the room again when refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 800 ms into the swing: 60 px out, 50 off the top block
    vi.setSystemTime(NOW + 400);
    const { sent } = server(room({ mode: stack() }), () => ({ status: 429, json: { error: "慢点，每秒只收 1 块。" } }));
    await loadSquadRoom();
    const put = squadStackDrop();
    const mode = squadRoomNow()!.mode as StackMode;
    expect(mode.blocks.at(-1)).toMatchObject({ x: 60 });
    expect(mode.fell).toEqual({ at: NOW + 400, height: 3 });
    expect(mode.best).toBe(5);
    await expect(put).rejects.toThrow("慢点，每秒只收 1 块。");
    await Promise.resolve();
    expect(sent.filter((s) => s.url === "/api/squad/room")).toHaveLength(2);
    // a tower down: nothing sent
    sent.length = 0;
    const { sent: none } = server(room({ mode: stack({ fell: { at: NOW, height: 3 } }) }), () => ({ status: 200, json: {} }));
    await loadSquadRoom();
    expect(await squadStackDrop()).toBeNull();
    expect(none.filter((s) => s.url === "/api/squad/stack")).toHaveLength(0);
  });

  it("sends 再来一轮 for the round it has, and reads the room again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const { sent } = server(room({ mode: stack({ fell: { at: NOW - 3_000, height: 3 } }) }), () => ({ status: 200, json: { now: NOW, round: 3, best: 5 } }));
    await loadSquadRoom();
    await squadStackAgain();
    expect(sent.map((s) => s.url)).toEqual(["/api/squad/room", "/api/squad/stack", "/api/squad/room"]);
    expect(sent[1].body).toEqual({ do: "again", round: 2 });
  });
});
