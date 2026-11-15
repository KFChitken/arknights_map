import type { ComponentType } from "react";
import type { CourseId } from "@/lib/study/courses";
import type { DrawnAvatar, RoachColor, RoachStyle } from "@/lib/types";

/**
 * Each course's game (src/lib/study/courses.ts), one file apiece, fetched the first time 开始上课 is pressed rather
 * than with the map. A game plays one round and says how it ended; Study.tsx records it and offers the next.
 */

/** How a round ended */
export type Round = {
  /** Passed (the stopwatch: stopped within 3.20–3.30); a loss shows the player's roach belly up */
  won: boolean;
  /** A step on the way, passed: neither won nor lost, nothing counts or is told (the stopwatch: shown, before hidden) */
  step?: boolean;
  /** The round in a few words, for 下课's page: 停在 3.26 秒 */
  result: string;
  /** What the play screen says once it is over: 正好 3.25！, 过关！, 停在 3.41 秒，再试一次 */
  verdict: string;
  /** Another round played differently, offered instead of 再来一局 (the stopwatch, passed: 藏数字再来) */
  again?: { label: string; mode: string };
  /** Passed at exactly 325, 命运的 325 (叠罗汉: none fell, 325 roaches stacked; 控分肉鸽: 325 at the top); nothing reads it yet */
  fate?: boolean;
};

/** The player's roach as the map shows it */
export type Look = { color: RoachColor; avatar: DrawnAvatar; style: RoachStyle };

export type GameProps = {
  /** The site day the round is played on */
  day: string;
  /** What the round's numbers are dealt from (src/lib/prng.ts mulberry32): another every round */
  seed: number;
  /** How to play this round, as a Round's again asked (the stopwatch: hidden) */
  mode?: string;
  /** A round of the day's course while it is not passed yet: what counts (the stopwatch then asks for two steps) */
  todays?: boolean;
  /** The player's roach, for a game it plays in (接住 3、2、5, 描红 325) */
  look: Look;
  /** Called once, the moment the round is over */
  onRound: (r: Round) => void;
};

export type Game = ComponentType<GameProps>;

const GAMES: Record<CourseId, () => Promise<{ default: Game }>> = {
  stopwatch: () => import("./Stopwatch"),
  react325: () => import("./React325"),
  echo325: () => import("./Echo325"),
  find325: () => import("./Find325"),
  mental325: () => import("./Mental325"),
  beat325: () => import("./Beat325"),
  make325: () => import("./Make325"),
  catch325: () => import("./Catch325"),
  trace325: () => import("./Trace325"),
  match325: () => import("./Match325"),
  stack325: () => import("./Stack325"),
  rogue325: () => import("./Rogue325"),
  snake325: () => import("./Snake325"),
  run325: () => import("./Run325"),
};

export const loadGame = (id: CourseId): Promise<Game> => GAMES[id]().then((m) => m.default);
