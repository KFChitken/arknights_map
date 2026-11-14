import { fmt, T } from "@/i18n";
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
  {
    id: "diplomacy",
    get name() {
      return T.lib.badges.series.diplomacy;
    },
    code: "DIPLOMACY",
  },
  {
    id: "daily",
    get name() {
      return T.lib.badges.series.daily;
    },
    code: "DAILY",
  },
  {
    id: "memorial",
    get name() {
      return T.lib.badges.series.memorial;
    },
    code: "MEMORIAL",
  },
  {
    id: "bacchus",
    get name() {
      return T.lib.badges.series.bacchus;
    },
    code: "BACCHUS",
  },
  {
    id: "event",
    get name() {
      return T.lib.badges.series.event;
    },
    code: "EVENT",
  },
  {
    id: "declare",
    get name() {
      return T.lib.badges.series.declare;
    },
    code: "DECLARE",
  },
  {
    id: "response",
    get name() {
      return T.lib.badges.series.response;
    },
    code: "RESPONSE",
  },
  {
    id: "guides",
    get name() {
      return T.lib.badges.series.guides;
    },
    code: "GUIDES",
  },
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

/** The everyday sentences 满嘴舟语 asks for: all but 祝我生日快乐 and 卫戍协议，启动！, and no limited or drunk ones */
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
    get name() {
      return T.lib.badges.trainee.name;
    },
    code: "DIP-01",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.trainee.condition;
    },
    get lockedHint() {
      return T.lib.badges.trainee.lockedHint;
    },
    get quote() {
      return T.lib.badges.trainee.quote;
    },
    pill: { background: "#e3f8ee", color: "#1f7a56", border: "1.5px solid #86e0b9" },
    goal: { count: "friends", n: 1 },
  },
  {
    id: "diplomat",
    get name() {
      return T.lib.badges.diplomat.name;
    },
    code: "DIP-10",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.diplomat.condition;
    },
    get lockedHint() {
      return T.lib.badges.diplomat.lockedHint;
    },
    get quote() {
      return T.lib.badges.diplomat.quote;
    },
    pill: { background: "#2b3d8f", color: "#ffe48a", border: "1.5px solid #2b3d8f" },
    goal: { count: "friends", n: 10 },
  },
  {
    id: "ambassador",
    get name() {
      return T.lib.badges.ambassador.name;
    },
    code: "DIP-30",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.ambassador.condition;
    },
    get lockedHint() {
      return T.lib.badges.ambassador.lockedHint;
    },
    get quote() {
      return T.lib.badges.ambassador.quote;
    },
    pill: { background: "#4b32b0", color: "#ffffff", border: "1.5px solid #ffcc3d" },
    goal: { count: "friends", n: 30 },
  },
  {
    id: "farwhisker",
    get name() {
      return T.lib.badges.farwhisker.name;
    },
    code: "DIP-1000KM",
    series: "diplomacy",
    get condition() {
      return fmt(T.lib.badges.farwhisker.condition, { km: FAR_FRIEND_KM });
    },
    get lockedHint() {
      return T.lib.badges.farwhisker.lockedHint;
    },
    get quote() {
      return T.lib.badges.farwhisker.quote;
    },
    pill: {
      background:
        "linear-gradient(#fffaf0, #fffaf0) padding-box, repeating-linear-gradient(-45deg, #ec4b45 0 6px, #fffaf0 6px 9px, #2e6fd8 9px 15px, #fffaf0 15px 18px) border-box",
      color: "#2e6fd8",
      border: "2px solid transparent",
    },
  },
  {
    id: "spokesperson",
    get name() {
      return T.lib.badges.spokesperson.name;
    },
    code: "DIP-PRESS",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.spokesperson.condition;
    },
    get lockedHint() {
      return T.lib.badges.spokesperson.lockedHint;
    },
    get quote() {
      return T.lib.badges.spokesperson.quote;
    },
    pill: { background: "#ff6f5e", color: "#ffffff", border: "1.5px solid #ff6f5e" },
    goal: { count: "responders", n: 10 },
  },
  {
    id: "ingame",
    get name() {
      return T.lib.badges.ingame.name;
    },
    code: "DIP-GAME",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.ingame.condition;
    },
    get lockedHint() {
      return T.lib.badges.ingame.lockedHint;
    },
    get quote() {
      return T.lib.badges.ingame.quote;
    },
    pill: { background: "#c8352f", color: "#ffe08a", border: "1.5px solid #c8352f" },
  },
  {
    id: "comrade",
    get name() {
      return T.lib.badges.comrade.name;
    },
    code: "DIP-30D",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.comrade.condition;
    },
    get lockedHint() {
      return T.lib.badges.comrade.lockedHint;
    },
    get quote() {
      return T.lib.badges.comrade.quote;
    },
    pill: { background: "#55642a", color: "#ffffff", border: "1.5px solid #36401a" },
  },
  {
    id: "summit",
    get name() {
      return T.lib.badges.summit.name;
    },
    code: "DIP-100",
    series: "diplomacy",
    get condition() {
      return T.lib.badges.summit.condition;
    },
    get lockedHint() {
      return T.lib.badges.summit.lockedHint;
    },
    get quote() {
      return T.lib.badges.summit.quote;
    },
    pill: { background: "#136148", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "friends", n: 100 },
  },
  {
    id: "postman",
    get name() {
      return T.lib.badges.postman.name;
    },
    code: "DAY-BDAY",
    series: "daily",
    get condition() {
      return T.lib.badges.postman.condition;
    },
    get lockedHint() {
      return T.lib.badges.postman.lockedHint;
    },
    get quote() {
      return T.lib.badges.postman.quote;
    },
    pill: { background: "#e7f2ff", color: "#1f5fb8", border: "1.5px solid #3d8ef0" },
    goal: { count: "birthdayWishes", n: 5 },
  },
  {
    id: "delivery",
    get name() {
      return T.lib.badges.delivery.name;
    },
    code: "DAY-VISIT",
    series: "daily",
    get condition() {
      return T.lib.badges.delivery.condition;
    },
    get lockedHint() {
      return T.lib.badges.delivery.lockedHint;
    },
    get quote() {
      return T.lib.badges.delivery.quote;
    },
    pill: { background: "#fff3dc", color: "#7a4a25", border: "1.5px solid #b0703f" },
  },
  {
    id: "longtime",
    get name() {
      return T.lib.badges.longtime.name;
    },
    code: "DAY-WAKE",
    series: "daily",
    get condition() {
      return T.lib.badges.longtime.condition;
    },
    get lockedHint() {
      return T.lib.badges.longtime.lockedHint;
    },
    get quote() {
      return T.lib.badges.longtime.quote;
    },
    pill: { background: "#fff4dc", color: "#9a5a00", border: "1.5px solid #f0a019" },
  },
  {
    id: "twins",
    get name() {
      return T.lib.badges.twins.name;
    },
    code: "DAY-CLONE",
    series: "daily",
    get condition() {
      return T.lib.badges.twins.condition;
    },
    get lockedHint() {
      return T.lib.badges.twins.lockedHint;
    },
    get quote() {
      return T.lib.badges.twins.quote;
    },
    pill: { background: "#eef7ff", color: "#1f5fb8", border: "1.5px dashed #3d8ef0" },
  },
  {
    id: "stormchaser",
    get name() {
      return T.lib.badges.stormchaser.name;
    },
    code: "DAY-RADAR",
    series: "daily",
    get condition() {
      return T.lib.badges.stormchaser.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days10;
    },
    get quote() {
      return T.lib.badges.stormchaser.quote;
    },
    pill: { background: "#10251f", color: "#3fd0d4", border: "1.5px solid #3fd0d4" },
    goal: { count: "radarDays", n: 10 },
  },
  {
    id: "treeshade",
    get name() {
      return T.lib.badges.treeshade.name;
    },
    code: "DAY-NAP",
    series: "daily",
    get condition() {
      return T.lib.badges.treeshade.condition;
    },
    get lockedHint() {
      return T.lib.badges.treeshade.lockedHint;
    },
    get quote() {
      return T.lib.badges.treeshade.quote;
    },
    pill: { background: "#e6f6e9", color: "#2f7d4a", border: "1.5px solid #4caf6a" },
    goal: { count: "quilters", n: 3 },
  },
  {
    id: "movingcity",
    get name() {
      return T.lib.badges.movingcity.name;
    },
    code: "DAY-MOVE",
    series: "daily",
    get condition() {
      return T.lib.badges.movingcity.condition;
    },
    get lockedHint() {
      return T.lib.badges.movingcity.lockedHint;
    },
    get quote() {
      return T.lib.badges.movingcity.quote;
    },
    pill: { background: "#f3dca6", color: "#123e80", border: "1.5px solid #3d8ef0" },
    goal: { count: "farMoves", n: 3 },
  },
  {
    id: "silentbolt",
    get name() {
      return T.lib.badges.silentbolt.name;
    },
    code: "DAY-SNEAK",
    series: "daily",
    get condition() {
      return T.lib.badges.silentbolt.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days10;
    },
    get quote() {
      return T.lib.badges.silentbolt.quote;
    },
    pill: { background: "#1b2046", color: "#ffd23f", border: "1.5px solid #3d8ef0" },
    goal: { count: "sneakDays", n: 10 },
  },
  {
    id: "firstbatch",
    get name() {
      return T.lib.badges.firstbatch.name;
    },
    code: "MEM-1000",
    series: "memorial",
    get condition() {
      return fmt(T.lib.badges.firstbatch.condition, { n: FIRST_BATCH });
    },
    get lockedHint() {
      return fmt(T.lib.badges.firstbatch.lockedHint, { n: FIRST_BATCH });
    },
    get quote() {
      return fmt(T.lib.badges.firstbatch.quote, { site: siteName() });
    },
    pill: { background: "#1b1d22", color: "#ffd23f", border: "1.5px solid #ffd23f" },
  },
  {
    id: "beta",
    get name() {
      return T.lib.badges.beta.name;
    },
    code: "MEM-BETA",
    series: "memorial",
    get condition() {
      return T.lib.badges.beta.condition;
    },
    get lockedHint() {
      return T.lib.badges.beta.lockedHint;
    },
    get quote() {
      return fmt(T.lib.badges.beta.quote, { site: siteName() });
    },
    pill: { background: "#3a74e8", color: "#ffffff", border: "1.5px solid #3a74e8" },
  },
  {
    id: "survivor",
    get name() {
      return T.lib.badges.survivor.name;
    },
    code: "MEM-14D",
    series: "memorial",
    get condition() {
      return fmt(T.lib.badges.survivor.condition, { awayDays: AWAY_DAYS, holdDays: SURVIVOR_DAYS });
    },
    get lockedHint() {
      return fmt(T.lib.badges.survivor.lockedHint, { awayDays: AWAY_DAYS });
    },
    get quote() {
      return T.lib.badges.survivor.quote;
    },
    pill: { background: "#24a874", color: "#ffffff", border: "1.5px solid #24a874" },
    days: SURVIVOR_DAYS,
  },
  {
    id: "regular",
    get name() {
      return T.lib.badges.regular.name;
    },
    code: "MEM-5",
    series: "memorial",
    get condition() {
      return T.lib.badges.regular.condition;
    },
    get lockedHint() {
      return T.lib.badges.regular.lockedHint;
    },
    get quote() {
      return T.lib.badges.regular.quote;
    },
    pill: { background: "#f4f6fa", color: "#1f2a44", border: "1.5px solid #1f2a44" },
    goal: { count: "badgesOwned", n: 5 },
  },
  {
    id: "elite",
    get name() {
      return T.lib.badges.elite.name;
    },
    code: "MEM-ELITE",
    series: "memorial",
    get condition() {
      return T.lib.badges.elite.condition;
    },
    get lockedHint() {
      return T.lib.badges.elite.lockedHint;
    },
    get quote() {
      return T.lib.badges.elite.quote;
    },
    pill: { background: "linear-gradient(100deg, #1f2a44 0%, #2c3d72 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "seriesCovered", n: 5 },
  },
  {
    id: "tipsy",
    get name() {
      return T.lib.badges.tipsy.name;
    },
    code: "BAC-01",
    series: "bacchus",
    get condition() {
      return T.lib.badges.tipsy.condition;
    },
    get lockedHint() {
      return T.lib.badges.tipsy.lockedHint;
    },
    get quote() {
      return T.lib.badges.tipsy.quote;
    },
    pill: { background: "#c23a5e", color: "#ffffff", border: "1.5px solid #c23a5e" },
    goal: { count: "drinks", n: 1 },
  },
  {
    id: "bacchus",
    get name() {
      return T.lib.badges.bacchus.name;
    },
    code: "BAC-50",
    series: "bacchus",
    get condition() {
      return T.lib.badges.bacchus.condition;
    },
    get lockedHint() {
      return T.lib.badges.bacchus.lockedHint;
    },
    get quote() {
      return T.lib.badges.bacchus.quote;
    },
    pill: { background: "linear-gradient(100deg, #3b1f5c 0%, #8e2a5a 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "drinks", n: 50 },
  },
  {
    id: "thousandcups",
    get name() {
      return T.lib.badges.thousandcups.name;
    },
    code: "BAC-10",
    series: "bacchus",
    get condition() {
      return T.lib.badges.thousandcups.condition;
    },
    get lockedHint() {
      return T.lib.badges.thousandcups.lockedHint;
    },
    get quote() {
      return T.lib.badges.thousandcups.quote;
    },
    pill: { background: "#7a4a25", color: "#ffe08a", border: "1.5px solid #b0703f" },
    goal: { count: "drinks", n: 10 },
  },
  {
    id: "bigjar",
    get name() {
      return T.lib.badges.bigjar.name;
    },
    code: "BAC-100",
    series: "bacchus",
    get condition() {
      return T.lib.badges.bigjar.condition;
    },
    get lockedHint() {
      return T.lib.badges.bigjar.lockedHint;
    },
    get quote() {
      return T.lib.badges.bigjar.quote;
    },
    pill: { background: "linear-gradient(100deg, #3b1f5c 0%, #8a5530 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "drinks", n: 100 },
  },
  {
    id: "nomore",
    get name() {
      return T.lib.badges.nomore.name;
    },
    code: "BAC-1MIN",
    series: "bacchus",
    get condition() {
      return T.lib.badges.nomore.condition;
    },
    get lockedHint() {
      return T.lib.badges.nomore.lockedHint;
    },
    get quote() {
      return T.lib.badges.nomore.quote;
    },
    pill: { background: "#fbfaf5", color: "#c23a5e", border: "1.5px solid #c23a5e" },
  },
  {
    id: "drinkup",
    get name() {
      return T.lib.badges.drinkup.name;
    },
    code: "BAC-PARTY",
    series: "bacchus",
    get condition() {
      return T.lib.badges.drinkup.condition;
    },
    get lockedHint() {
      return T.lib.badges.drinkup.lockedHint;
    },
    get quote() {
      return T.lib.badges.drinkup.quote;
    },
    pill: { background: "#3b1f5c", color: "#ffe08a", border: "1.5px solid #ff5c93" },
  },
  {
    id: "secondwind",
    get name() {
      return T.lib.badges.secondwind.name;
    },
    code: "BAC-8AM",
    series: "bacchus",
    get condition() {
      return T.lib.badges.secondwind.condition;
    },
    get lockedHint() {
      return T.lib.badges.secondwind.lockedHint;
    },
    get quote() {
      return T.lib.badges.secondwind.quote;
    },
    pill: { background: "#ffe3a8", color: "#c23a5e", border: "1.5px solid #c23a5e" },
  },
  {
    // each event brings its own badge, named in events.ts
    id: "half2026",
    get name() {
      return T.lib.badges.half2026.name;
    },
    code: "EVT-01 · 7.5TH",
    series: "event",
    get condition() {
      return T.lib.badges.half2026.condition;
    },
    get lockedHint() {
      return T.lib.badges.half2026.lockedHint;
    },
    get quote() {
      return T.lib.badges.half2026.quote;
    },
    pill: {
      background: "linear-gradient(100deg, #2a3f6e 0%, #2a3f6e 40%, #d9482b 64%, #ff8a3d 100%)",
      color: "#ffffff",
      border: "1.5px solid #f6c343",
    },
  },
  {
    id: "lookatme",
    get name() {
      return T.lib.badges.lookatme.name;
    },
    code: "DEC-01",
    series: "declare",
    get condition() {
      return T.lib.badges.lookatme.condition;
    },
    get lockedHint() {
      return T.lib.badges.lookatme.lockedHint;
    },
    get quote() {
      return T.lib.badges.lookatme.quote;
    },
    pill: { background: "#fff3c4", color: "#b8371c", border: "1.5px solid #ffd23f" },
    goal: { count: "declareDays", n: 1 },
  },
  {
    id: "declarer",
    get name() {
      return T.lib.badges.declarer.name;
    },
    code: "DEC-10",
    series: "declare",
    get condition() {
      return T.lib.badges.declarer.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days10;
    },
    get quote() {
      return T.lib.badges.declarer.quote;
    },
    pill: { background: "#1f2a44", color: "#ffffff", border: "1.5px solid #ff8a2a" },
    goal: { count: "declareDays", n: 10 },
  },
  {
    id: "chief",
    get name() {
      return T.lib.badges.chief.name;
    },
    code: "DEC-30",
    series: "declare",
    get condition() {
      return T.lib.badges.chief.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days30;
    },
    get quote() {
      return T.lib.badges.chief.quote;
    },
    pill: { background: "#22305c", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "declareDays", n: 30 },
  },
  {
    id: "resound",
    get name() {
      return T.lib.badges.resound.name;
    },
    code: "DEC-100",
    series: "declare",
    get condition() {
      return T.lib.badges.resound.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days100;
    },
    get quote() {
      return T.lib.badges.resound.quote;
    },
    pill: { background: "#5a2f86", color: "#ffe08a", border: "1.5px solid #3a74e8" },
    goal: { count: "declareDays", n: 100 },
  },
  {
    id: "echo",
    get name() {
      return T.lib.badges.echo.name;
    },
    code: "DEC-ECHO",
    series: "declare",
    get condition() {
      return T.lib.badges.echo.condition;
    },
    get lockedHint() {
      return T.lib.badges.echo.lockedHint;
    },
    get quote() {
      return T.lib.badges.echo.quote;
    },
    pill: { background: "#fff4e0", color: "#c25a12", border: "1.5px solid #ff8a2a" },
  },
  {
    id: "fluent",
    get name() {
      return T.lib.badges.fluent.name;
    },
    code: "DEC-8",
    series: "declare",
    get condition() {
      return T.lib.badges.fluent.condition;
    },
    get lockedHint() {
      return T.lib.badges.fluent.lockedHint;
    },
    get quote() {
      return T.lib.badges.fluent.quote;
    },
    pill: { background: "#fff6e6", color: "#a8282d", border: "1.5px solid #ffb547" },
    goal: { count: "declareLines", n: 8 },
  },
  {
    id: "globetrotter",
    get name() {
      return T.lib.badges.globetrotter.name;
    },
    code: "DEC-365",
    series: "declare",
    get condition() {
      return T.lib.badges.globetrotter.condition;
    },
    get lockedHint() {
      return T.lib.badges.globetrotter.lockedHint;
    },
    get quote() {
      return T.lib.badges.globetrotter.quote;
    },
    pill: { background: "linear-gradient(100deg, #22306a 0%, #3b2f8f 100%)", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "declareDays", n: 365 },
  },
  {
    id: "loudhorn",
    get name() {
      return T.lib.badges.loudhorn.name;
    },
    code: "DEC-X3",
    series: "declare",
    get condition() {
      return T.lib.badges.loudhorn.condition;
    },
    get lockedHint() {
      return T.lib.badges.loudhorn.lockedHint;
    },
    get quote() {
      return T.lib.badges.loudhorn.quote;
    },
    pill: { background: "#ff8a2a", color: "#ffffff", border: "1.5px solid #c25a12" },
  },
  {
    id: "rowdy",
    get name() {
      return T.lib.badges.rowdy.name;
    },
    code: "DEC-ECHO30",
    series: "declare",
    get condition() {
      return T.lib.badges.rowdy.condition;
    },
    get lockedHint() {
      return T.lib.badges.rowdy.lockedHint;
    },
    get quote() {
      return T.lib.badges.rowdy.quote;
    },
    pill: { background: "#2a1840", color: "#ffb36b", border: "1.5px solid #ff8a2a" },
  },
  {
    id: "courtesy",
    get name() {
      return T.lib.badges.courtesy.name;
    },
    code: "RE-01",
    series: "response",
    get condition() {
      return T.lib.badges.courtesy.condition;
    },
    get lockedHint() {
      return T.lib.badges.courtesy.lockedHint;
    },
    get quote() {
      return T.lib.badges.courtesy.quote;
    },
    pill: { background: "#e3faf6", color: "#178a80", border: "1.5px solid #2ec4b6" },
    goal: { count: "reactDays", n: 1 },
  },
  {
    id: "hype",
    get name() {
      return T.lib.badges.hype.name;
    },
    code: "RE-10",
    series: "response",
    get condition() {
      return T.lib.badges.hype.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days10;
    },
    get quote() {
      return T.lib.badges.hype.quote;
    },
    pill: { background: "#221a3c", color: "#ff9fc0", border: "1.5px solid #ff5c93" },
    goal: { count: "reactDays", n: 10 },
  },
  {
    id: "sidekick",
    get name() {
      return T.lib.badges.sidekick.name;
    },
    code: "RE-30",
    series: "response",
    get condition() {
      return T.lib.badges.sidekick.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days30;
    },
    get quote() {
      return T.lib.badges.sidekick.quote;
    },
    pill: { background: "#9e1f35", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "reactDays", n: 30 },
  },
  {
    id: "responder",
    get name() {
      return T.lib.badges.responder.name;
    },
    code: "RE-100",
    series: "response",
    get condition() {
      return T.lib.badges.responder.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days100;
    },
    get quote() {
      return T.lib.badges.responder.quote;
    },
    pill: { background: "#3b2385", color: "#ffe08a", border: "1.5px solid #f6c343" },
    goal: { count: "reactDays", n: 100 },
  },
  {
    id: "declfriend",
    get name() {
      return T.lib.badges.declfriend.name;
    },
    code: "RE-PAL",
    series: "response",
    get condition() {
      return T.lib.badges.declfriend.condition;
    },
    get lockedHint() {
      return T.lib.badges.declfriend.lockedHint;
    },
    get quote() {
      return T.lib.badges.declfriend.quote;
    },
    pill: { background: "linear-gradient(90deg, #ffe3c7, #d6f6f2)", color: "#0d5a53", border: "1.5px solid #2ec4b6" },
  },
  {
    id: "empathy",
    get name() {
      return T.lib.badges.empathy.name;
    },
    code: "RE-HALO",
    series: "response",
    get condition() {
      return T.lib.badges.empathy.condition;
    },
    get lockedHint() {
      return T.lib.badges.empathy.lockedHint;
    },
    get quote() {
      return T.lib.badges.empathy.quote;
    },
    pill: { background: "#0e3b37", color: "#ffe08a", border: "1.5px solid #2ec4b6" },
    goal: { count: "reactDays", n: 50 },
  },
  {
    id: "amiya",
    get name() {
      return T.lib.badges.amiya.name;
    },
    code: "GD-AMIYA",
    series: "guides",
    get condition() {
      return T.lib.badges.amiya.condition;
    },
    get lockedHint() {
      return T.lib.badges.amiya.lockedHint;
    },
    get quote() {
      return T.lib.badges.amiya.quote;
    },
    pill: { background: "#ffeaf3", color: "#c2477f", border: "1.5px solid #ff7eb6" },
    pictureArt: "badge-amiya",
  },
  {
    id: "perlica",
    get name() {
      return T.lib.badges.perlica.name;
    },
    code: "GD-PERLICA",
    series: "guides",
    get condition() {
      return T.lib.badges.perlica.condition;
    },
    get lockedHint() {
      return T.lib.badges.perlica.lockedHint;
    },
    get quote() {
      return T.lib.badges.perlica.quote;
    },
    pill: { background: "#e2f8f8", color: "#178a8e", border: "1.5px solid #3fd0d4" },
    pictureArt: "badge-perlica",
  },
  {
    id: "talulah",
    get name() {
      return T.lib.badges.talulah.name;
    },
    code: "GD-TALULAH",
    series: "guides",
    get condition() {
      return T.lib.badges.talulah.condition;
    },
    get lockedHint() {
      return T.lib.badges.talulah.lockedHint;
    },
    get quote() {
      return T.lib.badges.talulah.quote;
    },
    pill: { background: "#fff0e0", color: "#c25a12", border: "1.5px solid #ff9f43" },
    pictureArt: "badge-talulah",
  },
  {
    id: "minghe",
    get name() {
      return T.lib.badges.minghe.name;
    },
    code: "GD-MINGHE",
    series: "guides",
    get condition() {
      return T.lib.badges.minghe.condition;
    },
    get lockedHint() {
      return T.lib.badges.minghe.lockedHint;
    },
    get quote() {
      return T.lib.badges.minghe.quote;
    },
    pill: { background: "#1d2a5a", color: "#e8f1ff", border: "1.5px solid #5a78e6" },
    pictureArt: "badge-minghe",
  },
  {
    id: "amiya30",
    get name() {
      return T.lib.badges.amiya30.name;
    },
    code: "GD-AMIYA-30",
    series: "guides",
    get condition() {
      return T.lib.badges.amiya30.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days30;
    },
    get quote() {
      return T.lib.badges.amiya30.quote;
    },
    pill: { background: "#ffeaf3", color: "#c2477f", border: "1.5px solid #f6c343" },
    goal: { count: "amiyaDays", n: 30 },
    pictureArt: "badge-amiya30",
  },
  {
    id: "perlica30",
    get name() {
      return T.lib.badges.perlica30.name;
    },
    code: "GD-PERLICA-30",
    series: "guides",
    get condition() {
      return T.lib.badges.perlica30.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days30;
    },
    get quote() {
      return T.lib.badges.perlica30.quote;
    },
    pill: { background: "#e2f8f8", color: "#178a8e", border: "1.5px solid #f6c343" },
    goal: { count: "perlicaDays", n: 30 },
    pictureArt: "badge-perlica30",
  },
  {
    id: "fireside",
    get name() {
      return T.lib.badges.fireside.name;
    },
    code: "GD-FIRESIDE",
    series: "guides",
    get condition() {
      return T.lib.badges.fireside.condition;
    },
    get lockedHint() {
      return T.lib.badges.fireside.lockedHint;
    },
    get quote() {
      return T.lib.badges.fireside.quote;
    },
    pill: { background: "#2a1f4a", color: "#ffc94a", border: "1.5px solid #f6c343" },
    pictureArt: "badge-fireside",
  },
  {
    id: "warmth",
    get name() {
      return T.lib.badges.warmth.name;
    },
    code: "GD-WARM",
    series: "guides",
    get condition() {
      return T.lib.badges.warmth.condition;
    },
    get lockedHint() {
      return T.lib.badges.progress.days10;
    },
    get quote() {
      return T.lib.badges.warmth.quote;
    },
    pill: { background: "#2a1f4a", color: "#ffb36b", border: "1.5px solid #ff7a2a" },
    goal: { count: "fireNights", n: 10 },
    pictureArt: "badge-warmth",
  },
  {
    id: "sevenstops",
    get name() {
      return T.lib.badges.sevenstops.name;
    },
    code: "GD-SEVEN",
    series: "guides",
    get condition() {
      return T.lib.badges.sevenstops.condition;
    },
    get lockedHint() {
      return T.lib.badges.sevenstops.lockedHint;
    },
    get quote() {
      return T.lib.badges.sevenstops.quote;
    },
    pill: { background: "#1d2a5a", color: "#ffe08a", border: "1.5px solid #f6c343" },
    pictureArt: "badge-sevenstops",
  },
  {
    id: "siqueue",
    get name() {
      return T.lib.badges.siqueue.name;
    },
    code: "GD-SI-QUEUE",
    series: "guides",
    get condition() {
      return T.lib.badges.siqueue.condition;
    },
    get lockedHint() {
      return T.lib.badges.siqueue.lockedHint;
    },
    get quote() {
      return T.lib.badges.siqueue.quote;
    },
    pill: { background: "#fbe9e4", color: "#b8321f", border: "1.5px solid #d9472b" },
    pictureArt: "badge-siqueue",
  },
  {
    id: "siinn",
    get name() {
      return T.lib.badges.siinn.name;
    },
    code: "GD-SI-INN",
    series: "guides",
    get condition() {
      return T.lib.badges.siinn.condition;
    },
    get lockedHint() {
      return T.lib.badges.siinn.lockedHint;
    },
    get quote() {
      return T.lib.badges.siinn.quote;
    },
    pill: { background: "#fbe9e4", color: "#b8321f", border: "1.5px solid #d9472b" },
    pictureArt: "badge-siinn",
  },
  {
    id: "sibook",
    get name() {
      return T.lib.badges.sibook.name;
    },
    code: "GD-SI-BOOK",
    series: "guides",
    get condition() {
      return T.lib.badges.sibook.condition;
    },
    get lockedHint() {
      return T.lib.badges.sibook.lockedHint;
    },
    // her line at the 30th stamp (src/lib/si.ts STAMP_MILESTONES), word for word
    get quote() {
      return T.lib.si.milestone30;
    },
    pill: { background: "#fbe9e4", color: "#b8321f", border: "1.5px solid #d9472b" },
    pictureArt: "badge-sibook",
  },
  {
    id: "fullsquad",
    get name() {
      return T.lib.badges.fullsquad.name;
    },
    code: "GD-SQUAD",
    series: "guides",
    get condition() {
      return T.lib.badges.fullsquad.condition;
    },
    get lockedHint() {
      return T.lib.badges.fullsquad.lockedHint;
    },
    get quote() {
      return T.lib.badges.fullsquad.quote;
    },
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
export const daysLeft = (until: number, now = Date.now()) => fmt(T.lib.badges.daysLeft, { n: Math.max(1, Math.ceil((until - now) / 86_400_000)) });

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
