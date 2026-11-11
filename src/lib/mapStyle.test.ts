import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAP_STYLE, liteHintSeen, loadMapStyle, mapStyleSeen, markLiteHintSeen, markMapStyleSeen, saveMapStyle, storedMapStyle } from "./mapStyle";

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

  it("keeps 轻量 and 全员隐匿 like any other style", () => {
    fakeStorage();
    saveMapStyle("lite");
    expect(loadMapStyle()).toBe("lite");
    saveMapStyle("hidden");
    expect(loadMapStyle()).toBe("hidden");
  });

  it("tells a device that never picked a style from one that picked 默认", () => {
    fakeStorage();
    expect(storedMapStyle()).toBeNull();
    saveMapStyle("plain");
    expect(storedMapStyle()).toBe("plain");
  });

  it("offers 轻量 once when the map is slow", () => {
    fakeStorage();
    expect(liteHintSeen()).toBe(false);
    markLiteHintSeen();
    expect(liteHintSeen()).toBe(true);
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
