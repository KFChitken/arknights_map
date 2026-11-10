import { activeEvents } from "./events";
import { SITE_NAME } from "./rules";

/**
 * 称号: badges a player earns once and keeps, except 石棺里的苏醒, which is
 * held for a week at a time. Each has its art in public/badges/<id>.svg, and
 * <id>-mini.svg for 32px and below. They only ever show on profile cards,
 * never on the map.
 */

export type BadgeSeries = "diplomacy" | "memorial" | "bacchus" | "event" | "declare" | "response" | "guides";

export const SERIES: { id: BadgeSeries; name: string; code: string }[] = [
  { id: "diplomacy", name: "外交系列", code: "DIPLOMACY" },
  { id: "memorial", name: "纪念系列", code: "MEMORIAL" },
  { id: "bacchus", name: "酒神系列", code: "BACCHUS" },
  { id: "event", name: "活动系列", code: "EVENT" },
  { id: "declare", name: "宣言系列", code: "DECLARE" },
  { id: "response", name: "回应系列", code: "RESPONSE" },
  { id: "guides", name: "向导系列", code: "GUIDES" },
];

/**
 * A count the wall shows progress on, and the server awards by. The day counts are Beijing days
 * (twenty in a day is one day; they need not be in a row); declareLines is how many of the
 * everyday sentences (not 祝我生日快乐) they ever sent; guideFriends how many guides are 触须之交.
 */
export type BadgeCount =
  | "friends"
  | "responders"
  | "drinks"
  | "declareDays"
  | "reactDays"
  | "declareLines"
  | "amiyaDays"
  | "perlicaDays"
  | "guideFriends";

/** 一呼百舟应: this many responses to one declaration */
export const ECHO_REACTIONS = 10;
/** 火边的歌声: this many roaches by 塔露拉干员's fire, her third level */
export const FIRE_SONG_ROACHES = 50;

/** The everyday sentences 满嘴舟语 asks for: all but 祝我生日快乐, and no limited or drunk ones */
export const FLUENT_TEMPLATES = ["launch", "iam", "love", "buff", "myname", "welcome", "canyou", "eat"] as const;

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
  /**
   * Also drawn with the guide's own picture, served from the server's own folder while that guide's
   * picture is switched on (src/app/guide-art/[file]/route.ts): /guide-art/<file>(-mini).svg, else the drawn one
   */
  pictureArt?: string;
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
    condition: "站长颁发，给内测时帮忙找 bug 的人",
    lockedHint: "站长颁发",
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
    id: "tipsy",
    name: "当一回酒神",
    code: "BAC-01",
    series: "bacchus",
    condition: "第一次主动「摄入酒精」，醉倒翻肚皮",
    lockedHint: "摄入一次酒精",
    quote: "咕嘟咕嘟……嗝！这回你就是酒神。",
    pill: { background: "#c23a5e", color: "#ffffff", border: "1.5px solid #c23a5e" },
    goal: { count: "drinks", n: 1 },
  },
  {
    id: "bacchus",
    name: "泰拉异格酒神",
    code: "BAC-50",
    series: "bacchus",
    condition: "主动醉倒满 50 次，每次都算",
    lockedHint: "{n} / 50 次",
    quote: "醉倒 50 次，泰拉的酒馆都认识你了。",
    pill: { background: "linear-gradient(100deg, #3b1f5c 0%, #8e2a5a 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "drinks", n: 50 },
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
  {
    id: "lookatme",
    name: "全体目光向我看齐！",
    code: "DEC-01",
    series: "declare",
    condition: "第一次发独立宣言",
    lockedHint: "发一句独立宣言",
    quote: "看我看我，我宣布个事儿！",
    pill: { background: "#fff3c4", color: "#b8371c", border: "1.5px solid #ffd23f" },
    goal: { count: "declareDays", n: 1 },
  },
  {
    id: "declarer",
    name: "罗德岛宣言部干员",
    code: "DEC-10",
    series: "declare",
    condition: "累计 10 天发过宣言",
    lockedHint: "{n} / 10 天",
    quote: "十天的宣言没白喊，宣言部正式收下你了。",
    pill: { background: "#1f2a44", color: "#ffffff", border: "1.5px solid #ff8a2a" },
    goal: { count: "declareDays", n: 10 },
  },
  {
    id: "chief",
    name: "罗德岛宣言部部长",
    code: "DEC-30",
    series: "declare",
    condition: "累计 30 天发过宣言",
    lockedHint: "{n} / 30 天",
    quote: "三十天，从干员干到了部长，宣言部交给你了。",
    pill: { background: "#22305c", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "declareDays", n: 30 },
  },
  {
    id: "resound",
    name: "响彻泰拉",
    code: "DEC-100",
    series: "declare",
    condition: "累计 100 天发过宣言",
    lockedHint: "{n} / 100 天",
    quote: "一百天的宣言，全泰拉都听见了。",
    pill: { background: "#5a2f86", color: "#ffe08a", border: "1.5px solid #3a74e8" },
    goal: { count: "declareDays", n: 100 },
  },
  {
    id: "echo",
    name: "一呼百舟应",
    code: "DEC-ECHO",
    series: "declare",
    condition: "有一条宣言收到 10 个回应",
    lockedHint: "让一条宣言收到 10 个回应",
    quote: "你一开口，十位舟P起了反应。",
    pill: { background: "#fff4e0", color: "#c25a12", border: "1.5px solid #ff8a2a" },
  },
  {
    id: "fluent",
    name: "满嘴舟语",
    code: "DEC-8",
    series: "declare",
    condition: "平常那 9 句里，除了「祝我生日快乐」，另外 8 句都发过",
    lockedHint: "{n} / 8 句",
    quote: "舟语专业八级，恭喜通过！",
    pill: { background: "#fff6e6", color: "#a8282d", border: "1.5px solid #ffb547" },
    goal: { count: "declareLines", n: 8 },
  },
  {
    id: "courtesy",
    name: "合乎粥礼",
    code: "RE-01",
    series: "response",
    condition: "第一次回应别人的宣言",
    lockedHint: "回应一条别人的宣言",
    quote: "有来有往，合乎粥礼。",
    pill: { background: "#e3faf6", color: "#178a80", border: "1.5px solid #2ec4b6" },
    goal: { count: "reactDays", n: 1 },
  },
  {
    id: "hype",
    name: "舟P气氛组",
    code: "RE-10",
    series: "response",
    condition: "累计 10 天回应过宣言",
    lockedHint: "{n} / 10 天",
    quote: "有你在，宣言从不冷场！",
    pill: { background: "#221a3c", color: "#ff9fc0", border: "1.5px solid #ff5c93" },
    goal: { count: "reactDays", n: 10 },
  },
  {
    id: "sidekick",
    name: "金牌捧哏",
    code: "RE-30",
    series: "response",
    condition: "累计 30 天回应过宣言",
    lockedHint: "{n} / 30 天",
    quote: "你一句我一句，这活儿离了你不行。",
    pill: { background: "#9e1f35", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "reactDays", n: 30 },
  },
  {
    id: "responder",
    name: "有求必应",
    code: "RE-100",
    series: "response",
    condition: "累计 100 天回应过宣言",
    lockedHint: "{n} / 100 天",
    quote: "一百天，有宣言就有你的回应。",
    pill: { background: "#3b2385", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "reactDays", n: 100 },
  },
  {
    id: "declfriend",
    name: "以宣会友",
    code: "RE-PAL",
    series: "response",
    condition: "从一条宣言开始（你回应了 TA、或者碰了发宣言的人），一来一回最后成了触须之交；两个人都拿",
    lockedHint: "从一条宣言开始，交一位触须之交",
    quote: "一句宣言，换来一位触须之交。",
    pill: { background: "linear-gradient(90deg, #ffe3c7, #d6f6f2)", color: "#0d5a53", border: "1.5px solid #2ec4b6" },
  },
  {
    id: "amiya",
    name: "博士，欢迎回家",
    code: "GD-AMIYA",
    series: "guides",
    condition: "和阿米娅成为触须之交",
    lockedHint: "去罗德岛大胆碰一下阿米娅",
    quote: "诶嘿嘿...欢迎登上罗德岛！",
    pill: { background: "#ffeaf3", color: "#c2477f", border: "1.5px solid #ff7eb6" },
    pictureArt: "badge-amiya",
  },
  {
    id: "perlica",
    name: "空气突然好重...",
    code: "GD-PERLICA",
    series: "guides",
    condition: "和佩丽卡成为触须之交",
    lockedHint: "大胆碰一下佩丽卡",
    quote: "好，记下了。……以后不许再一声不吭地走掉。",
    pill: { background: "#e2f8f8", color: "#178a8e", border: "1.5px solid #3fd0d4" },
    pictureArt: "badge-perlica",
  },
  {
    id: "talulah",
    name: "小龙女是我自己？",
    code: "GD-TALULAH",
    series: "guides",
    condition: "和塔露拉握手（第一次大胆碰她）",
    lockedHint: "去篝火边和塔露拉握个手",
    quote: "重新认识一下……来，握个手吧。",
    pill: { background: "#fff0e0", color: "#c25a12", border: "1.5px solid #ff9f43" },
    pictureArt: "badge-talulah",
  },
  {
    id: "minghe",
    name: "不急，身后有他",
    code: "GD-MINGHE",
    series: "guides",
    condition: "和明河成为触须之交",
    lockedHint: "大胆碰一下明河",
    quote: "往后这一路，有我。",
    pill: { background: "#1d2a5a", color: "#e8f1ff", border: "1.5px solid #5a78e6" },
    pictureArt: "badge-minghe",
  },
  {
    id: "amiya30",
    name: "现在还不能休息哦",
    code: "GD-AMIYA-30",
    series: "guides",
    condition: "累计 30 天碰过阿米娅",
    lockedHint: "{n} / 30 天",
    quote: "三十天了呢。……不过，现在还不能休息哦。",
    pill: { background: "#ffeaf3", color: "#c2477f", border: "1.5px solid #f6c343" },
    goal: { count: "amiyaDays", n: 30 },
    pictureArt: "badge-amiya30",
  },
  {
    id: "perlica30",
    name: "重力翻倍",
    code: "GD-PERLICA-30",
    series: "guides",
    condition: "累计 30 天碰过佩丽卡",
    lockedHint: "{n} / 30 天",
    quote: "三十天，一天都没漏记。……你是重点监督对象了。",
    pill: { background: "#e2f8f8", color: "#178a8e", border: "1.5px solid #f6c343" },
    goal: { count: "perlicaDays", n: 30 },
    pictureArt: "badge-perlica30",
  },
  {
    id: "fireside",
    name: "火边的歌声",
    code: "GD-FIRESIDE",
    series: "guides",
    condition: "篝火烧到 50 只以上（第 3 档）的时候，你有蟑螂坐在火边",
    lockedHint: "篝火凑到 50 只时，你有蟑螂在火边",
    quote: "你听，火边有人在唱歌。",
    pill: { background: "#2a1f4a", color: "#ffc94a", border: "1.5px solid #f6c343" },
    pictureArt: "badge-fireside",
  },
  {
    id: "sevenstops",
    name: "七站星河",
    code: "GD-SEVEN",
    series: "guides",
    condition: "派克隆体跟明河走完整整 7 站，中途没下马",
    lockedHint: "跟明河走完 7 站",
    quote: "七座城连成一条星河，你都走过了。",
    pill: { background: "#1d2a5a", color: "#ffe08a", border: "1.5px solid #f6c343" },
    pictureArt: "badge-sevenstops",
  },
  {
    id: "fullsquad",
    name: "满编小队",
    code: "GD-SQUAD",
    series: "guides",
    condition: "认识的 4 枚都拿到",
    lockedHint: "{n} / 4 位向导",
    quote: "四位向导都认得你了。小队满编，出发！",
    pill: { background: "#1f2a44", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "guideFriends", n: 4 },
    pictureArt: "badge-fullsquad",
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
  const onNow = new Set(activeEvents(now).flatMap((e) => (e.badge ? [e.badge] : [])));
  return BADGES.filter((b) => earned.has(b.id) || (b.series === "event" ? onNow.has(b.id) : !b.days));
}

/** Counts a player is nudged about: drinking, the guides and the sentences never are */
const NUDGED: BadgeCount[] = ["friends", "responders", "declareDays", "reactDays"];

/** The badge earned by friends, responders or days of declaring and responding that a player is the fewest steps away from. */
export function nextBadge(earned: ShownBadge[], counts: Record<BadgeCount, number>) {
  let best: { name: string; count: BadgeCount; more: number } | null = null;
  for (const b of BADGES) {
    if (!b.goal || !NUDGED.includes(b.goal.count) || earned.some((e) => e.id === b.id)) continue;
    const more = b.goal.n - counts[b.goal.count];
    if (more > 0 && (!best || more < best.more)) best = { name: b.name, count: b.goal.count, more };
  }
  return best;
}
