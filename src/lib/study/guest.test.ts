import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteDayStart } from "../siteDay";
import { COURSE_IDS, isCourse } from "./courses";

/** A browser's storage, or one that keeps nothing (a private window) */
function storage(keeps: boolean) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (keeps ? (m.get(k) ?? null) : null),
    setItem: (k: string, v: string) => {
      if (!keeps) throw new Error("QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

const DAY = 86_400_000;
const at = (day: string, hours = 1) => siteDayStart(day) + hours * 3_600_000;

// the module keeps what it wrote last for a browser that keeps nothing: a fresh copy for each test
async function load() {
  vi.resetModules();
  return import("./guest");
}

afterEach(() => vi.unstubAllGlobals());

describe("325大学习 for a visitor, kept in their browser", () => {
  let store: ReturnType<typeof storage>;
  beforeEach(() => {
    store = storage(true);
    vi.stubGlobal("localStorage", store);
  });

  it("draws one course a site day and keeps it, passed or not, until 04:00 Beijing time", async () => {
    const { guestDone, guestStudy, guestToday } = await load();
    expect(guestStudy()).toBeNull();
    const t = guestToday(at("2026-11-21"));
    expect(t).toEqual({ day: "2026-11-21", course: expect.any(String), done: false, fails: 0, skipped: false });
    expect(isCourse(t.course)).toBe(true);
    expect(guestToday(at("2026-11-21", 20))).toEqual(t);
    expect(guestStudy()).toEqual({ day: "2026-11-21", done: false });

    expect(guestDone("2026-11-21", t.course, true, at("2026-11-21", 23))).toEqual({ ...t, done: true });
    expect(guestToday(at("2026-11-21", 23.9))).toEqual({ ...t, done: true });
    expect(guestStudy()).toEqual({ day: "2026-11-21", done: true });

    // after 04:00, another day: drawn again (another course, where there is one), not passed yet
    const t2 = guestToday(at("2026-11-21") + DAY);
    expect(t2).toEqual({ day: "2026-11-22", course: expect.any(String), done: false, fails: 0, skipped: false });
    if (COURSE_IDS.length > 1) expect(t2.course).not.toBe(t.course);
    expect(JSON.parse(store.raw.get("zhoup.study")!)).toMatchObject({ day: "2026-11-22", course: t2.course, bag: expect.arrayContaining([t2.course]), done: false });
  });

  it("counts the rounds of today's course lost until it is passed, and none the next day", async () => {
    const { guestDone, guestToday } = await load();
    const t = guestToday(at("2026-11-21"));
    expect(guestDone("2026-11-21", t.course, false, at("2026-11-21", 2))).toEqual({ ...t, fails: 1 });
    expect(guestDone("2026-11-21", t.course, false, at("2026-11-21", 3))).toEqual({ ...t, fails: 2 });
    expect(guestToday(at("2026-11-21", 4))).toEqual({ ...t, fails: 2 });
    expect(guestDone("2026-11-21", t.course, true, at("2026-11-21", 5))).toEqual({ ...t, done: true, fails: 2 });
    // once passed, a round lost counts nothing
    expect(guestDone("2026-11-21", t.course, false, at("2026-11-21", 6))).toEqual({ ...t, done: true, fails: 2 });
    expect(guestToday(at("2026-11-21") + DAY)).toMatchObject({ day: "2026-11-22", done: false, fails: 0 });
  });

  it("lets today's course be given up once five rounds of it are lost, and only today's", async () => {
    const { guestDone, guestGiveUp, guestStudy, guestToday } = await load();
    const t = guestToday(at("2026-11-21"));
    for (let i = 1; i < 5; i++) {
      expect(guestDone("2026-11-21", t.course, false, at("2026-11-21", 2))?.fails).toBe(i);
      expect(guestGiveUp("2026-11-21", t.course, at("2026-11-21", 2))).toBeNull();
    }
    expect(guestDone("2026-11-21", t.course, false, at("2026-11-21", 2))?.fails).toBe(5);
    for (const other of COURSE_IDS.filter((c) => c !== t.course)) expect(guestGiveUp("2026-11-21", other, at("2026-11-21", 3))).toBeNull();
    // yesterday's, after 04:00
    expect(guestGiveUp("2026-11-21", t.course, at("2026-11-21") + DAY)).toBeNull();
    expect(guestGiveUp("2026-11-21", t.course, at("2026-11-21", 3))).toEqual({ ...t, done: true, fails: 5, skipped: true });
    expect(guestGiveUp("2026-11-21", t.course, at("2026-11-21", 4))).toEqual({ ...t, done: true, fails: 5, skipped: true });
    expect(guestToday(at("2026-11-21", 5))).toEqual({ ...t, done: true, fails: 5, skipped: true });
    expect(guestStudy()).toEqual({ day: "2026-11-21", done: true });
    // passed after five lost: not given up
    const t2 = guestToday(at("2026-11-21") + DAY);
    for (let i = 0; i < 5; i++) guestDone("2026-11-22", t2.course, false, at("2026-11-22", 2));
    expect(guestDone("2026-11-22", t2.course, true, at("2026-11-22", 3))).toMatchObject({ done: true, fails: 5, skipped: false });
    expect(guestGiveUp("2026-11-22", t2.course, at("2026-11-22", 4))).toMatchObject({ done: true, skipped: false });
  });

  it("counts nothing for yesterday's course played after 04:00, or a course not drawn", async () => {
    const { guestDone, guestToday } = await load();
    const { course } = guestToday(at("2026-11-21"));
    expect(guestDone("2026-11-21", course, true, at("2026-11-21") + DAY)).toBeNull();
    expect(guestDone("2026-11-20", course, true, at("2026-11-21"))).toBeNull();
    for (const other of COURSE_IDS.filter((c) => c !== course)) {
      expect(guestDone("2026-11-21", other, true, at("2026-11-21", 2))).toBeNull();
      expect(guestDone("2026-11-21", other, false, at("2026-11-21", 2))).toBeNull();
    }
    expect(guestToday(at("2026-11-21", 2))).toMatchObject({ done: false, fails: 0 });
  });

  it("starts afresh from what it cannot read", async () => {
    store.raw.set("zhoup.study", "{not json");
    const { guestToday } = await load();
    const fresh = guestToday(at("2026-11-21"));
    expect(fresh).toEqual({ day: "2026-11-21", course: expect.any(String), done: false, fails: 0, skipped: false });
    expect(isCourse(fresh.course)).toBe(true);
    store.raw.set("zhoup.study", JSON.stringify({ day: "2026-11-21", course: "gone", bag: [], done: true }));
    const again = guestToday(at("2026-11-21"));
    expect(again).toEqual({ day: "2026-11-21", course: expect.any(String), done: false, fails: 0, skipped: false });
    expect(isCourse(again.course)).toBe(true);
    // kept before rounds were lost, or with nonsense for them
    store.raw.set("zhoup.study", JSON.stringify({ day: "2026-11-21", course: again.course, bag: [again.course], done: false, fails: -3 }));
    expect(guestToday(at("2026-11-21"))).toEqual({ ...again, fails: 0 });
    store.raw.set("zhoup.study", JSON.stringify({ day: "2026-11-21", course: again.course, bag: [again.course], done: false, fails: 2.5, skipped: "yes" }));
    expect(guestToday(at("2026-11-21"))).toEqual({ ...again, fails: 0, skipped: false });
  });

  it("still plays in a browser that keeps nothing, for as long as the page is open", async () => {
    vi.stubGlobal("localStorage", storage(false));
    const { guestDone, guestStudy, guestToday } = await load();
    const { course } = guestToday(at("2026-11-21"));
    expect(guestDone("2026-11-21", course, false, at("2026-11-21", 3))).toMatchObject({ fails: 1 });
    expect(guestDone("2026-11-21", course, true, at("2026-11-21", 3))).toMatchObject({ done: true, fails: 1 });
    expect(guestStudy()).toEqual({ day: "2026-11-21", done: true });
  });
});
