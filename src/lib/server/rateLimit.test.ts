import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allow, forgetHits, keptKeys, MAX_KEYS, prune } from "./rateLimit";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

beforeEach(() => {
  forgetHits();
});

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
    prune();
    allow("one-more", 1, MINUTE);
    expect(allow("daily", 1, DAY)).toBe(false);
    expect(keptKeys()).toBe(2);
  });

  it("leaves clearing out to prune: a call never walks the other keys", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 20_000; i++) allow(`code-day:${i}`, 100, DAY);
    for (let i = 0; i < 20_000; i++) allow(`short-${i}`, 1, MINUTE);
    vi.advanceTimersByTime(2 * MINUTE);
    // the short ones are past their window, but stay until prune runs
    allow("page", 10, MINUTE);
    expect(keptKeys()).toBe(40_001);
    // as many calls as there are keys, quickly: no call pays for the rest (it took about a millisecond each)
    const started = performance.now();
    for (let i = 0; i < 40_000; i++) allow(`page-${i % 100}`, 1_000_000, MINUTE);
    expect(performance.now() - started).toBeLessThan(500);
    prune();
    // the daily keys and this minute's
    expect(keptKeys()).toBe(20_000 + 1 + 100);
  });

  it("forgets a daily key only when its day is over, sweep after sweep", () => {
    vi.useFakeTimers();
    expect(allow("code-day:1.2.3.4", 1, DAY)).toBe(true);
    for (let h = 0; h < 23; h++) {
      vi.advanceTimersByTime(60 * MINUTE);
      prune();
      expect(allow("code-day:1.2.3.4", 1, DAY)).toBe(false);
    }
    vi.advanceTimersByTime(60 * MINUTE);
    prune();
    expect(keptKeys()).toBe(0);
    expect(allow("code-day:1.2.3.4", 1, DAY)).toBe(true);
  });

  it("keeps at most MAX_KEYS, forgetting the ones hit longest ago first", () => {
    vi.useFakeTimers();
    expect(allow("busy", 1, DAY)).toBe(true);
    for (let i = 0; i < MAX_KEYS + 10; i++) {
      allow(`flood-${i}`, 1, DAY);
      // hit again now and then, so it stays among the freshest
      if (i % 50_000 === 0) expect(allow("busy", 1, DAY)).toBe(false);
    }
    expect(keptKeys()).toBe(MAX_KEYS);
    expect(allow("busy", 1, DAY)).toBe(false);
    // the first of the flood went first
    expect(allow("flood-0", 1, DAY)).toBe(true);
  });
});
