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
};

export type SiteEvent = {
  id: string;
  name: string;
  /** Earned by sending any of the lines while it is on */
  badge: string;
  lines: EventLine[];
};

export const EVENTS: SiteEvent[] = [
  {
    id: "half2026",
    name: "半周年",
    badge: "half2026",
    lines: [
      // Arknights' 7.5th anniversary, 「时间啊，向前！」: until its shop and outfits go
      { id: "tazi", game: "arknights", text: "恭喜塔姐上岛！", start: "2026-10-27T00:00+08:00", end: "2026-11-29T04:00+08:00" },
      // Endfield 1.6, 「丹青渡」: its notice ends it at the next version's maintenance without a date yet;
      // its 理智补给 runs to 11/26 04:00
      {
        id: "yuanyuan",
        game: "endfield",
        text: "才...才不想和祀住进缘缘庄呢！",
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-26T04:00+08:00",
      },
    ],
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
  return `到 ${beijingShort(Date.parse(line.end))}`;
}
