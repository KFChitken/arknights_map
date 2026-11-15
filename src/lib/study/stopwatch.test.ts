import { afterEach, describe, expect, it, vi } from "vitest";
import { roundTells } from "./rules";
import { hundredths, judgeStop, stageOf, STOP_LIMIT_MS, stopOutcome, watchText } from "./stopwatch";

/** What a stop of the day's course, not passed yet, tells the server: nothing, passed (won) or lost */
const told = (outcome: "won" | "step" | "lost") => {
  const r = { won: outcome !== "lost", step: outcome === "step" };
  return roundTells(r, true) ? (r.won ? "passed" : "lost") : "nothing";
};

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

  it("passes the day's course in two steps: shown, a step that tells nothing, then hidden, which tells", () => {
    // the day's course, not passed yet: shown first
    expect(stageOf(undefined, true, false)).toBe("shown");
    expect(stopOutcome("shown", "pass")).toBe("step");
    expect(stopOutcome("shown", "exact")).toBe("step");
    expect(told(stopOutcome("shown", "pass"))).toBe("nothing");
    // shown or hidden, lost is lost
    expect(stopOutcome("shown", "miss")).toBe("lost");
    expect(told(stopOutcome("shown", "miss"))).toBe("lost");
    // 藏数字再来, or the shown one passed today on this device: hidden, whose pass passes it
    expect(stageOf("hidden", true, false)).toBe("hidden");
    expect(stageOf(undefined, true, true)).toBe("hidden");
    expect(stopOutcome("hidden", "pass")).toBe("won");
    expect(stopOutcome("hidden", "exact")).toBe("won");
    expect(told(stopOutcome("hidden", "pass"))).toBe("passed");
    expect(stopOutcome("hidden", "miss")).toBe("lost");
    expect(told(stopOutcome("hidden", "miss"))).toBe("lost");
    // nothing more of a course once it is passed, or of another course
    expect(roundTells({ won: true }, false)).toBe(false);
    expect(roundTells({ won: false }, false)).toBe(false);
    // another course's turn, or today's passed already: as ever, shown and passed in one
    expect(stageOf(undefined, false, true)).toBe("free");
    expect(stageOf(undefined, false, false)).toBe("free");
    expect(stageOf("hidden", false, false)).toBe("hidden");
    expect(stopOutcome("free", "pass")).toBe("won");
    expect(stopOutcome("free", "miss")).toBe("lost");
  });
});

/** A browser's storage, or one that keeps nothing (a private window) */
function storage(keeps: boolean) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (keeps ? (m.get(k) ?? null) : null),
    setItem: (k: string, v: string) => {
      if (!keeps) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    raw: m,
  };
}

// the module keeps what it wrote last for a browser that keeps nothing: a fresh copy for each test
async function load() {
  vi.resetModules();
  return import("./stopwatch");
}

afterEach(() => vi.unstubAllGlobals());

describe("3.25 秒停表's shown round of the day, kept on this device", () => {
  it("starts the day's next rounds hidden once the shown one is passed, until the site day is over", async () => {
    const store = storage(true);
    vi.stubGlobal("localStorage", store);
    const { rememberShown, shownPassed, stageOf } = await load();
    expect(shownPassed("2026-11-21")).toBe(false);
    rememberShown("2026-11-21");
    expect(store.raw.get("zhoup.study.shown")).toBe("2026-11-21");
    expect(shownPassed("2026-11-21")).toBe(true);
    expect(stageOf(undefined, true, shownPassed("2026-11-21"))).toBe("hidden");
    // the next site day: shown first again
    expect(shownPassed("2026-11-22")).toBe(false);
    expect(stageOf(undefined, true, shownPassed("2026-11-22"))).toBe("shown");
    // a fresh page reads it back from the browser
    const again = await load();
    expect(again.shownPassed("2026-11-21")).toBe(true);
  });

  it("keeps it while the page is open where the browser keeps nothing, and where there is no storage at all", async () => {
    vi.stubGlobal("localStorage", storage(false));
    const { rememberShown, shownPassed } = await load();
    rememberShown("2026-11-21");
    expect(shownPassed("2026-11-21")).toBe(true);
    expect(shownPassed("2026-11-22")).toBe(false);
    expect((await load()).shownPassed("2026-11-21")).toBe(false);

    vi.stubGlobal("localStorage", undefined);
    const none = await load();
    expect(none.shownPassed("2026-11-21")).toBe(false);
    none.rememberShown("2026-11-21");
    expect(none.shownPassed("2026-11-21")).toBe(true);
  });
});
