/**
 * 3.25 秒停表 (src/components/app/study/Stopwatch.tsx): a watch running up from 0.00, stopped by a tap. It is read the
 * way it shows, to the hundredth of a second, always rounded down; 3.20 to 3.30 passes, 3.25 itself is 正好.
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
