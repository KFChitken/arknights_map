import { describe, expect, it } from "vitest";
import { reporterWords } from "./words";

const record = { days: 2, upheld: 0, dismissed: 0, reliable: false, lastDay: 0 };

describe("reporterWords", () => {
  it("names the reporter, their email and how many reports they sent in the last 24 hours", () => {
    const words = reporterWords({ ...record, who: { id: "x", name: "爱举报的", anonymous: true, email: "sn***@example.com" }, lastDay: 7 });
    expect(words).toBe("举报人：爱举报的（匿名） · 邮箱 sn***@example.com · 注册 2 天，以前没举报过 · 不算进自动处理 · 最近 24 小时交了 7 条举报");
  });

  it("says when the reporter has no name or email, and leaves out a quiet day", () => {
    expect(reporterWords({ ...record, who: { id: "x", name: "", anonymous: false, email: "" }, upheld: 3, reliable: true })).toBe(
      "举报人：（没有名字） · 邮箱 （没有） · 注册 2 天，以前举报 3 次，都成立",
    );
  });

  it("shows a name that hides characters as plain words", () => {
    const flip = String.fromCodePoint(0x202e);
    const words = reporterWords({ ...record, who: { id: "x", name: `${flip}知通统系`, anonymous: false, email: "" } });
    expect(words).not.toContain(flip);
    expect(words.startsWith("举报人：知通统系 · ")).toBe(true);
  });

  it("says which 提醒区 when the site made the report itself", () => {
    expect(reporterWords(null, "测试用的地方")).toBe("网站自动标的 · 提醒区「测试用的地方」");
  });

  it("does not say which of the 管理台's people reported, nor anything of a deleted account", () => {
    expect(reporterWords({ ...record, who: null, upheld: 1, dismissed: 1 })).toBe("举报人是管理台的人（不显示是谁） · 注册 2 天，以前举报 2 次，成立 1 次 · 不算进自动处理");
    expect(reporterWords(null)).toBe("举报人已注销");
  });
});
