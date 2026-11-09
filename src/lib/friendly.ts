import { YEARS } from "./perlica";

/**
 * What 触须之交 can do for each other besides touching (the server side is
 * src/lib/server/friendly.ts): 催理智, the small gestures, 串门, adding each other in a game,
 * and the anniversaries of becoming 触须之交. All of it only between the two of them.
 */

/** The gestures while TA is awake, and the two for while TA sleeps (drunk or away) */
export const AWAKE_GESTURES = ["hug", "highfive", "luck"] as const;
export const SLEEP_GESTURES = ["blanket", "water"] as const;
export type AwakeGesture = (typeof AWAKE_GESTURES)[number];
export type SleepGesture = (typeof SLEEP_GESTURES)[number];
export type Gesture = AwakeGesture | SleepGesture;

export const isAwakeGesture = (x: unknown): x is AwakeGesture => (AWAKE_GESTURES as readonly unknown[]).includes(x);
export const isGesture = (x: unknown): x is Gesture => isAwakeGesture(x) || (SLEEP_GESTURES as readonly unknown[]).includes(x);

export const GESTURE_NAMES: Record<Gesture, string> = { hug: "贴贴", highfive: "击掌", luck: "吸欧气", blanket: "盖被子", water: "放杯白开水" };
/** The button once it is used up for today (or for this sleep) */
export const GESTURE_DONE: Record<Gesture, string> = { hug: "贴过了", highfive: "击过了", luck: "吸过了", blanket: "盖过了", water: "放过了" };
/** Answering one */
export const GESTURE_BACK: Record<AwakeGesture, string> = { hug: "贴回去", highfive: "击回去", luck: "吸回来" };

/** What TA reads, by your name */
export function gestureText(g: Gesture, who: string) {
  switch (g) {
    case "hug":
      return `${who} 和你贴贴了`;
    case "highfive":
      return `${who} 和你击了个掌`;
    case "luck":
      return `${who} 吸走了你的一口欧气`;
    case "blanket":
      return `你睡着的时候，${who} 给你盖了被子`;
    case "water":
      return `${who} 在你枕边放了一杯白开水`;
  }
}

/** What you read as yours goes out, by TA's name */
export function gestureSent(g: Gesture, who: string) {
  switch (g) {
    case "hug":
      return `和 ${who} 贴贴了！`;
    case "highfive":
      return `和 ${who} 击了个掌！`;
    case "luck":
      return `从 ${who} 那里吸了一口欧气，抽卡去吧！`;
    case "blanket":
      return `给 ${who} 盖好了被子。`;
    case "water":
      return `在 ${who} 枕边放了一杯白开水。`;
  }
}

/** 催理智, as TA reads it; asleep: sent while TA slept */
export const sanityText = (who: string, asleep: boolean) =>
  asleep ? `${who} 趁你睡着催你清理智啦！理智要溢出了。` : `${who} 催你清理智啦！理智要溢出了。`;
/** What you get back when TA says 「清完了！」 */
export const sanityThanks = (who: string) => `${who}：清完了，谢谢提醒！`;

/** 串门: after 请 TA 回家, the guest may not visit that host again for this long */
export const VISIT_BAN_DAYS = 3;

/** 游戏里也加个好友: 「我在游戏里申请了」 again for the same game, and 「想在游戏里加 TA」, at most this often */
export const GAME_ASK_DAYS = 7;

/** A 「祝我生日快乐」 reaches every 触须之交 at most this often; within it, only those nearby hear it */
export const FRIEND_BIRTHDAY_DAYS = 30;

/** 触须之交纪念日: the 7th, 30th and 100th day, and every whole year (the day they became so is day 1) */
export const isFriendAnniversary = (day: number) => day === 7 || day === 30 || day === 100 || (day > 0 && day % 365 === 0);

/** 「今天是你和 Dr. A 成为触须之交的第 100 天」, with 「，满一年啦」 on the years */
export function anniversaryText(day: number, who: string) {
  const line = `今天是你和 ${who} 成为触须之交的第 ${day} 天`;
  if (day < 365 || day % 365) return line;
  const years = day / 365;
  return `${line}，满${years <= YEARS.length ? YEARS[years - 1] : ` ${years} `}年啦`;
}
