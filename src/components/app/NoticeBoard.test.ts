import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { EMPTY_MEMORY, type PublicNotice } from "@/lib/notices";
import NoticeBoard, { type BoardView } from "./NoticeBoard";

const notice = (id: string): PublicNotice => ({ id, title: id, body: id, pop: "every", pinned: false, publishedAt: Date.now(), excerpt: id });
const welcome = notice("welcome");
const other = notice("other");

const board = (view: BoardView, hide?: { id: string; on: boolean }) =>
  renderToStaticMarkup(
    createElement(NoticeBoard, {
      notices: [welcome, other],
      view,
      memory: EMPTY_MEMORY,
      hide: hide && { ...hide, onChange: () => {} },
      onOpen: () => {},
      onList: () => {},
      onLog: () => {},
      onClose: () => {},
    }),
  );

/** 「以后不再显示」 with its box, as the board draws it, and whether it is ticked */
const tick = (html: string) =>
  new RegExp(`<label class="check notice-hide"><input type="checkbox"( checked="")?/><span>${T.notices.hideNext}</span></label>`).exec(html);

describe("公告's 「以后不再显示」", () => {
  it("is over 知道了 on the notice that popped up, ticked as the player left it", () => {
    const shown = board({ kind: "notice", notice: welcome, counted: true }, { id: "welcome", on: false });
    expect(tick(shown)).not.toBeNull();
    expect(tick(shown)?.[1]).toBeUndefined();
    expect(shown.indexOf(T.notices.hideNext)).toBeLessThan(shown.indexOf(T.common.gotIt));
    expect(tick(board({ kind: "notice", notice: welcome, counted: true }, { id: "welcome", on: true }))?.[1]).toBe(' checked=""');
  });

  it("is on no other: another notice opened from the list, the list itself, or one opened by the player", () => {
    expect(tick(board({ kind: "notice", notice: other, counted: false }, { id: "welcome", on: true }))).toBeNull();
    expect(tick(board({ kind: "list" }, { id: "welcome", on: true }))).toBeNull();
    expect(tick(board({ kind: "notice", notice: welcome, counted: false }))).toBeNull();
  });
});
