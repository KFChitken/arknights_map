import type { Game } from "./games";

/** Self-titles for 「我是<角色>的<称呼>」, picked by hand. They fit both games. */
export const SELF_TITLES = ["佩洛", "狗", "猫"];

export function titlesFor(game: Game) {
  void game;
  return SELF_TITLES;
}
