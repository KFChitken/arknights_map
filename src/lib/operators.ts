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

/** Nicknames players search by, for characters whose name they may not type */
export const NICKNAMES: Record<string, string[]> = { 祀: ["小葱"] };

/** Whether a character's name, or one of their nicknames, contains what was typed. */
export function matchesSearch(name: string, needle: string) {
  const q = needle.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q) || (NICKNAMES[name] ?? []).some((n) => n.includes(q));
}

export function isOperator(game: Game, name: string) {
  return sets[game].has(name);
}
