import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UI,
  EARLY_UI_MARKS,
  earlyUiScript,
  isUiName,
  loadFold,
  markUiAsked,
  parseFold,
  saveFold,
  saveUi,
  shouldAskUi,
  storedUi,
  UNFOLDED,
  uiStorable,
} from "./uiChoice";

const g = globalThis as { localStorage?: Storage; document?: unknown };

function fakeStorage({ broken = false } = {}) {
  const m = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => {
      if (broken) throw new Error("no storage");
      return m.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("no storage");
      m.set(k, String(v));
    },
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
  delete g.document;
});

describe("界面", () => {
  it("starts on 浮岛, and keeps what this device picked", () => {
    const m = fakeStorage();
    expect(DEFAULT_UI).toBe("float");
    expect(storedUi()).toBeNull();
    saveUi("hud");
    expect(storedUi()).toBe("hud");
    expect(m.get("zhoup.ui")).toBe("hud");
    m.set("zhoup.ui", "glass");
    expect(storedUi()).toBeNull();
    expect(isUiName("drawer")).toBe(true);
    expect(isUiName("float ")).toBe(false);
  });

  it("asks a device once, and never one that picked already or cannot remember the answer", () => {
    fakeStorage();
    expect(shouldAskUi()).toBe(true);
    markUiAsked();
    expect(shouldAskUi()).toBe(false);

    fakeStorage();
    saveUi("float");
    expect(shouldAskUi()).toBe(false);

    fakeStorage({ broken: true });
    expect(uiStorable()).toBe(false);
    expect(storedUi()).toBeNull();
    expect(shouldAskUi()).toBe(false);
    // nothing kept, nothing thrown
    saveUi("drawer");
    markUiAsked();
    saveFold({ float: { l: true, r: true }, hud: { r: true } });
    expect(loadFold()).toEqual(UNFOLDED);
  });

  it("keeps each layout's folds apart, and reads anything else as unfolded", () => {
    const m = fakeStorage();
    expect(loadFold()).toEqual(UNFOLDED);
    saveFold({ float: { l: false, r: true }, hud: { r: true } });
    expect(JSON.parse(m.get("zhoup.uiFold") ?? "")).toEqual({ float: { l: false, r: true }, hud: { r: true } });
    expect(loadFold()).toEqual({ float: { l: false, r: true }, hud: { r: true } });
    expect(parseFold("not json")).toEqual(UNFOLDED);
    expect(parseFold("null")).toEqual(UNFOLDED);
    expect(parseFold('{"float":{"r":"yes"},"hud":{"r":1}}')).toEqual(UNFOLDED);
    expect(parseFold('{"float":{"l":true}}')).toEqual({ float: { l: true, r: false }, hud: { r: false } });
  });

  it("marks the page before the app starts: a layout other than 浮岛, or 浮岛's sides folded away", () => {
    const attrs = new Map<string, string>();
    g.document = { documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v) } };
    const m = fakeStorage();
    const run = (choice = true) => {
      attrs.clear();
      new Function(earlyUiScript(choice))();
      return Object.fromEntries(attrs);
    };
    expect(run()).toEqual({});
    m.set("zhoup.ui", "float");
    expect(run()).toEqual({});
    m.set("zhoup.ui", "hud");
    expect(run()).toEqual({ "data-ui-early": "hud" });
    // folds of 浮岛 only matter on 浮岛
    m.set("zhoup.uiFold", JSON.stringify({ float: { l: true, r: true }, hud: { r: true } }));
    expect(run()).toEqual({ "data-ui-early": "hud" });
    m.set("zhoup.ui", "drawer");
    expect(run()).toEqual({ "data-ui-early": "drawer" });
    // the server keeps everyone on 浮岛: what this device picked waits, its folds still count
    expect(run(false)).toEqual({ "data-fold-l": "", "data-fold-r": "" });
    m.delete("zhoup.ui");
    m.set("zhoup.uiFold", JSON.stringify({ float: { l: false, r: true } }));
    expect(run()).toEqual({ "data-fold-r": "" });
    m.set("zhoup.uiFold", "{not json");
    expect(run()).toEqual({});
    expect(EARLY_UI_MARKS).toEqual(["data-ui-early", "data-fold-l", "data-fold-r"]);
    fakeStorage({ broken: true });
    expect(() => run()).not.toThrow();
    expect(run()).toEqual({});
  });
});
