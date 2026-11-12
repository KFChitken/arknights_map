import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BADGES, badgeById, badgesOwned, daysLeft, heldUntil, lockedText, nextBadge, quoteOf, serialText, seriesCovered, stillHeld, wallBadges } from "./badges";
import { siteName } from "./rules";

const none = {
  friends: 0,
  responders: 0,
  drinks: 0,
  declareDays: 0,
  reactDays: 0,
  declareLines: 0,
  amiyaDays: 0,
  perlicaDays: 0,
  guideFriends: 0,
  radarDays: 0,
  fireNights: 0,
  sneakDays: 0,
  birthdayWishes: 0,
  quilters: 0,
  farMoves: 0,
  badgesOwned: 0,
  seriesCovered: 0,
};

describe("badges", () => {
  it("has the art for every badge, full and mini", () => {
    for (const b of BADGES) {
      expect(existsSync(`public/badges/${b.id}.svg`)).toBe(true);
      expect(existsSync(`public/badges/${b.id}-mini.svg`)).toBe(true);
    }
  });

  it("lists every lasting badge on the wall, and an event's only while it is on or once earned", () => {
    const during = Date.parse("2026-11-15T12:00+08:00");
    const after = Date.parse("2026-12-01T12:00+08:00");
    expect(wallBadges(new Set(), during).map((b) => b.id)).toContain("half2026");
    expect(wallBadges(new Set(), after).map((b) => b.id)).not.toContain("half2026");
    expect(wallBadges(new Set(["half2026"]), after).map((b) => b.id)).toContain("half2026");
    // the lasting ones of the first two rounds and 祀掌柜's, and the twenty-three of the third
    expect(wallBadges(new Set(), after)).toHaveLength(54);
    // the timed one only while it is held
    expect(wallBadges(new Set(), after).map((b) => b.id)).not.toContain("survivor");
    expect(wallBadges(new Set(["survivor"]), after).map((b) => b.id)).toContain("survivor");
  });

  it("holds a timed badge for its days, and counts what is left in whole days", () => {
    const survivor = badgeById("survivor")!;
    const at = Date.parse("2026-11-01T12:00+08:00");
    expect(stillHeld(survivor, at, at + 6.9 * 86_400_000)).toBe(true);
    expect(stillHeld(survivor, at, at + 7 * 86_400_000)).toBe(false);
    expect(stillHeld(badgeById("beta")!, at, at + 999 * 86_400_000)).toBe(true);
    expect(daysLeft(heldUntil(survivor, at)!, at)).toBe("还剩 7 天");
    expect(daysLeft(heldUntil(survivor, at)!, at + 6.5 * 86_400_000)).toBe("还剩 1 天");
  });

  it("words numbers, quotes and progress", () => {
    expect(serialText(42)).toBe("No.0042");
    expect(quoteOf(badgeById("firstbatch")!, 42)).toBe(`你是第 42 只来到${siteName()}的蟑螂！`);
    expect(lockedText(badgeById("ambassador")!, { ...none, friends: 12 })).toBe("12 / 30 位");
    expect(lockedText(badgeById("spokesperson")!, { ...none, responders: 6 })).toBe("6 / 10 人回应");
    expect(lockedText(badgeById("chief")!, { ...none, declareDays: 12 })).toBe("12 / 30 天");
    expect(lockedText(badgeById("fluent")!, { ...none, declareLines: 9 })).toBe("8 / 8 句");
    expect(lockedText(badgeById("fullsquad")!, { ...none, guideFriends: 3 })).toBe("3 / 4 位向导");
    expect(lockedText(badgeById("beta")!, none)).toBe("站长颁发");
  });

  it("points at the nearest badge earned by a count, by friends, responders or days of declaring and responding", () => {
    const busy = { ...none, declareDays: 100, reactDays: 100 };
    expect(nextBadge([], none)).toEqual({ name: "见习外交官", count: "friends", more: 1 });
    expect(nextBadge([{ id: "trainee" }], { ...busy, friends: 8, responders: 7 })).toEqual({ name: "舟P外交官", count: "friends", more: 2 });
    expect(nextBadge([{ id: "trainee" }], { ...busy, friends: 2, responders: 9 })).toEqual({ name: "罗德岛外交部发言人", count: "responders", more: 1 });
    const all = ["trainee", "diplomat", "ambassador", "spokesperson"].map((id) => ({ id }));
    expect(nextBadge([...all, { id: "lookatme" }, { id: "courtesy" }], { ...none, friends: 30, responders: 10, declareDays: 8, reactDays: 3 })).toEqual({
      name: "罗德岛宣言部干员",
      count: "declareDays",
      more: 2,
    });
    // the third round's days: the radar, nights by the fire, touching sneakily
    expect(nextBadge(all, { ...busy, friends: 30, responders: 10 })).toEqual({ name: "天灾信使", count: "radarDays", more: 10 });
    const days = { ...busy, friends: 30, responders: 10, radarDays: 10, fireNights: 9, sneakDays: 7 };
    expect(nextBadge(all, days)).toEqual({ name: "温暖你的战友", count: "fireNights", more: 1 });
    // of the drinks only 人称千杯 and 人称万两, never the first drink; never the sentences or the guides
    const gotten = [...all, "stormchaser", "warmth", "silentbolt", "summit", "globetrotter"].map((b) => (typeof b === "string" ? { id: b } : b));
    const rest = { ...days, drinks: 0, declareLines: 7, amiyaDays: 29, guideFriends: 3, quilters: 2, farMoves: 2, birthdayWishes: 4 };
    expect(nextBadge(gotten, rest)).toEqual({ name: "人称千杯", count: "drinks", more: 10 });
    expect(nextBadge([...gotten, { id: "thousandcups" }], { ...rest, drinks: 99 })).toEqual({ name: "人称万两", count: "drinks", more: 1 });
    expect(nextBadge([...gotten, { id: "thousandcups" }, { id: "bigjar" }], { ...rest, drinks: 99 })).toBeNull();
  });

  it("counts the badges held besides 罗德岛正式干员, and the series of 精英干员", () => {
    const held = ["trainee", "tipsy", "regular", "lookatme"].map((id) => ({ id }));
    expect(badgesOwned(held)).toBe(3);
    expect(seriesCovered(held)).toBe(3);
    expect(seriesCovered([...held, { id: "courtesy" }, { id: "amiya" }, { id: "twins" }])).toBe(5);
    expect(lockedText(badgeById("regular")!, { ...none, badgesOwned: 3 })).toBe("3 / 5 枚");
    expect(lockedText(badgeById("elite")!, { ...none, seriesCovered: 4 })).toBe("4 / 5 个系列");
    expect(lockedText(badgeById("stormchaser")!, { ...none, radarDays: 12 })).toBe("10 / 10 天");
  });
});
