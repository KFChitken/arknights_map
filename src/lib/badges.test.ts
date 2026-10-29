import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BADGES, badgeById, lockedText, nextBadge, quoteOf, serialText, wallBadges } from "./badges";
import { SITE_NAME } from "./rules";

const none = { friends: 0, responders: 0 };

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
    expect(wallBadges(new Set(), after)).toHaveLength(8);
  });

  it("words numbers, quotes and progress", () => {
    expect(serialText(42)).toBe("No.0042");
    expect(quoteOf(badgeById("firstbatch")!, 42)).toBe(`你是第 42 只来到${SITE_NAME}的蟑螂！`);
    expect(lockedText(badgeById("ambassador")!, { friends: 12, responders: 0 })).toBe("12 / 30 位");
    expect(lockedText(badgeById("spokesperson")!, { friends: 0, responders: 6 })).toBe("6 / 10 人回应");
    expect(lockedText(badgeById("beta")!, none)).toBe("管理员颁发");
  });

  it("points at the nearest badge earned by a count", () => {
    expect(nextBadge([], none)).toEqual({ name: "见习外交官", count: "friends", more: 1 });
    expect(nextBadge([{ id: "trainee" }], { friends: 8, responders: 7 })).toEqual({ name: "舟P外交官", count: "friends", more: 2 });
    expect(nextBadge([{ id: "trainee" }], { friends: 2, responders: 9 })).toEqual({ name: "罗德岛外交部发言人", count: "responders", more: 1 });
    const all = ["trainee", "diplomat", "ambassador", "spokesperson"].map((id) => ({ id }));
    expect(nextBadge(all, { friends: 30, responders: 10 })).toBeNull();
  });
});
