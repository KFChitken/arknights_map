import { fmt, lang, T } from "./index";

/**
 * Stored codes in the page's words. Characters, self-titles, foods, spouses and 祀's stamps are stored
 * in Chinese, and code compares them by it, so they never change. An English page shows the English it
 * has for one (T.names, maps zh.ts leaves empty and en.ts fills), or the code as it is when it has none.
 */
function shown(map: Readonly<Record<string, string>>, code: string): string {
  return lang() === "zh" ? code : (map[code] ?? code);
}

/** A character of either game: 能天使 → Exusiai */
export const characterName = (name: string) => shown(T.names.characters, name);
/** What a player calls themselves in 「我是<角色>的<称呼>」 (titles.ts) */
export const titleName = (title: string) => shown(T.names.titles, title);
/** 「我想吃<角色>的<食物>」's foods (declarations.ts FOODS) */
export const foodName = (food: string) => shown(T.names.foods, food);
/** 老婆, 老公 (declarations.ts SPOUSES) */
export const spouseName = (spouse: string) => shown(T.names.spouses, spouse);

/** One of 祀's stamps where a line quotes it: as stamped, with what it means after it on an English page */
export function stampName(stamp: string): string {
  const meaning = lang() === "zh" ? undefined : T.names.stamps[stamp];
  return meaning ? `${stamp}${fmt(T.common.inParens, { text: meaning })}` : stamp;
}

/** Whether a character's name in the page's words contains what was typed (the Chinese one is matched as well) */
export const nameMatches = (name: string, q: string) => lang() !== "zh" && characterName(name).toLowerCase().includes(q);
