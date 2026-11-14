import { describe, expect, it } from "vitest";
import { hundredths, judgeStop, STOP_LIMIT_MS, watchText } from "./stopwatch";

/** How a stop that many ms after the start goes */
const stopAt = (ms: number) => judgeStop(hundredths(ms));

describe("3.25 秒停表", () => {
  it("reads a time the way the watch shows it, to the hundredth, rounded down", () => {
    expect(hundredths(3199)).toBe(319);
    expect(hundredths(3200)).toBe(320);
    expect(hundredths(3259.99)).toBe(325);
    expect(hundredths(3309)).toBe(330);
    expect(hundredths(3310)).toBe(331);
    // what a sum of time stamps loses in its last bits is not a hundredth less
    expect(hundredths(3.2 * 1000)).toBe(320);
    expect(hundredths(1234.5678 + 2015.4322)).toBe(325);
    expect(hundredths(-5)).toBe(0);
    expect(hundredths(STOP_LIMIT_MS)).toBe(1000);
  });

  it("passes from 3.20 to 3.30, both shown, and calls 3.25 itself 正好", () => {
    expect(stopAt(3199)).toBe("miss");
    expect(stopAt(3200)).toBe("pass");
    expect(stopAt(3249)).toBe("pass");
    expect(stopAt(3250)).toBe("exact");
    expect(stopAt(3259)).toBe("exact");
    expect(stopAt(3260)).toBe("pass");
    expect(stopAt(3300)).toBe("pass");
    expect(stopAt(3309)).toBe("pass");
    expect(stopAt(3310)).toBe("miss");
    expect(stopAt(0)).toBe("miss");
    expect(stopAt(STOP_LIMIT_MS)).toBe("miss");
  });

  it("shows seconds with two places", () => {
    expect(watchText(0)).toBe("0.00");
    expect(watchText(5)).toBe("0.05");
    expect(watchText(325)).toBe("3.25");
    expect(watchText(341)).toBe("3.41");
    expect(watchText(1000)).toBe("10.00");
  });
});
