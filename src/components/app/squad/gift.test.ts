import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SquadMember, SquadRoom } from "@/lib/squad";
import { GIFT_GAP_MS, GIFT_HOLD_MS, GIFT_LEAD_MS, giftAt, type GiftMode, type GiftRound } from "@/lib/squadMode";
import type { DanceMusic } from "./SquadDance";
import { GiftView, giftHits, giftPhase, hitLine, seatOf } from "./SquadGift";
import { modeRow } from "./SquadPlays";
import { forgetSquadPage, loadSquadRoom, squadGiftPass, squadRoomNow } from "./squading";

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
  members: [member(1), member(2), member(3), member(4)],
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
const BOTS = [
  { h: -100, no: 1, avatar: "imp", color: "red" },
  { h: -101, no: 2, avatar: "gugu", color: "blue" },
  { h: -102, no: 3, avatar: "hood", color: "cyan" },
];
/** Opened 1 s ago by you (h 1): its first round starting 2 s on, you and 企鹅物流 (h 2) in it with two of its own 人机 */
const gift = (more: Partial<GiftMode> = {}, rounds?: GiftRound[]): GiftMode => ({
  kind: "gift",
  by: 1,
  at: NOW - 1_000,
  in: [
    { h: 1, combo: 0 },
    { h: 2, combo: 0 },
  ],
  endsAt: NOW + 200_000,
  until: NOW + 200_000,
  song: "s1",
  name: "Operation Pyrite",
  songAt: NOW + 2_000,
  seed: 7,
  rounds: rounds ?? [{ at: NOW + 2_000, seats: [1, 2, -100, -101], from: 0, taps: [] }],
  bots: BOTS,
  ...more,
});
const nothing = () => {};
function view(r: SquadRoom, now: number, more: { music?: DanceMusic; msg?: string | null } = {}) {
  return renderToStaticMarkup(
    createElement(GiftView, {
      room: r,
      mode: r.mode as GiftMode,
      now,
      music: more.music ?? "on",
      busy: false,
      msg: more.msg ?? null,
      onClose: nothing,
      onPass: nothing,
      onPassClick: nothing,
      onJoin: nothing,
      onMusic: nothing,
      onLeave: nothing,
    }),
  );
}

describe("W 的礼物's card", () => {
  it("goes from its start to rounds going, each one's 砰, and the results after the fifth", () => {
    const round = (i: number, more: Partial<GiftRound> = {}): GiftRound => ({ at: NOW + i * 20_000, seats: [1, 2, -100, -101], from: 0, taps: [], ...more });
    const going = gift({}, [round(0)]);
    expect(giftPhase(going, NOW - 1)).toEqual({ at: "lead", r: 0 });
    expect(giftPhase(going, NOW)).toEqual({ at: "round", r: 0 });
    // its stop told once it came: 砰 till the next round starts
    const m = gift({}, [round(0, { stop: NOW + 9_000, hit: 1 }), round(1)]);
    expect(giftPhase(m, NOW + 9_500)).toEqual({ at: "boom", r: 0 });
    expect(giftPhase(m, NOW + 20_000)).toEqual({ at: "round", r: 1 });
    const five = gift({}, [0, 1, 2, 3, 4].map((i) => round(i, { stop: NOW + i * 20_000 + 9_000, hit: i % 4 })));
    expect(giftPhase(five, NOW + 89_000 + GIFT_GAP_MS - 1)).toEqual({ at: "boom", r: 4 });
    expect(giftPhase(five, NOW + 89_000 + GIFT_GAP_MS)).toEqual({ at: "results" });
  });

  it("seats you at the foot and the others as the gift goes, the room's names and its own 人机's, the gift at the first seat before it starts", () => {
    const r = room({ mode: gift() });
    const html = view(r, NOW + 900);
    expect(html).toContain("W 的礼物 · 2 秒后开始");
    expect(html).toContain('<span class="song">♪ 咚 咚 咚</span>');
    expect(html).toMatch(/class="gseat p0 you"><span class="gw">.*<svg class="box"/);
    expect(html).toContain('<span class="nm">你</span>');
    expect(html).toMatch(/class="gseat p1">.*<span class="nm">企鹅物流<\/span>/);
    expect(html).toContain('<span class="nm">人机 1<em>人机</em></span>');
    expect(html).toContain('<button type="button" class="pass" disabled="">2 秒后开始</button>');
    expect(html).toContain("不玩了，去围观");
    // 企鹅物流's page: TA at the foot, you (银灰厨 to TA) on TA's right
    const theirs = view(room({ mode: gift(), you: 2, members: [member(1, { you: false }), member(2, { you: true }), member(3), member(4)] }), NOW + 900);
    expect(theirs).toMatch(/class="gseat p3"><span class="gw">.*<span class="nm">银灰厨<\/span>/);
    // its own 人机 as members of the room would be
    expect(seatOf(r, gift(), -101)).toMatchObject({ h: -101, name: "人机 2", avatar: "gugu", color: "blue", bot: true, you: false });
  });

  it("puts the gift in your hands with the ring and 传, the song over the drum; else 等礼物转回来", () => {
    const r = room({ mode: gift() });
    const t = NOW + 2_000 + 500;
    expect(giftAt(gift().rounds[0], 7, 0, t)).toEqual({ seat: 0, since: NOW + 2_000, k: 0 });
    const mine = view(r, t);
    expect(mine).toContain("W 的礼物 · 第 1 / 5 轮");
    expect(mine).toContain('<span class="song">♪ 咚 咚 咚 · Operation Pyrite</span>');
    expect(mine).toContain('class="drum on"');
    expect(mine).toContain('<svg class="ring"');
    expect(mine).toContain(`animation-duration:${GIFT_HOLD_MS}ms;animation-delay:-500ms`);
    expect(mine).toContain("W 的礼物在你手上，引线在烧！2 秒不传会自动传出去");
    expect(mine).toContain('<button type="button" class="pass" aria-label="把礼物传给下一个">传</button>');
    // passed: on with 企鹅物流
    const passed = room({ mode: gift({}, [{ at: NOW + 2_000, seats: [1, 2, -100, -101], from: 0, taps: [{ at: NOW + 2_300, seat: 0 }] }]) });
    const theirs = view(passed, t);
    expect(theirs).toMatch(/class="gseat p1">.*<svg class="box"/);
    expect(theirs).not.toContain('<svg class="ring"');
    expect(theirs).toContain('<button type="button" class="pass" disabled="">等礼物转回来…</button>');
    // the music's button as the dance's
    expect(view(r, t, { music: "else" })).toContain("音乐：先不放");
  });

  it("says 砰 by the one hit, turned over with 漏勺, who it was, and when the next round comes", () => {
    const rounds = (hit: number): GiftRound[] => [
      { at: NOW, seats: [1, 2, -100, -101], from: 0, taps: [], stop: NOW + 8_000, hit },
      { at: NOW + 12_000, seats: [1, 2, -100, -101], from: hit, taps: [] },
    ];
    const t = NOW + 9_000;
    const them = view(room({ mode: gift({}, rounds(1)) }), t);
    expect(them).toContain('<span class="song">♪ 歌停了</span>');
    expect(them).toMatch(/class="gseat p1"><span class="gw"><span class="body hit">.*<img class="ladle"[^>]*\/><span class="bang">砰！<\/span>/);
    expect(them).toContain("砰！企鹅物流 被礼物炸翻了，扣漏勺 1 分钟");
    expect(them).toContain('<button type="button" class="pass" disabled="">下一轮 3 秒后</button>');
    expect(view(room({ mode: gift({}, rounds(0)) }), t)).toContain("砰！你被礼物炸翻了，扣漏勺 1 分钟");
    expect(view(room({ mode: gift({}, rounds(2)) }), t)).toContain("砰！人机 1 被礼物炸翻了");
    // one alone practises
    const alone = room({ mode: gift({ in: [{ h: 1, combo: 1 }] }, rounds(0)) });
    expect(hitLine(alone, alone.mode as GiftMode, rounds(0)[0])).toBe("砰！你被礼物炸翻了（自己练，不扣漏勺）");
    // 漏勺 from the server already on TA's head (drawn on the room's tiles, not here): drawn here once
    const worn = room({ mode: gift({}, rounds(1)), members: [member(1), member(2, { head: { item: 5, until: NOW + 60_000 } }), member(3), member(4)] });
    expect(view(worn, t).match(/<img class="ladle"/g)).toHaveLength(1);
  });

  it("asks one watching to join from the next round, one in it not seated yet to wait, and gives how often each was hit at the end", () => {
    const watching = view(room({ mode: gift({ in: [{ h: 2, combo: 0 }], by: 2 }, [{ at: NOW, seats: [2, -100, -101, -102], from: 0, taps: [] }]) }), NOW + 500);
    expect(watching).toContain("你在围观，加入以后下一轮坐进来");
    expect(watching).toContain('<button type="button" class="pass join">下一轮加入</button>');
    expect(watching).not.toContain("不玩了，去围观");
    const waiting = view(room({ mode: gift({ in: [{ h: 2, combo: 0 }, { h: 1, combo: 0 }], by: 2 }, [{ at: NOW, seats: [2, -100, -101, -102], from: 0, taps: [] }]) }), NOW + 500);
    expect(waiting).toContain("下一轮坐进来");
    // the end: most hit first, the 人机 after players with as many, those never hit last
    const ended = gift({ in: [{ h: 1, combo: 2 }, { h: 2, combo: 0 }] }, [
      { at: NOW - 90_000, seats: [1, 2, -100, -101], from: 0, taps: [], stop: NOW - 80_000, hit: 0 },
      { at: NOW - 70_000, seats: [1, 2, -100, -101], from: 0, taps: [], stop: NOW - 60_000, hit: 2 },
      { at: NOW - 50_000, seats: [1, 2, -100, -101], from: 2, taps: [], stop: NOW - 40_000, hit: 0 },
      { at: NOW - 30_000, seats: [1, 2, -100, -101], from: 0, taps: [], stop: NOW - 20_000, hit: 3 },
      { at: NOW - 16_000, seats: [1, 2, -100, -101], from: 3, taps: [], stop: NOW - 10_000, hit: 3 },
    ]);
    const r = room({ mode: ended });
    expect(giftHits(r, ended).map((x) => [x.m.h, x.n])).toEqual([
      [1, 2],
      [-101, 2],
      [-100, 1],
      [2, 0],
    ]);
    const html = view(r, NOW);
    expect(html).toContain("W 的礼物 · 这一局完了");
    expect(html).toContain("<h3>这一局</h3>");
    expect(html).toContain('<span class="nm">你</span><b>被炸 2 次</b>');
    expect(html).toContain('<span class="nm">企鹅物流</span><b>一次没被炸</b>');
    expect(html).toContain('<span class="nm">人机 2</span><em>人机</em><b>被炸 2 次</b>');
    expect(html).not.toContain('class="pass');
  });

  it("is a row of 玩点什么 as the others are", () => {
    expect(modeRow(room(), "gift", NOW)).toEqual({ kind: "gift", label: "开", does: "open" });
    expect(modeRow(room({ mode: gift({ in: [{ h: 2, combo: 0 }], by: 2 }) }), "gift", NOW)).toEqual({ kind: "gift", label: "正在玩 · 加入", does: "join" });
  });
});

describe("W 的礼物 on the page", () => {
  afterEach(() => {
    forgetSquadPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function server(r: SquadRoom, pass: (body: Record<string, unknown>) => { status: number; json: unknown }) {
    const sent: string[] = [];
    vi.stubGlobal("window", {
      __ZP_I18N: globalThis.__ZP_I18N_SERVER!(),
      setTimeout: () => 0,
      clearTimeout: () => {},
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      sent.push(url);
      if (url === "/api/squad/room") return new Response(JSON.stringify({ room: r, now: Date.now() }));
      const res = pass(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify(res.json), { status: res.status });
    });
    return sent;
  }

  it("passes the gift on at once from your seat, at the server's clock, and reads the room again when refused", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW + GIFT_LEAD_MS);
    const m = gift({}, [{ at: NOW + 2_000, seats: [1, 2, -100, -101], from: 0, taps: [] }]);
    let answer: { status: number; json: unknown } = { status: 200, json: { now: NOW + 3_000, at: NOW + 3_000 } };
    const bodies: Record<string, unknown>[] = [];
    const sent = server(room({ mode: m, now: NOW + 3_000 }), (b) => {
      bodies.push(b);
      return answer;
    });
    await loadSquadRoom();
    const going = squadGiftPass();
    // shown at once: the gift on with 企鹅物流
    const shown = (squadRoomNow()!.mode as GiftMode).rounds[0];
    expect(shown.taps).toEqual([{ at: NOW + 3_000, seat: 0 }]);
    expect(giftAt(shown, 7, 0, NOW + 3_000).seat).toBe(1);
    expect(await going).toEqual({ now: NOW + 3_000, at: NOW + 3_000 });
    expect(bodies).toEqual([{ at: NOW + 3_000 }]);
    answer = { status: 409, json: { error: "礼物不在你手上。" } };
    await expect(squadGiftPass()).rejects.toThrow("礼物不在你手上。");
    expect(sent.filter((u) => u === "/api/squad/room").length).toBeGreaterThanOrEqual(2);
  });
});
