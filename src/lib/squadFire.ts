/**
 * 篝火 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑤), always there, and 扔东西 between those in it: the rules both sides go
 * by. The server keeps the count and decides (src/lib/server/squadPlay.ts); the page only draws it.
 *
 * The fire has a level, 0 (out) and up, with no top: from L−1 to L takes fireNeed(L) sticks (one a level to Lv.10, two
 * to Lv.20, and so on), the room keeping how many are on towards the next (prog). Left alone it goes down one each
 * FIRE_DROP_MS after the last stick, and once it went down, what was on towards the next burnt with it; so the room
 * keeps only the level, prog and since when (and who put the last on). Each in the room holds WOOD_MAX sticks at
 * most, one more growing each WOOD_EVERY_MS, as 理智 does: back to the page, the hand is full.
 */

export const FIRE_DROP_MS = 60_000;
export const WOOD_MAX = 3;
export const WOOD_EVERY_MS = 30_000;

/** The fire's level now, put at `level` at `at` */
export const fireLevel = (level: number, at: number, now: number) => Math.max(0, level - Math.floor(Math.max(0, now - at) / FIRE_DROP_MS));
/** How long it burnt from `at` to now, put at `level` then */
export const fireLit = (level: number, at: number, now: number) => Math.max(0, Math.min(now - at, level * FIRE_DROP_MS));
/** Till it goes down one (null: out) */
export const fireDropIn = (level: number, at: number, now: number) =>
  fireLevel(level, at, now) === 0 ? null : FIRE_DROP_MS - (Math.max(0, now - at) % FIRE_DROP_MS);

/** Sticks it takes from L−1 up to L: one a level up to Lv.10, two up to Lv.20, and so on */
export const fireNeed = (level: number) => Math.max(1, Math.ceil(level / 10));
/** Sticks it takes from out up to L, all told */
export function fireTotal(level: number) {
  // whole tens (10 levels at each need), then the rest at the next need
  const tens = Math.floor(level / 10);
  return 10 * ((tens * (tens + 1)) / 2) + (level - tens * 10) * (tens + 1);
}
/**
 * The fire now, put at `level` at `at` with `prog` sticks on towards the next (null: never lit): gone down one each
 * FIRE_DROP_MS since, and the sticks towards the next burnt with it once it went down at all
 */
export function fireNow(level: number, prog: number, at: number | null, now: number) {
  if (at === null) return { level: 0, prog: 0 };
  const l = fireLevel(level, at, now);
  return { level: l, prog: l === level ? prog : 0 };
}
/** One stick on the fire as it is now: nearer the next level, up one once there (prog back to 0) */
export function fireAdd(level: number, prog: number, at: number | null, now: number) {
  const f = fireNow(level, prog, at, now);
  const p = f.prog + 1;
  return p >= fireNeed(f.level + 1) ? { level: f.level + 1, prog: 0, up: true } : { level: f.level, prog: p, up: false };
}

/** The fire's looks by its level: eight stages, each from a level on, each adding to the scene */
export const FIRE_STAGES = [
  { from: 0, key: "out" },
  { from: 1, key: "small" },
  { from: 10, key: "slug" },
  { from: 25, key: "pot" },
  { from: 50, key: "guard" },
  { from: 100, key: "map" },
  { from: 150, key: "storm" },
  { from: 200, key: "ship" },
] as const;
export type FireStage = (typeof FIRE_STAGES)[number]["key"];
/** Which of FIRE_STAGES a level is at (its index) */
export function fireStage(level: number) {
  let i = 0;
  FIRE_STAGES.forEach((s, k) => {
    if (level >= s.from) i = k;
  });
  return i;
}
/** From Lv.220 the flame's colour turns every 20 levels (6 of them, FIRE_COLORS), a ★ more each time round */
export const FIRE_COLOR_FROM = 220;
export function fireColor(level: number): { color: number; stars: number } {
  if (level < FIRE_COLOR_FROM) return { color: 0, stars: 0 };
  const k = Math.floor((level - 200) / 20);
  return { color: k % 6, stars: Math.floor(k / 6) };
}
/** The flame's sizes: its scale across and up (none while out), Lv.100 at its tallest */
export function fireScale(level: number) {
  if (level <= 0) return { x: 0, y: 0 };
  const lg = Math.log10(level + 1);
  return { x: Math.min(1, 0.55 + 0.22 * lg), y: Math.min(1.1, 0.5 + 0.3 * lg) };
}
/** The glow round it: how strong (alpha) and how wide (px) */
export function fireGlow(level: number) {
  if (level <= 0) return { a: 0.04, size: 300 };
  const lg = Math.log10(level + 1);
  return { a: Math.min(0.5, 0.12 + 0.14 * lg), size: Math.min(640, 300 + 150 * lg) };
}
/** How warm the room's sheet is by the fire: as Lv.5 was at Lv.50, no warmer after */
export const fireWarm = (level: number) => Math.min(level, 50) * 0.0045;
/** 卫戍池塘's campfire in 钓鳞's window (0–5): Lv.1 as its 1, Lv.50 and up as its 5 */
export const fireCamp = (level: number) => (level <= 0 ? 0 : 1 + (4 * (Math.min(level, 50) - 1)) / 49);

/**
 * Sticks in hand now: `wood` at `at` (null: never used, a full hand). The hand holds `max` at most, one more growing
 * each `every` (篝火's unless given: 基建加盖's blocks are held the same way)
 */
export const woodNow = (wood: number, at: number | null, now: number, max = WOOD_MAX, every = WOOD_EVERY_MS) =>
  at === null ? Math.min(max, wood) : Math.min(max, wood + Math.floor(Math.max(0, now - at) / every));
/** Till the next stick grows (null: the hand is full) */
export const woodIn = (wood: number, at: number | null, now: number, max = WOOD_MAX, every = WOOD_EVERY_MS) =>
  at === null || woodNow(wood, at, now, max, every) >= max ? null : every - (Math.max(0, now - at) % every);
/** The hand after one is put on: one less, and the next growing from where it was (from now, off a full hand) */
export function woodAfter(wood: number, at: number | null, now: number, max = WOOD_MAX, every = WOOD_EVERY_MS): { wood: number; at: number } {
  const have = woodNow(wood, at, now, max, every);
  if (at === null || have >= max) return { wood: have - 1, at: now };
  return { wood: have - 1, at: at + Math.floor(Math.max(0, now - at) / every) * every };
}

/**
 * The fire as a room tells it: level put at `at` with prog sticks towards the next, by one's number in the room (null:
 * nobody yet); the last 局's (how long it burnt, ms, and how high it went: null before one ended) and the room's
 * highest; and this 局's highest so far
 */
export type SquadFire = {
  level: number;
  prog: number;
  at: number;
  by: number | null;
  top: number;
  last: number | null;
  lastTop: number;
  bestTop: number;
};

// ---- 火焰周榜 ----

/** A week of 火焰周榜 goes from Monday 04:00 Beijing time to the next (src/lib/hotList.ts weekStartOf) */
/** One counts in a room's row from this many sticks put on its fire that week */
export const BOARD_STICKS = 20;
/** A row names this many at most (those who put most on), and is listed with this many at least */
export const BOARD_NAMES = 4;
export const BOARD_MIN = 2;
/** The rooms whose named win 篝火守夜人; the board lists this many */
export const BOARD_TOP = 100;
export const BOARD_SHOWN = 120;

/**
 * A name on 火焰周榜: as in the rooms, with their roach's look (「一位舟P」 and no look for one who keeps theirs off), or
 * you
 */
export type FireBoardName = { name: string; look?: { color: string; avatar: string }; you?: true };
/**
 * A row of 火焰周榜 as a page has it: a room's place, how high its fire went that week and its colour then (FIRE
 * colours), who is named; got: last week's, its named won 篝火守夜人; mine: the room the player is in now
 */
export type FireBoardRow = { rank: number; peak: number; color: number; names: FireBoardName[]; got?: true; mine?: true };
/**
 * 你们这堆: the room the player is in now, its place (null: not listed) and fire, and the first of these that is so:
 * old (opened before this week: on last week's board), in (named, in the top BOARD_TOP: n named), short (in the top,
 * k sticks more to be named), elsewhere (named in the room placed r), below (listed, d levels short of the top), off
 */
export type FireMine = {
  rank: number | null;
  peak: number;
  color: number;
  names: FireBoardName[];
  say: "old" | "in" | "short" | "elsewhere" | "below" | "off";
  n?: number;
  k?: number;
  r?: number;
  d?: number;
};
/** 火焰周榜 for a page: this week's (left: ms till it is settled) or last week's; how many win (or won) 篝火守夜人 */
export type FireBoard = { week: "this" | "last"; rows: FireBoardRow[]; holders: number; left?: number; mine: FireMine | null; now: number };

// ---- 扔东西 ----

/**
 * What may be thrown at someone in the room, by number (kept by it), in the order the picker shows them, in four
 * groups: praise, tease, rally (TA taps it to send it back, the rally counted), effect. fx: what it does where it
 * lands, head (on TA's head ms long; shake: till TA taps it off, ms at most), side (lands beside TA), say (a line over
 * TA), ball (sent back with a tap within BALL_BACK_MS), faint and dance (TA's roach asleep or dancing ms long), wake
 * (wakes TA's roach asleep, or fainted), parcel (opens to something of 钓鳞's junk, the server's pick).
 */
export const THROWS = [
  { no: 1, key: "halo", group: "praise", fx: "head", ms: 60_000 },
  { no: 2, key: "glowstick", group: "praise", fx: "side" },
  { no: 3, key: "applepie", group: "praise", fx: "side" },
  { no: 4, key: "coins", group: "praise", fx: "side" },
  { no: 5, key: "ladle", group: "tease", fx: "head", ms: 60_000 },
  { no: 6, key: "slug", group: "tease", fx: "head", ms: 300_000, shake: true },
  { no: 7, key: "bill", group: "tease", fx: "side" },
  { no: 8, key: "curse", group: "tease", fx: "say" },
  { no: 9, key: "volleyball", group: "rally", fx: "ball" },
  { no: 10, key: "snowball", group: "rally", fx: "ball" },
  { no: 11, key: "gourd", group: "effect", fx: "faint", ms: 10_000 },
  { no: 12, key: "water", group: "effect", fx: "wake" },
  { no: 13, key: "potion_full", group: "effect", fx: "side" },
  { no: 14, key: "parcel", group: "effect", fx: "parcel" },
  { no: 15, key: "vinyl", group: "effect", fx: "dance", ms: 6_000 },
  // never thrown (no group the picker shows): 企鹅物流急件赛's winner wears it
  { no: 16, key: "crown", group: "prize", fx: "head", ms: 60_000 },
] as const satisfies readonly { no: number; key: string; group: string; fx: string; ms?: number; shake?: boolean }[];
export type ThrowItem = (typeof THROWS)[number];
/** The picker's groups (a prize is never thrown) */
export type ThrowGroup = Exclude<ThrowItem["group"], "prize">;
export const THROW_GROUPS: readonly ThrowGroup[] = ["praise", "tease", "rally", "effect"];
/** One of the things that may be thrown (by number), or null: none, or a prize only worn */
export const throwable = (no: unknown): ThrowItem | null => {
  const t = throwOf(no);
  return t && (THROW_GROUPS as readonly string[]).includes(t.group) ? t : null;
};
export const throwOf = (no: unknown): ThrowItem | null => THROWS.find((t) => t.no === no) ?? null;
/** Whether what sits on a head (by number) stays till its one shakes it off (源石虫) */
export const shakes = (no: number) => {
  const t = throwOf(no);
  return Boolean(t && "shake" in t && t.shake);
};
/** One throw every THROW_EVERY_MS, and the same one hit THROWS_AT_A_MINUTE times a minute at most, by each thrower */
export const THROW_EVERY_MS = 5_000;
export const THROWS_AT_A_MINUTE = 3;
/** A ball waits this long for a tap that sends it back, else the rally is over */
export const BALL_BACK_MS = 6_000;
/** Where a ball was sent from, and the rally so far (1: the throw itself) */
export type SquadBall = { item: number; from: number; n: number; until: number };
/** What sits on one's roach in the room now: on its head, or it asleep or dancing, till then */
export type SquadOn = { item: number; until: number };

/**
 * A 局's end (结束这局): how long the fire burnt in it (ms), and the fire as the next 局 starts from it: the same
 * level, going down when it would have, its sticks towards the next kept unless it went down, and what of that burning
 * was this 局's counted off the next one's
 */
export function fireEnd(f: { level: number; prog?: number; at: number | null; burn: number }, now: number) {
  const burnt = f.at === null ? Math.max(0, f.burn) : Math.max(0, f.burn + fireLit(f.level, f.at, now));
  if (f.at === null) return { burnt, level: 0, prog: 0, at: null, burn: 0 };
  const level = fireLevel(f.level, f.at, now);
  if (level === 0) return { burnt, level: 0, prog: 0, at: now, burn: 0 };
  const drops = Math.floor((now - f.at) / FIRE_DROP_MS);
  const at = f.at + drops * FIRE_DROP_MS;
  return { burnt, level, prog: drops > 0 ? 0 : (f.prog ?? 0), at, burn: -(now - at) };
}

/** What of 扔东西 stays on one in the room now (a member's row: on the head, asleep or dancing, a ball to send back) */
export function playOn(
  m: {
    head: number | null;
    headUntil: Date | null;
    fx: number | null;
    fxUntil: Date | null;
    ball: number | null;
    ballFrom: number | null;
    ballN: number;
    ballUntil: Date | null;
  },
  now: number,
): { head?: SquadOn; fx?: SquadOn; ball?: SquadBall } {
  const on: { head?: SquadOn; fx?: SquadOn; ball?: SquadBall } = {};
  if (m.head !== null && m.headUntil && m.headUntil.getTime() > now) on.head = { item: m.head, until: m.headUntil.getTime() };
  if (m.fx !== null && m.fxUntil && m.fxUntil.getTime() > now) on.fx = { item: m.fx, until: m.fxUntil.getTime() };
  if (m.ball !== null && m.ballFrom !== null && m.ballUntil && m.ballUntil.getTime() > now) {
    on.ball = { item: m.ball, from: m.ballFrom, n: m.ballN, until: m.ballUntil.getTime() };
  }
  return on;
}
