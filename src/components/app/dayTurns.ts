"use client";

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import { TOUCHES_PER_DAY, TOUCHES_PER_PERSON_PER_DAY } from "@/lib/rules";
import { nextSiteDayAt } from "@/lib/siteDay";

/**
 * When the site's day turns (04:00 Beijing time, src/lib/siteDay.ts) as the device's own clock says it:
 * 「凌晨 4 点」 in Beijing, 「下午 2 点」 in Chicago's winter, 「凌晨 1 点半」 in India. offsetMin is the
 * device's Date.getTimezoneOffset() at that moment, given only by the tests.
 */
export function turnsAtText(at: number, offsetMin = new Date(at).getTimezoneOffset()) {
  const local = new Date(at - offsetMin * 60_000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const w = T.cards.dayTurns;
  const part = h < 6 ? w.dawn : h < 12 ? w.morning : h === 12 ? w.noon : h < 18 ? w.afternoon : w.evening;
  return fmt(m === 0 ? w.at : m === 30 ? w.atHalf : w.atMinute, { part, h: h > 12 ? h - 12 : h, m });
}

/** How long from now till then, in whole hours and minutes, the minutes rounded up: never less than a minute */
export function waitParts(at: number, now = Date.now()) {
  const minutes = Math.max(1, Math.ceil((at - now) / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * Touches left today, on everyone (left) and on one 触须之交 (friendLeft), and when the day turns, as the server
 * last said them; once that moment has passed on this page, a new day's: the page asks nothing for it.
 */
export function touchesNow(q: { left: number; at: number; friendLeft?: number }, now = Date.now()) {
  if (now < q.at) return q;
  return { left: TOUCHES_PER_DAY, at: nextSiteDayAt(now), friendLeft: q.friendLeft === undefined ? undefined : TOUCHES_PER_PERSON_PER_DAY };
}

/** Draws again every `every` ms while that is set, so what it shows of the time keeps up */
export function useTick(every: number | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!every) return;
    const t = window.setInterval(() => setTick((n) => n + 1), every);
    return () => window.clearInterval(t);
  }, [every]);
}
