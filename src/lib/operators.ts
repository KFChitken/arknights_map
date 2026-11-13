import arknights from "@/data/arknights-operators.json";
import endfield from "@/data/endfield-operators.json";
import { nameMatches } from "@/i18n/names";
import type { Game } from "./games";

/** Each game's characters as listed (from the BWIKI lists, a few added by hand), rarest first */
const LISTED: Record<Game, { name: string; playable?: boolean }[]> = {
  arknights: arknights.operators,
  endfield: endfield.operators,
};

/** Who may be among a player's 厨力: everyone listed, characters of the story too. */
export const CHARACTERS: Record<Game, string[]> = {
  arknights: LISTED.arknights.map((o) => o.name),
  endfield: LISTED.endfield.map((o) => o.name),
};

/** Playable characters per game (names only), rarest first: whom a player can field, so name as 助战 or ask to borrow. */
export const OPERATORS: Record<Game, string[]> = {
  arknights: LISTED.arknights.filter((o) => o.playable !== false).map((o) => o.name),
  endfield: LISTED.endfield.filter((o) => o.playable !== false).map((o) => o.name),
};

const setsOf = (lists: Record<Game, string[]>): Record<Game, Set<string>> => ({
  arknights: new Set(lists.arknights),
  endfield: new Set(lists.endfield),
});
const characters = setsOf(CHARACTERS);
const operators = setsOf(OPERATORS);

/** Nicknames players search by, for characters whose name they may not type */
export const NICKNAMES: Record<string, string[]> = { 祀: ["小葱"], 塔露拉: ["塔姐"] };

/** Whether a character's name, one of their nicknames, or on an English page their English name, contains what was typed. */
export function matchesSearch(name: string, needle: string) {
  const q = needle.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q) || (NICKNAMES[name] ?? []).some((n) => n.includes(q)) || nameMatches(name, q);
}

/** Whether a name may be among a player's 厨力 for a game */
export function isCharacter(game: Game, name: string) {
  return characters[game].has(name);
}

/** Whether a name is one of a game's playable characters */
export function isOperator(game: Game, name: string) {
  return operators[game].has(name);
}
