import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T, fmt } from "@/i18n";
import { repliesFor, replyOf, type Declaration } from "@/lib/declarations";
import type { InboxTab } from "@/lib/inboxTabs";
import { GIFTS_IN_PER_DAY, type GiftState } from "@/lib/passes";
import type { PublicProfile } from "@/lib/profile";
import type { Friend, InboxItem } from "@/lib/world/types";
import InboxSheet from "./InboxSheet";

const nothing = async () => {};
const sheet = (items: InboxItem[], friends: Friend[] = [], tab: InboxTab = "declarations") =>
  renderToStaticMarkup(
    createElement(InboxSheet, {
      items,
      friends,
      games: ["arknights"],
      tab,
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
        giftBack: nothing,
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

const DR_A: PublicProfile = { displayName: "Dr. A", games: ["arknights"], favourites: { arknights: [], endfield: [] }, avatar: "hood", color: "cyan" };

/** Dr. A, a 触须之交 who may be given a 寻访券 today as gift says (absent: TA may not be given any) */
const drA = (gift?: GiftState): Friend => ({
  id: "f:a",
  since: Date.now() - 86_400_000,
  profile: DR_A,
  roaches: [],
  declarations: 0,
  history: [],
  pokeAgainAt: null,
  star: null,
  between: {
    mainId: null,
    asleep: false,
    actsLeft: 3,
    touchesLeft: 3,
    done: { sanity: false, blanket: false, water: false },
    welcome: true,
    visitAgainAt: null,
    visiting: null,
    games: {},
    wantAgainAt: null,
    anniversary: null,
    ...(gift ? { gift } : {}),
  },
});

const fromA = (returned = false): InboxItem => ({
  kind: "gift",
  id: "c:1",
  at: Date.now() - 60_000,
  seen: false,
  from: DR_A,
  friendId: "f:a",
  returned,
  replied: returned,
});

/** The words of the 消息 and its buttons: [words, disabled] */
const read = (html: string) => ({
  text: html.replace(/<[^>]*>/g, ""),
  buttons: [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, inner]) => [inner.replace(/<[^>]*>/g, ""), /\sdisabled=""/.test(attrs)]),
});

describe("a 寻访券 in 消息", () => {
  it("offers 回送一张 while you may give TA one, grey once TA was given all a day brings", () => {
    const ok = read(sheet([fromA()], [drA("ok")], "friends"));
    expect(ok.text).toContain(fmt(T.inbox.gift.text, { who: "Dr. A" }));
    expect(ok.buttons).toContainEqual([T.inbox.gift.back, false]);
    expect(read(sheet([fromA()], [drA("full")], "friends")).buttons).toContainEqual([T.friendActs.giftFull, true]);
  });

  it("says 已经回送 once you gave TA one, also when you two gave at the very same moment", () => {
    for (const html of [sheet([fromA(true)], [drA("ok")], "friends"), sheet([fromA()], [drA("given")], "friends")]) {
      const { text, buttons } = read(html);
      expect(text).toContain(T.inbox.gift.returned);
      expect(buttons.map(([w]) => w)).not.toContain(T.inbox.gift.back);
    }
  });

  it("offers nothing to give while TA may not be given any, or is no longer a 触须之交", () => {
    for (const html of [sheet([fromA()], [drA()], "friends"), sheet([fromA()], [], "friends")]) {
      const { text, buttons } = read(html);
      expect(text).toContain(fmt(T.inbox.gift.text, { who: "Dr. A" }));
      expect(buttons.map(([w]) => w)).not.toContain(T.inbox.gift.back);
      expect(text).not.toContain(T.inbox.gift.returned);
    }
  });

  it("says once that the day's three came, from nobody: nothing to do, nobody to block", () => {
    const html = sheet([{ kind: "giftsFull", id: "g:2026-11-14", at: Date.now(), seen: false, replied: true }], [], "friends");
    const row = /<div class="msg[^"]*gifts-full">(.*?)<\/div><\/div>/.exec(html)?.[1] ?? "";
    expect(read(row).text).toContain(fmt(T.inbox.gift.full, { n: GIFTS_IN_PER_DAY }));
    expect(read(row).text).toContain(T.inbox.gift.fullFrom);
    expect(row).not.toMatch(/<button|<a /);
  });
});
