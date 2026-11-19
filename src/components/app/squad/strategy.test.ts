import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isPhrase, PHRASE_ROWS, strategyOf, TO, type SquadMember, type SquadRoom } from "@/lib/squad";
import { Bubble } from "./SquadRoach";
import SquadMateCard, { linesTo } from "./SquadMateCard";
import { MemberTile } from "./SquadSheet";
import { FillAsk, RoundTab } from "./SquadTalk";
import { answerPicks, answersTo, ToMeCard } from "./SquadToMe";
import { lineWords, recentLines } from "./squading";

const LOOK = { avatar: "hood", color: "cyan" };
const member = (more: Partial<SquadMember> = {}): SquadMember => ({
  h: 2,
  name: "Dr. 晚昼",
  host: false,
  you: false,
  friend: false,
  inGame: true,
  pose: 0,
  core: 1,
  strategy: 21,
  extras: [],
  ...LOOK,
  ...more,
});
const me = (more: Partial<SquadMember> = {}) => member({ h: 1, name: "海嗣饲养员", host: true, you: true, strategy: 18, ...more });

describe("a line said to one in the room (对 TA 说)", () => {
  it("is its own row, out of 说话 and of what a 人机 says by itself", () => {
    const to = PHRASE_ROWS.find(([r]) => r === "to")![1];
    expect(to).toEqual([36, 37, 38, 39, 40, 41, 42, 43]);
    expect(to.every(isPhrase)).toBe(true);
  });

  it("fills in the strategy asked for, as it was said, and with none known asks for a change", () => {
    expect(lineWords(TO.giveUp, 21)).toBe(`能把「${strategyOf(21)!.op}」让给我吗？`);
    expect(lineWords(TO.giveUp, null)).toBe("能换个策略吗？");
    expect(lineWords(TO.change, 21)).toBe("能换个策略吗？");
    expect(lineWords(TO.thanks)).toBe("谢谢！");
  });

  it("names whom it was said to over its bubble, 「对你」 to them", () => {
    const now = Date.now();
    const bubble = (to: SquadMember | null) =>
      renderToStaticMarkup(createElement(Bubble, { line: { key: 1, h: 1, p: TO.giveUp, at: now, to: 2, s: 21 }, to }));
    expect(bubble(member())).toContain('<small class="sq-bto">对 Dr. 晚昼</small>能把「森蚺」让给我吗？');
    expect(bubble(member({ you: true }))).toContain('<small class="sq-bto">对你</small>');
    // TA gone from the room: the line alone
    expect(bubble(null)).not.toContain("sq-bto");
    // a line to everyone names nobody
    expect(renderToStaticMarkup(createElement(Bubble, { line: { key: 2, h: 1, p: 14, at: now } }))).not.toContain("sq-bto");
  });

  it("is never kept among 常用 (it is said from a teammate's card)", () => {
    const kept = new Map([["squad.recent", JSON.stringify([36, 14, 40, 999, 15])]]);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => kept.get(k) ?? null } });
    try {
      expect(recentLines()).toEqual([14, 15]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a tile in a room that waits", () => {
  const tile = (m: SquadMember, more: { clash?: boolean; named?: boolean } = {}) =>
    renderToStaticMarkup(
      createElement(MemberTile, {
        m,
        art: null,
        playing: false,
        clash: more.clash,
        named: more.named ? { key: 7, h: 1, p: TO.change, at: Date.now(), to: m.h, s: m.strategy } : undefined,
        lift: 0,
        open: false,
        onCore: () => {},
        onStrategy: () => {},
        onMenu: () => {},
      }),
    );

  it("rings a strategy that clashes red with 撞", () => {
    expect(tile(member(), { clash: true })).toContain('<span class="sq-stw clash">');
    expect(tile(member(), { clash: true })).toContain('<i class="ctag">撞</i>');
    expect(tile(member())).not.toContain("ctag");
  });

  it("flashes as a line is said to TA", () => {
    expect(tile(member(), { named: true })).toContain('class="sq-named"');
    expect(tile(member())).not.toContain("sq-named");
  });
});

describe("a teammate's card while the room waits", () => {
  const card = (m: SquadMember, more: { playing?: boolean; onSay?: (p: number) => void } = {}) =>
    renderToStaticMarkup(
      createElement(SquadMateCard, {
        m,
        host: true,
        staff: false,
        playing: false,
        art: null,
        busy: false,
        className: "in-sheet",
        me: me(),
        onSay: () => {},
        onTouch: () => {},
        onKick: () => {},
        onSafety: () => {},
        onBot: () => {},
        onClose: () => {},
        ...more,
      }),
    );

  it("offers what may be said to TA as things stand", () => {
    // a clash with yours: 能换个策略吗？; TA's own: 能把「…」让给我吗？; none: 选个策略吧; not ready: 快准备呀; always 谢谢！
    expect(linesTo(member({ strategy: 18 }), me())).toEqual([TO.change, TO.thanks]);
    expect(linesTo(member(), me())).toEqual([TO.giveUp, TO.thanks]);
    expect(linesTo(member({ strategy: null }), me())).toEqual([TO.pick, TO.thanks]);
    expect(linesTo(member({ inGame: false }), me())).toEqual([TO.giveUp, TO.ready, TO.thanks]);
    // the host needs not get ready
    expect(linesTo(member({ host: true, inGame: false }), me({ host: false }))).toEqual([TO.giveUp, TO.thanks]);
    // 无偏好 on both sides is no clash
    expect(linesTo(member({ strategy: null }), me({ strategy: null }))).toEqual([TO.pick, TO.thanks]);
  });

  it("shows TA's strategy and the row 对 TA 说, a 人机's too, and neither while a round plays", () => {
    const out = card(member({ inGame: false }));
    expect(out).toContain("森蚺");
    expect(out).toContain("对 TA 说 · 房间里的人都看得到");
    expect(out).toContain(">能把「森蚺」让给我吗？</button>");
    expect(out).toContain(">快准备呀</button>");
    expect(out).toContain(">谢谢！</button>");
    expect(card(member({ strategy: null }))).toContain("无偏好");
    expect(card(member({ strategy: null }))).toContain(">选个策略吧</button>");
    expect(card(member({ h: -1, name: "人机 1", bot: true }))).toContain("对 TA 说");
    expect(card(member(), { playing: true })).not.toContain("对 TA 说");
    expect(card(member(), { onSay: undefined })).not.toContain("对 TA 说");
  });
});

describe("a line said to you, over the room or the map", () => {
  const banner = (p: number, s: number | null = 18) =>
    renderToStaticMarkup(createElement(ToMeCard, { line: { p, s }, from: member({ h: 3, name: "今天也在刷1-7" }), busy: false, onAnswer: () => {}, onClose: () => {} }));

  it("says who said what, with its answers under it; 谢谢！ has none", () => {
    const ask = banner(TO.giveUp);
    expect(ask).toContain("今天也在刷1-7 对你说");
    expect(ask).toContain("能把「老鲤」让给我吗？");
    expect(ask).toContain(">好，我换</button>");
    expect(ask).toContain(">不换啦，你换一个？</button>");
    expect(banner(TO.pick)).toContain(">好嘞</button>");
    expect(banner(TO.ready)).toContain(">好嘞</button>");
    expect(banner(TO.thanks)).not.toContain("</button><button");
    expect(answersTo(TO.thanks)).toEqual([]);
    expect(answersTo(TO.change)).toEqual([TO.ok, TO.no]);
    expect(answersTo(TO.ready)).toEqual([TO.sure]);
  });

  it("goes on to the strategy picker for 好，我换, and 好嘞 to 选个策略吧", () => {
    expect(answerPicks(TO.change, TO.ok)).toBe(true);
    expect(answerPicks(TO.giveUp, TO.ok)).toBe(true);
    expect(answerPicks(TO.change, TO.no)).toBe(false);
    expect(answerPicks(TO.pick, TO.sure)).toBe(true);
    expect(answerPicks(TO.ready, TO.sure)).toBe(false);
  });
});

describe("这局 once a round has started", () => {
  const room = (mine: number | null): SquadRoom =>
    ({ state: "go", members: [me({ strategy: mine }), member({ strategy: 21 })] }) as unknown as SquadRoom;
  const round = (mine: number | null) => renderToStaticMarkup(createElement(RoundTab, { room: room(mine), onError: () => {} }));

  it("locks the strategy marked, the core alliance and 附加盟约 changing as before", () => {
    const out = round(18);
    expect(out).toContain('<div class="sq-lockrow">');
    expect(out).toContain("开打了，策略锁住；「结束这局」以后才能换");
    expect(out).toContain('<i class="lk">锁住了</i>');
    expect(out).toContain('<i class="ok">照旧能换</i>');
    expect(out).toContain('<i class="ok">照旧能改</i>');
    // no grid to pick another from
    expect(out).not.toContain("sq-stgrid");
  });

  it("lets one with 无偏好 fill one nobody plays (补位), teammates' grey, asked first", () => {
    const out = round(null);
    expect(out).toContain('<i class="ok">补位</i>');
    expect(out).toContain("补一个没人用的；补了就锁住，「结束这局」以后才能换");
    expect(out).toContain("你名片是「无偏好」：补一个没人用的策略，队友就看到了");
    expect(out).toContain("sq-stgrid");
    const ask = renderToStaticMarkup(createElement(FillAsk, { s: strategyOf(19)!, onYes: () => {}, onNo: () => {} }));
    expect(ask).toContain("就补「芬」？补了这局就不能换了");
    expect(ask).toContain(">补位</button>");
    expect(ask).toContain(">再想想</button>");
  });
});
