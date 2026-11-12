import type { Lang, Messages } from "./core";

/**
 * Groups only the server reads, left out of what pages download: `server`, its refusals and emails,
 * read only in src/lib/server and src/app/api (a test holds the code to that).
 */
export const SERVER_ONLY: readonly string[] = ["server"];

/** How the script that sets a page's words (src/app/i18n) begins */
export const WORDS_PREFIX = "self.__ZP_I18N=";

/** That script: one language's words, without the server's own */
export function wordsBody(lang: Lang, t: Messages): string {
  const shown = Object.fromEntries(Object.entries(t).filter(([group]) => !SERVER_ONLY.includes(group)));
  return `${WORDS_PREFIX}${JSON.stringify({ lang, t: shown })};`;
}
