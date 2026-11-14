import { describe, expect, it } from "vitest";
import { TOUCHES_PER_DAY, TOUCHES_PER_PERSON_PER_DAY } from "@/lib/rules";
import { nextSiteDayAt } from "@/lib/siteDay";
import { touchesNow, turnsAtText, waitParts } from "./dayTurns";

// 04:00 Beijing time on 20 November, when that day begins for the site
const TURN = new Date("2026-11-20T04:00+08:00").getTime();
const HOUR = 3_600_000;

describe("when the day turns, in the device's own time", () => {
  it("says 04:00 Beijing time as each place's clock does", () => {
    // offsets as Date.getTimezoneOffset() gives them: minutes behind UTC
    expect(turnsAtText(TURN, -480)).toBe("凌晨 4 点"); // Beijing
    expect(turnsAtText(TURN, 360)).toBe("下午 2 点"); // Chicago in winter
    expect(turnsAtText(TURN, 300)).toBe("下午 3 点"); // Chicago in summer
    expect(turnsAtText(TURN, 0)).toBe("晚上 8 点"); // London in winter, the evening before
    expect(turnsAtText(TURN, -540)).toBe("凌晨 5 点"); // Tokyo
    expect(turnsAtText(TURN, -330)).toBe("凌晨 1 点半"); // India
    expect(turnsAtText(TURN, -345)).toBe("凌晨 1 点 45 分"); // Nepal
  });

  it("names the part of the day by the hour, with the hours of a 12-hour clock", () => {
    const at = (h: number) => turnsAtText(Date.UTC(2026, 10, 20, h), 0);
    expect([0, 5, 6, 11, 12, 13, 17, 18, 23].map(at)).toEqual([
      "凌晨 0 点",
      "凌晨 5 点",
      "上午 6 点",
      "上午 11 点",
      "中午 12 点",
      "下午 1 点",
      "下午 5 点",
      "晚上 6 点",
      "晚上 11 点",
    ]);
  });

  it("counts the wait in hours and minutes, the minutes rounded up, never under a minute", () => {
    expect(waitParts(TURN, TURN - 2 * HOUR - 40 * 60_000)).toEqual({ h: 2, m: 40 });
    expect(waitParts(TURN, TURN - 2 * HOUR - 39 * 60_000 - 1)).toEqual({ h: 2, m: 40 });
    expect(waitParts(TURN, TURN - 3 * HOUR)).toEqual({ h: 3, m: 0 });
    expect(waitParts(TURN, TURN - 30_000)).toEqual({ h: 0, m: 1 });
    expect(waitParts(TURN, TURN + 5_000)).toEqual({ h: 0, m: 1 });
  });
});

describe("today's touches on the page", () => {
  it("are what the server said until the day turns", () => {
    const q = { left: 0, at: TURN, friendLeft: 0 };
    expect(touchesNow(q, TURN - 1)).toBe(q);
  });

  it("are a whole new day's from then, the next turn after it, with no count on anyone who is no 触须之交", () => {
    expect(touchesNow({ left: 0, at: TURN, friendLeft: 0 }, TURN)).toEqual({
      left: TOUCHES_PER_DAY,
      at: nextSiteDayAt(TURN),
      friendLeft: TOUCHES_PER_PERSON_PER_DAY,
    });
    expect(nextSiteDayAt(TURN)).toBe(TURN + 24 * HOUR);
    expect(touchesNow({ left: 3, at: TURN }, TURN + HOUR).friendLeft).toBeUndefined();
  });
});
