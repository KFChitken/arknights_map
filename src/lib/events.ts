import { fmt, T } from "@/i18n";
import { beijingShort } from "./beijing";
import type { Game } from "./games";

/**
 * Limited-time declarations. Each line follows its own game's version, so it
 * can be sent from its `start` until just before its `end`; sending any line
 * of an event earns the event's badge. Past events stay listed so the
 * declarations already sent still read right.
 */

export type EventLine = {
  /** Unique across all events, since a declaration stores only the line */
  id: string;
  game: Game;
  text: string;
  /** Beijing time to the minute, as in the game's notices: a notice's 「11月29日 03:59」 is an end of 04:00 */
  start: string;
  end: string;
  /**
   * Its own four replies (src/lib/declarations.ts), the fourth asking for a touch, stored as
   * "<replyKey or id>.<n>"; lines that are the same every year share a replyKey. A line without
   * gets only the five replies every declaration has.
   */
  replies?: readonly [string, string, string, string];
  replyKey?: string;
};

export type SiteEvent = {
  id: string;
  name: string;
  /** Earned by sending any of the lines while it is on; some events have none */
  badge?: string;
  lines: EventLine[];
};

/** 佩丽卡's birthday, 3 月 16 日 each year: from midnight until 04:00 the next morning, Beijing time */
const perlicaBirthdays = (from: number, to: number): EventLine[] =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const y = from + i;
    return {
      id: `perlica-bday-${y}`,
      game: "endfield",
      get text() {
        return T.lib.events.lines.perlicaBday.text;
      },
      start: `${y}-03-16T00:00+08:00`,
      end: `${y}-03-17T04:00+08:00`,
      get replies() {
        return [T.lib.events.lines.perlicaBday.replies.r1, T.lib.events.lines.perlicaBday.replies.r2, T.lib.events.lines.perlicaBday.replies.r3, T.lib.events.lines.perlicaBday.replies.r4] as const;
      },
      replyKey: "perlica-bday",
    };
  });

export const EVENTS: SiteEvent[] = [
  {
    id: "half2026",
    get name() {
      return T.lib.events.half2026.name;
    },
    badge: "half2026",
    lines: [
      // Arknights' 7.5th anniversary, 「时间啊，向前！」: until its shop and outfits go
      {
        id: "tazi",
        game: "arknights",
        get text() {
          return T.lib.events.lines.tazi.text;
        },
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-29T04:00+08:00",
        get replies() {
          return [T.lib.events.lines.tazi.replies.r1, T.lib.events.lines.tazi.replies.r2, T.lib.events.lines.tazi.replies.r3, T.lib.events.lines.tazi.replies.r4] as const;
        },
      },
      // 塔露拉's own words in its story: her letter to 晖洁 (TL-ST-4), and after TL-7
      {
        id: "talulah-spring",
        game: "arknights",
        get text() {
          return T.lib.events.lines.talulahSpring.text;
        },
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-29T04:00+08:00",
        get replies() {
          return [T.lib.events.lines.talulahSpring.replies.r1, T.lib.events.lines.talulahSpring.replies.r2, T.lib.events.lines.talulahSpring.replies.r3, T.lib.events.lines.talulahSpring.replies.r4] as const;
        },
      },
      {
        id: "talulah-flame",
        game: "arknights",
        get text() {
          return T.lib.events.lines.talulahFlame.text;
        },
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-29T04:00+08:00",
        get replies() {
          return [T.lib.events.lines.talulahFlame.replies.r1, T.lib.events.lines.talulahFlame.replies.r2, T.lib.events.lines.talulahFlame.replies.r3, T.lib.events.lines.talulahFlame.replies.r4] as const;
        },
      },
      // Endfield 1.6, 「丹青渡」: its notice ends it at the next version's maintenance without a date yet;
      // its 理智补给 runs to 11/26 04:00
      {
        id: "yuanyuan",
        game: "endfield",
        get text() {
          return T.lib.events.lines.yuanyuan.text;
        },
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-26T04:00+08:00",
        get replies() {
          return [T.lib.events.lines.yuanyuan.replies.r1, T.lib.events.lines.yuanyuan.replies.r2, T.lib.events.lines.yuanyuan.replies.r3, T.lib.events.lines.yuanyuan.replies.r4] as const;
        },
      },
      // 明河's banner runs to the next version too; until its date is out, it ends with 缘缘庄's line
      {
        id: "minghe",
        game: "endfield",
        get text() {
          return T.lib.events.lines.minghe.text;
        },
        start: "2026-11-06T00:00+08:00",
        end: "2026-11-26T04:00+08:00",
        get replies() {
          return [T.lib.events.lines.minghe.replies.r1, T.lib.events.lines.minghe.replies.r2, T.lib.events.lines.minghe.replies.r3, T.lib.events.lines.minghe.replies.r4] as const;
        },
      },
    ],
  },
  // no badge of its own, every year
  {
    id: "perlica-birthday",
    get name() {
      return T.lib.events.perlicaBirthday.name;
    },
    lines: perlicaBirthdays(2027, 2036),
  },
];

export function lineIsOn(line: EventLine, now = Date.now()) {
  return Date.parse(line.start) <= now && now < Date.parse(line.end);
}

/** Events that have a line on now, listing only those lines. */
export function activeEvents(now = Date.now()) {
  return EVENTS.map((e) => ({ ...e, lines: e.lines.filter((l) => lineIsOn(l, now)) })).filter((e) => e.lines.length > 0);
}

/** A line and its event, whether or not the line is still on. */
export function findLine(lineId: string) {
  for (const event of EVENTS) {
    const line = event.lines.find((l) => l.id === lineId);
    if (line) return { event, line };
  }
  return null;
}

/** 「到 11/29 04:00」 */
export function untilText(line: EventLine) {
  return fmt(T.lib.events.until, { time: beijingShort(Date.parse(line.end)) });
}
