import type { Game } from "./games";

/**
 * 本周舟P热榜: the characters most shouted in 「我永远喜欢」 and 「加强」
 * declarations this week, ranked by how many different players shouted them.
 * Only characters and counts, never who.
 */

export const HOT_BOARDS = [
  { id: "love", name: "我永远喜欢" },
  { id: "buff", name: "加强" },
] as const;
export type HotBoard = (typeof HOT_BOARDS)[number]["id"];

/** Fewer players than this, and a character stays off the list, so nobody can be picked out */
export const HOT_MIN_PLAYERS = 3;
export const HOT_SIZE = 10;

export type HotRow = { rank: number; character: string; games: Game[]; players: number };

export type HotList = {
  /** When this week began */
  weekStart: number;
  boards: Record<HotBoard, HotRow[]>;
  /** Last week's first place on each board */
  lastWeek: Record<HotBoard, HotRow | null>;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The moment a week begins: Monday 04:00 Beijing time, when the game's day turns over too. */
export function weekStartOf(now: number) {
  // shifted so that Monday 04:00 in Beijing lands on Monday 00:00 UTC
  const shifted = now + 4 * HOUR;
  const daysSinceMonday = (new Date(shifted).getUTCDay() + 6) % 7;
  return Math.floor(shifted / DAY) * DAY - daysSinceMonday * DAY - 4 * HOUR;
}

export const WEEK = 7 * DAY;
