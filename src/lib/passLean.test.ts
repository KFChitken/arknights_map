import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leanArt, setLeanArt } from "./passLean";

/** A browser's bits the setting reads: its storage (or storage that refuses), the data saver, and window's events */
function browser({ saveData, blocked = false }: { saveData?: boolean; blocked?: boolean }) {
  const kept = new Map<string, string>();
  const refuse = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked ? refuse : (k: string) => kept.get(k) ?? null,
    setItem: blocked ? refuse : (k: string, v: string) => void kept.set(k, v),
  });
  vi.stubGlobal("navigator", saveData === undefined ? {} : { connection: { saveData } });
  const events: string[] = [];
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => events.push(e.type) });
  return { kept, events };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

// the first and last tests load it afresh, as what was said on a page stays with that page
describe("省流量 for passes", () => {
  it("follows the phone's data saver until the player says", async () => {
    vi.resetModules();
    const { leanArt } = await import("./passLean");
    browser({ saveData: true });
    expect(leanArt()).toBe(true);
    browser({ saveData: false });
    expect(leanArt()).toBe(false);
    browser({});
    expect(leanArt()).toBe(false);
  });

  it("keeps what the player said on this device, either way, and tells the page", () => {
    const { kept, events } = browser({ saveData: true });
    setLeanArt(false);
    expect(kept.get("zhoup.passLean")).toBe("off");
    expect(leanArt()).toBe(false);
    setLeanArt(true);
    expect(leanArt()).toBe(true);
    expect(events).toEqual(["zhoup:passLean", "zhoup:passLean"]);
  });

  it("is kept for the page alone where storage is blocked", async () => {
    vi.resetModules();
    const fresh = await import("./passLean");
    const { events } = browser({ saveData: true, blocked: true });
    expect(fresh.leanArt()).toBe(true);
    fresh.setLeanArt(false);
    expect(fresh.leanArt()).toBe(false);
    expect(events).toEqual(["zhoup:passLean"]);
  });
});
