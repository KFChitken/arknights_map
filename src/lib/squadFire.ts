/**
 * 篝火 in a room of 一起卫戍 (卫戍碎片时间玩法 ⑤), always there, and 扔东西 between those in it: the rules both sides go
 * by. The server keeps the count and decides (src/lib/server/squadPlay.ts); the page only draws it.
 *
 * The fire has a level, 0 (out) to FIRE_MAX: a stick puts it up one; left alone it goes down one each FIRE_DROP_MS
 * after the last stick, so the room keeps only the level and since when (and who put the last on). Each in the room
 * holds WOOD_MAX sticks at most, one more growing each WOOD_EVERY_MS, as 理智 does: back to the page, the hand is full.
 */

export const FIRE_MAX = 5;
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

/** Sticks in hand now: `wood` at `at` (null: never used, a full hand) */
export const woodNow = (wood: number, at: number | null, now: number) =>
  at === null ? Math.min(WOOD_MAX, wood) : Math.min(WOOD_MAX, wood + Math.floor(Math.max(0, now - at) / WOOD_EVERY_MS));
/** Till the next stick grows (null: the hand is full) */
export const woodIn = (wood: number, at: number | null, now: number) =>
  at === null || woodNow(wood, at, now) >= WOOD_MAX ? null : WOOD_EVERY_MS - (Math.max(0, now - at) % WOOD_EVERY_MS);
/** The hand after one is put on: one less, and the next growing from where it was (from now, off a full hand) */
export function woodAfter(wood: number, at: number | null, now: number): { wood: number; at: number } {
  const have = woodNow(wood, at, now);
  if (at === null || have >= WOOD_MAX) return { wood: have - 1, at: now };
  return { wood: have - 1, at: at + Math.floor(Math.max(0, now - at) / WOOD_EVERY_MS) * WOOD_EVERY_MS };
}

/** The fire as a room tells it: level put at `at`, by one's number in the room (null: nobody yet) */
export type SquadFire = { level: number; at: number; by: number | null; best: number; last: number | null };

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
] as const satisfies readonly { no: number; key: string; group: string; fx: string; ms?: number; shake?: boolean }[];
export type ThrowItem = (typeof THROWS)[number];
export type ThrowGroup = ThrowItem["group"];
export const THROW_GROUPS: readonly ThrowGroup[] = ["praise", "tease", "rally", "effect"];
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
 * level, going down when it would have, and what of that burning was this 局's counted off the next one's
 */
export function fireEnd(f: { level: number; at: number | null; burn: number }, now: number) {
  const burnt = f.at === null ? Math.max(0, f.burn) : Math.max(0, f.burn + fireLit(f.level, f.at, now));
  if (f.at === null) return { burnt, level: 0, at: null, burn: 0 };
  const level = fireLevel(f.level, f.at, now);
  if (level === 0) return { burnt, level: 0, at: now, burn: 0 };
  const at = f.at + Math.floor((now - f.at) / FIRE_DROP_MS) * FIRE_DROP_MS;
  return { burnt, level, at, burn: -(now - at) };
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
