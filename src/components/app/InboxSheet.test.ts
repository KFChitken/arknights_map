import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { T, fmt } from "@/i18n";
import { repliesFor, replyOf, type Declaration } from "@/lib/declarations";
import type { InboxTab } from "@/lib/inboxTabs";
import { GIFTS_IN_PER_DAY, type GiftState } from "@/lib/passes";
import type { PublicProfile } from "@/lib/profile";
import type { SquadCall } from "@/lib/squad";
import type { Friend, InboxItem } from "@/lib/world/types";
import InboxSheet, { type InboxFriendly } from "./InboxSheet";

const nothing = async () => {};
const sheet = (items: InboxItem[], friends: Friend[] = [], tab: InboxTab = "declarations", more: Partial<InboxFriendly> = {}) =>
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
        listenJoin: nothing,
        listenLater: nothing,
        listenShow: () => {},
        listenCall: nothing,
        listenAnswer: nothing,
        squadJoin: nothing,
        squadLater: nothing,
        squadShow: () => {},
        squadCall: nothing,
        ...more,
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

const invited = (state: "open" | "later" | "in" | "over"): InboxItem => ({
  kind: "listenInvite",
  id: "li:1",
  at: Date.now() - 60_000,
  seen: false,
  from: DR_A,
  friendId: "f:a",
  song: "逐星河",
  state,
  n: state === "open" || state === "later" ? 2 : 0,
  until: Date.now() + 29 * 60_000,
  replied: true,
});
const words = (html: string) => read(html).buttons.map(([w]) => w);

describe("an invitation to 一起听 in 消息", () => {
  it("offers 一起听 and 下次吧 while it is good, and after 下次吧 still 一起听", () => {
    const open = sheet([invited("open")], [drA()], "friends");
    expect(read(open).text).toContain(fmt(T.inbox.listen.invite, { who: "Dr. A", song: "逐星河" }));
    expect(read(open).text).toContain(fmt(T.inbox.listen.open, { n: 2 }));
    expect(words(open)).toEqual(expect.arrayContaining([T.listen.join, T.listen.later, T.common.seeThem]));
    const later = sheet([invited("later")], [drA()], "friends");
    expect(read(later).text).toContain(T.inbox.listen.later);
    expect(words(later)).toContain(T.listen.join);
    expect(words(later)).not.toContain(T.listen.later);
  });

  it("says when you are in that room, or that it is over, with nothing to go in at", () => {
    const inIt = sheet([invited("in")], [], "friends");
    expect(read(inIt).text).toContain(T.inbox.listen.in);
    expect(words(inIt)).toContain(T.inbox.listen.go);
    expect(words(inIt)).not.toContain(T.listen.join);
    const over = sheet([invited("over")], [], "friends");
    expect(read(over).text).toContain(T.inbox.listen.over);
    for (const w of [T.listen.join, T.listen.later, T.inbox.listen.go]) expect(words(over)).not.toContain(w);
  });
});

const squadInvited = (state: "open" | "later" | "in" | "over", room: SquadCall["state"] = "open"): InboxItem => ({
  kind: "squadInvite",
  id: "qi:1",
  at: Date.now() - 60_000,
  seen: false,
  from: DR_A,
  friendId: "f:a",
  call: { state: room, n: room === "open" ? 2 : room === "full" ? 4 : 0, server: "bili", level: 4 },
  state,
  until: Date.now() + 29 * 60_000,
  replied: true,
});

describe("an invitation to 一起卫戍 in 消息", () => {
  it("names the room's 难度 and server, and offers 进去 and 下次吧 while it is good; after 下次吧 still 进去", () => {
    const open = sheet([squadInvited("open")], [drA()], "friends");
    expect(read(open).text).toContain(fmt(T.inbox.squad.invite, { who: "Dr. A" }));
    expect(read(open).text).toContain(fmt(T.squad.call.line.open, { level: T.squad.levels[3], server: "B服", n: 2, max: 4 }));
    expect(words(open)).toEqual(expect.arrayContaining([T.squad.call.go, T.squad.call.later, T.common.seeThem]));
    const later = sheet([squadInvited("later")], [drA()], "friends");
    expect(read(later).text).toContain(T.inbox.squad.later);
    expect(words(later)).toContain(T.squad.call.go);
    expect(words(later)).not.toContain(T.squad.call.later);
  });

  it("says a full room is full and one playing is playing, with no 进去; in it, 回房间; over, nothing", () => {
    const full = sheet([squadInvited("open", "full")], [], "friends");
    expect(read(full).text).toContain(fmt(T.squad.call.line.full, { level: T.squad.levels[3], server: "B服" }));
    expect(words(full)).not.toContain(T.squad.call.go);
    const playing = sheet([squadInvited("open", "playing")], [], "friends");
    expect(read(playing).text).toContain(fmt(T.squad.call.line.playing, { level: T.squad.levels[3], server: "B服" }));
    expect(words(playing)).not.toContain(T.squad.call.go);
    const inIt = sheet([squadInvited("in", "in")], [], "friends");
    expect(read(inIt).text).toContain(T.inbox.squad.in);
    expect(words(inIt)).toContain(T.squad.call.back);
    for (const w of [T.squad.call.go, T.squad.call.later]) expect(words(inIt)).not.toContain(w);
    const over = sheet([squadInvited("over", "over")], [], "friends");
    expect(read(over).text).toContain(T.inbox.squad.over);
    for (const w of [T.squad.call.go, T.squad.call.later, T.squad.call.back]) expect(words(over)).not.toContain(w);
  });
});

describe("a 宣言招人 in 消息", () => {
  const call = (state: SquadCall["state"]): InboxItem => ({
    ...(declared({ template: "squad", server: "cn", level: 3, need: 2, room: null }) as Extract<InboxItem, { kind: "declaration" }>),
    squad: { state, n: state === "open" ? 2 : 0, server: "cn", level: 3 },
  });
  it("shows its room as it is now, with 进房间 while open and 回房间 once you are in it", () => {
    const open = sheet([call("open")]);
    expect(read(open).text).toContain(fmt(T.squad.call.line.open, { level: T.squad.levels[2], server: "官服", n: 2, max: 4 }));
    expect(words(open)).toContain(T.squad.call.join);
    const inIt = sheet([call("in")]);
    expect(words(inIt)).toContain(T.squad.call.back);
    expect(words(inIt)).not.toContain(T.squad.call.join);
    const over = sheet([call("over")]);
    expect(read(over).text).toContain(T.squad.call.line.over);
    for (const w of [T.squad.call.join, T.squad.call.back]) expect(words(over)).not.toContain(w);
  });
});

const asking = (state: "open" | "done" | "over", song = "逐星河"): InboxItem => ({
  kind: "listenAsk",
  id: "c:7",
  at: Date.now() - 60_000,
  seen: false,
  from: DR_A,
  friendId: "f:a",
  song,
  state,
  replied: state !== "open",
});

describe("a 想一起听 in 消息", () => {
  it("offers 一起听 while it is good today, with the song TA heard you play", () => {
    const html = sheet([asking("open")], [drA()], "friends");
    expect(read(html).text).toContain(fmt(T.inbox.listen.ask, { who: "Dr. A", song: "逐星河" }));
    expect(read(html).text).toContain(T.inbox.listen.askOpen);
    expect(words(html)).toEqual(expect.arrayContaining([T.listen.join, T.common.seeThem]));
  });

  it("says once you invited TA, or that the day is over, with nothing to press but 看看 TA", () => {
    for (const [state, said] of [["done", T.inbox.listen.askDone], ["over", T.inbox.listen.askOver]] as const) {
      const html = sheet([asking(state)], [drA()], "friends");
      expect(read(html).text).toContain(said);
      expect(words(html)).not.toContain(T.listen.join);
      expect(words(html)).toContain(T.common.seeThem);
    }
  });

  it("asks without a song when it has none, and offers no 看看 TA once TA is no longer a 触须之交", () => {
    const html = sheet([asking("open", "")], [], "friends");
    expect(read(html).text).toContain(fmt(T.inbox.listen.askNoSong, { who: "Dr. A" }));
    expect(words(html)).toContain(T.listen.join);
    expect(words(html)).not.toContain(T.common.seeThem);
  });
});

/** Dr. A listening to 逐星河, asked already or not */
const hearingA = (asked: boolean): Friend => ({ ...drA(), listening: { song: "s:1", name: "逐星河", asked } });
/** The row's own button, the one that opens TA */
const rowButton = (html: string) => /<button class="list-row friend-row"[^>]*>(.*?)<\/button>/.exec(html)?.[1] ?? "";

describe("a 触须之交 listening, in 触须之交's list", () => {
  it("says what TA is listening to, with 想一起听 beside the row, not inside its button", () => {
    const html = sheet([], [hearingA(false)], "friends", { listenAsk: nothing });
    expect(read(html).text).toContain(fmt(T.inbox.friendRow.hearing, { song: "逐星河" }));
    expect(read(html).buttons).toContainEqual([T.friendActs.ask, false]);
    expect(rowButton(html)).toContain(fmt(T.inbox.friendRow.hearing, { song: "逐星河" }));
    expect(rowButton(html)).not.toContain("hear-ask");
    expect(html).toMatch(/<div class="friend-row-wrap"><button class="list-row friend-row"/);
  });

  it("greys 想一起听 once you asked today", () => {
    expect(read(sheet([], [hearingA(true)], "friends", { listenAsk: nothing })).buttons).toContainEqual([T.friendActs.asked, true]);
  });

  it("offers no 想一起听 while 听歌 is not shown, and says nothing of a 触须之交 not listening", () => {
    expect(words(sheet([], [hearingA(false)], "friends"))).not.toContain(T.friendActs.ask);
    const quiet = sheet([], [drA()], "friends", { listenAsk: nothing });
    expect(read(quiet).text).not.toContain("♪");
    expect(words(quiet)).not.toContain(T.friendActs.ask);
    expect(quiet).not.toContain("friend-row-wrap");
  });
});
