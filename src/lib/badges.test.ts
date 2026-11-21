import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BADGES,
  badgeById,
  badgesOwned,
  badgeTotal,
  daysLeft,
  earnableCount,
  ELITE_SERIES,
  heldUntil,
  lockedText,
  nextBadge,
  quoteOf,
  serialText,
  SERIES,
  seriesCovered,
  stillHeld,
  wallBadges,
} from "./badges";
import { siteName } from "./rules";
import { FATE_BADGE, ON_TIME_BADGE, sealBadge, SEALS } from "./study/rules";

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
  studyDays: 0,
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
    // the lasting ones of the first two rounds and 祀掌柜's three, and the twenty-three of the third
    expect(wallBadges(new Set(), after)).toHaveLength(55);
    // the timed one only while it is held
    expect(wallBadges(new Set(), after).map((b) => b.id)).not.toContain("survivor");
    expect(wallBadges(new Set(["survivor"]), after).map((b) => b.id)).toContain("survivor");
    // the thanks for sponsoring only once had: no one is shown a way to them
    for (const id of ["feeder", "volt"]) {
      expect(wallBadges(new Set(), after).map((b) => b.id)).not.toContain(id);
      expect(wallBadges(new Set([id]), after).map((b) => b.id)).toContain(id);
    }
    expect(wallBadges(new Set(["feeder", "volt"]), after)).toHaveLength(57);
  });

  it("gives by hand only 内测功臣 and the two thanks for sponsoring, which nothing in play earns", () => {
    expect(BADGES.filter((b) => b.byHand).map((b) => b.id)).toEqual(["beta", "feeder", "volt"]);
    for (const b of BADGES.filter((b) => b.byHand)) expect([b.goal, b.days, b.series]).toEqual([undefined, undefined, "memorial"]);
    // 服务器饲养员 and ?!电电!? go together, off the wall until had
    const thanks = BADGES.filter((b) => b.sponsor);
    expect(thanks.map((b) => b.name)).toEqual(["服务器饲养员", "?!电电!?"]);
    for (const b of thanks) expect([b.byHand, b.unlisted]).toEqual([true, true]);
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
    // the thanks for sponsoring count for nothing in play
    expect(badgesOwned([...held, { id: "feeder" }, { id: "volt" }])).toBe(3);
    expect(badgesOwned([...held, { id: "beta" }])).toBe(4);
    expect(seriesCovered(held)).toBe(3);
    expect(seriesCovered([...held, { id: "courtesy" }, { id: "amiya" }, { id: "twins" }])).toBe(5);
    expect(lockedText(badgeById("regular")!, { ...none, badgesOwned: 3 })).toBe("3 / 5 枚");
    expect(lockedText(badgeById("elite")!, { ...none, seriesCovered: 4 })).toBe("4 / 5 个系列");
    expect(lockedText(badgeById("stormchaser")!, { ...none, radarDays: 12 })).toBe("10 / 10 天");
  });

  it("has 325大学习's eight last, a 称号 for each seal's days and two hidden, as drafted", () => {
    expect(SERIES.at(-1)).toMatchObject({ id: "study", name: "325大学习系列", code: "STUDY" });
    const study = BADGES.filter((b) => b.series === "study");
    expect(BADGES.slice(-8)).toEqual(study);
    expect(study.map((b) => [b.id, b.name, b.code])).toEqual([
      ["study7", "325 旁听生", "STU-7"],
      ["study14", "325 插班生", "STU-14"],
      ["study30", "325 课代表", "STU-30"],
      ["study90", "325 学习委员", "STU-90"],
      ["study180", "325 教研组长", "STU-180"],
      ["study325", "325 名誉教授", "STU-325"],
      [FATE_BADGE, "命运的 325", "STU-FATE"],
      [ON_TIME_BADGE, "准点 325", "STU-3:25"],
    ]);
    // one by the days for each seal on 325大学习's page, the same days
    const byDays = study.filter((b) => b.goal);
    expect(byDays.map((b) => b.id)).toEqual(SEALS.map(sealBadge));
    expect(byDays.map((b) => b.goal)).toEqual(SEALS.map((n) => ({ count: "studyDays", n })));
    expect(lockedText(badgeById("study7")!, { ...none, studyDays: 3 })).toBe("3 / 7 天");
    expect(lockedText(badgeById("study325")!, { ...none, studyDays: 400 })).toBe("325 / 325 天");
    expect(badgeById("study30")!.condition).toBe("325大学习累计学满 30 天（每天上完抽到的那门课算一天，不用连着）");
    expect(badgeById("study325")!.quote).toBe("第 325 天。这门课，你学满了。");
    expect(badgeById(ON_TIME_BADGE)!.condition).toBe("北京时间 3:25 或 15:25 那一分钟里上完一局，哪门课都行");
    // the hidden two go by no count, and are off the wall until had
    for (const id of [FATE_BADGE, ON_TIME_BADGE]) {
      expect(badgeById(id)!.goal).toBeUndefined();
      expect(badgeById(id)).toMatchObject({ unlisted: true, hidden: true, study: true });
    }
    // neither 精英干员 nor any nudge asks for studying: its own page says the days left
    expect(ELITE_SERIES).not.toContain("study");
    const lots = { ...none, friends: 999, responders: 999, declareDays: 999, reactDays: 999, radarDays: 999, fireNights: 999, sneakDays: 999 };
    expect(nextBadge([], { ...lots, drinks: 999, studyDays: 6 })).toBeNull();
  });

  it("lists 325大学习's only for a player who may study, the hidden two only once had, and counts them likewise", () => {
    const after = Date.parse("2026-12-01T12:00+08:00");
    const study = (list: { id: string; series: string }[]) => list.filter((b) => b.series === "study").map((b) => b.id);
    expect(study(wallBadges(new Set(), after))).toEqual([]);
    expect(study(wallBadges(new Set(), after, false, true))).toEqual(SEALS.map(sealBadge));
    // one held shows whatever STUDY is, as any held does
    expect(study(wallBadges(new Set(["study7"]), after))).toEqual(["study7"]);
    expect(study(wallBadges(new Set([FATE_BADGE]), after, false, true))).toEqual([...SEALS.map(sealBadge), FATE_BADGE]);
    expect(study(wallBadges(new Set([ON_TIME_BADGE, FATE_BADGE]), after, false, true))).toEqual([...SEALS.map(sealBadge), FATE_BADGE, ON_TIME_BADGE]);
    // 我的资料's and 我的记录's 「x / y」: six more for one who may study, a hidden one only once had
    const base = badgeTotal([], false);
    expect(badgeTotal([], false, true)).toBe(base + 6);
    expect(badgeTotal([{ id: FATE_BADGE }], false, true)).toBe(base + 7);
    expect(badgeTotal([{ id: "study7" }], false)).toBe(base + 1);
    expect(badgeTotal([], true, true)).toBe(badgeTotal([], true) + 6);
    // the intro page's: the six only once anyone may study, the hidden two never
    expect(earnableCount(false, true)).toBe(earnableCount(false) + 6);
  });
});
