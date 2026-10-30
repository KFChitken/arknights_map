import { activeEvents } from "./events";
import { SITE_NAME } from "./rules";

/**
 * 称号: badges a player earns once and keeps, except 石棺里的苏醒, which is
 * held for a week at a time. Each has its art in public/badges/<id>.svg, and
 * <id>-mini.svg for 32px and below. They only ever show on profile cards,
 * never on the map.
 */

export type BadgeSeries = "diplomacy" | "memorial" | "event";

export const SERIES: { id: BadgeSeries; name: string; code: string }[] = [
  { id: "diplomacy", name: "外交系列", code: "DIPLOMACY" },
  { id: "memorial", name: "纪念系列", code: "MEMORIAL" },
  { id: "event", name: "活动系列", code: "EVENT" },
];

/** A count the wall shows progress on, and the server awards by */
export type BadgeCount = "friends" | "responders";

export type Badge = {
  id: string;
  name: string;
  /** Printed under the name when it is earned, like DIP-10 */
  code: string;
  series: BadgeSeries;
  condition: string;
  /** What the wall says while it is locked; {n} is the count so far */
  lockedHint: string;
  /** Said when it is earned; {serial} is a 首批蟑螂's number */
  quote: string;
  /** The pill under a name on profile cards */
  pill: { background: string; color: string; border: string };
  goal?: { count: BadgeCount; n: number };
  /** Held only this many days from when it was given; the wall lists it only meanwhile, outside the tally */
  days?: number;
};

/** 千里传须: the two main roaches this far apart when two players become 触须之交 */
export const FAR_FRIEND_KM = 1000;
/** 首批蟑螂: the first this many players to sign up, numbered */
export const FIRST_BATCH = 1000;
/** 石棺里的苏醒: back after this many days away, or just signed up */
export const AWAY_DAYS = 14;
/** 石棺里的苏醒 is held this many days, then it goes until the next time */
export const SURVIVOR_DAYS = 7;

export const BADGES: Badge[] = [
  {
    id: "trainee",
    name: "见习外交官",
    code: "DIP-01",
    series: "diplomacy",
    condition: "有了第 1 位触须之交",
    lockedHint: "{n} / 1 位",
    quote: "舟P社交的第一步，迈出去了！",
    pill: { background: "#e3f8ee", color: "#1f7a56", border: "1.5px solid #86e0b9" },
    goal: { count: "friends", n: 1 },
  },
  {
    id: "diplomat",
    name: "舟P外交官",
    code: "DIP-10",
    series: "diplomacy",
    condition: "和 10 位不同的舟P成为过触须之交",
    lockedHint: "{n} / 10 位",
    quote: "在我们舟P里，这已经是外交官级别的了！",
    pill: { background: "#2b3d8f", color: "#ffe48a", border: "1.5px solid #2b3d8f" },
    goal: { count: "friends", n: 10 },
  },
  {
    id: "ambassador",
    name: "特命全权大使",
    code: "DIP-30",
    series: "diplomacy",
    condition: "和 30 位不同的舟P成为过触须之交",
    lockedHint: "{n} / 30 位",
    quote: "全权代表舟P，出使四方！",
    pill: { background: "#4b32b0", color: "#ffffff", border: "1.5px solid #ffcc3d" },
    goal: { count: "friends", n: 30 },
  },
  {
    id: "farwhisker",
    name: "千里传须",
    code: "DIP-1000KM",
    series: "diplomacy",
    condition: `有一位相隔 ${FAR_FRIEND_KM} 公里以上的触须之交`,
    lockedHint: "找一位千里之外的触须之交",
    quote: "千里之外，触须相连。",
    pill: {
      background:
        "linear-gradient(#fffaf0, #fffaf0) padding-box, repeating-linear-gradient(-45deg, #ec4b45 0 6px, #fffaf0 6px 9px, #2e6fd8 9px 15px, #fffaf0 15px 18px) border-box",
      color: "#2e6fd8",
      border: "2px solid transparent",
    },
  },
  {
    id: "spokesperson",
    name: "罗德岛外交部发言人",
    code: "DIP-PRESS",
    series: "diplomacy",
    condition: "你的宣言被 10 位不同的舟P回应过",
    lockedHint: "{n} / 10 人回应",
    quote: "你的宣言，有十位舟P在听！",
    pill: { background: "#ff6f5e", color: "#ffffff", border: "1.5px solid #ff6f5e" },
    goal: { count: "responders", n: 10 },
  },
  {
    id: "firstbatch",
    name: "首批蟑螂",
    code: "MEM-1000",
    series: "memorial",
    condition: `前 ${FIRST_BATCH} 个注册的舟P`,
    lockedHint: `前 ${FIRST_BATCH} 名专属`,
    quote: `你是第 {serial} 只来到${SITE_NAME}的蟑螂！`,
    pill: { background: "#1b1d22", color: "#ffd23f", border: "1.5px solid #ffd23f" },
  },
  {
    id: "beta",
    name: "内测功臣",
    code: "MEM-BETA",
    series: "memorial",
    condition: "管理员颁发，给内测时帮忙找 bug 的人",
    lockedHint: "管理员颁发",
    quote: `感谢你帮${SITE_NAME}抓虫！`,
    pill: { background: "#3a74e8", color: "#ffffff", border: "1.5px solid #3a74e8" },
  },
  {
    id: "survivor",
    name: "石棺里的苏醒",
    code: "MEM-14D",
    series: "memorial",
    condition: `刚注册，或者离开 ${AWAY_DAYS} 天以上又回来；能戴 ${SURVIVOR_DAYS} 天`,
    lockedHint: `离开 ${AWAY_DAYS} 天再回来`,
    quote: "石棺打开了，欢迎回来。",
    pill: { background: "#24a874", color: "#ffffff", border: "1.5px solid #24a874" },
    days: SURVIVOR_DAYS,
  },
  {
    // each event brings its own badge, named in events.ts
    id: "half2026",
    name: "半周年限定",
    code: "EVT-01 · 7.5TH",
    series: "event",
    condition: "方舟 7.5 周年「时间啊，向前！」期间发过一次限定宣言",
    lockedHint: "发一次限定宣言",
    quote: "时间啊，向前！半周年快乐！",
    pill: {
      background: "linear-gradient(100deg, #2a3f6e 0%, #2a3f6e 40%, #d9482b 64%, #ff8a3d 100%)",
      color: "#ffffff",
      border: "1.5px solid #f6c343",
    },
  },
];

export function badgeById(id: string) {
  return BADGES.find((b) => b.id === id);
}

/** A badge someone has, as profile cards show it */
export type ShownBadge = { id: string; serial?: number };

/** A badge the signed-in player has, with when they got it, whether they have been shown, and when a timed one goes */
export type EarnedBadge = ShownBadge & { at: number; seen: boolean; until?: number };

/** When a badge given at `at` goes, for one held only for a while. */
export const heldUntil = (b: Badge, at: number) => (b.days ? at + b.days * 86_400_000 : undefined);

/** Whether a badge given at `at` is still held: always, unless it is timed and its days are over. */
export const stillHeld = (b: Badge, at: number, now = Date.now()) => now < (heldUntil(b, at) ?? Infinity);

/** 「还剩 3 天」, counting a part of a day as a day */
export const daysLeft = (until: number, now = Date.now()) => `还剩 ${Math.max(1, Math.ceil((until - now) / 86_400_000))} 天`;

/** 「No.0042」 */
export const serialText = (n: number) => `No.${String(n).padStart(4, "0")}`;

export const quoteOf = (b: Badge, serial?: number) => b.quote.replace("{serial}", String(serial ?? ""));

export const lockedText = (b: Badge, counts: Record<BadgeCount, number>) =>
  b.lockedHint.replace("{n}", String(b.goal ? Math.min(counts[b.goal.count], b.goal.n) : 0));

/**
 * The badges the wall lists: every lasting one, of the event badges only those
 * earned or on offer now, and a timed one only while it is held. Past events
 * nobody earned stay out of sight.
 */
export function wallBadges(earned: Set<string>, now = Date.now()) {
  const onNow = new Set(activeEvents(now).map((e) => e.badge));
  return BADGES.filter((b) => earned.has(b.id) || (b.series === "event" ? onNow.has(b.id) : !b.days));
}

/** The badge earned by a count that a player is the fewest steps away from. */
export function nextBadge(earned: ShownBadge[], counts: Record<BadgeCount, number>) {
  let best: { name: string; count: BadgeCount; more: number } | null = null;
  for (const b of BADGES) {
    if (!b.goal || earned.some((e) => e.id === b.id)) continue;
    const more = b.goal.n - counts[b.goal.count];
    if (more > 0 && (!best || more < best.more)) best = { name: b.name, count: b.goal.count, more };
  }
  return best;
}
