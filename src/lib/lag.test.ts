import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lagWatch } from "./lag";

// a clock, frames and ticks driven by hand
let now = 0;
let tick: (() => void) | null = null;
let frames: ((t: number) => void)[] = [];
let onBack: (() => void) | null = null;

beforeEach(() => {
  now = 0;
  tick = null;
  frames = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("setInterval", (fn: () => void) => {
    tick = fn;
    return 1;
  });
  vi.stubGlobal("clearInterval", () => {
    tick = null;
  });
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => {
    frames.push(fn);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: (_: string, fn: () => void) => {
      onBack = fn;
    },
    removeEventListener: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The map draws at fps for this long */
function drawFor(ms: number, fps: number) {
  const end = now + ms;
  while (now < end && frames.length) {
    now += 1000 / fps;
    const due = frames.splice(0);
    for (const f of due) f(now);
  }
}

/** The page's ticks every 250 ms, for this long */
function tickFor(ms: number) {
  for (let t = 0; t < ms; t += 250) {
    now += 250;
    tick?.();
  }
}

describe("whether the map feels slow", () => {
  it("is slow after three seconds of a drag under 25 frames a second, in all, and says so once", () => {
    const onLag = vi.fn();
    const w = lagWatch(onLag, () => false);
    w.moving(true);
    drawFor(2100, 20);
    w.moving(false);
    expect(onLag).not.toHaveBeenCalled();
    w.moving(true);
    drawFor(1500, 20);
    expect(onLag).toHaveBeenCalledTimes(1);
    w.moving(true);
    drawFor(5000, 10);
    expect(onLag).toHaveBeenCalledTimes(1);
  });

  it("is not slow at 60 frames a second, nor while the player is busy", () => {
    const onLag = vi.fn();
    let busy = false;
    const w = lagWatch(onLag, () => busy);
    w.moving(true);
    drawFor(10_000, 60);
    expect(onLag).not.toHaveBeenCalled();
    busy = true;
    drawFor(10_000, 10);
    expect(onLag).not.toHaveBeenCalled();
  });

  it("is slow when the page stops twice within five minutes, not when it was just hidden", () => {
    const onLag = vi.fn();
    lagWatch(onLag, () => false);
    tickFor(1000);
    // back into view: a stop just after does not count
    onBack?.();
    now += 1500;
    tick?.();
    expect(onLag).not.toHaveBeenCalled();
    tickFor(5000);
    now += 1500;
    tick?.();
    tickFor(60_000);
    expect(onLag).not.toHaveBeenCalled();
    now += 1200;
    tick?.();
    expect(onLag).toHaveBeenCalledTimes(1);
  });

  it("forgets a stop five minutes old", () => {
    const onLag = vi.fn();
    lagWatch(onLag, () => false);
    tickFor(3000);
    now += 1500;
    tick?.();
    tickFor(6 * 60_000);
    now += 1500;
    tick?.();
    expect(onLag).not.toHaveBeenCalled();
  });
});
