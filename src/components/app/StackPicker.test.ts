import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { roachTitle } from "./RoachCards";
import StackPicker, { StackBack, StackUnderGuide, type StackRow } from "./StackPicker";

const rows = (n: number): StackRow[] => Array.from({ length: n }, (_, i) => ({ key: `r${i}`, icon: null, title: `row ${i}`, onPick: () => {} }));
const list = (n: number, zoomIn = true) =>
  renderToStaticMarkup(createElement(StackPicker, { rows: rows(n), onZoomIn: zoomIn ? () => {} : undefined, onClose: () => {} }));
const count = (html: string, part: string) => html.split(part).length - 1;

describe("the list of roaches lying on top of each other", () => {
  it("says how many, and lists them in the order given, nearest first", () => {
    const html = list(3);
    expect(html).toContain("这里叠着 3 只");
    expect(html).toContain("点一只，看看是谁");
    expect(html).toContain("按离你点的地方远近排");
    expect(count(html, 'class="stack-row"')).toBe(3);
    expect(html.indexOf("row 0")).toBeLessThan(html.indexOf("row 1"));
    expect(html.indexOf("row 1")).toBeLessThan(html.indexOf("row 2"));
    expect(html).not.toContain("还有");
  });

  it("lists eight and counts the rest", () => {
    const html = list(23);
    expect(html).toContain("这里叠着 23 只");
    expect(count(html, 'class="stack-row"')).toBe(8);
    expect(html).toContain("row 7");
    expect(html).not.toContain("row 8");
    expect(html).toContain("还有 15 只");
  });

  it("offers 放大看看 only where the map can go closer", () => {
    expect(list(2)).toContain("放大看看");
    expect(list(2, false)).not.toContain("放大看看");
  });

  it("shows the way back to them on a card, and what lies under a guide on hers", () => {
    expect(renderToStaticMarkup(createElement(StackBack, { n: 5, onBack: () => {} }))).toContain("← 这一堆还有 5 只");
    expect(renderToStaticMarkup(createElement(StackUnderGuide, { them: "她", n: 3, onOpen: () => {} }))).toContain("她脚下还有 3 只 · 挑一只看看");
    expect(renderToStaticMarkup(createElement(StackUnderGuide, { them: "他", n: 1, onOpen: () => {} }))).toContain("他脚下还有 1 只");
  });
});

describe("what someone else's roach is called, on its card and in the list", () => {
  it("names a 触须之交's", () => {
    expect(roachTitle({ clone: false }, "小满")).toBe("触须之交 · 小满");
    expect(roachTitle({ clone: true }, "小满")).toBe("触须之交 · 小满 的克隆体");
  });

  it("names nobody else's, and tells no clone's owner", () => {
    expect(roachTitle({ clone: false })).toBe("一只匿名舟P");
    expect(roachTitle({ clone: false, asleep: true })).toBe("一只翻肚皮的匿名舟P");
    expect(roachTitle({ clone: true })).toBe("某舟P的克隆体");
    expect(roachTitle({ clone: true, asleep: true })).toBe("某舟P的克隆体");
  });
});
