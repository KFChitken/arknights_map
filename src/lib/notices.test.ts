import { beforeEach, describe, expect, it } from "vitest";
import {
  boardOpened,
  changeNoticeMemory,
  EMPTY_MEMORY,
  FRESH_MS,
  isNew,
  markPopped,
  noticeDay,
  noticeDot,
  noticeMemory,
  noticeMemoryKept,
  noticeRead,
  noticeToPop,
  poppedThisVisit,
  readNoticeList,
  stripClosed,
  stripNotice,
  type NoticeMemory,
  type NoticePop,
  type PublicNotice,
} from "./notices";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-12T10:00:00+08:00");

const notice = (id: string, pop: NoticePop, daysAgo: number, pinned = false): PublicNotice => ({
  id,
  title: id,
  body: id,
  pop,
  pinned,
  publishedAt: NOW - daysAgo * DAY,
  excerpt: id,
});

const welcome = notice("welcome", "every", 1, true);

/** A browser's storage, for tests in Node */
class Store {
  private map = new Map<string, string>();
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => void this.map.set(k, String(v));
  removeItem = (k: string) => void this.map.delete(k);
  clear = () => this.map.clear();
}

beforeEach(() => {
  Object.assign(globalThis, { localStorage: new Store(), sessionStorage: new Store() });
});

describe("what pops up", () => {
  it("is the newest new one that pops up once, or else the one that pops up on every visit", () => {
    const a = notice("a", "once", 2);
    const b = notice("b", "once", 1);
    expect(noticeToPop([welcome, a, b], EMPTY_MEMORY, NOW)).toBe(b);
    // one at a time: once b was read, a; once both were, the welcome notice
    expect(noticeToPop([welcome, a, b], noticeRead(EMPTY_MEMORY, "b"), NOW)).toBe(a);
    const both = noticeRead(noticeRead(EMPTY_MEMORY, "b"), "a");
    expect(noticeToPop([welcome, a, b], both, NOW)).toBe(welcome);
    // the welcome notice pops up seen or not, and however old
    expect(noticeToPop([{ ...welcome, publishedAt: NOW - 30 * DAY }], noticeRead(EMPTY_MEMORY, "welcome"), NOW)?.id).toBe("welcome");
    expect(noticeToPop([notice("quiet", "none", 0)], EMPTY_MEMORY, NOW)).toBeNull();
    expect(noticeToPop([], EMPTY_MEMORY, NOW)).toBeNull();
  });

  it("is never one from more than 7 days ago that pops up once", () => {
    const old = notice("old", "once", 8);
    expect(noticeToPop([old], EMPTY_MEMORY, NOW)).toBeNull();
    expect(noticeToPop([welcome, old], EMPTY_MEMORY, NOW)).toBe(welcome);
    expect(noticeToPop([{ ...old, publishedAt: NOW - FRESH_MS + 1 }], EMPTY_MEMORY, NOW)?.id).toBe("old");
  });
});

describe("the red dot and the strip", () => {
  it("show what is new until the board is opened, or the strip put away", () => {
    const quiet = notice("quiet", "none", 0);
    const list = [welcome, quiet];
    expect(noticeDot(list, EMPTY_MEMORY, NOW)).toBe(true);
    expect(stripNotice(list, EMPTY_MEMORY, NOW)).toBe(quiet);

    // opening the board puts out the dot and keeps the strip away; 「新」 stays until each is read
    const opened = boardOpened(EMPTY_MEMORY, list, NOW);
    expect(noticeDot(list, opened, NOW)).toBe(false);
    expect(stripNotice(list, opened, NOW)).toBeNull();
    expect(isNew(quiet, opened, NOW)).toBe(true);
    expect(isNew(quiet, noticeRead(opened, "quiet"), NOW)).toBe(false);

    // a newer one lights them again
    const later = notice("later", "none", -0.01);
    expect(noticeDot([...list, later], opened, NOW + DAY)).toBe(true);
    expect(stripNotice([...list, later], opened, NOW + DAY)).toBe(later);
  });

  it("do not bring up the next one when × puts the strip away", () => {
    const a = notice("a", "none", 2);
    const b = notice("b", "none", 1);
    expect(stripNotice([a, b], EMPTY_MEMORY, NOW)).toBe(b);
    const closed = stripClosed(EMPTY_MEMORY, "b", [a, b], NOW);
    expect(closed.seen).toEqual(["b"]);
    expect(stripNotice([a, b], closed, NOW)).toBeNull();
    // the dot stays for what is still new, until the board is opened
    expect(noticeDot([a, b], closed, NOW)).toBe(true);
  });

  it("leave what is more than 7 days old to the board", () => {
    const old = notice("old", "none", 7);
    expect(noticeDot([old], EMPTY_MEMORY, NOW)).toBe(false);
    expect(stripNotice([old], EMPTY_MEMORY, NOW)).toBeNull();
    expect(isNew(old, EMPTY_MEMORY, NOW)).toBe(false);
  });

  it("do not come back when a notice is edited, which keeps the day it went out", () => {
    const quiet = notice("quiet", "none", 1);
    const read = noticeRead(boardOpened(EMPTY_MEMORY, [quiet], NOW), "quiet");
    const edited = { ...quiet, title: "改过的字", body: "改过的字" };
    expect(noticeDot([edited], read, NOW + 60_000)).toBe(false);
    expect(stripNotice([edited], read, NOW + 60_000)).toBeNull();
    expect(noticeToPop([{ ...edited, pop: "once" }], read, NOW + 60_000)).toBeNull();
  });

  it("go out on a phone whose clock is behind, once the board was opened", () => {
    const quiet = notice("quiet", "none", 0);
    const behind = NOW - 3_600_000;
    const opened = boardOpened(EMPTY_MEMORY, [quiet], behind);
    expect(noticeDot([quiet], opened, behind)).toBe(false);
    expect(stripNotice([quiet], opened, behind)).toBeNull();
  });
});

describe("what this device remembers", () => {
  it("keeps what was read and when the board was opened, and changes what is stored", () => {
    expect(noticeMemoryKept()).toBe(false);
    expect(noticeMemory()).toEqual(EMPTY_MEMORY);
    changeNoticeMemory((m) => noticeRead(m, "a"));
    // another tab changed it meanwhile: both are kept
    changeNoticeMemory((m) => noticeRead(m, "b"), EMPTY_MEMORY);
    expect(noticeMemory().seen).toEqual(["a", "b"]);
    expect(noticeMemoryKept()).toBe(true);
    const opened = changeNoticeMemory((m) => boardOpened(m, [], NOW));
    expect(noticeMemory()).toEqual({ seen: ["a", "b"], boardAt: NOW, quietAt: NOW });
    expect(opened).toEqual(noticeMemory());
  });

  it("keeps the last 100 read", () => {
    let m: NoticeMemory = EMPTY_MEMORY;
    for (let i = 0; i < 130; i++) m = noticeRead(m, `n${i}`);
    expect(m.seen).toHaveLength(100);
    expect(m.seen[0]).toBe("n30");
    expect(noticeRead(m, "n129")).toBe(m);
  });

  it("is nothing when storage is blocked or holds something else", () => {
    localStorage.setItem("zhoup.notices", "{not json");
    expect(noticeMemory()).toEqual(EMPTY_MEMORY);
    localStorage.setItem("zhoup.notices", JSON.stringify({ seen: ["a", 3], boardAt: "x" }));
    expect(noticeMemory()).toEqual({ seen: ["a"], boardAt: 0, quietAt: 0 });
    Object.assign(globalThis, {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(noticeMemory()).toEqual(EMPTY_MEMORY);
    // remembered on the page only
    expect(changeNoticeMemory((m) => noticeRead(m, "a"), EMPTY_MEMORY).seen).toEqual(["a"]);
  });

  it("marks a visit in the tab under the key the notice before the board used", () => {
    expect(poppedThisVisit("u1")).toBe(false);
    sessionStorage.setItem("zhoup.notice.2026-11-11.u1", "1");
    expect(poppedThisVisit("u1")).toBe(true);
    markPopped("u2");
    expect(sessionStorage.getItem("zhoup.notice.2026-11-11.u2")).toBe("1");
    expect(poppedThisVisit("u3")).toBe(false);
  });
});

describe("the list from the server", () => {
  it("is read as sent, leaving out anything that is not a notice", () => {
    expect(readNoticeList({ stamp: "s1", notices: [welcome, { id: 3 }, null, { ...welcome, pop: "loud" }] })).toEqual({
      stamp: "s1",
      notices: [welcome],
    });
    expect(readNoticeList(null)).toBeNull();
    expect(readNoticeList({ notices: [] })).toBeNull();
  });

  it("dates each by Beijing's day", () => {
    expect(noticeDay(Date.parse("2026-11-11T15:08:00+08:00"))).toBe("11月11日");
    // after midnight in Beijing, still the 11th in Chicago
    expect(noticeDay(Date.parse("2026-11-12T00:30:00+08:00"))).toBe("11月12日");
  });
});
