import { isOperator } from "./operators";

/**
 * 我的助战: up to three Arknights operators a player names on their profile
 * card, names only. Picked from the list, never typed.
 */

export const MAX_SUPPORT = 3;

/** Listed Arknights operators only, each once, at most MAX_SUPPORT. */
export function checkSupport(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String))].filter((n) => isOperator("arknights", n)).slice(0, MAX_SUPPORT);
}
