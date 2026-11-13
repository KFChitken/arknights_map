import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BADGES } from "@/lib/badges";
import { addDays } from "@/lib/beijing";
import { CITIES, OPEN_DAY, type DashboardData, type DashDay, type StatSnapshot } from "@/lib/dashboard";
import { DRUNK_TEMPLATES, GENERIC_REACTIONS, repliesFor, STAY_TEMPLATES, TEMPLATES, type Declaration } from "@/lib/declarations";
import { EVENTS } from "@/lib/events";
import { colTop, highest, layout, niceTicks, tickWords } from "./chartMath";
import { Board } from "./Dashboard";
import { badgeLists, daysIn, leadingNulls, milestones, weekActs, weekReplies, weekTemplates } from "./dashView";
import { actsCover, cityName, dayLong, momentWords, replyWords, templateWords, wan } from "./dashWords";

const TODAY = "2026-11-13";
const NOW = Date.parse("2026-11-13T21:40:00+08:00");

describe("数据看板's charts", () => {
  it("rounds the axis to whole steps past the top, about four of them", () => {
    for (const max of [0, -5, Number.NaN]) expect(niceTicks(max)).toEqual([0, 1]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(77_900)).toEqual([0, 20_000, 40_000, 60_000, 80_000]);
    for (let max = 1; max < 5_000_000; max = Math.ceil(max * 1.37)) {
      const ticks = niceTicks(max);
      expect(ticks[0], String(max)).toBe(0);
      expect(ticks[ticks.length - 1], String(max)).toBeGreaterThanOrEqual(max);
      expect(ticks.length, String(max)).toBeLessThanOrEqual(5);
      expect(ticks.every((t, i) => Number.isInteger(t) && (i === 0 || t > ticks[i - 1])), String(max)).toBe(true);
    }
  });

  it("labels the axis short, and draws a column's top inside its box", () => {
    expect([0, 9_500, 10_000, 15_000, 125_000, 1_000_000].map(tickWords)).toEqual(["0", "9,500", "1万", "1.5万", "12.5万", "100万"]);
    for (const [w, h, r] of [
      [10, 0, 4],
      [2, 50, 4],
      [24, 3, 4],
    ]) {
      expect(colTop(5, 10, w, h, r)).not.toMatch(/NaN|-/);
    }
  });

  it("puts every point inside the plot, and the latest always gets its day", () => {
    for (const count of [1, 7, 30, 120]) {
      const l = layout(600, 180, count, "col", 1, 77_900);
      expect(l.x(0)).toBeGreaterThan(l.ml);
      expect(l.x(count - 1)).toBeLessThan(600 - l.mr);
      expect(l.y(0)).toBe(l.mt + l.ph);
      expect(l.y(l.top)).toBe(l.mt);
      expect(l.at(0)).toBe(0);
      expect(l.at(10_000)).toBe(count - 1);
      expect(l.labelled(count - 1)).toBe(true);
      expect(l.cw).toBeGreaterThanOrEqual(2);
      expect(l.cw).toBeLessThanOrEqual(24);
    }
    // two lines leave room for their names on the right
    expect(layout(600, 180, 30, "line", 2, 10).mr).toBeGreaterThan(layout(600, 180, 30, "line", 1, 10).mr);
    const series = [{ values: [1, null, 5] }, { values: [4, 2, null] }];
    expect(highest("stack", series)).toBe(5);
    expect(highest("line", series)).toBe(5);
    expect(highest("col", [{ values: [] }])).toBe(0);
  });
});

describe("数据看板's words", () => {
  it("names every city, every sentence and every reply as the players see them", () => {
    for (const c of CITIES) expect(cityName(c.id), c.id).not.toBe(c.id);
    expect(actsCover()).toBe(true);
    const blank = (template: string) =>
      ({ template, game: "arknights", character: "X", title: "X", name: "X", food: "X", spouse: "老婆", line: "" }) as unknown as Declaration;
    for (const t of [...TEMPLATES, ...DRUNK_TEMPLATES, ...STAY_TEMPLATES]) {
      const words = templateWords(t);
      expect(words, t).not.toBe(t);
      expect(words, t).not.toMatch(/[{}]|undefined/);
      for (const r of repliesFor(blank(t)).filter((r) => r.own)) {
        expect(replyWords(r.id), r.id).not.toBe(r.id);
        expect(replyWords(r.id), r.id).not.toMatch(/[{}]|undefined/);
      }
    }
    expect(templateWords("event")).toBe("限定宣言（几句合起来算）");
    for (const id of GENERIC_REACTIONS) expect(replyWords(id), id).not.toBe(id);
    for (const e of EVENTS) {
      for (const l of e.lines) {
        if (l.replies?.length) expect(replyWords(`${l.replyKey ?? l.id}.1`)).toBe(`${l.replies[0]}（限定宣言的）`);
      }
    }
    // what the board does not know stays as it is
    expect(templateWords("gone")).toBe("gone");
    expect(replyWords("gone.1")).toBe("gone.1");
  });

  it("writes days, times and milestones as the board does, in Beijing time", () => {
    expect(dayLong("2026-11-13")).toBe("11月13日 周五");
    expect(momentWords(Date.parse("2026-11-10T07:12:00Z"))).toBe("11月10日 15:12");
    expect(momentWords(Date.parse("2026-11-12T16:30:00Z"))).toBe("11月13日 00:30");
    expect([10_000, 200_000, 1_000_000, 12_345].map(wan)).toEqual(["1 万", "20 万", "100 万", "12,345"]);
  });
});

describe("数据看板's lists", () => {
  it("ranks the week's acts, sentences and replies, most first", () => {
    const week = {
      "note.gameAsk": 2,
      "note.gameWant": 3,
      "note.hug": 4,
      decl: 10,
      "decl.reach": 99,
      "decl.launch": 3,
      "decl.love": 5,
      "decl.iam": 0,
      reply: 9,
      "reply.zhouli": 4,
      "reply.love.1": 5,
    };
    const acts = weekActs(week);
    expect(acts.slice(0, 2).map((r) => [r.key, r.n])).toEqual([
      ["game", 5],
      ["hug", 4],
    ]);
    expect(acts).toHaveLength(8);
    expect(acts.slice(2).every((r) => r.n === 0)).toBe(true);
    expect(weekTemplates(week).map((r) => [r.key, r.n])).toEqual([
      ["love", 5],
      ["launch", 3],
    ]);
    expect(weekReplies(week).map((r) => [r.key, r.n])).toEqual([
      ["love.1", 5],
      ["zhouli", 4],
    ]);
    expect(weekTemplates({}, 8)).toEqual([]);
  });

  it("lists the badges most held, and the least among those the wall shows", () => {
    const s = { badges: { total: 17, by: [{ key: "amiya", n: 5 }, { key: "trainee", n: 9 }, { key: "survivor", n: 3 }] } } as StatSnapshot;
    const { most, least } = badgeLists(s, NOW);
    expect(most.map((b) => [b.id, b.n])).toEqual([
      ["trainee", 9],
      ["amiya", 5],
      ["survivor", 3],
    ]);
    expect(most.every((b) => b.name && b.how)).toBe(true);
    expect(least).toHaveLength(5);
    // held by nobody, and never one held only some days or a past event's
    expect(least.every((b) => b.n === 0 && !BADGES.find((x) => x.id === b.id)!.days)).toBe(true);
  });

  it("names the milestones reached and the next one", () => {
    expect(milestones(0, [])).toEqual([{ n: 10_000, at: null, left: 10_000 }]);
    expect(milestones(60_000, [{ n: 10_000, at: 1 }])).toEqual([
      { n: 10_000, at: 1, left: null },
      { n: 50_000, at: null, left: null },
      { n: 100_000, at: null, left: 40_000 },
    ]);
    expect(milestones(105_000, [10_000, 50_000, 100_000].map((n, i) => ({ n, at: i })))).toEqual([
      { n: 10_000, at: 0, left: null },
      { n: 50_000, at: 1, left: null },
      { n: 100_000, at: 2, left: null },
      { n: 200_000, at: null, left: 95_000 },
    ]);
  });

  it("takes the days a range shows, and the days before something was kept", () => {
    const days = fixture().days;
    expect(daysIn(days, 7).map((d) => d.day)).toEqual(days.slice(-7).map((d) => d.day));
    expect(daysIn(days, 30)).toEqual(days);
    expect(daysIn(days, "all")).toEqual(days);
    expect(leadingNulls([null, null, 3, null])).toBe(2);
    expect(leadingNulls([])).toBe(0);
    expect(leadingNulls([null])).toBe(1);
  });
});

/** An answer of the endpoint, as 数据看板 might get it on the evening of 11/13 */
function fixture(): DashboardData {
  const days: DashDay[] = [];
  let players = 0;
  for (let day = OPEN_DAY, i = 0; day <= TODAY; day = addDays(day, 1), i++) {
    const signups = 40 + i * 1_900;
    players += signups;
    const kept = i >= 16;
    days.push({
      day,
      signups,
      friendships: 10 + i * 900,
      players,
      placed: 60 + i * 2_400,
      sneaky: 100 + i * 9_000,
      bold: 60 + i * 5_000,
      decl: 50 + i * 1_200,
      replies: 90 + i * 2_600,
      visitors: kept ? 600 + i * 2_000 : null,
      peakOnline: kept ? 60 + i * 150 : null,
    });
  }
  const sum = (of: (d: DashDay) => number) => days.reduce((s, d) => s + of(d), 0);
  const snapshot: StatSnapshot & { day: string; at: number } = {
    day: TODAY,
    at: Date.parse("2026-11-13T05:00:20+08:00"),
    players: players - days[days.length - 1].signups,
    milestones: [{ n: 10_000, at: Date.parse("2026-11-10T15:12:00+08:00") }],
    avatars: [
      { key: "hood", n: 5_021 },
      { key: "doctor", n: 2_293 },
      { key: "imp", n: 874 },
    ],
    colors: [
      { key: "cyan", n: 1_760 },
      { key: "pink", n: 820 },
    ],
    hood: 5_021,
    games: { arknights: 4_680, both: 4_130, endfield: 1_460, none: 648 },
    clones: { players: 4_102, all: 9_843, full: 821, riders: 314 },
    favourites: {
      arknights: [{ key: "阿米娅", n: 984 }],
      endfield: [{ key: "佩丽卡", n: 683 }],
      support: [],
    },
    friendships: { pairs: 13_602, withSome: 6_792, most: 28, oldestDays: 22 },
    badges: { total: 81_240, by: [{ key: "trainee", n: 6_792 }, { key: "amiya", n: 6_120 }] },
    guides: { friends: { amiya: 6_120, perlica: 3_387, talulah: 2_845, minghe: 1_924, si: 1_240 }, inksStayed: 1_240, inksQueued: 388 },
    where: { china: 9_588, abroad: 900, cities: [{ key: "shanghai", n: 986 }, { key: "tokyo", n: 41 }] },
    reach: { n: 231, day: "2026-11-11" },
  };
  return {
    asOf: NOW,
    backfilled: true,
    since: { visitors: days[16].day, online: days[16].day },
    totals: {
      players,
      roaches: { mains: 10_488, clones: 9_843, inks: 1_612, fire: 186, riders: 314 },
      friendships: sum((d) => d.friendships),
      touches: { sneaky: sum((d) => d.sneaky), bold: sum((d) => d.bold) },
      decl: sum((d) => d.decl),
      replies: sum((d) => d.replies),
      guides: { amiya: 38_820, perlica: 20_140, talulah: 15_290, minghe: 9_630, si: 7_180 },
    },
    today: {
      day: TODAY,
      counts: { "touch.sneaky": 9_000, "touch.bold": 5_000, decl: 1_200, "guide.amiya": 712 },
      online: 341,
      peak: { n: 408, at: Date.parse("2026-11-13T20:50:00+08:00") },
    },
    days,
    hours: {
      today: Array.from({ length: 24 }, (_, h) => (h <= 21 ? 100 + h * 10 : null)),
      yesterday: Array.from({ length: 24 }, (_, h) => 120 + h * 10),
    },
    week: {
      from: addDays(TODAY, -7),
      to: addDays(TODAY, -1),
      counts: { "touch.sneaky": 60_000, "touch.bold": 30_000, "touch.back": 18_000, "touch.ignored": 9_000, decl: 7_000, "decl.reach": 70_000, reply: 15_000, "decl.love": 3_000, "reply.zhouli": 6_000, "note.hug": 8_241 },
    },
    snapshot,
    records: {
      online: { n: 624, at: Date.parse("2026-11-11T21:20:00+08:00") },
      signups: { n: 7_790, day: "2026-11-11" },
      friendships: { n: 6_130, day: "2026-11-11" },
      touches: { n: 51_200, day: "2026-11-11" },
      placed: { n: 14_120, day: "2026-11-11" },
      reach: { n: 231, day: "2026-11-11" },
    },
    people: {
      retention: { activeWeek: 9_824, activeWeekBefore: 142, lastWeekSignups: 174, lastWeekSignupsBack: 101, friendshipsWeek: 12_100 },
      desk: [{ day: TODAY, counts: { "standalone:iphone": 810 } }],
    },
  };
}

const page = (d: DashboardData, stale: string | null = null) => renderToStaticMarkup(createElement(Board, { data: d, stale }));

describe("数据看板's page", () => {
  it("shows every panel of a full answer, with nothing left unfilled", () => {
    const html = page(fixture());
    for (const words of ["一共", "今天", "每天的变化", "触须之交", "触须和宣言", "小强长什么样", "厨力和助战", "向导们", "徽章", "地图", "纪录", "这周的人"]) {
      expect(html, words).toContain(words);
    }
    expect(html).toContain(fixture().totals.players.toLocaleString("en-US"));
    expect(html).toContain("上海");
    expect(html).not.toMatch(/undefined|NaN|null|\[object/);
    expect(html).not.toContain("会在下一个早上 5 点");
  });

  it("says what is not there yet: the days before, the 05:00 counts, the players online", () => {
    const d = fixture();
    const fresh: DashboardData = {
      ...d,
      backfilled: false,
      since: { visitors: null, online: null },
      days: d.days.map((x) => ({ ...x, visitors: null, peakOnline: null })),
      today: { ...d.today, online: null, peak: null },
      hours: { today: Array(24).fill(null), yesterday: Array(24).fill(null) },
      week: { ...d.week, counts: {} },
      snapshot: null,
      records: { online: null, signups: null, friendships: null, touches: null, placed: null, reach: null },
    };
    const html = page(fresh, "连不上服务器");
    expect(html).toContain("会在下一个早上 5 点（北京时间）从记录里补上");
    expect(html).toContain("这块每天早上 5 点数一次，还没数过。");
    expect(html).toContain("刚才没更新上（连不上服务器）");
    expect(html).toContain("还没有");
    expect(html).not.toMatch(/undefined|NaN|null|\[object/);
  });
});
