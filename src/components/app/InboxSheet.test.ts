import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { repliesFor, replyOf, type Declaration } from "@/lib/declarations";
import type { InboxItem } from "@/lib/world/types";
import InboxSheet from "./InboxSheet";

const nothing = async () => {};
const sheet = (items: InboxItem[]) =>
  renderToStaticMarkup(
    createElement(InboxSheet, {
      items,
      friends: [],
      games: ["arknights"],
      tab: "declarations",
      viewed: [],
      notice: false,
      onTab: () => {},
      onReply: nothing,
      onReact: nothing,
      onIgnore: nothing,
      onViewProfile: () => {},
      onOpenFriend: () => {},
      onSafety: () => {},
      onAppeal: async () => true,
      friendly: {
        answerSanity: nothing,
        gestureBack: nothing,
        look: () => {},
        sendHome: nothing,
        follow: nothing,
        goHome: nothing,
        gameAdded: nothing,
      },
      onClose: () => {},
    }),
  );

const declared = (d: Declaration, reaction: string | null = null): InboxItem => ({
  kind: "declaration",
  id: "d:1",
  at: Date.now() - 4 * 60_000,
  seen: false,
  text: "卫戍协议，启动！",
  replied: false,
  reaction: reaction === null ? null : replyOf(d, reaction),
  options: repliesFor(d),
});

/** Each line of reply chips, by its class, with the words on its buttons */
const rows = (html: string) =>
  [...html.matchAll(/<div class="(chips reactions[^"]*)">(.*?)<\/div>/g)].map(([, cls, inner]) => ({
    cls,
    words: [...inner.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(([, w]) => w),
  }));

describe("a declaration in 消息", () => {
  it("has three lines to answer it with: its own four, the five every one has, then the playful four", () => {
    expect(rows(sheet([declared({ template: "stronghold" })]))).toEqual([
      { cls: "chips reactions", words: ["上号！摆阵！", "这把稳了", "再来一把就睡", "一起卫戍，碰我一下"] },
      { cls: "chips reactions generic", words: ["原来，你也玩舟？", "合乎粥礼", "舟P收收味", "+1", "这种已经是外交官级别的了"] },
      { cls: "chips reactions fun", words: ["该电了", "6", "绷不住了", "已截图"] },
    ]);
  });

  it("has the two lines of everyone's where a sentence has none of its own", () => {
    expect(rows(sheet([declared({ template: "alsoplay", game: "arknights" })])).map((r) => r.cls)).toEqual([
      "chips reactions generic",
      "chips reactions fun",
    ]);
  });

  it("says which one you left, a playful one too, with no lines to pick from", () => {
    const html = sheet([declared({ template: "stronghold" }, "six")]);
    expect(rows(html)).toEqual([]);
    expect(html.replace(/<[^>]*>/g, "")).toContain("你回应了：6");
  });
});
