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
  /** The round in a few words, for 下课's page: 停在 3.26 秒 */
  result: string;
  /** What the play screen says once it is over: 正好 3.25！, 过关！, 停在 3.41 秒，再试一次 */
  verdict: string;
  /** Another round played differently, offered instead of 再来一局 (the stopwatch, passed: 藏数字再来) */
  again?: { label: string; mode: string };
};

/** The player's roach as the map shows it */
export type Look = { color: RoachColor; avatar: DrawnAvatar; style: RoachStyle };

export type GameProps = {
  /** The site day the round is played on, for a course whose numbers are the day's */
  day: string;
  /** How to play this round, as a Round's again asked (the stopwatch: hidden) */
  mode?: string;
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
};

export const loadGame = (id: CourseId): Promise<Game> => GAMES[id]().then((m) => m.default);
