import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KEY_OLD_MS, type SquadListRoom } from "@/lib/squad";
import { Prefs, RoomCard } from "./SquadSheet";

const NOW = Date.parse("2026-11-16T20:30:00+08:00");
const room = (more: Partial<SquadListRoom> = {}): SquadListRoom => ({
  id: "r1",
  host: { name: "小龙", friend: false, avatar: "hood", color: "cyan" },
  server: "cn",
  level: 3,
  tags: [2, 5],
  state: "wait",
  friendsOnly: false,
  seats: [
    { role: "host", core: 5, strategy: 18, extras: [4] },
    { role: "friend", name: "红豆", core: 1, strategy: null, extras: [] },
    { role: "mate", core: 0, strategy: null, extras: [1, 2] },
  ],
  at: NOW - 20 * 60_000,
  keyAt: NOW - 3 * 60_000,
  friend: true,
  mine: false,
  music: false,
  ...more,
});
const html = (r: SquadListRoom) => renderToStaticMarkup(createElement(RoomCard, { room: r, now: NOW, busy: false, onJoin: () => {}, onBack: () => {} }));

describe("a room on the list", () => {
  it("names the host, and a teammate only as the viewer's 触须之交; every seat's card, the strategy by its operator", () => {
    const out = html(room());
    expect(out).toContain("小龙");
    expect(out).toContain("险境模拟");
    expect(out).toContain("冲奖杯 · 稳一点");
    expect(out).toContain("红豆");
    expect(out).toContain("队友");
    expect(out).toContain("<b class=\"\">阿戈尔</b>");
    // the operator shown, the strategy's name only to a screen reader until tapped
    expect(out).toContain(">老鲤</button>");
    expect(out).not.toContain("<small>得闲饮茶</small>");
    expect(out).toContain("<b class=\"none\">无偏好</b>");
    expect(out).toContain("精准 迅捷");
    expect(out).toContain("三缺一");
    expect(out).toContain("加入");
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

  it("keeps a card the season no longer has as none", () => {
    expect(renderToStaticMarkup(createElement(Prefs, { card: { core: 5, strategy: 999, extras: [999] } }))).toBe(
      '<span class="prefs"><b class="">阿戈尔</b></span>',
    );
  });
});
