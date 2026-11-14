import "server-only";
import { sql } from "drizzle-orm";
import { beijingDate } from "../beijing";
import { COUNTED, declName, guideName, isNoteKind, noteName, replyName } from "../dashboard";
import type { GuideId } from "../guides";
import { db } from "./db";
import { statCounts } from "./schema";

/**
 * 数据看板's counters (src/lib/dashboard.ts COUNTED), per Beijing day: one more as each row they stand for is
 * written, kept in memory by every process and added to stat_counts once a minute, and once more when it is told
 * to stop (src/instrumentation-node.ts), as 存到桌面's are (appCounts.ts). Nothing about who: a name and a day.
 * Every count comes after the write it stands for went through (its transaction too), so a refused or failed
 * step counts nothing.
 */

const g = globalThis as { __statCounts?: Map<string, number> };
const pending = () => (g.__statCounts ??= new Map());

/** `by` more of these today (Beijing time) */
export function countStat(name: string, by = 1, now = Date.now()) {
  if (!(by > 0)) return;
  const key = `${beijingDate(now)}|${name}`;
  pending().set(key, (pending().get(key) ?? 0) + by);
}

/** What was counted since last time, added to the days' rows in one statement; kept for next time when that fails */
export async function saveStatCounts() {
  const taken = pending();
  if (!taken.size) return;
  g.__statCounts = new Map();
  const rows = [...taken].map(([key, n]) => {
    const bar = key.indexOf("|");
    return { day: key.slice(0, bar), name: key.slice(bar + 1), n };
  });
  try {
    await db
      .insert(statCounts)
      .values(rows)
      .onConflictDoUpdate({ target: [statCounts.day, statCounts.name], set: { n: sql`${statCounts.n} + excluded.n` } });
  } catch (e) {
    for (const [key, n] of taken) pending().set(key, (pending().get(key) ?? 0) + n);
    throw e;
  }
}

/** What this process counted and has not saved yet, for the tests */
export const unsavedStats = () => new Map(pending());

/** For the tests */
export function forgetStatCounts() {
  g.__statCounts = new Map();
}

// ---- what each counts, where it happens ----

/** A touch of a player's roach, or one answering something in their inbox; back: it answers a touch */
export function countTouch(bold: boolean, back = false) {
  countStat(bold ? COUNTED.bold : COUNTED.sneaky);
  if (back) countStat(COUNTED.back);
}

/** 默默爬走 from a touch */
export const countIgnored = () => countStat(COUNTED.ignored);

/** A touch that used the last of the day's: of all of them (left 0), or of those on one 触须之交 (onFriend 0) */
export function countCapped(left: number, onFriend?: number) {
  if (left === 0) countStat(COUNTED.capped);
  if (onFriend === 0) countStat(COUNTED.friendCapped);
}

/** A declaration, by its sentence, and how many players it reached */
export function countDeclared(template: string, reached: number) {
  countStat(COUNTED.decl);
  countStat(declName(template));
  countStat(COUNTED.reach, reached);
}

/** A reply left on a declaration, by the reply's id as stored */
export function countReply(id: string) {
  countStat(COUNTED.reply);
  countStat(replyName(id));
}

/** One of the things 触须之交 do for each other (NOTE_KINDS); the site's own notes are not counted */
export function countNote(kind: string) {
  if (isNoteKind(kind)) countStat(noteName(kind));
}

/** A roach put down: a new one only (a move had a roach before), the main roach in slot 0 */
export function countPlaced(slot: number, existing: unknown) {
  if (!existing) countStat(slot === 0 ? COUNTED.main : COUNTED.clone);
}

/** 墨小强, drawn by 祀掌柜 */
export const countInkDrawn = () => countStat(COUNTED.ink);

/** A player's touch of a guide */
export const countGuide = (id: GuideId) => countStat(guideName(id));
