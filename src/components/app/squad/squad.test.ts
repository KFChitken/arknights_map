import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KEY_OLD_MS, type SquadListRoom, type SquadSeat } from "@/lib/squad";
import { RoomCard, SeatTile } from "./SquadSheet";

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
