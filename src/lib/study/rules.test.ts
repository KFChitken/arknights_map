import { describe, expect, it } from "vitest";
import { siteDayStart } from "../siteDay";
import { dayRandom, factIndex, nextSeal, sameDay, SEALS, studiedNow } from "./rules";

describe("325大学习's rules", () => {
  it("name the next seal and the days left to it, and none once all six are had", () => {
    expect(SEALS).toEqual([7, 14, 30, 90, 180, 325]);
    expect(nextSeal(0)).toEqual({ k: 1, left: 7 });
    expect(nextSeal(6)).toEqual({ k: 1, left: 1 });
    expect(nextSeal(7)).toEqual({ k: 2, left: 7 });
    expect(nextSeal(12)).toEqual({ k: 2, left: 2 });
    expect(nextSeal(324)).toEqual({ k: 6, left: 1 });
    expect(nextSeal(325)).toBeNull();
    expect(nextSeal(400)).toBeNull();
  });

  it("count today's course as played until 04:00 Beijing time the next day, by this device's clock", () => {
    const day = "2026-11-21";
    const start = siteDayStart(day);
    expect(new Date(start).toISOString()).toBe("2026-11-20T20:00:00.000Z");
    expect(sameDay(day, start)).toBe(true);
    expect(sameDay(day, start + 86_400_000 - 1)).toBe(true);
    expect(sameDay(day, start + 86_400_000)).toBe(false);
    expect(studiedNow({ day, done: true }, start + 1000)).toBe(true);
    expect(studiedNow({ day, done: false }, start + 1000)).toBe(false);
    expect(studiedNow({ day, done: true }, start + 86_400_000)).toBe(false);
  });

  it("show everyone the same 今日知识点 on a day, the next one the day after, round and round", () => {
    const seen = Array.from({ length: 26 }, (_, i) => factIndex(new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10), 13));
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBe((seen[i - 1] + 1) % 13);
    expect(new Set(seen).size).toBe(13);
    expect(factIndex("1969-12-31", 13)).toBeGreaterThanOrEqual(0);
  });

  it("deal a course the same numbers all day for everyone, and others on another day or course", () => {
    const a = dayRandom("react325", "2026-11-21");
    const b = dayRandom("react325", "2026-11-21");
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    for (const x of first) expect(x >= 0 && x < 1).toBe(true);
    expect(dayRandom("react325", "2026-11-22")()).not.toBe(first[0]);
    expect(dayRandom("find325", "2026-11-21")()).not.toBe(first[0]);
  });
});
