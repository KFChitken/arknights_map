import { describe, expect, it } from "vitest";
import { T } from "@/i18n";
import { capCount, dockCounts, firstTab, INBOX_TABS, noticeTitle, tabLabel, tabOf, type InboxTab } from "./inboxTabs";
import type { PublicProfile } from "./profile";
import type { InboxItem } from "./world/types";

const someone: PublicProfile = { displayName: "Dr. A", games: [], favourites: { arknights: [], endfield: [] }, avatar: "hood", color: "cyan" };
const FROM = { from: someone, friendId: "f:1" };

let made = 0;
/** An unread message of a kind, with only what tells it apart filled in */
const item = (kind: InboxItem["kind"], more: Record<string, unknown> = {}) =>
  ({ kind, id: `${kind}:${++made}`, at: 1_800_000_000_000 - made, seen: false, replied: false, ...more }) as InboxItem;
const read = (i: InboxItem): InboxItem => ({ ...i, seen: true });

const nearby = () => item("declaration", { text: "明日方舟，启动！", reaction: null, options: [] });
const birthday = () => item("declaration", { ...FROM, text: "祝我生日快乐！", reaction: null, options: [] });
const touch = () => item("touch", { bold: false, target: "main", from: null, ignored: false });
const reaction = () => item("reaction", { text: "我永远喜欢能天使", reaction: { id: "plus1", text: "+1", own: false } });
const staff = () => item("staff", { text: "你举报的那只蟑螂已经处理了。" });

/** One unread message of each kind (and of each line with a headline of its own): the tab it is in, what the notice says */
const ONE_OF_EACH: [InboxItem, InboxTab, () => string][] = [
  [staff(), "replies", () => T.inbox.headline.staff],
  [item("friend", FROM), "friends", () => T.inbox.headline.friend],
  [item("poke", FROM), "friends", () => T.inbox.headline.poke],
  [item("pokeWoke", FROM), "friends", () => T.inbox.headline.pokeWoke],
  [item("anniversary", { ...FROM, day: 30 }), "friends", () => T.inbox.headline.anniversary],
  [birthday(), "friends", () => T.inbox.headline.birthday],
  [item("visit", { ...FROM, event: "came", tip: false, spot: null, cloneId: null }), "friends", () => T.inbox.headline.visitCame],
  [item("visit", { ...FROM, event: "sentHome", tip: false, spot: null, cloneId: "c:1" }), "friends", () => T.inbox.headline.visit],
  [item("sanity", { ...FROM, asleep: false, answer: null }), "friends", () => T.inbox.headline.sanity],
  [item("gesture", { ...FROM, gesture: "hug", returned: false }), "friends", () => T.inbox.headline.gesture],
  [item("gift", { ...FROM, returned: false }), "friends", () => T.inbox.headline.gift],
  [item("giftsFull", { replied: true }), "friends", () => T.inbox.headline.gift],
  [item("sanityThanks", FROM), "friends", () => T.inbox.headline.thanks],
  [item("game", { ...FROM, event: "added", game: "arknights", server: "", answered: false }), "friends", () => T.inbox.headline.thanks],
  [touch(), "touches", () => T.inbox.headline.touch],
  [item("amiya", { bold: true, greet: false, ignored: false }), "touches", () => T.inbox.headline.amiya],
  [item("perlica"), "touches", () => T.inbox.headline.perlica],
  [item("talulah"), "touches", () => T.inbox.headline.talulah],
  [item("minghe", { line: "trip", stop: 3 }), "touches", () => T.inbox.headline.mingheTrip],
  [item("minghe", { line: "touch" }), "touches", () => T.inbox.headline.minghe],
  [item("si", { line: "checkin" }), "touches", () => T.inbox.headline.siCheckin],
  [item("si", { line: "again" }), "touches", () => T.inbox.headline.siCheckin],
  [item("si", { line: "checkout" }), "touches", () => T.inbox.headline.siCheckout],
  [item("si", { line: "touch" }), "touches", () => T.inbox.headline.si],
  [reaction(), "replies", () => T.inbox.headline.reaction],
  [nearby(), "declarations", () => T.inbox.headline.declaration],
];

describe("消息's tabs", () => {
  it("are 触碰｜回复｜宣言｜触须之交, in that order", () => {
    expect(INBOX_TABS.map(tabLabel)).toEqual(["触碰", "回复", "宣言", "触须之交"]);
  });

  it("put every kind of message in one, and the notice for it alone opens there, saying what it is", () => {
    // every kind there is has its row above (a new kind fails here, and its tab fails to compile in inboxTabs.ts)
    const kinds: Record<InboxItem["kind"], true> = {
      staff: true, touch: true, declaration: true, reaction: true, friend: true, poke: true, pokeWoke: true, sanity: true,
      sanityThanks: true, gesture: true, gift: true, giftsFull: true, visit: true, game: true, anniversary: true, amiya: true,
      perlica: true, talulah: true, minghe: true, si: true,
    };
    expect(new Set(ONE_OF_EACH.map(([i]) => i.kind))).toEqual(new Set(Object.keys(kinds)));
    for (const [message, tab, title] of ONE_OF_EACH) {
      const what = `${message.kind} ${JSON.stringify(message)}`;
      expect(tabOf(message), what).toBe(tab);
      expect(firstTab([message]), what).toBe(tab);
      expect(noticeTitle([message]), what).toBe(title());
      expect(noticeTitle([message]), what).not.toBe(T.inbox.title);
    }
  });

  it("keep a 触须之交's birthday with them, apart from the declarations sent nearby", () => {
    expect(tabOf(birthday())).toBe("friends");
    expect(tabOf(nearby())).toBe("declarations");
    // a reaction to your declaration is a reply, a 触须之交's birthday wish too
    expect(tabOf(item("reaction", { ...FROM, text: "祝我生日快乐！", reaction: { id: "birthday", text: "生日快乐！", own: true } }))).toBe("replies");
  });
});

describe("where 消息 opens by itself, and what its headline says", () => {
  it("goes 站长通知, then 触须之交, 触碰, 回复, 宣言: the headline always about the tab it opens on", () => {
    expect([firstTab([touch(), staff()]), noticeTitle([touch(), staff()])]).toEqual(["replies", "站长给你发了通知"]);
    expect([firstTab([touch(), birthday()]), noticeTitle([touch(), birthday()])]).toEqual(["friends", "有触须之交过生日啦！"]);
    expect([firstTab([reaction(), nearby(), touch()]), noticeTitle([reaction(), nearby(), touch()])]).toEqual(["touches", "你被蟑螂触须碰了一下！"]);
    expect([firstTab([nearby(), reaction()]), noticeTitle([nearby(), reaction()])]).toEqual(["replies", "有舟P回应了你的宣言！"]);
    expect([firstTab([nearby(), nearby()]), noticeTitle([nearby(), nearby()])]).toEqual(["declarations", "附近有舟P发了宣言！"]);
  });

  it("opens on 触碰 when everything is read, under the plain title", () => {
    const all = [read(staff()), read(touch()), read(birthday()), read(nearby())];
    expect(firstTab(all)).toBe("touches");
    expect(noticeTitle(all)).toBe("消息");
    expect(firstTab([])).toBe("touches");
    expect(noticeTitle([])).toBe("消息");
  });

  it("goes by what is unread only", () => {
    expect(firstTab([read(staff()), nearby()])).toBe("declarations");
    expect(noticeTitle([read(birthday()), touch()])).toBe("你被蟑螂触须碰了一下！");
  });
});

describe("the envelope at the bottom left", () => {
  it("counts in red what came to you, and only lights the speaker for declarations sent nearby", () => {
    expect(dockCounts([nearby(), nearby(), nearby()])).toEqual({ red: 0, say: true });
    expect(dockCounts([birthday()])).toEqual({ red: 1, say: false });
    expect(dockCounts([reaction(), staff(), touch(), nearby()])).toEqual({ red: 3, say: true });
    expect(dockCounts(ONE_OF_EACH.map(([i]) => i))).toEqual({ red: ONE_OF_EACH.length - 1, say: true });
  });

  it("counts nothing read", () => {
    expect(dockCounts([read(nearby()), read(touch())])).toEqual({ red: 0, say: false });
    expect(dockCounts([])).toEqual({ red: 0, say: false });
  });

  it("writes 99+ from a hundred on", () => {
    expect(capCount(1)).toBe("1");
    expect(capCount(99)).toBe("99");
    expect(capCount(100)).toBe("99+");
    expect(capCount(2048)).toBe("99+");
  });
});
