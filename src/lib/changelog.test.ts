import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeLog } from "@/components/app/ChangeLog";
import { addDays, beijingDate, daysBetween } from "./beijing";
import { CHANGELOG, type ChangeRow } from "./changelog";
import { isVague, kindCounts, logDays, logSquares, logToday, logTotals } from "./changelogView";

const KIND_NAMES = ["new", "better", "fix", "tweak", "chore"];
/** What a row may not say: how the site is made and run */
const TECHNICAL = ["服务器", "数据库", "缓存", "接口", "进程", "限流", "补丁", "迁移", "代码", "部署", "高德", "腾讯", "OSM", "Resend", "bug", "API", "CDN", "git", "commit"];

describe("the change log's rows", () => {
  it("are dated with real days, newest first, and none far ahead of today in Beijing", () => {
    for (const r of CHANGELOG) {
      expect(r.date, r.text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10), r.text).toBe(r.date);
    }
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i].date <= CHANGELOG[i - 1].date, `${CHANGELOG[i].date} ${CHANGELOG[i].text}`).toBe(true);
    // a wrong year would show as a day to come
    expect(daysBetween(beijingDate(), CHANGELOG[0].date)).toBeLessThanOrEqual(7);
  });

  it("start on the day the site opened", () => {
    const first = CHANGELOG[CHANGELOG.length - 1];
    expect(first.date).toBe("2026-10-22");
    expect(first.text.startsWith("舟P地图开张")).toBe(true);
  });

  it("are of the five kinds, behind the scenes always 「后台调整」 and the vague ones 「一些小改动」", () => {
    for (const r of CHANGELOG) {
      expect(KIND_NAMES, r.text).toContain(r.kind);
      expect(r.kind === "chore", r.text).toBe(r.text === "后台调整");
      if (r.text === "一些小改动") expect(r.kind).toBe("tweak");
    }
  });

  it("are one line of 1 to 20 characters each", () => {
    for (const r of CHANGELOG) {
      const n = Array.from(r.text).length;
      expect(n >= 1 && n <= 20, `${r.text} (${n})`).toBe(true);
      expect(r.text, r.text).not.toMatch(/[\r\n]/);
      expect(r.text.trim(), r.text).toBe(r.text);
    }
  });

  it("say nothing of how the site is made", () => {
    for (const r of CHANGELOG) for (const w of TECHNICAL) expect(r.text.toLowerCase().includes(w.toLowerCase()), `${r.text}: ${w}`).toBe(false);
  });

  it("write 舟P and 蟑螂, 小强 only in 墨小强", () => {
    for (const r of CHANGELOG) {
      expect(r.text.includes("舟p"), r.text).toBe(false);
      expect(r.text.replaceAll("墨小强", "").includes("小强"), r.text).toBe(false);
    }
  });

  it("leave nothing for Breeze to decide in the file", () => {
    expect(readFileSync(new URL("./changelog.ts", import.meta.url), "utf8")).not.toContain("TODO(Breeze)");
  });
});

const row = (date: string, kind: ChangeRow["kind"], text: string): ChangeRow => ({ date, kind, text });

describe("what the page makes of them", () => {
  it("counts the days since the site opened, both ends, and the changes of the last 7 days", () => {
    const rows = [row("2026-11-13", "new", "c"), row("2026-11-07", "fix", "b"), row("2026-11-06", "fix", "a"), row("2026-10-22", "new", "开张")];
    expect(logTotals(rows, "2026-11-13")).toEqual({ total: 4, daysOpen: 23, lastWeek: 2 });
    expect(logTotals(rows, "2026-11-14")).toEqual({ total: 4, daysOpen: 24, lastWeek: 1 });
  });

  it("never puts today before the newest row, for a clock that is behind", () => {
    const rows = [row("2026-11-13", "new", "c"), row("2026-10-22", "new", "开张")];
    expect(logToday(rows, Date.parse("2026-11-13T16:30:00Z"))).toBe("2026-11-14");
    expect(logToday(rows, Date.parse("2026-11-13T15:30:00Z"))).toBe("2026-11-13");
    expect(logToday(rows, Date.parse("2025-01-01T00:00:00Z"))).toBe("2026-11-13");
  });

  it("draws a square a day, today last, darker for more changes", () => {
    const on = (date: string, n: number, kind: ChangeRow["kind"] = "fix") => Array.from({ length: n }, () => row(date, kind, "x"));
    const rows = [...on("2026-10-26", 30), ...on("2026-10-25", 15), ...on("2026-10-24", 14), ...on("2026-10-23", 4), ...on("2026-10-22", 1, "new")];
    const squares = logSquares(rows, "2026-10-28");
    expect(squares.map((s) => [s.date, s.n, s.level])).toEqual([
      ["2026-10-22", 1, 1],
      ["2026-10-23", 4, 1],
      ["2026-10-24", 14, 2],
      ["2026-10-25", 15, 3],
      ["2026-10-26", 30, 4],
      ["2026-10-27", 0, 0],
      ["2026-10-28", 0, 0],
    ]);
  });

  it("folds a run of the same vague row with numbers in a row, also when filtered, and nothing else", () => {
    const rows = [
      row("2026-11-13", "chore", "后台调整"),
      row("2026-11-13", "chore", "后台调整"),
      row("2026-11-13", "tweak", "一些小改动"),
      row("2026-11-13", "tweak", "一些小改动"),
      row("2026-11-13", "chore", "后台调整"),
      row("2026-11-13", "fix", "同一句"),
      row("2026-11-13", "fix", "同一句"),
      row("2026-11-12", "chore", "后台调整"),
      row("2026-10-22", "new", "舟P地图开张"),
    ];
    const lines = (pick: Parameters<typeof logDays>[1]) => logDays(rows, pick).map((d) => [d.date, d.count, d.lines.map((l) => `${l.lo}-${l.hi} ${l.text}`)]);
    expect(lines("all")).toEqual([
      ["2026-11-13", 7, ["8-9 后台调整", "6-7 一些小改动", "5-5 后台调整", "4-4 同一句", "3-3 同一句"]],
      // another day is another line
      ["2026-11-12", 1, ["2-2 后台调整"]],
      ["2026-10-22", 1, ["1-1 舟P地图开张"]],
    ]);
    // #5 is not next to #8 and #9: it stays a line of its own
    expect(lines("chore")).toEqual([
      ["2026-11-13", 3, ["8-9 后台调整", "5-5 后台调整"]],
      ["2026-11-12", 1, ["2-2 后台调整"]],
    ]);
    expect(lines("fix")).toEqual([["2026-11-13", 2, ["4-4 同一句", "3-3 同一句"]]]);
    expect(logDays(rows)[0].opening).toBe(false);
    expect(logDays(rows).at(-1)!.opening).toBe(true);
  });

  it("counts every kind, and all", () => {
    const counts = kindCounts(CHANGELOG);
    expect(counts.all).toBe(CHANGELOG.length);
    expect(counts.new + counts.better + counts.fix + counts.tweak + counts.chore).toBe(CHANGELOG.length);
  });
});

/** The log as it is drawn on 11 月 13 日, every day of it (the page draws the newest 14 first) */
const page = (props: Partial<Parameters<typeof ChangeLog>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChangeLog, { rows: CHANGELOG, today: "2026-11-13", firstDays: Infinity, ...props }));
/** Each day's part of the page */
const daysOf = (html: string) => html.split('<section class="cl-day">').slice(1);
const linesOf = (html: string) => html.match(/<li[ >].*?<\/li>/g) ?? [];

describe("更新记录 as drawn", () => {
  it("shows the total, the days open, the last 7 days, a square a day and a line for each change or run", () => {
    const html = page();
    expect(html).toContain(`<strong>${CHANGELOG.length}</strong><span>次更新</span>`);
    expect(html).toContain("开张第 23 天");
    const lastWeek = CHANGELOG.filter((r) => r.date >= addDays("2026-11-13", -6)).length;
    expect(html).toContain(`最近 7 天改了 ${lastWeek} 次。一格是一天，颜色越深改得越多。`);
    expect(html.match(/<span class="l\d" title="/g)).toHaveLength(23);
    expect(html).toContain('title="11 月 13 日：');
    // a vague row folds into the one above it when they are the same, on the same day
    const folded = CHANGELOG.filter((r, i) => i > 0 && isVague(r) && r.date === CHANGELOG[i - 1].date && r.kind === CHANGELOG[i - 1].kind && r.text === CHANGELOG[i - 1].text).length;
    expect(linesOf(html)).toHaveLength(CHANGELOG.length - folded);
    expect(daysOf(html)).toHaveLength(new Set(CHANGELOG.map((r) => r.date)).size);
    expect(html).toContain("最早一条是 10 月 22 日，舟P地图开张那天。");
  });

  it("keeps only 新增 with that filter, counted as 条", () => {
    const html = page({ firstPick: "new" });
    const lines = linesOf(html);
    expect(lines).toHaveLength(CHANGELOG.filter((r) => r.kind === "new").length);
    for (const l of lines) expect(l).toContain('<span class="kind new">新增</span>');
    expect(html).toContain('<button aria-pressed="true"><span class="pill">新增<span class="n">');
    expect(html).toMatch(/<span class="cl-count">\d+ 条<\/span>/);
    expect(html).not.toMatch(/<span class="cl-count">\d+ 次<\/span>/);
  });

  it("marks 10 月 22 日 as the opening, with #1 at the very bottom", () => {
    const days = daysOf(page());
    const last = days.at(-1)!;
    expect(last).toContain("<h3>10 月 22 日</h3>");
    expect(last).toContain('<span class="cl-opening">开张</span>');
    expect(days.filter((d) => d.includes("cl-opening"))).toHaveLength(1);
    expect(linesOf(last).at(-1)).toContain('<span class="no">#1</span>');
  });

  it("numbers from the oldest, so 11 月 13 日 keeps #180–185 as one line of 后台调整 ×6", () => {
    const day = daysOf(page()).find((d) => d.includes("<h3>11 月 13 日</h3>"))!;
    expect(day).toContain("周五");
    const line = linesOf(day).find((l) => l.includes("#180–185"));
    expect(line).toContain('<span class="t">后台调整 ×6</span>');
    expect(line).toContain('<li class="vague">');
  });

  it("draws the newest 14 days first, and more as the list is scrolled", () => {
    const html = page({ firstDays: undefined });
    expect(daysOf(html)).toHaveLength(14);
    expect(html).toContain('<div class="cl-more"></div>');
    expect(html).not.toContain("最早一条是");
  });
});
