import { wallBadges } from "@/lib/badges";
import { COUNTED, MILESTONES, noteName, type DashDay, type StatSnapshot } from "@/lib/dashboard";
import { ACT_KINDS, actName, replyWords, templateWords, type Act } from "./dashWords";

/**
 * What 数据看板 (Dashboard.tsx) lists, worked out from its answer: the week's rankings, the badges most and least
 * held, the milestones, the days a range shows. Kept apart from the page so it can be tested.
 */

/** A line of a ranking: what (a code), in words, and how many */
export type Row = { key: string; name: string; n: number };

const most = (a: Row, b: Row) => b.n - a.n || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** What 触须之交 did for each other in the week, most first (every kind, those not done too) */
export function weekActs(week: Record<string, number>): Row[] {
  return (Object.keys(ACT_KINDS) as Act[])
    .map((a) => ({ key: a, name: actName(a), n: ACT_KINDS[a].reduce((s, kind) => s + (week[noteName(kind)] ?? 0), 0) }))
    .sort(most);
}

/** The counters under one name (decl.<template>, reply.<id>) with any, most first, in words */
function under(week: Record<string, number>, prefix: string, skip: string[], words: (code: string) => string, top: number): Row[] {
  return Object.entries(week)
    .filter(([name, n]) => name.startsWith(prefix) && !skip.includes(name) && n > 0)
    .map(([name, n]) => ({ key: name.slice(prefix.length), name: words(name.slice(prefix.length)), n }))
    .sort(most)
    .slice(0, top);
}

/** The week's sentences, most sent first */
export const weekTemplates = (week: Record<string, number>, top = 8) => under(week, "decl.", [COUNTED.reach], templateWords, top);

/** The week's replies, most left first */
export const weekReplies = (week: Record<string, number>, top = 8) => under(week, "reply.", [], replyWords, top);

/** A badge as the board lists it: its name, how it is earned, and how many hold it */
export type BadgeRow = { id: string; name: string; how: string; n: number };

/**
 * The badges most held and least held: those the badge wall shows (lasting ones, events on now, and any someone
 * holds), so a past event nobody earned stays out of the least held. Ties keep the wall's order.
 */
export function badgeLists(s: StatSnapshot, now: number, top = 5) {
  const held = new Map(s.badges.by.map((c) => [c.key, c.n]));
  const rows: BadgeRow[] = wallBadges(new Set([...held].filter(([, n]) => n > 0).map(([id]) => id)), now).map((b) => ({
    id: b.id,
    name: b.name,
    how: b.condition,
    n: held.get(b.id) ?? 0,
  }));
  return {
    most: rows
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, top),
    least: [...rows].sort((a, b) => a.n - b.n).slice(0, top),
  };
}

/** A milestone: reached, with when (as of the morning's count, else null), or the next one, with how many to go */
export type Mile = { n: number; at: number | null; left: number | null };

/** The milestones reached, then the next one */
export function milestones(players: number, reached: { n: number; at: number }[]): Mile[] {
  const at = new Map(reached.map((m) => [m.n, m.at]));
  const out: Mile[] = [];
  for (const m of MILESTONES) {
    if (at.has(m)) out.push({ n: m, at: at.get(m)!, left: null });
    else if (players >= m) out.push({ n: m, at: null, left: null });
    else {
      out.push({ n: m, at: null, left: m - players });
      break;
    }
  }
  return out;
}

/** How many days back the charts go: the last 7, the last 30, or every day since the opening */
export type Range = 7 | 30 | "all";
export const daysIn = (days: DashDay[], range: Range) => (range === "all" ? days : days.slice(Math.max(0, days.length - range)));

/** How many of the first values were never kept */
export const leadingNulls = (values: (number | null)[]) => {
  const i = values.findIndex((v) => v !== null);
  return i < 0 ? values.length : i;
};
