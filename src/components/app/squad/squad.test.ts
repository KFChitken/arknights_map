import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUBBLE_MS, KEY_OLD_MS, type SquadListRoom, type SquadMember, type SquadSeat } from "@/lib/squad";
import { Bubble, liftsOf, SquadRoach } from "./SquadRoach";
import { MemberTile, RoomCard, SeatTile } from "./SquadSheet";
import type { SquadLine } from "./squading";

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
