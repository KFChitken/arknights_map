import { fmt, T } from "@/i18n";
import { yearsWord } from "./perlica";

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

export const GESTURE_NAMES: Record<Gesture, string> = {
  get hug() {
    return T.lib.friendly.names.hug;
  },
  get highfive() {
    return T.lib.friendly.names.highfive;
  },
  get luck() {
    return T.lib.friendly.names.luck;
  },
  get blanket() {
    return T.lib.friendly.names.blanket;
  },
  get water() {
    return T.lib.friendly.names.water;
  },
};
/** The button once used for this sleep of theirs; the awake ones may come again, within the day's FRIEND_ACTS_PER_DAY */
export const GESTURE_DONE: Record<SleepGesture, string> = {
  get blanket() {
    return T.lib.friendly.done.blanket;
  },
  get water() {
    return T.lib.friendly.done.water;
  },
};
/** Answering one */
export const GESTURE_BACK: Record<AwakeGesture, string> = {
  get hug() {
    return T.lib.friendly.back.hug;
  },
  get highfive() {
    return T.lib.friendly.back.highfive;
  },
  get luck() {
    return T.lib.friendly.back.luck;
  },
};
/** One of theirs you answered */
export const GESTURE_RETURNED: Record<AwakeGesture, string> = {
  get hug() {
    return T.lib.friendly.returned.hug;
  },
  get highfive() {
    return T.lib.friendly.returned.highfive;
  },
  get luck() {
    return T.lib.friendly.returned.luck;
  },
};

/** What TA reads, by your name */
export function gestureText(g: Gesture, who: string) {
  switch (g) {
    case "hug":
      return fmt(T.lib.friendly.text.hug, { who });
    case "highfive":
      return fmt(T.lib.friendly.text.highfive, { who });
    case "luck":
      return fmt(T.lib.friendly.text.luck, { who });
    case "blanket":
      return fmt(T.lib.friendly.text.blanket, { who });
    case "water":
      return fmt(T.lib.friendly.text.water, { who });
  }
}

/** What you read as yours goes out, by TA's name */
export function gestureSent(g: Gesture, who: string) {
  switch (g) {
    case "hug":
      return fmt(T.lib.friendly.sent.hug, { who });
    case "highfive":
      return fmt(T.lib.friendly.sent.highfive, { who });
    case "luck":
      return fmt(T.lib.friendly.sent.luck, { who });
    case "blanket":
      return fmt(T.lib.friendly.sent.blanket, { who });
    case "water":
      return fmt(T.lib.friendly.sent.water, { who });
  }
}

/** 催理智, as TA reads it; asleep: sent while TA slept */
export const sanityText = (who: string, asleep: boolean) =>
  asleep ? fmt(T.lib.friendly.sanityAsleep, { who }) : fmt(T.lib.friendly.sanity, { who });
/** What you get back when TA says 「清完了！」 */
export const sanityThanks = (who: string) => fmt(T.lib.friendly.sanityThanks, { who });

/**
 * What you may do for one 触须之交 a day (from 04:00 Beijing time, src/lib/siteDay.ts), of any kinds together: 催理智 and the
 * gestures, returning one of theirs included. 催理智 stays once a day, 盖被子 and 放杯白开水
 * once a sleep. Touches, 戳一戳, 串门 and 游戏里加好友 have their own rules (Breeze, 2026-11-10).
 */
export const FRIEND_ACTS_PER_DAY = 3;

/** 一键: what may go to many 触须之交 at once; 送券 only while 寻访券 may be given (src/lib/passes.ts) */
export const BATCH_ACTS = ["hug", "highfive", "luck", "sanity", "gift"] as const;
export type BatchAct = (typeof BATCH_ACTS)[number];
export const isBatchAct = (x: unknown): x is BatchAct => (BATCH_ACTS as readonly unknown[]).includes(x);
export const BATCH_NAMES: Record<BatchAct, string> = {
  get hug() {
    return T.lib.friendly.names.hug;
  },
  get highfive() {
    return T.lib.friendly.names.highfive;
  },
  get luck() {
    return T.lib.friendly.names.luck;
  },
  get sanity() {
    return T.friendActs.sanity;
  },
  get gift() {
    return T.friends.batch.giftName;
  },
};

/** The toast once a batch went out to n of them */
export function batchSent(act: BatchAct, n: number) {
  switch (act) {
    case "hug":
      return fmt(T.lib.friendly.batchSent.hug, { n });
    case "highfive":
      return fmt(T.lib.friendly.batchSent.highfive, { n });
    case "luck":
      return fmt(T.lib.friendly.batchSent.luck, { n });
    case "sanity":
      return fmt(T.lib.friendly.batchSent.sanity, { n });
    case "gift":
      return fmt(T.lib.friendly.batchSent.gift, { n });
  }
}

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
  const line = fmt(T.lib.friendly.anniversary, { who, day });
  if (day < 365 || day % 365) return line;
  const years = day / 365;
  return fmt(T.lib.friendly.anniversaryYears, { line, years: yearsWord(years) });
}
