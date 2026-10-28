import { describe, expect, it } from "vitest";
import { weekStartOf } from "./hotList";

describe("本周舟P热榜", () => {
  it("starts each week at Monday 04:00 Beijing time", () => {
    const monday4 = Date.parse("2026-10-26T04:00+08:00");
    expect(weekStartOf(Date.parse("2026-10-28T07:38+08:00"))).toBe(monday4);
    expect(weekStartOf(monday4)).toBe(monday4);
    expect(weekStartOf(monday4 - 1)).toBe(Date.parse("2026-10-19T04:00+08:00"));
    expect(weekStartOf(Date.parse("2026-11-02T03:59+08:00"))).toBe(monday4);
  });
});
