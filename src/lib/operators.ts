import arknights from "@/data/arknights-operators.json";
import endfield from "@/data/endfield-operators.json";
import type { Game } from "./games";

/** Playable character names per game (names only, from the BWIKI lists), rarest first. */
export const OPERATORS: Record<Game, string[]> = {
  arknights: arknights.operators.map((o) => o.name),
  endfield: endfield.operators.map((o) => o.name),
};

const sets: Record<Game, Set<string>> = {
  arknights: new Set(OPERATORS.arknights),
  endfield: new Set(OPERATORS.endfield),
};

export function isOperator(game: Game, name: string) {
  return sets[game].has(name);
}
