import { fmt, T } from "@/i18n";
import { beijingDate } from "./beijing";
import type { ChangeRow } from "./changelog";
import { logDays, type LogLine } from "./changelogView";
import { findLine, lineIsOn } from "./events";
import { homeGame } from "./games";
import { HAIMAO_LINES } from "./haimao";
import { LISTEN_DEFAULTS } from "./listen";
import type { PublicNotice } from "./notices";
import type { Me } from "./world/types";

/**
 * 最近更新 (src/components/app/Pamphlet.tsx): a booklet of what is new, a page for each change after a cover.
 * It is a notice the page adds itself, stored nowhere: the board lists it among the others by its day, and it
 * pops up once on each device as those do (src/lib/notices.ts), though for 30 days rather than 7, and only for
 * players who signed up before it came. Read or not is kept on the device, with the other notices.
 *
 * 第 2 期 tells of what came to play, and follows it out: each of its pages is there only for a reader who has that
 * part of the site open (Opened, as the map shows it to them), and the booklet itself only once all five it leads
 * with are (HEADLINERS; 一起卫戍 is never there for one who plays 终末地 alone, so not asked of them). So while they
 * are the 站长's and the admins' alone (SQUAD=admins and the rest), so is it; once they are everyone's, it is
 * everyone's, with nothing else to switch. Once a reader has it, 第 1 期 is an old notice for them, there to read
 * again on the board but new no more, and never popping up.
 */

const DAY = 86_400_000;

/** Its id among the notices */
export const PAMPHLET_ID = "pamphlet-1";
/** When it came: 00:00 in Beijing on the day it was written */
export const PAMPHLET_1_FROM = Date.parse("2026-11-13T00:00:00+08:00");
/** New, with the red dot, the strip and popping up, for this long */
export const PAMPHLET_FRESH_MS = 30 * DAY;
/** 第 2 期's id, and when it came, as 第 1 期's */
export const PAMPHLET_2_ID = "pamphlet-2";
export const PAMPHLET_2_FROM = Date.parse("2026-11-22T00:00:00+08:00");

export type Issue = 1 | 2;

/** 第 1 期's pages after the cover, each about one change */
export type Page1 = "ui" | "mains" | "inbox" | "si" | "badges" | "friends" | "styles" | "login" | "notice";
/** 第 2 期's: 一起卫戍 and its games, 听歌 and its disco, 通行证寻访, 325大学习, 香艳制作人, 钓鳞, the new 我的资料 */
export type Page2 = "squad" | "plays" | "listen" | "disco" | "passes" | "study" | "haimao" | "fish" | "profile";
/** A page after the cover */
export type UpdatePage = Page1 | Page2;
export type PamphletPage = "cover" | UpdatePage;

const UPDATES: readonly Page1[] = ["ui", "mains", "inbox", "si", "badges", "friends", "styles", "login", "notice"];
const UPDATES_2: readonly Page2[] = ["squad", "plays", "listen", "disco", "passes", "study", "haimao", "fish", "profile"];

export const isPage2 = (p: PamphletPage): p is Page2 => (UPDATES_2 as readonly string[]).includes(p);

/** Its pages in order: the cover, then the changes; 界面's only while players may pick one (UI_CHOICE) */
export const pamphletPages = (uiChoice: boolean): PamphletPage[] => ["cover", ...UPDATES.filter((p) => uiChoice || p !== "ui")];

/**
 * What 第 2 期 tells of that the reader has open, each as the map shows it to them: a player as the server says in
 * me() (openedOf), a visitor what is open to everyone (MapApp's allOpen, from page.tsx); none of it on the English
 * site, whose words for them are not written. profile: the new 我的资料 and 我的记录 both. endfield: the reader plays
 * 终末地 alone, so 一起卫戍 (明日方舟's 卫戍协议) never shows to them, open to them or not (server squadShown).
 */
export type Opened = Record<"squad" | "listen" | "disco" | "passes" | "study" | "haimao" | "fish" | "profile" | "endfield", boolean>;
export const OPENED_KEYS = ["squad", "listen", "disco", "passes", "study", "haimao", "fish", "profile", "endfield"] as const satisfies readonly (keyof Opened)[];
export const NONE_OPEN: Opened = {
  squad: false,
  listen: false,
  disco: false,
  passes: false,
  study: false,
  haimao: false,
  fish: false,
  profile: false,
  endfield: false,
};

/** A player's, as me() says: 一起卫戍 (SQUAD), 听歌 (LISTEN) and its disco (DISCO), 寻访 (PASSES), and so on */
export const openedOf = (
  me: Pick<Me, "squad" | "listen" | "passes" | "study" | "haimao" | "fish" | "profile2" | "records"> & { profile: Pick<Me["profile"], "games"> },
): Opened => ({
  squad: Boolean(me.squad),
  listen: Boolean(me.listen),
  disco: me.listen?.disco === true,
  passes: Boolean(me.passes),
  study: Boolean(me.study),
  haimao: Boolean(me.haimao),
  fish: Boolean(me.fish),
  profile: me.profile2 && me.records,
  endfield: homeGame(me.profile.games) === "endfield",
});

/** The same in a word of 0s and 1s, to tell when it changes (a page's me() changes far more often) */
export const openedKey = (o: Opened) => OPENED_KEYS.map((k) => (o[k] ? "1" : "0")).join("");
export const openedOfKey = (key: string): Opened =>
  Object.fromEntries(OPENED_KEYS.map((k, i) => [k, key[i] === "1"])) as Opened;

/**
 * The five 第 2 期 leads with, as the promo has them: it is the reader's once all five are open to them, 一起卫戍
 * left out for one who plays 终末地 alone
 */
export const HEADLINERS = ["squad", "listen", "passes", "study", "haimao"] as const satisfies readonly (keyof Opened)[];
export const issue2Ready = (o: Opened) => HEADLINERS.every((k) => o[k] || (k === "squad" && o.endfield));

/** What each of 第 2 期's pages needs open: the games are in 一起卫戍's rooms, the disco goes with 听歌 */
const NEEDS: Record<Page2, (o: Opened) => boolean> = {
  squad: (o) => o.squad,
  plays: (o) => o.squad,
  listen: (o) => o.listen,
  disco: (o) => o.listen && o.disco,
  passes: (o) => o.passes,
  study: (o) => o.study,
  haimao: (o) => o.haimao,
  fish: (o) => o.fish,
  profile: (o) => o.profile,
};

/** 第 2 期's pages for a reader: the cover, then those open to them, the others leaving no gap */
export const issue2Pages = (o: Opened): PamphletPage[] => ["cover", ...UPDATES_2.filter((p) => NEEDS[p](o))];

/** An issue's pages for a reader */
export const issuePages = (issue: Issue, uiChoice: boolean, o: Opened) => (issue === 2 ? issue2Pages(o) : pamphletPages(uiChoice));

/** A page's number as it shows, counted as the pages come: 01 for the first after the cover */
export const pageNo = (i: number) => String(i).padStart(2, "0");

/** How many changes it holds, in words: 九 */
export const countWord = (n: number) => T.pamphlet.counts[n] ?? String(n);

/** The open book's cover says how many changes there are: 「一共 9 样，一页一样。……」 */
export const coverCount = (pages: readonly PamphletPage[]) => fmt(T.pamphlet.cover.count, { n: pages.length - 1 });

/** Either issue among the notices */
export const isPamphlet = (n: { id: string }) => n.id === PAMPHLET_ID || n.id === PAMPHLET_2_ID;
/** Which, of one that is */
export const issueOf = (n: { id: string }): Issue => (n.id === PAMPHLET_2_ID ? 2 : 1);

/**
 * Its row on the board: opened, the booklet opens, so there are no words of a notice. later: 第 2 期 is the reader's,
 * so this one is new only until that came, which is to say no more
 */
export function pamphletNotice(uiChoice: boolean, later = false): PublicNotice {
  return {
    id: PAMPHLET_ID,
    title: T.pamphlet.rowTitle,
    body: "",
    pop: "once",
    pinned: false,
    publishedAt: PAMPHLET_1_FROM,
    excerpt: fmt(T.pamphlet.rowSub, { n: countWord(pamphletPages(uiChoice).length - 1) }),
    freshMs: later ? PAMPHLET_2_FROM - PAMPHLET_1_FROM : PAMPHLET_FRESH_MS,
  };
}

/** 第 2 期's row, counting the pages the reader has */
export function pamphlet2Notice(o: Opened): PublicNotice {
  return {
    id: PAMPHLET_2_ID,
    title: T.pamphlet.two.rowTitle,
    body: "",
    pop: "once",
    pinned: false,
    publishedAt: PAMPHLET_2_FROM,
    excerpt: fmt(T.pamphlet.two.rowSub, { n: countWord(issue2Pages(o).length - 1) }),
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
export const pamphletMayPop = (joinedAt: number | null, now: number, held: Held) => mayPopFrom(PAMPHLET_1_FROM, joinedAt, now, held);

/** 第 2 期, the same from the day it came, for a reader who has it */
export const issue2MayPop = (joinedAt: number | null, now: number, held: Held, o: Opened) =>
  issue2Ready(o) && mayPopFrom(PAMPHLET_2_FROM, joinedAt, now, held);

type Held = { tutorial: boolean; gray: boolean };

const mayPopFrom = (from: number, joinedAt: number | null, now: number, held: Held) =>
  joinedAt !== null && joinedAt < from && now >= from && now - from < PAMPHLET_FRESH_MS && !held.tutorial && !held.gray;

/**
 * What may pop up on opening the map or signing in: the server's notices, with the booklet when it may. two: for a
 * reader who has 第 2 期 (issue2Ready), that one when it may, and 第 1 期 never
 */
export function mayPopAmong(list: PublicNotice[], mayPop: boolean, uiChoice: boolean, two?: { mayPop: boolean; opened: Opened }) {
  if (two && issue2Ready(two.opened)) return two.mayPop ? withPamphlet(list, pamphlet2Notice(two.opened)) : list;
  return mayPop ? withPamphlet(list, pamphletNotice(uiChoice)) : list;
}

/**
 * The notices as the board, the red dot and the strip have them: the server's, with 第 1 期 among them, and 第 2 期
 * once it is the reader's (第 1 期 new no more then)
 */
export function withBooklets(list: PublicNotice[], uiChoice: boolean, o: Opened): PublicNotice[] {
  const two = issue2Ready(o);
  const withOne = withPamphlet(list, pamphletNotice(uiChoice, two));
  return two ? withPamphlet(withOne, pamphlet2Notice(o)) : withOne;
}

// ---- its pages ----

/**
 * A page's words: its kicker (「01 · 界面」), title, 祀掌柜's own words on hers, its lines, and the small print under
 * them (香艳制作人's 「*与鹰角网络无关」, which goes wherever she does)
 */
export type PageText = { kicker: string; title: string; quote: string | null; lines: string[]; note: string | null };

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

/** What a page's words need of the reader: how many one 一起听 holds for them (me().listen.roomMax) */
export type PageFor = { roomMax?: number };

export function pageText(page: UpdatePage, no: string, now: number, forReader: PageFor = {}): PageText {
  if (isPage2(page)) {
    const w = T.pamphlet.two.pages[page];
    const max = forReader.roomMax ?? LISTEN_DEFAULTS.roomMax;
    return {
      kicker: fmt(T.pamphlet.kicker, { no, name: w.name }),
      title: w.title,
      quote: null,
      lines: w.lines.map((l) => (page === "listen" ? fmt(l, { max }) : l)),
      note: page === "haimao" ? HAIMAO_LINES.disclaimer : null,
    };
  }
  const w = T.pamphlet.pages[page];
  const lines: string[] = [...w.lines];
  const inn = page === "si" ? innLine(now) : null;
  if (inn) lines.push(fmt(T.pamphlet.pages.si.line, { line: inn.text, m: inn.m, d: inn.d }));
  return { kicker: fmt(T.pamphlet.kicker, { no, name: w.name }), title: w.title, quote: page === "si" ? T.pamphlet.pages.si.quote : null, lines, note: null };
}

/** A page's title, as the cover's list has it */
export const pageTitle = (page: UpdatePage) => (isPage2(page) ? T.pamphlet.two.pages[page].title : T.pamphlet.pages[page].title);

/** An issue's own words: its name and date, and its cover's; the rest are both's (T.pamphlet) */
export const issueWords = (issue: Issue) => (issue === 2 ? T.pamphlet.two : T.pamphlet);

/** A line's pieces: those written between ** and ** go under the marker */
export const markedParts = (line: string) =>
  line
    .split("**")
    .map((text, i) => ({ text, marked: i % 2 === 1 }))
    .filter((p) => p.text);

/** Where a page's button takes the player: 第 1 期's, then 第 2 期's (the games and the disco to 卫戍 and 听歌) */
export type PamphletAction =
  | "ui"
  | "mains"
  | "inbox"
  | "si"
  | "badges"
  | "friends"
  | "styles"
  | "password"
  | "squad"
  | "listen"
  | "passes"
  | "study"
  | "haimao"
  | "fish"
  | "profile";

type Pressable = Exclude<UpdatePage, "notice">;
/** Each page's button, and whether it needs an account: of 第 2 期's, only 325大学习 and 香艳制作人 are a visitor's too */
const BUTTONS: Record<Pressable, { action: PamphletAction; account: boolean }> = {
  ui: { action: "ui", account: false },
  mains: { action: "mains", account: true },
  inbox: { action: "inbox", account: true },
  si: { action: "si", account: false },
  badges: { action: "badges", account: true },
  friends: { action: "friends", account: true },
  styles: { action: "styles", account: false },
  login: { action: "password", account: true },
  squad: { action: "squad", account: true },
  plays: { action: "squad", account: true },
  listen: { action: "listen", account: true },
  disco: { action: "listen", account: true },
  passes: { action: "passes", account: true },
  study: { action: "study", account: false },
  haimao: { action: "haimao", account: false },
  fish: { action: "fish", account: true },
  profile: { action: "profile", account: true },
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
  const label = isPage2(page) ? T.pamphlet.two.pages[page].action : done ? T.pamphlet.pages.login.done : T.pamphlet.pages[page].action;
  return { action: b.action, label, done };
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
