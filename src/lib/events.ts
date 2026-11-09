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
      text: "祝佩丽卡生日快乐！",
      start: `${y}-03-16T00:00+08:00`,
      end: `${y}-03-17T04:00+08:00`,
      replies: ["佩丽卡生日快乐！", "蛋糕备好了", "整个塔卫二都在庆祝", "一起庆生，碰我一下"],
      replyKey: "perlica-bday",
    };
  });

export const EVENTS: SiteEvent[] = [
  {
    id: "half2026",
    name: "半周年",
    badge: "half2026",
    lines: [
      // Arknights' 7.5th anniversary, 「时间啊，向前！」: until its shop and outfits go
      {
        id: "tazi",
        game: "arknights",
        text: "恭喜塔姐上岛！",
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-29T04:00+08:00",
        replies: ["塔姐，欢迎上岛！", "我抽到了！", "塔姐还没来我岛上", "同喜同喜，碰我一下"],
      },
      // 塔露拉's own words in its story: her letter to 晖洁 (TL-ST-4), and after TL-7
      {
        id: "talulah-spring",
        game: "arknights",
        text: "推开窗看看吧，春天已经到了。",
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-29T04:00+08:00",
        replies: ["（推开了窗）", "春天真的到了", "可现在是十一月啊", "一起等春天，碰我一下"],
      },
      {
        id: "talulah-flame",
        game: "arknights",
        text: "我，就是火焰。",
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-29T04:00+08:00",
        replies: ["塔姐帅！", "好烫好烫", "那我来烤火了", "借个火，碰我一下"],
      },
      // Endfield 1.6, 「丹青渡」: its notice ends it at the next version's maintenance without a date yet;
      // its 理智补给 runs to 11/26 04:00
      {
        id: "yuanyuan",
        game: "endfield",
        text: "才...才不想和祀住进缘缘庄呢！",
        start: "2026-10-27T00:00+08:00",
        end: "2026-11-26T04:00+08:00",
        replies: ["口嫌体正直", "小葱在等你呢", "掌柜的，来间上房！", "才不想认识你呢，碰我一下"],
      },
      // 明河's banner runs to the next version too; until its date is out, it ends with 缘缘庄's line
      {
        id: "minghe",
        game: "endfield",
        text: "明河，带我一程！",
        start: "2026-11-06T00:00+08:00",
        end: "2026-11-26T04:00+08:00",
        replies: ["也带我一程！", "我的克隆体已经上马了", "抓紧了，怒骊跑得快", "同路人，碰我一下"],
      },
    ],
  },
  // no badge of its own, every year
  { id: "perlica-birthday", name: "佩丽卡生日", lines: perlicaBirthdays(2027, 2036) },
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
