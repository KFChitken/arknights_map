/** The site counts days in Beijing time, which is UTC+8 all year. */
const OFFSET_MS = 8 * 3_600_000;

/** The date in Beijing, as YYYY-MM-DD. */
export function beijingDate(now = Date.now()) {
  return new Date(now + OFFSET_MS).toISOString().slice(0, 10);
}

/** The moment a Beijing date (YYYY-MM-DD) begins. */
export function beijingMidnight(date: string) {
  return Date.parse(`${date}T00:00:00+08:00`);
}

/** A moment as Beijing wall-clock time, like 「11/29 04:00」. */
export function beijingShort(t: number) {
  const s = new Date(t + OFFSET_MS).toISOString();
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}`;
}
