import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { badgeById, BADGES, wallBadges, type EarnedBadge } from "@/lib/badges";
import type { Me } from "@/lib/world/types";
import { BadgePeek, BadgePill, BadgeWall, NewBadge } from "./Badges";

/** Every count a badge is earned by, at 0 but those given */
const countsOf = (some: Partial<Me["counts"]> = {}) =>
  ({ ...Object.fromEntries(BADGES.flatMap((b) => (b.goal ? [[b.goal.count, 0]] : []))), ...some }) as Me["counts"];

const peek = (id: string, counts = countsOf()) =>
  renderToStaticMarkup(createElement(BadgePeek, { badge: badgeById(id)!, counts, onClose: () => {} }));

const wall = (badges: EarnedBadge[], wornBadge: string | null, counts = countsOf()) =>
  renderToStaticMarkup(
    createElement(BadgeWall, { me: { badges, wornBadge, counts } as Me, onWear: () => {}, onBack: () => {}, onClose: () => {} }),
  );

/** The text a piece of markup shows, without its tags */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

describe("a badge not earned yet, tapped on 我的称号", () => {
  it("says how to get it, word for word, and how far along its count is, but never its quote", () => {
    const b = badgeById("stormchaser")!;
    const html = peek("stormchaser", countsOf({ radarDays: 4 }));
    expect(text(html)).toContain("天灾信使");
    expect(text(html)).toContain("日常系列 · 还没拿到");
    expect(text(html)).toContain(`怎么拿${b.condition}`);
    expect(b.condition).toBe("累计 10 天用过方舟雷达");
    expect(text(html)).toContain("进度4 / 10 天");
    expect(html).toContain('style="width:40%"');
    expect(text(html)).toContain("拿到后能戴在名字下面，还会解锁一句台词。");
    expect(text(html)).toContain("知道了");
    expect(html).not.toContain(b.quote);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="badge-peek-name"');
  });

  it("shows no count for a badge earned without one: its condition says it all", () => {
    const b = badgeById("delivery")!;
    const html = peek("delivery");
    expect(text(html)).toContain(b.condition);
    expect(html).not.toContain("badge-peek-progress");
    expect(html).not.toContain(b.lockedHint);
    expect(html).not.toContain(b.quote);
  });

  it("says an event badge on offer now is going on, without a lock", () => {
    const b = BADGES.find((x) => x.series === "event")!;
    const html = peek(b.id);
    expect(text(html)).toContain("活动系列 · 进行中");
    expect(html).toContain("badge-peek-card running");
    expect(html).not.toContain('class="lock"');
    expect(html).not.toContain(b.quote);
  });

  it("holds no quote of any badge, earned or not, for any count", () => {
    for (const b of BADGES) {
      const html = peek(b.id, countsOf(b.goal ? { [b.goal.count]: b.goal.n - 1 } : {}));
      expect(html, b.id).not.toContain(b.quote.replace("{serial}", ""));
      expect(text(html), b.id).toContain(b.condition);
    }
  });
});

describe("我的称号", () => {
  const twins: EarnedBadge = { id: "twins", at: Date.parse("2026-10-22T04:00:00Z"), seen: true };

  it("lets each badge not earned be tapped to see how to get it, and an earned one still be worn or taken off", () => {
    const html = wall([twins], "twins", countsOf({ radarDays: 4 }));
    const name = (id: string) => badgeById(id)!.name;
    // earned: wear or take off, as before
    expect(html).toContain(`aria-label="取下${name("twins")}"`);
    // not earned: a button of its own, which shows how to get it
    expect(html).toContain(`<button type="button" class="badge-cell locked" aria-label="${name("stormchaser")}：看看怎么拿">`);
    const listed = wallBadges(new Set(["twins"]));
    const buttons = html.match(/：看看怎么拿"/g) ?? [];
    expect(buttons).toHaveLength(listed.filter((b) => b.id !== "twins").length);
    // nothing open until one is tapped, and no quote of a badge not earned
    expect(html).not.toContain("badge-peek");
    for (const b of listed.filter((x) => x.id !== "twins")) expect(html, b.id).not.toContain(b.quote.replace("{serial}", ""));
  });

  it("wears an earned badge that is not worn on a tap", () => {
    const html = wall([twins], null);
    expect(html).toContain(`aria-label="戴上${badgeById("twins")!.name}"`);
  });
});

describe("篝火守夜人, a title worn a week by a place on 火焰周榜", () => {
  // given at the Monday 04:00 that settled last week (Beijing time), held till the next
  const at = Date.parse("2026-11-16T04:00:00+08:00");
  const until = at + 7 * 86_400_000;
  const earned: EarnedBadge = { id: "firewatch", serial: 7, at, seen: false, until };

  it("pops up as a title for a week, saying the place it was won with and till when it is worn, never a number", () => {
    const html = renderToStaticMarkup(createElement(NewBadge, { earned, onWear: () => {}, onLater: () => {} }));
    expect(text(html)).toContain("获得新称号 · 限定一周");
    expect(text(html)).toContain("篝火守夜人");
    expect(text(html)).toContain("上周火焰周榜第 7 名");
    expect(text(html)).toContain("戴到 11/23（周一）凌晨 4 点");
    expect(text(html)).toContain("卫戍的夜很长，你们那堆火烧到了天亮。");
    expect(html).not.toContain("No.0007");
  });

  it("is listed on 我的称号 only while held, outside the count, as 限定 with the days left; on cards, without its place", () => {
    const now = at + 4 * 86_400_000;
    expect(wallBadges(new Set(), now).some((b) => b.id === "firewatch")).toBe(false);
    expect(wallBadges(new Set(["firewatch"]), now).some((b) => b.id === "firewatch")).toBe(true);
    const html = wall([earned], null);
    expect(text(html)).toContain("篝火守夜人");
    expect(text(html)).toMatch(/限定 · 还剩 \d+ 天/);
    expect(renderToStaticMarkup(createElement(BadgePill, { badge: { id: "firewatch", serial: 7 } }))).not.toContain("No.");
  });
});

describe("基建狂魔, a title worn a week by a place on 基建周榜", () => {
  const at = Date.parse("2026-11-16T04:00:00+08:00");
  const until = at + 7 * 86_400_000;
  const earned: EarnedBadge = { id: "stacktop", serial: 12, at, seen: false, until };

  it("pops up as 篝火守夜人 does, its place on 基建周榜", () => {
    const html = renderToStaticMarkup(createElement(NewBadge, { earned, onWear: () => {}, onLater: () => {} }));
    expect(text(html)).toContain("获得新称号 · 限定一周");
    expect(text(html)).toContain("基建狂魔");
    expect(text(html)).toContain("上周基建周榜第 12 名");
    expect(text(html)).not.toContain("火焰周榜");
    expect(text(html)).toContain("戴到 11/23（周一）凌晨 4 点");
    expect(text(html)).toContain("没有图纸，没有地基，照样盖到了天上。");
    expect(html).not.toContain("No.0012");
  });

  it("is listed on 我的称号 only while held, as 限定 with the days left", () => {
    const now = at + 2 * 86_400_000;
    expect(wallBadges(new Set(), now).some((b) => b.id === "stacktop")).toBe(false);
    expect(wallBadges(new Set(["stacktop"]), now).some((b) => b.id === "stacktop")).toBe(true);
    expect(text(wall([earned], null))).toMatch(/限定 · 还剩 \d+ 天/);
    expect(renderToStaticMarkup(createElement(BadgePill, { badge: { id: "stacktop", serial: 12 } }))).not.toContain("No.");
  });
});
