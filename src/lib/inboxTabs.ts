import { T } from "@/i18n";
import type { InboxItem } from "./world/types";

/**
 * How 消息 is split, what the envelope at the bottom left counts, and where 消息 opens.
 *
 * Four tabs: touches (the guides' too), replies (reactions to your declarations, and 站长通知), declarations
 * sent nearby, and 触须之交 (all they do for each other, 寻访券 they give you included, and a 触须之交's
 * 「祝我生日快乐」, sent to you as one).
 * The red count on the envelope counts what came to you, so everything but the declarations sent nearby;
 * those light a yellow speaker of their own, without a number.
 */

export type InboxTab = "touches" | "replies" | "declarations" | "friends";

/** The tabs, in their order */
export const INBOX_TABS: readonly InboxTab[] = ["touches", "replies", "declarations", "friends"];

/** A tab's name */
export function tabLabel(tab: InboxTab) {
  return tab === "friends" ? T.common.friends : T.inbox.tabs[tab];
}

/** The tab each kind of message is in; a declaration's goes by who sent it (tabOf) */
const TAB_OF: Record<Exclude<InboxItem["kind"], "declaration">, InboxTab> = {
  touch: "touches",
  amiya: "touches",
  perlica: "touches",
  talulah: "touches",
  minghe: "touches",
  si: "touches",
  reaction: "replies",
  staff: "replies",
  friend: "friends",
  poke: "friends",
  pokeWoke: "friends",
  sanity: "friends",
  sanityThanks: "friends",
  gesture: "friends",
  gift: "friends",
  giftsFull: "friends",
  visit: "friends",
  game: "friends",
  anniversary: "friends",
};

/** Which tab a message is in: a declaration with `from` is a 触须之交's birthday, sent to you as one */
export function tabOf(item: InboxItem): InboxTab {
  if (item.kind === "declaration") return item.from ? "friends" : "declarations";
  return TAB_OF[item.kind];
}

/**
 * What came, most pressing first, and what the notice opening 消息 by itself says of it. Both the notice's
 * headline and the tab 消息 opens on come from the first row an unread message matches (that message's tab),
 * so the headline always talks about what the open tab shows.
 */
const NOTICES: { is: (item: InboxItem) => boolean; title: () => string }[] = [
  { is: (i) => i.kind === "staff", title: () => T.inbox.headline.staff },
  { is: (i) => i.kind === "friend", title: () => T.inbox.headline.friend },
  { is: (i) => i.kind === "poke", title: () => T.inbox.headline.poke },
  { is: (i) => i.kind === "pokeWoke", title: () => T.inbox.headline.pokeWoke },
  { is: (i) => i.kind === "anniversary", title: () => T.inbox.headline.anniversary },
  { is: (i) => i.kind === "declaration" && Boolean(i.from), title: () => T.inbox.headline.birthday },
  { is: (i) => i.kind === "visit" && i.event === "came", title: () => T.inbox.headline.visitCame },
  { is: (i) => i.kind === "visit", title: () => T.inbox.headline.visit },
  { is: (i) => i.kind === "sanity", title: () => T.inbox.headline.sanity },
  { is: (i) => i.kind === "gesture", title: () => T.inbox.headline.gesture },
  { is: (i) => i.kind === "gift" || i.kind === "giftsFull", title: () => T.inbox.headline.gift },
  { is: (i) => i.kind === "sanityThanks" || i.kind === "game", title: () => T.inbox.headline.thanks },
  { is: (i) => i.kind === "touch", title: () => T.inbox.headline.touch },
  { is: (i) => i.kind === "amiya", title: () => T.inbox.headline.amiya },
  { is: (i) => i.kind === "perlica", title: () => T.inbox.headline.perlica },
  { is: (i) => i.kind === "talulah", title: () => T.inbox.headline.talulah },
  { is: (i) => i.kind === "minghe" && i.line === "trip", title: () => T.inbox.headline.mingheTrip },
  { is: (i) => i.kind === "minghe", title: () => T.inbox.headline.minghe },
  { is: (i) => i.kind === "si" && (i.line === "checkin" || i.line === "again"), title: () => T.inbox.headline.siCheckin },
  { is: (i) => i.kind === "si" && i.line === "checkout", title: () => T.inbox.headline.siCheckout },
  { is: (i) => i.kind === "si", title: () => T.inbox.headline.si },
  { is: (i) => i.kind === "reaction", title: () => T.inbox.headline.reaction },
  { is: (i) => i.kind === "declaration", title: () => T.inbox.headline.declaration },
];

/** The most pressing unread message, by NOTICES, with what the notice says of it; null when everything is read */
function mostPressing(items: InboxItem[]) {
  const unseen = items.filter((i) => !i.seen);
  for (const n of NOTICES) {
    const item = unseen.find(n.is);
    if (item) return { item, title: n.title };
  }
  return null;
}

/** The tab 消息 opens on by itself: that of the most pressing unread message, else 触碰 */
export function firstTab(items: InboxItem[]): InboxTab {
  const top = mostPressing(items);
  return top ? tabOf(top.item) : "touches";
}

/** Headline for the notice shown when a player opens the map with unseen items: about the tab it opens on (firstTab) */
export function noticeTitle(items: InboxItem[]) {
  return mostPressing(items)?.title() ?? T.inbox.title;
}

/**
 * What the envelope shows: red, how many unread messages came to you (all but declarations sent nearby);
 * say, whether a declaration sent nearby is unread (a yellow speaker, no number).
 */
export function dockCounts(items: InboxItem[]): { red: number; say: boolean } {
  let red = 0;
  let say = false;
  for (const i of items) {
    if (i.seen) continue;
    if (tabOf(i) === "declarations") say = true;
    else red++;
  }
  return { red, say };
}

/** A count as a badge shows it: 99+ from a hundred on */
export const capCount = (n: number) => (n > 99 ? "99+" : String(n));
