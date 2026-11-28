import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { withLang } from "@/i18n/server";
import { EMPTY_PROFILE } from "@/lib/profile";
import { DAY_FIELDS, DAY_INDEX, RECORD_DAYS, type RecordsSummary, type TimelineItem } from "@/lib/records";
import type { Me } from "@/lib/world/types";
import Charts from "./Charts";
import Overview from "./Overview";
import { dayLabel, itemDetail, itemSub, itemText } from "./parts";

const BEIJING = 480;
const AT = Date.parse("2026-11-16T20:05:00+08:00");
const base = { key: "k", at: AT, cat: "touch", dir: "out" } as const;
const item = (i: Partial<TimelineItem> & { kind: TimelineItem["kind"] }) => ({ ...base, ...i }) as TimelineItem;

describe("「我的记录」's sentences", () => {
  it("name only who the player knew, and write the nameless without spaces", () => {
    const tout = { kind: "tout", bold: true, reply: false, clone: false, got: null } as const;
    expect(itemText(item({ ...tout, who: { name: "红豆" } }))).toBe("大胆地碰了 红豆");
    expect(itemText(item({ ...tout, bold: false, who: null }))).toBe("偷偷碰了一只蟑螂");
    expect(itemText(item({ ...tout, clone: true, who: null }))).toBe("大胆地碰了一只克隆体");
    expect(itemText(item({ ...tout, who: { ex: true } }))).toBe("大胆地碰了一位舟P");
    expect(itemText(item({ ...tout, reply: true, who: null }))).toBe("大胆地碰回一只蟑螂");
    expect(itemSub(item({ ...tout, who: null, got: "bold" }), BEIJING)).toBe(T.records.timeline.tout.gotBold);

    const tin = { kind: "tin", dir: "in", slot: 2, back: false, mine: null } as const;
    expect(itemText(item({ ...tin, bold: false, who: null }))).toBe("一只蟑螂偷偷碰了你的克隆体 2");
    expect(itemText(item({ ...tin, bold: true, slot: 0, who: { name: "阿九" } }))).toBe("阿九 大胆地碰了你的本体");
    expect(itemText(item({ ...tin, bold: true, back: true, who: { ex: true } }))).toBe("一位舟P大胆地碰回来了");
    expect(itemSub(item({ ...tin, bold: false, who: null, mine: "ignored" }), BEIJING)).toBe(T.records.timeline.tin.mineIgnored);

    expect(itemText(item({ kind: "friend", cat: "friend", dir: "both", who: { ex: true } }))).toBe("和一位舟P成为了触须之交");
    expect(itemText(item({ kind: "note", cat: "friend", dir: "in", note: "hug", who: { name: "红豆" }, answer: null, game: null }))).toBe("红豆 和你贴贴了");
    expect(itemText(item({ kind: "note", cat: "friend", dir: "out", note: "gift", who: { name: "红豆" }, answer: null, game: null }))).toBe("送了 红豆 1 张寻访券");
    expect(itemText(item({ kind: "move", cat: "roach", slot: 0, how: "move", km: 1084 }))).toBe("本体挪了 1084 公里");
  });

  it("say when a drink ended, by the player's own clock", () => {
    const drink = { kind: "drink", cat: "drink", until: Date.parse("2026-11-17T08:00:00+08:00") } as const;
    expect(itemSub(item({ ...drink, soberAt: null }), BEIJING)).toBe("醉到 08:00");
    expect(itemSub(item({ ...drink, soberAt: AT + 20 * 60_000 }), BEIJING)).toBe("20 分钟后醒了");
    expect(itemSub(item({ ...drink, soberAt: Date.parse("2026-11-17T01:30:00+08:00") }), BEIJING)).toBe("01:30 醒了");
  });

  it("keep their spaces on the English site, a line that starts with no one's name starting with a capital", () => {
    withLang("en", () => {
      const tout = { kind: "tout", bold: true, reply: false, clone: false, got: null } as const;
      expect(itemText(item({ ...tout, who: { name: "redbean" } }))).toBe("Boldly tapped redbean");
      expect(itemText(item({ ...tout, bold: false, who: null }))).toBe("Sneakily tapped a roach");
      expect(itemText(item({ ...tout, clone: true, who: null }))).toBe("Boldly tapped a clone");
      expect(itemText(item({ ...tout, reply: true, who: { ex: true } }))).toBe("Boldly tapped a Doctor back");

      const tin = { kind: "tin", dir: "in", slot: 2, back: false, mine: null } as const;
      expect(itemText(item({ ...tin, bold: false, who: null }))).toBe("A roach sneakily tapped your Clone 2");
      expect(itemText(item({ ...tin, bold: true, slot: 0, who: null }))).toBe("A roach boldly tapped your main roach");
      expect(itemText(item({ ...tin, bold: true, back: true, who: { ex: true } }))).toBe("A Doctor boldly tapped you back");
      // a name as its player wrote it
      expect(itemText(item({ ...tin, bold: true, who: { name: "aki" } }))).toBe("aki boldly tapped your Clone 2");

      const note = { kind: "note", cat: "friend", answer: null, game: null } as const;
      expect(itemText(item({ ...note, dir: "in", note: "visit", who: { ex: true } }))).toBe("A Doctor's clone came to visit you");
      expect(itemText(item({ ...note, dir: "in", note: "blanket", who: { ex: true } }))).toBe("While you were asleep, a Doctor tucked you in");
      expect(itemText(item({ ...note, dir: "out", note: "water", who: { ex: true } }))).toBe("Left a glass of water by a Doctor's pillow");
      expect(itemText(item({ kind: "friend", cat: "friend", dir: "both", who: { ex: true } }))).toBe("Became Feeler Friends with a Doctor");
      expect(itemText(item({ kind: "poke", cat: "friend", dir: "in", who: { ex: true } }))).toBe("A Doctor poked you while you were asleep");

      const guide = { kind: "guide", cat: "guide", guide: "haimao", what: "touch", bold: true } as const;
      expect(itemText(item({ ...guide, dir: "in" }))).toBe("The Glamorous Producer tapped you");
      expect(itemText(item({ ...guide, dir: "out" }))).toBe("Boldly tapped the Glamorous Producer");
      expect(itemText(item({ ...guide, dir: "in", guide: "amiya", what: "greet" }))).toBe("Guide Amiya greeted you");

      expect(itemText(item({ kind: "move", cat: "roach", slot: 0, how: "move", km: 1084 }))).toBe("Your main roach moved 1084 km");
      expect(itemText(item({ kind: "move", cat: "roach", slot: 1, how: "put", km: null }))).toBe("Placed your Clone 1");
    });
  });

  it("run sentences together with a space on the English site, and name the day of the week in letters enough", () => {
    withLang("en", () => {
      const tin = { kind: "tin", dir: "in", slot: 0, back: false, mine: null, who: null } as const;
      expect(itemDetail(item({ ...tin, bold: true }), BEIJING)).toBe("It was your main roach they tapped. It was a bold tap, so you can see their name and profile.");
      expect(itemDetail(item({ ...tin, bold: false }), BEIJING)).toBe("It was your main roach they tapped. It was a sneaky tap, so you can't tell who.");
      const decl = item({ kind: "decl", cat: "declare", text: "Rhodes Island, roll out!", recipients: 3, roaches: 2, drunk: true, rx: [] });
      expect(renderToStaticMarkup(createElement("div", null, itemDetail(decl, BEIJING)))).toContain(
        "Sent from 2 roaches. Drunk only. Fewer than 5 Doctors within 10 km got it.",
      );
      const today = Math.floor((AT + BEIJING * 60_000) / 86_400_000);
      expect(dayLabel(today, today, BEIJING)).toBe("Today · Mon, 11/16");
      expect(dayLabel(today - 1, today, BEIJING)).toBe("Yesterday · Sun, 11/15");
      expect(dayLabel(today - 4, today, BEIJING)).toBe("Thu, 11/12");
    });
    // Chinese as it was: no spaces, and 周一
    const today = Math.floor((AT + BEIJING * 60_000) / 86_400_000);
    expect(dayLabel(today, today, BEIJING)).toBe("今天 · 11 月 16 日 周一");
    expect(itemDetail(item({ kind: "tin", dir: "in", slot: 0, back: false, mine: null, who: null, bold: true }), BEIJING)).toBe(
      "碰的是你的本体。TA 是大胆碰的，所以你能看到 TA 的名字和资料。",
    );
  });
});

/** A summary of a player who touched and was touched every day, at 21:00 */
function sample(): RecordsSummary {
  const days = Array.from({ length: RECORD_DAYS }, (_, i) => {
    const d = new Array<number>(DAY_FIELDS.length).fill(0);
    if (i < 30) {
      d[DAY_INDEX.outBold] = 3;
      d[DAY_INDEX.outSneaky] = 1;
      d[DAY_INDEX.inBold] = 2;
      d[DAY_INDEX.inMain] = 2;
      d[DAY_INDEX.declared] = i % 3 === 0 ? 1 : 0;
    }
    return d;
  });
  const hours = new Array(24).fill(0);
  hours[21] = 120;
  return {
    today: Math.floor((AT + BEIJING * 60_000) / 86_400_000),
    days,
    hours: [hours, hours, hours],
    lines: [["卫戍协议，启动！", 2, 10, 10]],
    reactionsIn: [["+1", 1, 4, 4]],
    friends: [{ id: "f1", name: "红豆", since: Date.parse("2026-10-25T21:00:00+08:00"), touch: [2, 9, 9], gest: [1, 3, 3], poke: [0, 1, 1] }],
    drinks: [{ at: Date.parse("2026-11-15T23:40:00+08:00"), until: Date.parse("2026-11-16T08:00:00+08:00"), soberAt: null }],
    totals: { visitDays: 20, touchesOut: 120, touchesIn: 60, declarations: 10, siStamps: 3, studyDays: 2 },
    seen: [],
  };
}

const me = {
  id: "me",
  profile: { ...EMPTY_PROFILE, anonymous: false, name: "罗德岛摸鱼部" },
  joinedAt: Date.parse("2026-10-22T20:30:00+08:00"),
  badges: [],
  counts: new Proxy({}, { get: () => 0 }),
} as unknown as Me;

describe("「我的记录」's tabs", () => {
  it("draw the overview from the summary: the 90 days' numbers, what they say, and the totals", () => {
    const html = renderToStaticMarkup(
      createElement(Overview, { me, summary: sample(), offset: BEIJING, passesOpen: false, onTile: () => {}, onChart: () => {}, onSeen: () => {}, onOpenBadges: () => {} }),
    );
    expect(html).toContain("罗德岛摸鱼部");
    expect(html).toContain("<b>120</b>");
    expect(html).toContain("你最爱喊「卫戍协议，启动！」，喊了 10 次。");
    expect(html).toContain("和 红豆 互动最多");
    expect(html).toContain("120 次");
    // nothing of 寻访 while it is closed
    expect(html).not.toContain(T.records.overview.groups.passes);
  });

  it("draw the charts for the range picked", () => {
    const html = renderToStaticMarkup(createElement(Charts, { summary: sample(), offset: BEIJING, focus: null, onDay: () => {} }));
    for (const title of [T.records.charts.days, T.records.charts.hours, T.records.charts.touch, T.records.charts.declare, T.records.charts.friends, T.records.charts.drink]) {
      expect(html).toContain(title);
    }
    expect(html).toContain("你最常在 21 点到 22 点出没。");
    expect(html).toContain("这段时间醉倒 1 次。");
  });

  it("draw them in English on the English site: a capital in the legend, a space between sentences", () => {
    withLang("en", () => {
      const charts = renderToStaticMarkup(createElement(Charts, { summary: sample(), offset: BEIJING, focus: null, onDay: () => {} }));
      expect(charts).toContain("You&#x27;re around most between 21:00 and 22:00. 21:00–22:00: 120 times, 100% of everything you did.");
      expect(charts).toContain("Main roach <b>");
      expect(charts).toContain("Passed out drunk 1 time in this period.");
      const overview = renderToStaticMarkup(
        createElement(Overview, { me, summary: sample(), offset: BEIJING, passesOpen: false, onTile: () => {}, onChart: () => {}, onSeen: () => {}, onOpenBadges: () => {} }),
      );
      expect(overview).toContain("Your go-to line is “卫戍协议，启动！”: you&#x27;ve said it 10 times.");
      expect(overview).toContain("You&#x27;ve done the most with 红豆: 9 taps between you, and 3 little gestures.");
      expect(overview).toContain("Main roach <b>");
    });
  });
});
