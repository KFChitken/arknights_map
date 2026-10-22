import { afterEach, describe, expect, it, vi } from "vitest";
import { allow } from "./rateLimit";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

afterEach(() => {
  vi.useRealTimers();
});

describe("allow", () => {
  it("lets a key through a fixed number of times per window", () => {
    vi.useFakeTimers();
    expect(allow("a", 2, MINUTE)).toBe(true);
    expect(allow("a", 2, MINUTE)).toBe(true);
    expect(allow("a", 2, MINUTE)).toBe(false);
    vi.advanceTimersByTime(MINUTE);
    expect(allow("a", 2, MINUTE)).toBe(true);
  });

  it("keeps a daily count when a flood of short-window keys is cleared", () => {
    vi.useFakeTimers();
    expect(allow("daily", 1, DAY)).toBe(true);
    for (let i = 0; i <= 10_000; i++) allow(`short-${i}`, 1, MINUTE);
    vi.advanceTimersByTime(2 * MINUTE);
    allow("one-more", 1, MINUTE);
    expect(allow("daily", 1, DAY)).toBe(false);
  });
});
