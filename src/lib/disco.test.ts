import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoChosen, discoHintSeen, discoOpenTo, forgetDisco, prefetchDisco, seeDiscoHint, setDiscoChosen } from "./disco";

/** This browser's storage as the page sees it; blocked: one that throws on every use (a private window, say) */
function storage(blocked = false) {
  const kept = new Map<string, string>();
  const no = () => {
    throw new Error("SecurityError");
  };
  return {
    kept,
    api: blocked
      ? { getItem: no, setItem: no }
      : { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) },
  };
}

let told = 0;
function page(s: ReturnType<typeof storage>, nav: object = {}) {
  const w = new EventTarget();
  w.addEventListener("zhoup:disco", () => told++);
  const idle = vi.fn();
  vi.stubGlobal("window", Object.assign(w, { requestIdleCallback: idle, setTimeout: vi.fn() }));
  vi.stubGlobal("localStorage", s.api);
  vi.stubGlobal("navigator", nav);
  return idle;
}

beforeEach(() => {
  told = 0;
  forgetDisco();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("听歌's disco's switch", () => {
  it("is off until turned on, and is kept in this browser as it was left", () => {
    const s = storage();
    page(s);
    expect(discoChosen()).toBe(false);
    setDiscoChosen(true);
    expect(s.kept.get("zhoup.disco")).toBe("1");
    expect(told).toBe(1);
    // the page opened again
    forgetDisco();
    expect(discoChosen()).toBe(true);
    setDiscoChosen(false);
    expect(s.kept.get("zhoup.disco")).toBe("0");
    forgetDisco();
    expect(discoChosen()).toBe(false);
  });

  it("with the browser's storage blocked, is off, and kept for this page alone, never an error", () => {
    page(storage(true));
    expect(discoChosen()).toBe(false);
    expect(() => setDiscoChosen(true)).not.toThrow();
    expect(discoChosen()).toBe(true);
    forgetDisco();
    expect(discoChosen()).toBe(false);
  });
});

describe("「点我蹦迪」", () => {
  it("is shown once on this device", () => {
    const s = storage();
    page(s);
    expect(discoHintSeen()).toBe(false);
    seeDiscoHint();
    expect(discoHintSeen()).toBe(true);
    expect(s.kept.get("zhoup.discoHint")).toBe("1");
    seeDiscoHint();
    expect(told).toBe(1);
    forgetDisco();
    expect(discoHintSeen()).toBe(true);
  });

  it("with the browser's storage blocked, is shown once on this page, never an error", () => {
    page(storage(true));
    expect(discoHintSeen()).toBe(false);
    expect(() => seeDiscoHint()).not.toThrow();
    expect(discoHintSeen()).toBe(true);
  });
});

describe("the disco's own part of the page", () => {
  it("is fetched ahead once the page has nothing else to do, but not on a phone saving data", () => {
    const saving = page(storage(), { connection: { saveData: true } });
    prefetchDisco();
    expect(saving).not.toHaveBeenCalled();
    const fetching = page(storage(), { connection: { saveData: false } });
    prefetchDisco();
    expect(fetching).toHaveBeenCalledTimes(1);
  });
});

describe("whether the disco is there", () => {
  it("is where 听歌 is and the server opened the disco to the player too", () => {
    expect(discoOpenTo(true, { disco: true })).toBe(true);
    // DISCO off, or admins and the player not one: me() says nothing of it
    expect(discoOpenTo(true, {})).toBe(false);
    // 听歌 not open to them (LISTEN)
    expect(discoOpenTo(true, undefined)).toBe(false);
    // 听歌 not shown: the site gray, the page in English
    expect(discoOpenTo(false, { disco: true })).toBe(false);
  });
});
