import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A browser's bits the setting reads: its storage (or storage that refuses), and window's events */
function browser({ blocked = false }: { blocked?: boolean } = {}) {
  const kept = new Map<string, string>();
  const refuse = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked ? refuse : (k: string) => kept.get(k) ?? null,
    setItem: blocked ? refuse : (k: string, v: string) => void kept.set(k, v),
  });
  const events: string[] = [];
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => events.push(e.type) });
  return { kept, events };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

// each test loads it afresh, as what was said on a page stays with that page
describe("folding the pass hung on a roach's card", () => {
  it("hangs it out until whoever looks folds it, and keeps that on this device for every card after", async () => {
    const { passFolded, setPassFolded } = await import("./passFold");
    const { kept, events } = browser();
    expect(passFolded()).toBe(false);
    setPassFolded(true);
    expect(kept.get("zhoup.passFold")).toBe("on");
    expect(passFolded()).toBe(true);
    setPassFolded(false);
    expect(kept.get("zhoup.passFold")).toBe("off");
    expect(passFolded()).toBe(false);
    expect(events).toEqual(["zhoup:passFold", "zhoup:passFold"]);
  });

  it("reads what this device kept, whatever this page said", async () => {
    const { passFolded } = await import("./passFold");
    const { kept } = browser();
    kept.set("zhoup.passFold", "on");
    expect(passFolded()).toBe(true);
    kept.set("zhoup.passFold", "something else");
    expect(passFolded()).toBe(false);
  });

  it("is kept for the page alone where storage is blocked", async () => {
    const { passFolded, setPassFolded } = await import("./passFold");
    const { events } = browser({ blocked: true });
    expect(passFolded()).toBe(false);
    setPassFolded(true);
    expect(passFolded()).toBe(true);
    expect(events).toEqual(["zhoup:passFold"]);
  });
});
