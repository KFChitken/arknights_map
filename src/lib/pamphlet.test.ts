import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Pamphlet from "@/components/app/Pamphlet";
import { T } from "@/i18n";
import { CHANGELOG } from "./changelog";
import { logDays } from "./changelogView";
import { findLine } from "./events";
import { EMPTY_MEMORY, FRESH_MS, isNew, noticeDot, noticeRead, noticeToPop, stripNotice, type NoticePop, type PublicNotice } from "./notices";
import {
  actionMayRun,
  countWord,
  coverCount,
  hintsMayCome,
  innLine,
  markedParts,
  mayPopAmong,
  newestLines,
  PAMPHLET_1_FROM,
  PAMPHLET_FRESH_MS,
  PAMPHLET_ID,
  pageButton,
  pageNo,
  pageText,
  pamphletMayPop,
  pamphletNotice,
  pamphletPages,
  withPamphlet,
  type Reader,
  type UpdatePage,
} from "./pamphlet";

const DAY = 86_400_000;
/** A few days after it came */
const NOW = PAMPHLET_1_FROM + 3 * DAY;
const BEFORE = PAMPHLET_1_FROM - 40 * DAY;
const free = { tutorial: false, gray: false };

const notice = (id: string, pop: NoticePop, publishedAt: number, pinned = false): PublicNotice => ({
  id,
  title: id,
  body: id,
  pop,
  pinned,
  publishedAt,
  excerpt: id,
});
const welcome = notice("welcome", "every", PAMPHLET_1_FROM - 20 * DAY, true);

/** What pops up on opening the map for a player who signed up then, as MapApp asks */
const popsUp = (joinedAt: number | null, list: PublicNotice[], seen = EMPTY_MEMORY, now = NOW, held = free) =>
  noticeToPop(mayPopAmong(list, pamphletMayPop(joinedAt, now, held), true), seen, now)?.id ?? null;

describe("when the booklet pops up", () => {
  it("is within its 30 days, to the millisecond", () => {
    expect(PAMPHLET_FRESH_MS).toBe(30 * DAY);
    expect(PAMPHLET_1_FROM).toBe(Date.parse("2026-11-13T00:00:00+08:00"));
    expect(pamphletMayPop(BEFORE, PAMPHLET_1_FROM - 1, free)).toBe(false);
    expect(pamphletMayPop(BEFORE, PAMPHLET_1_FROM, free)).toBe(true);
    expect(pamphletMayPop(BEFORE, PAMPHLET_1_FROM + 30 * DAY - 1, free)).toBe(true);
    expect(pamphletMayPop(BEFORE, PAMPHLET_1_FROM + 30 * DAY, free)).toBe(false);
    // and as a notice it is new as long, popping up, with the red dot, the strip and 「新」
    const p = pamphletNotice(true);
    expect(isNew(p, EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY - 1)).toBe(true);
    expect(isNew(p, EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY)).toBe(false);
    expect(popsUp(BEFORE, [welcome], EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY - 1)).toBe(PAMPHLET_ID);
    expect(popsUp(BEFORE, [welcome], EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY)).toBe("welcome");
    expect(noticeDot([p], EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY - 1)).toBe(true);
    expect(noticeDot([p], EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY)).toBe(false);
    expect(stripNotice([p], EMPTY_MEMORY, PAMPHLET_1_FROM + 29 * DAY)?.id).toBe(PAMPHLET_ID);
    expect(stripNotice([p], EMPTY_MEMORY, PAMPHLET_1_FROM + 30 * DAY)).toBeNull();
  });

  it("leaves the other notices their 7 days", () => {
    const other = notice("other", "once", PAMPHLET_1_FROM);
    const later = PAMPHLET_1_FROM + FRESH_MS;
    expect(isNew(other, EMPTY_MEMORY, later - 1)).toBe(true);
    expect(isNew(other, EMPTY_MEMORY, later)).toBe(false);
    expect(isNew(pamphletNotice(true), EMPTY_MEMORY, later)).toBe(true);
    expect(stripNotice(withPamphlet([other], pamphletNotice(true)), EMPTY_MEMORY, later)?.id).toBe(PAMPHLET_ID);
  });

  it("is for players who signed up before it came", () => {
    expect(pamphletMayPop(PAMPHLET_1_FROM - 1, NOW, free)).toBe(true);
    expect(pamphletMayPop(PAMPHLET_1_FROM, NOW, free)).toBe(false);
    expect(pamphletMayPop(PAMPHLET_1_FROM + 1, NOW, free)).toBe(false);
    expect(popsUp(PAMPHLET_1_FROM, [welcome])).toBe("welcome");
    // the board has it for them all the same
    expect(withPamphlet([welcome], pamphletNotice(true)).map((n) => n.id)).toEqual(["welcome", PAMPHLET_ID]);
  });

  it("never for a visitor, who has the red dot and the strip", () => {
    expect(pamphletMayPop(null, NOW, free)).toBe(false);
    expect(mayPopAmong([welcome], false, true)).toEqual([welcome]);
    const board = withPamphlet([welcome], pamphletNotice(true));
    expect(noticeDot(board, EMPTY_MEMORY, NOW)).toBe(true);
    expect(stripNotice(board, EMPTY_MEMORY, NOW)?.id).toBe(PAMPHLET_ID);
  });

  it("once on each device: read, never again", () => {
    expect(popsUp(BEFORE, [welcome])).toBe(PAMPHLET_ID);
    expect(popsUp(BEFORE, [welcome], noticeRead(EMPTY_MEMORY, PAMPHLET_ID))).toBe("welcome");
    expect(popsUp(BEFORE, [], noticeRead(EMPTY_MEMORY, PAMPHLET_ID))).toBeNull();
  });

  it("after a newer notice that pops up once, on the next visit; before an older one", () => {
    const newer = notice("newer", "once", PAMPHLET_1_FROM + DAY);
    const older = notice("older", "once", PAMPHLET_1_FROM - DAY);
    expect(popsUp(BEFORE, [welcome, newer])).toBe("newer");
    expect(popsUp(BEFORE, [welcome, newer], noticeRead(EMPTY_MEMORY, "newer"))).toBe(PAMPHLET_ID);
    expect(popsUp(BEFORE, [welcome, older])).toBe(PAMPHLET_ID);
  });

  it("instead of the welcome notice, which pops up on every visit", () => {
    expect(popsUp(BEFORE, [welcome])).toBe(PAMPHLET_ID);
    // one a visit: with it read, the welcome notice comes again on the next
    expect(popsUp(BEFORE, [welcome], noticeRead(EMPTY_MEMORY, PAMPHLET_ID))).toBe("welcome");
  });

  it("not during the tutorial nor while the site is gray, and on a visit after", () => {
    expect(popsUp(BEFORE, [welcome], EMPTY_MEMORY, NOW, { tutorial: true, gray: false })).toBe("welcome");
    expect(popsUp(BEFORE, [welcome], EMPTY_MEMORY, NOW, { tutorial: false, gray: true })).toBe("welcome");
    // nothing was read meanwhile
    expect(popsUp(BEFORE, [welcome], EMPTY_MEMORY, NOW + DAY)).toBe(PAMPHLET_ID);
  });
});

describe("its row on the board", () => {
  it("is the booklet's, with the day it came, among the others by time", () => {
    const p = pamphletNotice(true);
    expect(p).toMatchObject({ id: PAMPHLET_ID, title: "最近更新 · 第 1 期", pop: "once", pinned: false, publishedAt: PAMPHLET_1_FROM });
    expect(p.excerpt).toBe("11 月 9 日以来的九样，滑着看");
    const pinned = notice("pinned", "none", PAMPHLET_1_FROM - 9 * DAY, true);
    const newer = notice("newer", "none", PAMPHLET_1_FROM + DAY);
    const older = notice("older", "none", PAMPHLET_1_FROM - DAY);
    const same = notice("same", "none", PAMPHLET_1_FROM);
    expect(withPamphlet([pinned, newer, same, older], p).map((n) => n.id)).toEqual(["pinned", "newer", PAMPHLET_ID, "same", "older"]);
    expect(withPamphlet([], p)).toEqual([p]);
    expect(withPamphlet([pinned], p).map((n) => n.id)).toEqual(["pinned", PAMPHLET_ID]);
  });
});

describe("its pages", () => {
  it("are the cover and nine changes, numbered as they show", () => {
    const pages = pamphletPages(true);
    expect(pages).toEqual(["cover", "ui", "mains", "inbox", "si", "badges", "friends", "styles", "login", "notice"]);
    expect(pageText("ui", pageNo(1), NOW).kicker).toBe("01 · 界面");
    expect(pageText("notice", pageNo(9), NOW).kicker).toBe("09 · 公告");
    expect(coverCount(pages)).toBe("一共 9 样，一页一样。中途关掉也行，以后在「公告」里还能再翻。");
  });

  it("leave out 界面's while players may not pick one (UI_CHOICE=off), the others moving up", () => {
    const pages = pamphletPages(false);
    expect(pages).toEqual(["cover", "mains", "inbox", "si", "badges", "friends", "styles", "login", "notice"]);
    expect(pageText(pages[1] as UpdatePage, pageNo(1), NOW).kicker).toBe("01 · 只看本体");
    expect(pageText(pages[8] as UpdatePage, pageNo(8), NOW).kicker).toBe("08 · 公告");
    expect(coverCount(pages)).toMatch(/^一共 8 样，/);
    expect(pamphletNotice(false).excerpt).toBe("11 月 9 日以来的八样，滑着看");
    expect(countWord(12)).toBe("12");
  });

  it("say 缘缘庄's limited declaration until it can no longer be sent, to the day it ends in Beijing", () => {
    const line = findLine("yuanyuan")!.line;
    const end = Date.parse(line.end);
    const on = pageText("si", "04", end - 1);
    expect(on.quote).toBe("有空就来碰我一下，顺手给你盖个章。");
    expect(on.lines).toHaveLength(3);
    expect(on.lines[2]).toBe("限定宣言「才...才不想和祀住进缘缘庄呢！」还能发到 11 月 26 日。");
    expect(innLine(end - 1)).toEqual({ text: line.text, m: 11, d: 26 });
    const off = pageText("si", "04", end);
    expect(off.lines).toHaveLength(2);
    expect(off.lines.join("")).not.toContain("限定宣言");
    expect(innLine(end)).toBeNull();
    // the others have no quote
    expect(pageText("badges", "05", NOW).quote).toBeNull();
  });

  it("mark what the design marks", () => {
    expect(markedParts("红数字**只数找你的**：碰你的")).toEqual([
      { text: "红数字", marked: false },
      { text: "只数找你的", marked: true },
      { text: "：碰你的", marked: false },
    ]);
    expect(markedParts("**「界面」**")).toEqual([{ text: "「界面」", marked: true }]);
    // every line closes what it marks
    for (const p of pamphletPages(true).slice(1) as UpdatePage[])
      for (const l of pageText(p, "01", NOW).lines) expect(l.split("**").length % 2, l).toBe(1);
  });

  it("show 更新记录's newest lines as its tab numbers and folds them", () => {
    const want = logDays(CHANGELOG).flatMap((d) => d.lines).slice(0, 3);
    expect(newestLines(CHANGELOG, 3)).toEqual(want);
    expect(newestLines(CHANGELOG, 3)[0]).toMatchObject({ hi: CHANGELOG.length, text: CHANGELOG[0].text });
    // a run of 后台调整 is one line
    const rows = [
      { date: "2026-11-13", kind: "chore", text: "后台调整" },
      { date: "2026-11-13", kind: "chore", text: "后台调整" },
      { date: "2026-11-12", kind: "new", text: "新东西" },
    ] as const;
    expect(newestLines(rows, 3)).toEqual([
      { lo: 2, hi: 3, kind: "chore", text: "后台调整", vague: true },
      { lo: 1, hi: 1, kind: "new", text: "新东西", vague: false },
    ]);
  });
});

describe("its buttons", () => {
  const player: Reader = { signedIn: true, asking: false, passwordSet: false };
  const visitor: Reader = { signedIn: false, asking: false, passwordSet: null };

  it("take a player to each change, but for the cover and the last page", () => {
    expect(pageButton("cover", player)).toBeNull();
    expect(pageButton("notice", player)).toBeNull();
    const to = Object.fromEntries((["ui", "mains", "inbox", "si", "badges", "friends", "styles", "login"] as const).map((p) => [p, pageButton(p, player)]));
    expect(to.ui).toEqual({ action: "ui", label: "换个界面", done: false });
    expect(to.mains).toEqual({ action: "mains", label: "试试只看本体", done: false });
    expect(to.inbox).toEqual({ action: "inbox", label: "打开消息", done: false });
    expect(to.si).toEqual({ action: "si", label: "去宏村看看", done: false });
    expect(to.badges).toEqual({ action: "badges", label: "看看我的称号", done: false });
    expect(to.friends).toEqual({ action: "friends", label: "打开触须之交", done: false });
    expect(to.styles).toEqual({ action: "styles", label: "换个画风", done: false });
    expect(to.login).toEqual({ action: "password", label: "去设密码", done: false });
  });

  it("leave a visitor those that need an account", () => {
    for (const p of ["mains", "inbox", "badges", "friends", "login"] as const) expect(pageButton(p, visitor), p).toBeNull();
    for (const p of ["ui", "si", "styles"] as const) expect(pageButton(p, visitor), p).not.toBeNull();
  });

  it("say a password is set, greyed, and 去设密码 while that is not known", () => {
    expect(pageButton("login", { ...player, passwordSet: true })).toEqual({ action: "password", label: "已经设好了", done: true });
    expect(pageButton("login", { ...player, passwordSet: null })?.label).toBe("去设密码");
  });

  it("are none on the visit that first asks for the age question or the new privacy policy", () => {
    for (const p of pamphletPages(true)) expect(pageButton(p, { ...player, asking: true }), p).toBeNull();
  });
});

describe("the visit it pops up on", () => {
  it("has no hints, over it or after it", () => {
    expect(hintsMayCome(false, false)).toBe(true);
    expect(hintsMayCome(true, false)).toBe(false);
    expect(hintsMayCome(false, true)).toBe(false);
    expect(hintsMayCome(true, true)).toBe(false);
  });

  it("takes a button's player there once what waited has had its turn", () => {
    const quiet = { open: false, board: false, panel: false, scene: false, notes: false, settled: true };
    expect(actionMayRun(quiet)).toBe(true);
    for (const k of ["open", "board", "panel", "scene", "notes"] as const) expect(actionMayRun({ ...quiet, [k]: true }), k).toBe(false);
    expect(actionMayRun({ ...quiet, settled: false })).toBe(false);
  });
});

describe("the booklet", () => {
  const props = {
    uiChoice: true,
    signedIn: true,
    asking: false,
    ui: "drawer" as const,
    mapStyle: "lite" as const,
    onAction: () => {},
    onClose: () => {},
  };
  const html = (p: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(Pamphlet, { ...props, ...p }));
  const count = (s: string, part: string) => s.split(part).length - 1;

  it("is a dialog named 最近更新, opening on its cover with the list of its pages", () => {
    const s = html();
    expect(s).toContain('role="dialog"');
    expect(s).toContain('aria-modal="true"');
    expect(s).toContain(`aria-label="${T.pamphlet.label}"`);
    expect(s).toContain("这几天，地图上多了这些");
    expect(s).toContain("11 月 9 日以来的更新，往左滑，一页一样。");
    for (let i = 1; i <= 9; i++) expect(s).toContain(`<span class="no">${pageNo(i)}</span>`);
    expect(s).toContain("三种界面随你换");
    // every page but the one showing is out of reach
    expect(count(s, 'class="pp-page"')).toBe(10);
    expect(count(s, "inert")).toBe(9);
    // the first page's picture is there, those further on wait
    expect(s).toContain("/ui/phone-drawer.webp");
    expect(s).not.toContain("/map-style-lite.png");
    expect(s).toContain("下一页");
    expect(s).toContain("上一页");
  });

  it("has a page fewer, and no 界面, while players may not pick one", () => {
    const s = html({ uiChoice: false });
    expect(count(s, 'class="pp-page"')).toBe(9);
    expect(s).not.toContain("三种界面随你换");
    expect(s).toContain("01 · 只看本体");
  });

  it("has a visitor's buttons only, and none while the visit asks first", () => {
    const labels = ["换个界面", "试试只看本体", "打开消息", "去宏村看看", "看看我的称号", "打开触须之交", "换个画风", "去设密码"];
    const signedIn = html();
    for (const l of labels) expect(signedIn, l).toContain(l);
    const visitor = html({ signedIn: false });
    for (const l of ["换个界面", "去宏村看看", "换个画风"]) expect(visitor, l).toContain(l);
    for (const l of ["试试只看本体", "打开消息", "看看我的称号", "打开触须之交", "去设密码"]) expect(visitor, l).not.toContain(l);
    const asking = html({ asking: true });
    for (const l of labels) expect(asking, l).not.toContain(`${l}<svg`);
    expect(count(asking, 'class="pp-act"')).toBe(0);
  });

  it("marks what the design marks", () => {
    const s = html();
    expect(s).toContain("<mark>「界面」</mark>");
    expect(s).toContain("<mark>都能收起来</mark>");
    expect(s).not.toContain("**");
  });
});
