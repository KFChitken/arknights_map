/**
 * Counts of roaches as visitors who have not signed in get them: the whole world's in 万, and those
 * around a spot only roughly (the server rounds them, src/app/api/around), so that tapping about and
 * watching a number change cannot pin one roach down.
 */

/**
 * As the top line says it, with its measure word, 只 for roaches and 位 for players: as it is under 10,000, else in
 * 万 to one place, rounded down (6.2 万只, 9.1 万位). English has no measure word, and counts in thousands (62.3k).
 */
import { fmt, lang, T } from "@/i18n";
export function countText(n: number, measure: "只" | "位" = "只") {
  const zh = lang() === "zh";
  if (n < 10_000) return zh ? `${n.toLocaleString("zh-CN")} ${measure}` : n.toLocaleString("en-US");
  return fmt(T.lib.counts.tenThousands, { n: Math.floor(n / 1000) / 10, measure, thousands: Math.floor(n / 100) / 10 });
}

/** A count rounded down: 0; 1 for a few (1–9); tens below 100; hundreds from there */
export function rough(n: number) {
  if (n <= 0) return 0;
  if (n < 10) return 1;
  if (n < 100) return Math.floor(n / 10) * 10;
  return Math.floor(n / 100) * 100;
}

/** A rough count (rough()) in words, with its measure word: 几只, 30 多只, 300 多只 */
export const roughText = (n: number) => (n === 1 ? T.lib.counts.roughFew : fmt(T.lib.counts.roughMore, { n }));
