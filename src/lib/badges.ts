import { activeEvents } from "./events";
import { siteName } from "./rules";

/**
 * 称号: badges a player earns once and keeps, except 石棺里的苏醒, which is
 * held for a week at a time. Each has its art in public/badges/<id>.svg, and
 * <id>-mini.svg for 32px and below. They only ever show on profile cards,
 * never on the map.
 */

export type BadgeSeries = "diplomacy" | "daily" | "memorial" | "bacchus" | "event" | "declare" | "response" | "guides";

export const SERIES: { id: BadgeSeries; name: string; code: string }[] = [
  { id: "diplomacy", name: "外交系列", code: "DIPLOMACY" },
  { id: "daily", name: "日常系列", code: "DAILY" },
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
 * everyday sentences (not 祝我生日快乐) they ever sent; guideFriends how many guides are 触须之交. The third
 * round's: days they scanned the radar, a roach of theirs spent the night by 塔露拉干员's fire, and they touched a
 * player sneakily; 触须之交 they wished 生日快乐！, and who covered them with a quilt; main roach moves of
 * MOVING_CITY_KM or more; badges held besides 罗德岛正式干员; and how many of ELITE_SERIES they hold one of.
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
  | "guideFriends"
  | "radarDays"
  | "fireNights"
  | "sneakDays"
  | "birthdayWishes"
  | "quilters"
  | "farMoves"
  | "badgesOwned"
  | "seriesCovered";

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
/** 狂响的声筒: the main roach and at least this many clones in one declaration */
export const LOUDHORN_CLONES = 2;
/** 喧闹法则: this many responses to one declaration */
export const ROWDY_REACTIONS = 30;
/** 共患难的战友: 触须之交 this many days without a break */
export const COMRADE_DAYS = 30;
/** 移动城市: a move of the main roach this far counts */
export const MOVING_CITY_KM = 100;
/** 我真的不能再喝了: 醒酒 within this many seconds of getting drunk */
export const NO_MORE_SECONDS = 60;
/** 罗德岛精英干员: one of each of these series */
export const ELITE_SERIES: BadgeSeries[] = ["diplomacy", "declare", "response", "guides", "bacchus"];

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
    id: "ingame",
    name: "相见欢",
    code: "DIP-GAME",
    series: "diplomacy",
    condition: "第一次和触须之交在游戏里也成了好友（一方点「我在游戏里申请了」，另一方点「我也加了」），两人都拿",
    lockedHint: "和触须之交在游戏里也加个好友",
    quote: "地图上碰过触须，游戏里也见着了。",
    pill: { background: "#c8352f", color: "#ffe08a", border: "1.5px solid #c8352f" },
  },
  {
    id: "comrade",
    name: "共患难的战友",
    code: "DIP-30D",
    series: "diplomacy",
    condition: "和同一位触须之交做满 30 天，中间没解除，两人都拿",
    lockedHint: "和同一位触须之交做满 30 天",
    quote: "别那么拘谨，我们可已经是共患难的战友了。",
    pill: { background: "#55642a", color: "#ffffff", border: "1.5px solid #36401a" },
  },
  {
    id: "summit",
    name: "万国峰会",
    code: "DIP-100",
    series: "diplomacy",
    condition: "和 100 位不同的舟P成为过触须之交",
    lockedHint: "{n} / 100 位",
    quote: "一百位触须之交，各国的代表都到齐了。",
    pill: { background: "#136148", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "friends", n: 100 },
  },
  {
    id: "postman",
    name: "罗德岛信使",
    code: "DAY-BDAY",
    series: "daily",
    condition: "给 5 位不同的触须之交的生日宣言回过「生日快乐！」",
    lockedHint: "{n} / 5 位",
    quote: "有你的信——五份生日祝福，都是你送到的。",
    pill: { background: "#e7f2ff", color: "#1f5fb8", border: "1.5px solid #3d8ef0" },
    goal: { count: "birthdayWishes", n: 5 },
  },
  {
    id: "delivery",
    name: "使命必达",
    code: "DAY-VISIT",
    series: "daily",
    condition: "第一次派克隆体去触须之交家串门",
    lockedHint: "派克隆体去触须之交家串个门",
    quote: "咚咚！打扰了，有人在吗？送货上门——",
    pill: { background: "#fff3dc", color: "#7a4a25", border: "1.5px solid #b0703f" },
  },
  {
    id: "longtime",
    name: "好久不见",
    code: "DAY-WAKE",
    series: "daily",
    condition: "你戳过的触须之交睡醒回来了（第一次）",
    lockedHint: "戳一戳睡着的触须之交，等 TA 醒来",
    quote: "你戳过的那位醒了。好久不见！",
    pill: { background: "#fff4dc", color: "#9a5a00", border: "1.5px solid #f0a019" },
  },
  {
    id: "twins",
    name: "异卵同生",
    code: "DAY-CLONE",
    series: "daily",
    condition: "第一次放出克隆体",
    lockedHint: "放出一只克隆体",
    quote: "又一只你，出门去了。",
    pill: { background: "#eef7ff", color: "#1f5fb8", border: "1.5px dashed #3d8ef0" },
  },
  {
    id: "stormchaser",
    name: "天灾信使",
    code: "DAY-RADAR",
    series: "daily",
    condition: "累计 10 天用过方舟雷达",
    lockedHint: "{n} / 10 天",
    quote: "十天的雷达，附近有多少舟P，你心里有数。",
    pill: { background: "#10251f", color: "#3fd0d4", border: "1.5px solid #3fd0d4" },
    goal: { count: "radarDays", n: 10 },
  },
  {
    id: "treeshade",
    name: "眠于树影之中",
    code: "DAY-NAP",
    series: "daily",
    condition: "睡着的时候被 3 位不同的触须之交盖过被子",
    lockedHint: "{n} / 3 位",
    quote: "睡着的时候，三位触须之交给你盖过被子。",
    pill: { background: "#e6f6e9", color: "#2f7d4a", border: "1.5px solid #4caf6a" },
    goal: { count: "quilters", n: 3 },
  },
  {
    id: "movingcity",
    name: "移动城市",
    code: "DAY-MOVE",
    series: "daily",
    condition: "本体搬过 3 次家，每次相隔 100 公里以上",
    lockedHint: "{n} / 3 次",
    quote: "搬了三次家，你的城市一直在路上。",
    pill: { background: "#f3dca6", color: "#123e80", border: "1.5px solid #3d8ef0" },
    goal: { count: "farMoves", n: 3 },
  },
  {
    id: "silentbolt",
    name: "惊霆无声",
    code: "DAY-SNEAK",
    series: "daily",
    condition: "累计 10 天偷偷碰过人",
    lockedHint: "{n} / 10 天",
    quote: "十天，悄悄碰过去，一点声响都没有。",
    pill: { background: "#1b2046", color: "#ffd23f", border: "1.5px solid #3d8ef0" },
    goal: { count: "sneakDays", n: 10 },
  },
  {
    id: "firstbatch",
    name: "首批蟑螂",
    code: "MEM-1000",
    series: "memorial",
    condition: `前 ${FIRST_BATCH} 个注册的舟P`,
    lockedHint: `前 ${FIRST_BATCH} 名专属`,
    quote: `你是第 {serial} 只来到${siteName()}的蟑螂！`,
    pill: { background: "#1b1d22", color: "#ffd23f", border: "1.5px solid #ffd23f" },
  },
  {
    id: "beta",
    name: "内测功臣",
    code: "MEM-BETA",
    series: "memorial",
    condition: "站长颁发，给内测时帮忙找 bug 的人",
    lockedHint: "站长颁发",
    quote: `感谢你帮${siteName()}抓虫！`,
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
    id: "regular",
    name: "罗德岛正式干员",
    code: "MEM-5",
    series: "memorial",
    condition: "拿到第 5 枚徽章",
    lockedHint: "{n} / 5 枚",
    quote: "人事部同意你晋升为罗德岛正式干员。",
    pill: { background: "#f4f6fa", color: "#1f2a44", border: "1.5px solid #1f2a44" },
    goal: { count: "badgesOwned", n: 5 },
  },
  {
    id: "elite",
    name: "罗德岛精英干员",
    code: "MEM-ELITE",
    series: "memorial",
    condition: "外交、宣言、回应、向导、酒神 5 个系列，每个都至少拿到 1 枚",
    lockedHint: "{n} / 5 个系列",
    quote: "五个系列都有你，罗德岛的精英干员。",
    pill: { background: "linear-gradient(100deg, #1f2a44 0%, #2c3d72 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "seriesCovered", n: 5 },
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
    id: "thousandcups",
    name: "人称千杯",
    code: "BAC-10",
    series: "bacchus",
    condition: "主动醉倒满 10 次，每次都算",
    lockedHint: "{n} / 10 次",
    quote: "醉倒十次，酒馆里有人叫你「千杯」了。",
    pill: { background: "#7a4a25", color: "#ffe08a", border: "1.5px solid #b0703f" },
    goal: { count: "drinks", n: 10 },
  },
  {
    id: "bigjar",
    name: "人称万两",
    code: "BAC-100",
    series: "bacchus",
    condition: "主动醉倒满 100 次，每次都算",
    lockedHint: "{n} / 100 次",
    quote: "醉倒一百次，「万两」这个名号归你了。",
    pill: { background: "linear-gradient(100deg, #3b1f5c 0%, #8a5530 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "drinks", n: 100 },
  },
  {
    id: "nomore",
    name: "我真的不能再喝了",
    code: "BAC-1MIN",
    series: "bacchus",
    condition: "醉倒后不到 1 分钟就点了「醒酒」",
    lockedHint: "醉倒后 1 分钟内醒酒",
    quote: "……不行，我真的不能再喝了。我要回去了……",
    pill: { background: "#fbfaf5", color: "#c23a5e", border: "1.5px solid #c23a5e" },
  },
  {
    id: "drinkup",
    name: "将进酒",
    code: "BAC-PARTY",
    series: "bacchus",
    condition: "醉倒的时候开过一次「⚡舟友的酒⚡」",
    lockedHint: "醉着的时候开一次舟友的酒",
    quote: "喝酒吗？……音乐都放起来了。",
    pill: { background: "#3b1f5c", color: "#ffe08a", border: "1.5px solid #ff5c93" },
  },
  {
    id: "secondwind",
    name: "二次呼吸",
    code: "BAC-8AM",
    series: "bacchus",
    condition: "醉倒后没点「醒酒」，一觉睡到早上 8 点自然醒",
    lockedHint: "醉倒后别点醒酒，睡到早上 8 点",
    quote: "没点醒酒，一觉睡到八点。深呼吸，又是新的一天。",
    pill: { background: "#ffe3a8", color: "#c23a5e", border: "1.5px solid #c23a5e" },
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
    condition: "第一次发宣言",
    lockedHint: "发一句宣言",
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
    id: "globetrotter",
    name: "万国信使",
    code: "DEC-365",
    series: "declare",
    condition: "累计 365 天发过宣言",
    lockedHint: "{n} / 365 天",
    quote: "这一年，作为万国信使，你踏过了太多前所未见的土地。",
    pill: { background: "linear-gradient(100deg, #22306a 0%, #3b2f8f 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "declareDays", n: 365 },
  },
  {
    id: "loudhorn",
    name: "狂响的声筒",
    code: "DEC-X3",
    series: "declare",
    condition: "本体带着 2 只以上克隆体一起发了一次宣言（3 只同时喊）",
    lockedHint: "本体带上 2 只克隆体一起发一次宣言",
    quote: "三只一起开口，整片地图都听见了。",
    pill: { background: "#ff8a2a", color: "#ffffff", border: "1.5px solid #c25a12" },
  },
  {
    id: "rowdy",
    name: "喧闹法则",
    code: "DEC-ECHO30",
    series: "declare",
    condition: "有一条宣言收到 30 个回应",
    lockedHint: "让一条宣言收到 30 个回应",
    quote: "一条宣言换来三十个回应，热闹得像过节。",
    pill: { background: "#2a1840", color: "#ffb36b", border: "1.5px solid #ff8a2a" },
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
    id: "empathy",
    name: "萨科塔的共感",
    code: "RE-HALO",
    series: "response",
    condition: "累计 50 天回应过宣言",
    lockedHint: "{n} / 50 天",
    quote: "身边的人是快乐还是难过，你都感受得到。",
    pill: { background: "#0e3b37", color: "#ffe08a", border: "1.5px solid #2ec4b6" },
    goal: { count: "reactDays", n: 50 },
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
    id: "warmth",
    name: "温暖你的战友",
    code: "GD-WARM",
    series: "guides",
    condition: "累计 10 天有蟑螂在塔露拉的篝火边过夜（每天 4 点数火边的时候算一天）",
    lockedHint: "{n} / 10 天",
    quote: "威慑敌人那半句用不上，火边只有战友。",
    pill: { background: "#2a1f4a", color: "#ffb36b", border: "1.5px solid #ff7a2a" },
    goal: { count: "fireNights", n: 10 },
    pictureArt: "badge-warmth",
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
    id: "siqueue",
    name: "门口排着去",
    code: "GD-SI-QUEUE",
    series: "guides",
    condition: "你的墨小强头一回在缘缘庄门口排上队",
    lockedHint: "缘缘庄客满时，去门口排一回队",
    quote: "客满了，门口排着去。……排队的路，我都给你画好了。",
    pill: { background: "#fbe9e4", color: "#b8321f", border: "1.5px solid #d9472b" },
    pictureArt: "badge-siqueue",
  },
  {
    id: "siinn",
    name: "塔卫二最好的客栈",
    code: "GD-SI-INN",
    series: "guides",
    condition: "你的墨小强头一回住进缘缘庄",
    lockedHint: "排到你，住进缘缘庄",
    quote: "被子是新晒的，才、才不是为你晒的。",
    pill: { background: "#fbe9e4", color: "#b8321f", border: "1.5px solid #d9472b" },
    pictureArt: "badge-siinn",
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

/** 罗德岛正式干员's count: the badges held besides itself */
export const badgesOwned = (held: { id: string }[]) => held.filter((b) => b.id !== "regular").length;

/** 罗德岛精英干员's count: how many of ELITE_SERIES a badge is held of */
export const seriesCovered = (held: { id: string }[]) =>
  ELITE_SERIES.filter((series) => held.some((b) => badgeById(b.id)?.series === series)).length;

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

/**
 * Counts a player is nudged about: 触须之交, responders, and days (of declaring, responding, the radar, nights by
 * the fire, touching sneakily); of drinking only 人称千杯 and 人称万两; the guides, the sentences and the one-off
 * badges never are
 */
const NUDGED: BadgeCount[] = ["friends", "responders", "declareDays", "reactDays", "radarDays", "fireNights", "sneakDays"];
/** Of the drinking ones, only these two: never the first drink, nor 泰拉异格酒神 */
const NUDGED_DRINKS = ["thousandcups", "bigjar"];

/** The badge earned by one of the NUDGED counts that a player is the fewest steps away from. */
export function nextBadge(earned: ShownBadge[], counts: Record<BadgeCount, number>) {
  let best: { name: string; count: BadgeCount; more: number } | null = null;
  for (const b of BADGES) {
    const nudged = b.goal && (NUDGED.includes(b.goal.count) || NUDGED_DRINKS.includes(b.id));
    if (!b.goal || !nudged || earned.some((e) => e.id === b.id)) continue;
    const more = b.goal.n - counts[b.goal.count];
    if (more > 0 && (!best || more < best.more)) best = { name: b.name, count: b.goal.count, more };
  }
  return best;
}
