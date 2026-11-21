import { createElement } from "react";
import { T } from "@/i18n";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUBBLE_MS, KEY_OLD_MS, type SquadListRoom, type SquadMember, type SquadSeat } from "@/lib/squad";
import { Bubble, liftsOf, SquadRoach } from "./SquadRoach";
import SquadMateCard from "./SquadMateCard";
import { MemberTile, RoomCard, SeatTile } from "./SquadSheet";
import { StrategyFace } from "./SquadPicks";
import { squadCallLine, type SquadLine } from "./squading";

const NOW = Date.parse("2026-11-16T20:30:00+08:00");
const LOOK = { avatar: "hood", color: "cyan" };
const room = (more: Partial<SquadListRoom> = {}): SquadListRoom => ({
  id: "r1",
  host: { name: "小龙", friend: false, avatar: "hood", color: "cyan" },
  server: "cn",
  level: 3,
  tags: [2, 5],
  state: "wait",
  friendsOnly: false,
  seats: [
    { role: "host", core: 5, strategy: 18, ...LOOK },
    { role: "friend", name: "红豆", core: 1, strategy: null, ...LOOK },
    { role: "mate", core: 0, strategy: null, ...LOOK },
  ],
  at: NOW - 20 * 60_000,
  keyAt: NOW - 3 * 60_000,
  friend: true,
  mine: false,
  music: false,
  ...more,
});
const html = (r: SquadListRoom, myStrategy: number | null = null) =>
  renderToStaticMarkup(createElement(RoomCard, { room: r, now: NOW, busy: false, art: null, myStrategy, onJoin: () => {}, onBack: () => {} }));

describe("a room on the list", () => {
  it("shows its 难度's badge and four seats: the host by name, a teammate only where TA may be named, every seat's picks", () => {
    const out = html(room());
    expect(out).toContain('<span class="sq-lv lv3">险境模拟</span>');
    expect(out).toContain("冲奖杯 · 稳一点");
    expect(out).toContain("小龙");
    expect(out).toContain("红豆");
    expect(out).toContain("队友");
    expect(out).toContain('<span class="sq-core">阿戈尔</span>');
    expect(out).toContain('<span class="sq-core none">随机应变</span>');
    // with no picture yet, the strategy's operator by name; the strategy's own name only once tapped
    expect(out).toContain("老鲤");
    expect(out).not.toContain("得闲饮茶</small>");
    // one empty seat, dashed
    expect(out.match(/sq-seat empty/g)).toHaveLength(1);
    expect(out).toContain("三缺一");
    expect(out).toContain("加入");
  });

  it("marks a seat whose strategy is the viewer's card's, and says so under the room; 无偏好 never clashes", () => {
    const clash = html(room(), 18);
    expect(clash).toContain('<i class="tag">撞</i>');
    expect(clash).toContain("和你的策略撞了");
    for (const mine of [null, 19]) {
      expect(html(room(), mine)).not.toContain("撞");
    }
  });

  it("says how old its key is, and that it may be gone once the game's alliance may be", () => {
    expect(html(room())).toContain("密钥 3 分钟前");
    const old = html(room({ keyAt: NOW - KEY_OLD_MS - 60_000 }));
    expect(old).toContain("密钥 16 分钟前 · 可能过期");
    expect(old).toContain("sq-age old");
  });

  it("is marked 测试 with 人机 in it (to the 站长 and the admins alone)", () => {
    expect(html(room({ test: true }))).toContain('<small class="tst">测试</small>');
    expect(html(room())).not.toContain("测试");
  });

  it("says in 消息 that its host stopped anyone coming in (停止加入)", () => {
    expect(squadCallLine({ state: "stopped", n: 2, server: "cn", level: 3 })).toBe("房主停止了加入");
    expect(squadCallLine({ state: "open", n: 2, server: "cn", level: 3 })).toBe("险境模拟 · 官服 · 现在 2/4");
  });

  it("is closed while playing, and leads back to one's own room", () => {
    const go = html(room({ state: "go" }));
    expect(go).toContain("开打中");
    expect(go).not.toContain("加入");
    expect(html(room({ mine: true }))).toContain("回房间");
  });

  it("keeps a pick the season no longer has as none", () => {
    const seat: SquadSeat = { role: "mate", core: 5, strategy: 999, ...LOOK };
    const out = renderToStaticMarkup(createElement(SeatTile, { seat, hostName: "", hostFriend: false, art: null, clash: false }));
    expect(out).toContain('<span class="sq-core">阿戈尔</span>');
    expect(out).toContain("sq-face none");
  });
});

describe("a roach in a room's tile", () => {
  const member = (more: Partial<SquadMember> = {}): SquadMember => ({
    h: 2,
    name: "红豆",
    host: false,
    you: false,
    friend: false,
    inGame: true,
    pose: 0,
    core: 1,
    strategy: null,
    extras: [],
    ...LOOK,
    ...more,
  });
  const roach = (m: SquadMember, line?: SquadLine) => renderToStaticMarkup(createElement(SquadRoach, { m, size: 42, line }));

  it("dances with its sleeves going up and down, lies asleep, and shouts as its line comes", () => {
    expect(roach(member({ pose: 1 }))).toContain('class="sq-roach dance"');
    expect(roach(member({ pose: 1 })).match(/<img /g)).toHaveLength(2);
    expect(roach(member({ pose: 2 }))).toContain('class="sq-roach sleep"');
    const now = Date.now();
    expect(roach(member(), { key: 1, h: 2, p: 14, at: now })).toContain("sq-roach yell yell-hood");
    // asleep, it does not shout
    expect(roach(member({ pose: 2 }), { key: 1, h: 2, p: 14, at: now })).not.toContain("yell");
    expect(roach(member(), { key: 1, h: 2, p: 14, at: now - 5_000 })).not.toContain("yell");
  });

  it("marks a 人机's tile 人机, its 准备 as anyone's", () => {
    const tile = (m: SquadMember) =>
      renderToStaticMarkup(
        createElement(MemberTile, {
          m,
          art: null,
          playing: false,
          lift: 0,
          open: false,
          onCore: () => {},
          onStrategy: () => {},
          onMenu: () => {},
        }),
      );
    const bot = tile(member({ h: -1, name: "人机 1", bot: true }));
    expect(bot).toContain('class="sq-tile bot"');
    expect(bot).toContain('<span class="bt">人机</span>');
    expect(bot).toContain("✓ 准备好了");
    expect(tile(member())).not.toContain('class="bt"');
  });

  it("says one thing on a tile: the mode one is in first (等开局 when ready for a match), else 在搭; a small tower by a 基建狂魔's name", () => {
    const tile = (m: SquadMember, more: { inMode?: "quiz" | "race"; readyMode?: boolean; building?: boolean } = {}) =>
      renderToStaticMarkup(
        createElement(MemberTile, {
          m,
          art: null,
          playing: false,
          lift: 0,
          open: false,
          onCore: () => {},
          onStrategy: () => {},
          onMenu: () => {},
          ...more,
        }),
      );
    expect(tile(member(), { building: true })).toContain('<span class="dz k-stack">在搭</span>');
    expect(tile(member(), { building: true, inMode: "race" })).toContain('<span class="dz k-race">在跑</span>');
    expect(tile(member(), { building: true, inMode: "race" })).not.toContain("在搭");
    expect(tile(member(), { building: true, inMode: "quiz", readyMode: true })).toContain('<span class="dz k-quiz">等开局</span>');
    expect(tile(member())).not.toContain('class="dz');
    // the flame first, then the tower
    const both = tile(member({ fireTop: true, stackTop: true }));
    expect(both).toContain('aria-label="基建狂魔"');
    expect(both.indexOf('aria-label="篝火守夜人"')).toBeLessThan(both.indexOf('aria-label="基建狂魔"'));
    expect(tile(member())).not.toContain("基建狂魔");
  });

  it("says a line in a bubble for 4 s, a later one beside it higher up", () => {
    const now = Date.now();
    const bubble = (at: number) => renderToStaticMarkup(createElement(Bubble, { line: { key: 1, h: 2, p: 14, at }, lift: 28 }));
    expect(bubble(now)).toContain("大的来了");
    expect(bubble(now)).toContain("--lift:28px");
    expect(bubble(now - BUBBLE_MS - 1)).toBe("");
    const lines = [
      { key: 1, h: 1, p: 14, at: now - 2_000 },
      { key: 2, h: 2, p: 15, at: now - 1_000 },
      { key: 3, h: 4, p: 16, at: now - 500 },
      { key: 4, h: 3, p: 17, at: now - 10_000 },
    ];
    // 1 and 2 sit side by side: 2, the later, goes up; 4 is two tiles from 1 and above none; 3's is over
    expect([...liftsOf(lines, [1, 2, 3, 4], 28, now)]).toEqual([
      [1, 0],
      [2, 28],
      [4, 0],
    ]);
  });
});

describe("a teammate's card", () => {
  const mate = (more: Partial<SquadMember> = {}): SquadMember => ({
    h: 2,
    name: "红豆",
    host: false,
    you: false,
    friend: false,
    inGame: true,
    pose: 0,
    core: 5,
    strategy: 18,
    extras: [1, 2],
    ...LOOK,
    ...more,
  });
  const card = (m: SquadMember, more: { host?: boolean; staff?: boolean; playing?: boolean; touched?: "sneaky" | "bold" } = {}) =>
    renderToStaticMarkup(
      createElement(SquadMateCard, {
        m,
        host: false,
        staff: false,
        playing: false,
        art: null,
        touches: { left: 2, at: Date.now() + 3_600_000 },
        busy: false,
        className: "in-sheet",
        onTouch: () => {},
        onKick: () => {},
        onSafety: () => {},
        onBot: () => {},
        onClose: () => {},
        ...more,
      }),
    );

  it("is the map's card: TA's roach and name, 准备 while the room waits, the touches as on the map and today's left, 拉黑 and 举报 at its foot", () => {
    const out = card(mate({ friend: true }));
    expect(out).toContain('class="card stack sq-mate in-sheet"');
    expect(out).toContain("红豆");
    expect(out).toContain('<span class="sq-mtag fr">触须之交</span>');
    expect(out).toContain("✓ 准备好了");
    expect(out).toContain("偷偷伸出触须");
    expect(out).toContain("大胆伸出触须");
    expect(out).toContain("今天总共还能碰 <b>2</b> 次");
    expect(out).toContain(">拉黑<");
    expect(out).toContain(">举报<");
    // 请出去 only to the host, each of the three asked first (nothing to ask yet)
    expect(out).not.toContain("请出去");
    expect(out).not.toContain("sq-mask");
    expect(card(mate(), { host: true })).toContain('<button class="link out">请出去</button>');
    expect(card(mate({ inGame: false }))).toContain("还没准备（还没进同盟）");
    expect(card(mate({ host: true }))).toContain("房主不用准备");
  });

  it("offers 请出去 to the host while the room waits, never once a round has started", () => {
    expect(card(mate(), { host: true })).toContain("请出去");
    expect(card(mate(), { host: true, playing: true })).not.toContain("请出去");
  });

  it("shows TA's round while it plays, and today's touch done", () => {
    const out = card(mate(), { playing: true });
    expect(out).toContain("这局：");
    expect(out).toContain("老鲤");
    expect(out).toContain('<span class="sq-core">阿戈尔</span>');
    expect(out).not.toContain("准备好了");
    expect(card(mate(), { touched: "bold" })).toContain("今天碰过了");
  });

  it("hangs the pass TA wears, folded or not as on the map; a 人机's has no foot, its touches on this page, and its row to the 站长 or an admin hosting", () => {
    const pass = { game: "ak" as const, charId: 21, name: "风笛", en: "Bagpipe", rarity: 6, no: 799, fancy: false, color: "#8a6833", art: null, avatar: null, drawnAt: Date.now() };
    const worn = card(mate({ pass }));
    expect(worn).toContain("with-pass");
    expect(worn).toContain("通行证 · 风笛");
    const bot = mate({ h: -1, name: "人机 1", bot: true });
    const plain = card(bot);
    expect(plain).toContain('<span class="sq-mtag bot">人机</span>');
    expect(plain.match(/只放动画，不算次数/g)).toHaveLength(2);
    expect(plain).not.toContain("拉黑");
    expect(plain).not.toContain("今天总共还能碰");
    expect(plain).not.toContain("sq-botrow");
    const theirs = card(bot, { host: true, staff: true });
    expect(theirs).toContain("人机（只有站长和管理员能点这一排）");
    for (const word of ["换策略", "说一句", "换动作", "请出去"]) expect(theirs).toContain(word);
  });

  it("is said in 我的资料 by the switch that hangs the pass, where the name shows", () => {
    expect(T.passes.onMap.hint).toContain("一起卫戍的房间里点你也挂，那里看得到你的名字。");
    expect(T.passes.onMap.label).toBe("地图卡片上挂出通行证");
  });
});

describe("a strategy's picture", () => {
  // 18 老鲤, an operator of the list; 2 歌利亚, none: the game's own 策略发起人 portrait
  const face = (id: number) => renderToStaticMarkup(createElement(StrategyFace, { id, art: { arknights: { 老鲤: "a.webp", 歌利亚: "b.webp" }, endfield: {} }, size: 40 }));

  it("is green and holographic: an operator's usual picture made so, the game's own as it is", () => {
    expect(face(18)).toBe('<span class="sq-face pic holo"><img src="/operator-art/a.webp" alt="" width="40" height="40" loading="lazy"/></span>');
    expect(face(2)).toBe('<span class="sq-face pic"><img src="/operator-art/b.webp" alt="" width="40" height="40" loading="lazy"/></span>');
  });
});
