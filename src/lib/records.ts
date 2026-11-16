/**
 * 「我的记录」 (src/components/app/records/): what a player gets of their own records, from GET /api/records/summary and
 * /api/records/timeline (src/lib/server/records.ts). Days are the player's own, by their device's clock: offset is
 * -Date.getTimezoneOffset(), minutes east of UTC, and a day starts at midnight there.
 */

/** The seven kinds of record, each with its colour */
export const RECORD_CATS = ["touch", "declare", "friend", "drink", "guide", "roach", "harvest"] as const;
export type RecordCat = (typeof RECORD_CATS)[number];
export const isRecordCat = (v: unknown): v is RecordCat => (RECORD_CATS as readonly unknown[]).includes(v);

/** The ranges the page switches between, in days back from today */
export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];
/** One number for each range: the last 7, 30 and 90 days */
export type ByRange = [number, number, number];

/** The day the site opened (Beijing), for 「所以 30 天和 90 天现在一样」 while it is not yet 90 days old */
export const RECORDS_FROM = Date.parse("2026-10-22T00:00:00+08:00");

/** Each day's numbers, in this order */
export const DAY_FIELDS = [
  // touches you sent, boldly and sneakily
  "outBold",
  "outSneaky",
  // touches you got (not those of players you blocked), boldly and sneakily, and which of your roaches each touched
  "inBold",
  "inSneaky",
  "inMain",
  "inClone1",
  "inClone2",
  "inClone3",
  // of those you got: touched back, and crawled away from
  "touchedBack",
  "crawled",
  // declarations sent, reactions given, reactions got (not withheld)
  "declared",
  "reactedOut",
  "reactedIn",
  // 小动作 both ways, 戳一戳 both ways
  "gestures",
  "pokes",
  "drinks",
  // touches of the guides
  "guides",
  // roaches put down, moved or taken back
  "moves",
  "badges",
  // 寻访 (a draw of ten is one), and 寻访券 given and got: only while 寻访 is open to the player
  "draws",
  "gifts",
] as const;
export type DayField = (typeof DAY_FIELDS)[number];
export const DAY_INDEX = Object.fromEntries(DAY_FIELDS.map((f, i) => [f, i])) as Record<DayField, number>;

/** How far back the records go: the days an inbox keeps everything (KEEP_ACTIVITY_DAYS) */
export const RECORD_DAYS = 90;

/** A 触须之交 now, with how much the two of you did with each other */
export type FriendRecord = {
  /** Their key, as 触须之交 elsewhere (friendKey) */
  id: string;
  name: string;
  /** When you became 触须之交 (ms) */
  since: number;
  /** Your touches of them, and their bold ones of you (a sneaky one never says who) */
  touch: ByRange;
  /** 小动作, 催理智 and 寻访券, both ways */
  gest: ByRange;
  /** 戳一戳, both ways */
  poke: ByRange;
};

/** A drink: when, until when the main roach was to sleep, and when it woke before that (null: slept it off) */
export type DrinkRecord = { at: number; until: number; soberAt: number | null };

/** 「一共」's numbers the page does not have from me() already */
export type RecordTotals = {
  visitDays: number;
  /** Touches sent and got, and declarations sent, ever: what the 90-day clean-up counted, and what is still kept */
  touchesOut: number;
  touchesIn: number;
  declarations: number;
  siStamps: number;
  studyDays: number;
};

/** 寻访 in 「我的记录」, only while 寻访 is open to the player */
export type PassRecords = {
  /** Draws (a draw of ten counted as ten), different characters, wishes come true, characters with two or more, gold numbers */
  draws: number;
  chars: number;
  wish: number;
  laser: number;
  gold: number;
};

export type RecordsSummary = {
  /** Today's day number on the device's clock (days since 1970-01-01 there) */
  today: number;
  /** days[i]: the numbers of the day today - i, for i from 0 to RECORD_DAYS - 1, in DAY_FIELDS order */
  days: number[][];
  /** What the player did themselves, by the hour of their day (0 to 23), in the last 7, 30 and 90 days */
  hours: [number[], number[], number[]];
  /** Each sentence they declared, with how often in each range; the most in 90 days first */
  lines: [string, number, number, number][];
  /** The reactions they got most, their words only, with how often in each range; at most 20 */
  reactionsIn: [string, number, number, number][];
  friends: FriendRecord[];
  drinks: DrinkRecord[];
  totals: RecordTotals;
  passes?: PassRecords;
};

/** GET /api/records/summary?lite=1: the last 7 days of touches sent, got, and declarations, for 「我的资料」's card */
export type RecordsLite = { today: number; out: number[]; in: number[]; declared: number[] };

/** The device's offset as the page sends it, kept to real time zones */
export function readOffset(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-720, Math.min(840, Math.round(n))) : 480;
}

const DAY_MS = 86_400_000;
/** The day number of a moment on a clock offset minutes east of UTC */
export const localDay = (at: number, offset: number) => Math.floor((at + offset * 60_000) / DAY_MS);
/** The hour of a moment on that clock, 0 to 23 */
export const localHour = (at: number, offset: number) => Math.floor((((at + offset * 60_000) % DAY_MS) + DAY_MS) % DAY_MS / 3_600_000);
/** When a day number begins (ms) on that clock */
export const dayStart = (day: number, offset: number) => day * DAY_MS - offset * 60_000;

// ---- the timeline ----

/** 「我做的」 / 「别人对我」; both: becoming 触须之交, which was the two of you */
export type RecordDir = "out" | "in" | "both";
/** What the overview's big numbers open the timeline at */
export const TIMELINE_KINDS = ["tout", "tin", "decl", "rxout"] as const;
export type TimelineKindFilter = (typeof TIMELINE_KINDS)[number];

/**
 * Someone in a record, as the inbox would name them: by name only when the player knew who it was (a bold touch,
 * a 触须之交 then); ex: once 触须之交 and no longer, named 「一位舟P」; null: nobody can tell (「一只蟑螂」)
 */
export type RecordWho = { name: string } | { ex: true } | null;

export type TimelineItem = {
  /** Where it comes from and its row: unique, and with at, the cursor of the next page */
  key: string;
  at: number;
  cat: RecordCat;
  dir: RecordDir;
} & (
  | { kind: "tout"; bold: boolean; reply: boolean; clone: boolean; who: RecordWho; got: "bold" | "sneaky" | null }
  | { kind: "tin"; bold: boolean; slot: number | null; back: boolean; who: RecordWho; mine: "bold" | "sneaky" | "ignored" | null }
  | { kind: "decl"; text: string; recipients: number; roaches: number | null; drunk: boolean; rx: [string, number][] }
  | { kind: "rxin"; text: string; declaredAt: number; rx: [string, number][] }
  | { kind: "rxout"; text: string; reaction: string }
  | { kind: "friend"; who: RecordWho }
  | { kind: "note"; note: string; who: RecordWho; answer: string | null; game: string | null }
  | { kind: "poke"; who: RecordWho }
  | { kind: "guide"; guide: string; what: string; bold: boolean }
  | { kind: "drink"; until: number; soberAt: number | null }
  | { kind: "move"; slot: number; how: "put" | "move" | "remove"; km: number | null }
  | { kind: "badge"; badge: string }
  | { kind: "ink"; no: number; look: string }
  | { kind: "pass"; cards: { charId: number; no: number; wish: boolean; tag: "new" | "laser" | "potential"; gold: string }[] }
);
export type TimelineKind = TimelineItem["kind"];

export type TimelinePage = { items: TimelineItem[]; next: string | null };

/** A page asked for: before the cursor, of one side, one kind of record, or one of the overview's numbers */
export type TimelineQuery = { before: string | null; dir: "all" | "out" | "in"; cat: RecordCat | "all"; kind: TimelineKindFilter | null };

/** A page's items at most */
export const TIMELINE_PAGE = 30;
