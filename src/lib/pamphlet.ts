import { fmt, T } from "@/i18n";
import { beijingDate } from "./beijing";
import type { ChangeRow } from "./changelog";
import { logDays, type LogLine } from "./changelogView";
import { findLine, lineIsOn } from "./events";
import type { PublicNotice } from "./notices";

/**
 * 最近更新 (src/components/app/Pamphlet.tsx): a booklet of what is new, a page for each change after a cover.
 * It is a notice the page adds itself, stored nowhere: the board lists it among the others by its day, and it
 * pops up once on each device as those do (src/lib/notices.ts), though for 30 days rather than 7, and only for
 * players who signed up before it came. Read or not is kept on the device, with the other notices.
 */

const DAY = 86_400_000;

/** Its id among the notices */
export const PAMPHLET_ID = "pamphlet-1";
/** When it came: 00:00 in Beijing on the day it was written */
export const PAMPHLET_1_FROM = Date.parse("2026-11-13T00:00:00+08:00");
/** New, with the red dot, the strip and popping up, for this long */
export const PAMPHLET_FRESH_MS = 30 * DAY;

export type PamphletPage = "cover" | "ui" | "mains" | "inbox" | "si" | "badges" | "friends" | "styles" | "login" | "notice";
/** A page after the cover, each about one change */
export type UpdatePage = Exclude<PamphletPage, "cover">;

const UPDATES: readonly UpdatePage[] = ["ui", "mains", "inbox", "si", "badges", "friends", "styles", "login", "notice"];

/** Its pages in order: the cover, then the changes; 界面's only while players may pick one (UI_CHOICE) */
export const pamphletPages = (uiChoice: boolean): PamphletPage[] => ["cover", ...UPDATES.filter((p) => uiChoice || p !== "ui")];

/** A page's number as it shows, counted as the pages come: 01 for the first after the cover */
export const pageNo = (i: number) => String(i).padStart(2, "0");

/** How many changes it holds, in words: 九 */
export const countWord = (n: number) => T.pamphlet.counts[n] ?? String(n);

/** The open book's cover says how many changes there are: 「一共 9 样，一页一样。……」 */
export const coverCount = (pages: readonly PamphletPage[]) => fmt(T.pamphlet.cover.count, { n: pages.length - 1 });

export const isPamphlet = (n: { id: string }) => n.id === PAMPHLET_ID;

/** Its row on the board: opened, the booklet opens, so there are no words of a notice */
export function pamphletNotice(uiChoice: boolean): PublicNotice {
  return {
    id: PAMPHLET_ID,
    title: T.pamphlet.rowTitle,
    body: "",
    pop: "once",
    pinned: false,
    publishedAt: PAMPHLET_1_FROM,
    excerpt: fmt(T.pamphlet.rowSub, { n: countWord(pamphletPages(uiChoice).length - 1) }),
    freshMs: PAMPHLET_FRESH_MS,
  };
}

/** The notices with it among them, in the server's order (src/lib/server/notices.ts): pinned first, then the newest */
export function withPamphlet(list: PublicNotice[], pamphlet: PublicNotice): PublicNotice[] {
  const after = (n: PublicNotice) =>
    !n.pinned && (n.publishedAt < pamphlet.publishedAt || (n.publishedAt === pamphlet.publishedAt && n.id > pamphlet.id));
  const i = list.findIndex(after);
  return i < 0 ? [...list, pamphlet] : [...list.slice(0, i), pamphlet, ...list.slice(i)];
}

/**
 * Whether it may pop up on this visit for a player who signed up then (joinedAt; null, a visitor who has not
 * signed in, never): one from before it came, within its 30 days; not during the tutorial, nor while the site is
 * gray, which leave it for a later visit. Whether this device has read it, and whether another notice comes first,
 * noticeToPop says.
 */
export function pamphletMayPop(joinedAt: number | null, now: number, held: { tutorial: boolean; gray: boolean }) {
  return (
    joinedAt !== null &&
    joinedAt < PAMPHLET_1_FROM &&
    now >= PAMPHLET_1_FROM &&
    now - PAMPHLET_1_FROM < PAMPHLET_FRESH_MS &&
    !held.tutorial &&
    !held.gray
  );
}

/** What may pop up on opening the map or signing in: the server's notices, with the booklet when it may */
export const mayPopAmong = (list: PublicNotice[], mayPop: boolean, uiChoice: boolean) =>
  mayPop ? withPamphlet(list, pamphletNotice(uiChoice)) : list;

// ---- its pages ----

/** A page's words: its kicker (「01 · 界面」), title, 祀掌柜's own words on hers, and its lines */
export type PageText = { kicker: string; title: string; quote: string | null; lines: string[] };

/**
 * 缘缘庄's limited declaration and the day (Beijing) it can last be sent, while it can be sent
 * (src/lib/events.ts); null after
 */
export function innLine(now: number): { text: string; m: number; d: number } | null {
  const found = findLine("yuanyuan");
  if (!found || !lineIsOn(found.line, now)) return null;
  const [, m, d] = beijingDate(Date.parse(found.line.end) - 1).split("-").map(Number);
  return { text: found.line.text, m, d };
}

export function pageText(page: UpdatePage, no: string, now: number): PageText {
  const w = T.pamphlet.pages[page];
  const lines: string[] = [...w.lines];
  const inn = page === "si" ? innLine(now) : null;
  if (inn) lines.push(fmt(T.pamphlet.pages.si.line, { line: inn.text, m: inn.m, d: inn.d }));
  return { kicker: fmt(T.pamphlet.kicker, { no, name: w.name }), title: w.title, quote: page === "si" ? T.pamphlet.pages.si.quote : null, lines };
}

/** A line's pieces: those written between ** and ** go under the marker */
export const markedParts = (line: string) =>
  line
    .split("**")
    .map((text, i) => ({ text, marked: i % 2 === 1 }))
    .filter((p) => p.text);

/** Where a page's button takes the player */
export type PamphletAction = "ui" | "mains" | "inbox" | "si" | "badges" | "friends" | "styles" | "password";

type Pressable = Exclude<UpdatePage, "notice">;
/** Each page's button, and whether it needs an account */
const BUTTONS: Record<Pressable, { action: PamphletAction; account: boolean }> = {
  ui: { action: "ui", account: false },
  mains: { action: "mains", account: true },
  inbox: { action: "inbox", account: true },
  si: { action: "si", account: false },
  badges: { action: "badges", account: true },
  friends: { action: "friends", account: true },
  styles: { action: "styles", account: false },
  login: { action: "password", account: true },
};

/** Who reads it: signed in or not; asked first to say they are 18 or to agree again; whether they have a password (null: not known) */
export type Reader = { signedIn: boolean; asking: boolean; passwordSet: boolean | null };

/**
 * A page's button, if it has one for this reader: none on the visit that first asks for the age question or
 * the new privacy policy, nor for visitors where it needs an account; 去设密码 shows 已经设好了, greyed, once a
 * password is set
 */
export function pageButton(page: PamphletPage, who: Reader): { action: PamphletAction; label: string; done: boolean } | null {
  if (page === "cover" || page === "notice") return null;
  const b = BUTTONS[page];
  if (who.asking || (b.account && !who.signedIn)) return null;
  const done = page === "login" && who.passwordSet === true;
  return { action: b.action, label: done ? T.pamphlet.pages.login.done : T.pamphlet.pages[page].action, done };
}

/** The change log's newest lines as 更新记录 shows them (changelogView.ts): numbered from the oldest, vague runs folded */
export function newestLines(rows: readonly ChangeRow[], n: number): LogLine[] {
  const out: LogLine[] = [];
  for (const day of logDays(rows)) {
    for (const l of day.lines) {
      if (out.length === n) return out;
      out.push(l);
    }
  }
  return out;
}

// ---- the visit it pops up on ----

/**
 * Whether the hints (画风's, 设个密码, 存到桌面's bubble) may come: not over the booklet, nor at all on a visit it
 * popped up on by itself, which has said enough; the next visit has them as before
 */
export const hintsMayCome = (open: boolean, poppedThisVisit: boolean) => !open && !poppedThisVisit;

/**
 * Whether a button pressed in it may now take the player where it said: once what waited for the booklet has
 * had its turn, one thing at a time as ever: the age question, the new privacy policy, 欢迎回家 and 消息 (sheets
 * and cards), the main roach waking, 佩丽卡's notes (消息 can wait for them), and the visit's first panels
 */
export const actionMayRun = (now: { open: boolean; board: boolean; panel: boolean; scene: boolean; notes: boolean; settled: boolean }) =>
  !now.open && !now.board && !now.panel && !now.scene && !now.notes && now.settled;
