import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAP_STYLE, loadMapStyle, mapStyleSeen, markMapStyleSeen, saveMapStyle } from "./mapStyle";

const g = globalThis as { localStorage?: Storage };

function fakeStorage() {
  const m = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
  return m;
}

afterEach(() => {
  delete g.localStorage;
});

describe("地图画风", () => {
  it("starts on 默认, and keeps what this device picked", () => {
    const m = fakeStorage();
    expect(DEFAULT_MAP_STYLE).toBe("plain");
    expect(loadMapStyle()).toBe("plain");
    saveMapStyle("nation");
    expect(loadMapStyle()).toBe("nation");
    m.set("zhoup.mapStyle", "rainbow");
    expect(loadMapStyle()).toBe("plain");
  });

  it("says once that the style can change", () => {
    fakeStorage();
    expect(mapStyleSeen()).toBe(false);
    markMapStyleSeen();
    expect(mapStyleSeen()).toBe(true);
  });

  it("does without storage: 默认, and no hint to pester with", () => {
    expect(loadMapStyle()).toBe("plain");
    expect(mapStyleSeen()).toBe(true);
    expect(() => saveMapStyle("hearts")).not.toThrow();
  });
});
