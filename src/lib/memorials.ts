import type { Memorial } from "./adminConsole";

/**
 * Days of national remembrance, for 全站变灰 in the 管理台 (src/components/admin/Site.tsx). They only remind the owner
 * which comes next: the site never turns gray by itself.
 */
const FIXED: [month: number, day: number, name: string][] = [
  [7, 7, "七七事变纪念日"],
  [9, 3, "中国人民抗日战争胜利纪念日"],
  [9, 18, "九一八事变纪念日"],
  [9, 30, "烈士纪念日"],
  [12, 13, "南京大屠杀死难者国家公祭日"],
];
const QINGMING = "清明节";

/** The day of April that 清明 falls on in a year, the 4th or the 5th: the usual formula, Y the year's last two digits */
export function qingmingDay(year: number) {
  const y = year % 100;
  return Math.floor(y * 0.2422 + 4.81) - Math.floor(y / 4);
}

const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The next day of remembrance from a Beijing date (YYYY-MM-DD), today's own included (days 0) */
export function nextMemorial(today: string): Memorial {
  const [y, m, d] = today.split("-").map(Number);
  const from = dayNumber(y, m, d);
  let next: Memorial | null = null;
  for (const year of [y, y + 1]) {
    const days: [number, number, string][] = [[4, qingmingDay(year), QINGMING], ...FIXED];
    for (const [month, day, name] of days) {
      const away = dayNumber(year, month, day) - from;
      if (away >= 0 && (!next || away < next.days)) next = { date: `${year}-${pad(month)}-${pad(day)}`, name, days: away };
    }
  }
  // a year always holds one
  return next!;
}

/** 「下一个纪念日：12 月 13 日，南京大屠杀死难者国家公祭日（还有 32 天）。」, or 「今天是……。」 */
export function memorialWords(m: Memorial) {
  if (m.days === 0) return `今天是${m.name}。`;
  const [, month, day] = m.date.split("-").map(Number);
  return `下一个纪念日：${month} 月 ${day} 日，${m.name}（还有 ${m.days} 天）。`;
}
