import catalog from "@/data/pass-catalog.json";
import type { Game } from "./games";
import type { PassGame } from "./passes";

/**
 * Every character a pass can be drawn for (src/data/pass-catalog.json, written by scripts/build-pass-catalog.mjs):
 * the two lists players pick their 厨力 from, characters of the story and collaborations included. Each has the same
 * chance in a draw. id is how passes are stored: given once, never changed or given again.
 */
export type PassChar = {
  id: number;
  game: PassGame;
  name: string;
  /** the stars printed on the pass; null for a character of the story; nothing to do with the chance */
  rarity: number | null;
  /** the character's own colour, #rrggbb, for the block of colour on the pass */
  color: string;
};

export const PASS_CATALOG = catalog.characters as readonly PassChar[];
/** How many characters a draw picks from: what 「每位概率一样」 is one over */
export const CATALOG_SIZE = PASS_CATALOG.length;
export const CATALOG_IDS: readonly number[] = PASS_CATALOG.map((c) => c.id);

const byId = new Map(PASS_CATALOG.map((c) => [c.id, c]));
const byName = new Map(PASS_CATALOG.map((c) => [`${c.game}:${c.name}`, c]));

export const passChar = (id: number): PassChar | null => byId.get(id) ?? null;
export const isPassChar = (id: unknown): id is number => typeof id === "number" && byId.has(id);

export const GAME_OF: Record<PassGame, Game> = { ak: "arknights", ef: "endfield" };
export const PASS_GAME: Record<Game, PassGame> = { arknights: "ak", endfield: "ef" };

/** A character by the name a player's 厨力 or a game's list has them by */
export const passCharNamed = (game: Game, name: string): PassChar | null => byName.get(`${PASS_GAME[game]}:${name}`) ?? null;

/** How many characters each game brings */
export const catalogCounts = (): Record<PassGame, number> => ({
  ak: PASS_CATALOG.filter((c) => c.game === "ak").length,
  ef: PASS_CATALOG.filter((c) => c.game === "ef").length,
});
