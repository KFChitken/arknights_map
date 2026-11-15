import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PageError from "@/app/error";
import NoMap from "@/components/app/NoMap";
import { onDrawingLost, webglWorks } from "./webgl";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A document whose canvases answer getContext with what given says for each kind */
function canvases(given: (kind: string) => unknown) {
  const asked: string[] = [];
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: (kind: string) => {
        asked.push(kind);
        return given(kind);
      },
    }),
  });
  return asked;
}

const gl = () => {
  const lose = vi.fn();
  return { lose, context: { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext: lose } : null) } };
};

describe("whether the browser lets the page draw with the graphics card", () => {
  it("says yes for WebGL 2, and lets the context it made go at once", () => {
    const { lose, context } = gl();
    const asked = canvases((kind) => (kind === "webgl2" ? context : null));
    expect(webglWorks()).toBe(true);
    expect(asked).toEqual(["webgl2"]);
    expect(lose).toHaveBeenCalledOnce();
  });

  it("says yes for WebGL 1 where 2 is not had, each asked of a canvas of its own", () => {
    const { context } = gl();
    const asked = canvases((kind) => (kind === "webgl" ? context : null));
    expect(webglWorks()).toBe(true);
    expect(asked).toEqual(["webgl2", "webgl"]);
  });

  it("says yes for a context without the extension to let it go", () => {
    canvases(() => ({ getExtension: () => null }));
    expect(webglWorks()).toBe(true);
  });

  it("says no where neither comes, as for a site the browser stopped (2026-11-15), or the browser throws", () => {
    canvases(() => null);
    expect(webglWorks()).toBe(false);
    canvases(() => {
      throw new Error("no");
    });
    expect(webglWorks()).toBe(false);
  });
});

describe("hearing that what a map drew was lost", () => {
  class Canvas {
    constructor(readonly isConnected: boolean) {}
  }
  function wrapper() {
    const heard: { type: string; capture: unknown; f: (e: Event) => void }[] = [];
    const el = {
      addEventListener: (type: string, f: (e: Event) => void, capture: unknown) => heard.push({ type, capture, f }),
      removeEventListener: (type: string, f: (e: Event) => void) => heard.splice(heard.findIndex((h) => h.type === type && h.f === f), 1),
    };
    const fire = (target: unknown) => heard.filter((h) => h.type === "webglcontextlost").forEach((h) => h.f({ target } as unknown as Event));
    return { el: el as unknown as HTMLElement, heard, fire };
  }

  it("on the way down, from a canvas still on the page; not from one already taken off it, nor anything else", () => {
    vi.stubGlobal("HTMLCanvasElement", Canvas);
    const { el, heard, fire } = wrapper();
    const lost = vi.fn();
    const undo = onDrawingLost(el, lost);
    expect(heard.map((h) => [h.type, h.capture])).toEqual([["webglcontextlost", true]]);
    fire(new Canvas(false));
    fire({ isConnected: true });
    expect(lost).not.toHaveBeenCalled();
    fire(new Canvas(true));
    expect(lost).toHaveBeenCalledOnce();
    undo();
    expect(heard).toEqual([]);
  });
});

describe("what the page shows instead of black", () => {
  it("says the map cannot be drawn, or that its drawing broke off, and how to get it back", () => {
    const fresh = renderToString(createElement(NoMap, { lost: false, onRetry: () => {} }));
    expect(fresh).toContain("地图画不出来");
    expect(fresh).toContain("把浏览器完全关掉");
    expect(fresh).toContain("再试一次");
    expect(fresh).toContain('role="alert"');
    expect(renderToString(createElement(NoMap, { lost: true, onRetry: () => {} }))).toContain("地图画面断了");
  });

  it("shows a page whose code broke readably, with the way back and what the browser said", () => {
    const html = renderToString(createElement(PageError, { error: new TypeError("Cannot read properties of null (reading 'getSource')") }));
    expect(html).toContain("页面出了点问题");
    expect(html).toContain("重新加载");
    expect(html).toContain("TypeError: Cannot read properties of null (reading &#x27;getSource&#x27;)");
    expect(html).toContain('class="page-error"');
  });
});
