import { describe, expect, it } from "vitest";
import { clockWords, pausedWords } from "./adminConsole";

const MINUTE = 60_000;
/** 23:50 on 11/18 in Beijing */
const LATE = Date.parse("2026-11-18T15:50:00Z");

describe("when a pause of the 管理台 ends, in words", () => {
  it("is the Beijing clock while that is the same day there, with the day in front once it is past midnight", () => {
    expect(clockWords(LATE + 5 * MINUTE, LATE)).toBe("23:55");
    expect(clockWords(LATE + 10 * MINUTE, LATE)).toBe("11/19 00:00");
    expect(clockWords(LATE + 15 * MINUTE, LATE)).toBe("11/19 00:05");
    // noon in Beijing: the same day there, whatever the day is in UTC
    const noon = Date.parse("2026-11-18T04:00:00Z");
    expect(clockWords(noon + 15 * MINUTE, noon)).toBe("12:15");
  });

  it("reads that way on the door, so fifteen minutes from 23:45 on end on the next day", () => {
    expect(pausedWords("owner", LATE + 15 * MINUTE, 15, LATE)).toMatch(/^输错太多次，先暂停 15 分钟（到 11\/19 00:05）。已经发邮件到你的邮箱。/);
    const before = LATE - 10 * MINUTE;
    expect(pausedWords("mod", before + 15 * MINUTE, 15, before)).toMatch(/^输错太多次，先暂停 15 分钟（到 23:55）。已经发邮件告诉站长。/);
    expect(pausedWords("owner", LATE + 15 * MINUTE, 15, LATE, "views")).toBe(
      "一小时里看了太多账号，管理台先暂停到 11/19 00:05。已经发邮件告诉站长，站长可以提前解除。",
    );
  });
});
