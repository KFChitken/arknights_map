import { afterEach, describe, expect, it, vi } from "vitest";
import { alonePopping, markBadgesPopped, poppedBadges, poppedKey, poppedStorageKey, POPPED_KEEP } from "./badgesPopped";

/** A browser's localStorage, shared by its tabs */
function storage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, String(v)),
    removeItem: (k: string) => void items.delete(k),
  };
}

const badge = (id: string, at = 1_700_000_000_000) => ({ id, at });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("获得新称号, once on each device", () => {
  it("keeps the badges shown, each as earned at its time, for each player apart", () => {
    const local = storage();
    vi.stubGlobal("localStorage", local);
    const held = [badge("lookatme"), badge("survivor", 1_700_000_100_000), badge("beta")];
    expect(poppedBadges("u1")).toEqual(new Set());
    markBadgesPopped("u1", held.slice(0, 2));
    expect(poppedBadges("u1")).toEqual(new Set(["lookatme@1700000000000", "survivor@1700000100000"]));
    expect(JSON.parse(local.getItem(poppedStorageKey("u1"))!)).toEqual(["lookatme@1700000000000", "survivor@1700000100000"]);
    // another player on the same browser has their own
    expect(poppedBadges("u2")).toEqual(new Set());
    // 石棺里的苏醒 given again: a new one, not shown yet
    expect(poppedBadges("u1").has(poppedKey(badge("survivor", 1_800_000_000_000)))).toBe(false);
    // what another tab kept is read afresh
    local.setItem(poppedStorageKey("u1"), JSON.stringify(["beta@1700000000000"]));
    expect(poppedBadges("u1").has("beta@1700000000000")).toBe(true);
  });

  it("keeps what another tab showed, and the latest few hundred", () => {
    const local = storage();
    vi.stubGlobal("localStorage", local);
    markBadgesPopped("u3", [badge("lookatme"), badge("survivor")]);
    // another tab, its badges newer, showed 石棺里的苏醒 given again; this one then shows beta
    local.setItem(poppedStorageKey("u3"), JSON.stringify([...poppedBadges("u3"), poppedKey(badge("survivor", 1_800_000_000_000))]));
    markBadgesPopped("u3", [badge("beta")]);
    expect(poppedBadges("u3")).toEqual(
      new Set(["lookatme@1700000000000", "survivor@1700000000000", "survivor@1800000000000", "beta@1700000000000"]),
    );
    const many = Array.from({ length: POPPED_KEEP + 20 }, (_, i) => badge(`b${i}`));
    markBadgesPopped("u3", many);
    const kept = poppedBadges("u3");
    expect(kept.size).toBe(POPPED_KEEP);
    expect(kept.has(poppedKey(many[many.length - 1]))).toBe(true);
    expect(kept.has(poppedKey(many[0]))).toBe(false);
    expect(kept.has("lookatme@1700000000000")).toBe(false);
  });

  it("remembers on the page alone when storage fails, or holds something else", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    markBadgesPopped("u4", [badge("lookatme")]);
    expect(poppedBadges("u4")).toEqual(new Set(["lookatme@1700000000000"]));
    // no storage at all
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", undefined);
    expect(poppedBadges("u4")).toEqual(new Set(["lookatme@1700000000000"]));
    // not a list
    const local = storage();
    vi.stubGlobal("localStorage", local);
    local.setItem(poppedStorageKey("u5"), "{oops");
    expect(poppedBadges("u5")).toEqual(new Set());
    local.setItem(poppedStorageKey("u5"), JSON.stringify({ a: 1 }));
    expect(poppedBadges("u5")).toEqual(new Set());
    local.setItem(poppedStorageKey("u5"), JSON.stringify(["beta@1", 7, null]));
    expect(poppedBadges("u5")).toEqual(new Set(["beta@1"]));
  });

  it("lets two tabs at once take turns where the browser has locks, and just goes on where it has none", async () => {
    const local = storage();
    vi.stubGlobal("localStorage", local);
    // a browser's lock manager: one holder at a time for each name, in the order asked
    const queues = new Map<string, Promise<unknown>>();
    const asked: string[] = [];
    vi.stubGlobal("navigator", {
      locks: {
        request: (name: string, cb: () => unknown) => {
          asked.push(name);
          const turn = (queues.get(name) ?? Promise.resolve()).then(() => new Promise((r) => setTimeout(r, 5))).then(cb);
          queues.set(name, turn.catch(() => {}));
          return turn;
        },
      },
    });
    const held = [badge("lookatme")];
    // what each tab does on finding lookatme unseen: read, keep, and say whether to show it
    const tab = () =>
      alonePopping("u6", () => {
        const before = poppedBadges("u6");
        markBadgesPopped("u6", held);
        return held.filter((b) => !before.has(poppedKey(b))).length;
      });
    expect(await Promise.all([tab(), tab()])).toEqual([1, 0]);
    expect(asked).toEqual([poppedStorageKey("u6"), poppedStorageKey("u6")]);

    // no locks: it runs at once
    vi.stubGlobal("navigator", {});
    expect(await alonePopping("u7", () => "ran")).toBe("ran");
    // locks that refuse (not allowed here): it runs all the same
    vi.stubGlobal("navigator", { locks: { request: () => Promise.reject(new Error("SecurityError")) } });
    expect(await alonePopping("u7", () => "ran anyway")).toBe("ran anyway");
  });
});
