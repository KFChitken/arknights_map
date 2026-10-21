export const GAMES = ["arknights", "endfield"] as const;
export type Game = (typeof GAMES)[number];

export const GAME_NAMES: Record<Game, string> = {
  arknights: "明日方舟",
  endfield: "终末地",
};

export function isGame(v: unknown): v is Game {
  return v === "arknights" || v === "endfield";
}
