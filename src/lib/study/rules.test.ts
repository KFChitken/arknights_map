import { describe, expect, it } from "vitest";
import { siteDayStart } from "../siteDay";
import { factIndex, GIVE_UP_AFTER, nearOnTime, newSeed, nextSeal, ON_TIME_GRACE_MS, onTimeNow, sameDay, sealBadge, SEALS, studiedNow } from "./rules";

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
    expect(SEALS.map(sealBadge)).toEqual(["study7", "study14", "study30", "study90", "study180", "study325"]);
  });

  it("know 准点 325's minute by Beijing time: the server's from 3:25 or 15:25 on, a page's a minute either side", () => {
    const bj = (hms: string) => Date.parse(`2026-11-21T${hms}+08:00`);
    expect(onTimeNow(bj("03:25:00"))).toBe(true);
    expect(onTimeNow(bj("03:25:59"))).toBe(true);
    // a round over within the minute may reach the server a little after it
    expect(onTimeNow(bj("03:26:00") + ON_TIME_GRACE_MS - 1)).toBe(true);
    expect(onTimeNow(bj("03:26:00") + ON_TIME_GRACE_MS)).toBe(false);
    expect(onTimeNow(bj("03:24:59"))).toBe(false);
    expect(onTimeNow(bj("15:25:30"))).toBe(true);
    expect(onTimeNow(bj("15:27:00"))).toBe(false);
    // Beijing's, wherever the player is: 3:25 in Chicago is 17:25 in Beijing
    expect(onTimeNow(Date.parse("2026-11-21T03:25:30-06:00"))).toBe(false);
    expect(onTimeNow(Date.parse("2026-11-20T13:25:30-06:00"))).toBe(true);
    // the page asks from a minute before to a minute after, its clock maybe a little off
    expect(nearOnTime(bj("03:23:59"))).toBe(false);
    expect(nearOnTime(bj("03:24:00"))).toBe(true);
    expect(nearOnTime(bj("03:26:59"))).toBe(true);
    expect(nearOnTime(bj("03:27:00"))).toBe(false);
    expect(nearOnTime(bj("15:24:30"))).toBe(true);
    expect(nearOnTime(bj("12:00:00"))).toBe(false);
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

  it("let the day's course be given up after five rounds of it lost", () => {
    expect(GIVE_UP_AFTER).toBe(5);
  });

  it("deal each round from a seed of its own", () => {
    const seeds = Array.from({ length: 200 }, newSeed);
    for (const s of seeds) expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
    expect(new Set(seeds).size).toBe(200);
  });
});
