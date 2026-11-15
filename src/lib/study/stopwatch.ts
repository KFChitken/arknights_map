/**
 * 3.25 秒停表 (src/components/app/study/Stopwatch.tsx): a watch running up from 0.00, stopped by a tap. It is read the
 * way it shows, to the hundredth of a second, always rounded down; 3.20 to 3.30 passes, 3.25 itself is 正好. As the
 * day's course, not passed yet, it is passed in two steps: a round with the numbers shown, then one with them hidden.
 */

/** The aim, in hundredths of a second */
export const STOP_AIM = 325;
/** What passes, in hundredths of a second, both ends included */
export const STOP_PASS = { from: 320, to: 330 } as const;
/** Never stopped, the watch stops by itself then (ms) */
export const STOP_LIMIT_MS = 10_000;
/** In 藏数字再来, how long the numbers show before they hide (ms) */
export const STOP_HIDE_AFTER_MS = 1_000;

/** The hundredths of a second shown for a time in ms, rounded down (forgiving the hair a sum of timestamps may lose) */
export const hundredths = (ms: number) => Math.max(0, Math.floor(ms / 10 + 1e-6));

/** How a stop went: right on 3.25, within what passes, or outside it */
export type StopVerdict = "exact" | "pass" | "miss";

export function judgeStop(cs: number): StopVerdict {
  if (cs === STOP_AIM) return "exact";
  return cs >= STOP_PASS.from && cs <= STOP_PASS.to ? "pass" : "miss";
}

/** Hundredths of a second as the watch shows them: 3.25 */
export const watchText = (cs: number) => `${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, "0")}`;

/**
 * How a round is played: free, the numbers shown all along (any round once today's is passed, or of a course not
 * today's); shown, the first of today's two steps, whose pass is only a step; hidden, the numbers hidden after a second
 * (藏数字再来, and today's second step, whose pass passes the day's course)
 */
export type StopStage = "free" | "shown" | "hidden";

/**
 * The stage a round starts in: hidden when asked (mode hidden); a round of the day's course not passed yet (todays)
 * starts shown, or hidden once the shown one was passed on this device that day (shownPassed)
 */
export function stageOf(mode: string | undefined, todays: boolean, shownPassedToday: boolean): StopStage {
  if (mode === "hidden") return "hidden";
  if (!todays) return "free";
  return shownPassedToday ? "hidden" : "shown";
}

/** What a stop tells: won, a step (today's shown round passed: neither won nor lost, nothing told), or lost */
export function stopOutcome(stage: StopStage, v: StopVerdict): "won" | "step" | "lost" {
  if (v === "miss") return "lost";
  return stage === "shown" ? "step" : "won";
}

const SHOWN_KEY = "zhoup.study.shown";
/** The site day this page last passed today's shown round on, for a browser that keeps nothing (a private window) */
let held: string | null = null;

/** Whether today's shown round was passed on this device on that site day */
export function shownPassed(day: string): boolean {
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(SHOWN_KEY);
  } catch {}
  return kept === day || held === day;
}

/** Today's shown round passed on this device: until the site day is over, today's next round starts hidden */
export function rememberShown(day: string) {
  held = day;
  try {
    localStorage.setItem(SHOWN_KEY, day);
  } catch {}
}
