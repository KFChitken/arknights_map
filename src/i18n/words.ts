import type { Lang, Messages } from "./core";

/**
 * Groups only the server reads (its error messages, emails and the privacy page,
 * which it renders itself): left out of what pages download.
 */
export const SERVER_ONLY: readonly string[] = [];

/** How the script that sets a page's words (src/app/i18n) begins */
export const WORDS_PREFIX = "self.__ZP_I18N=";

/** That script: one language's words, without the server's own */
export function wordsBody(lang: Lang, t: Messages): string {
  const shown = Object.fromEntries(Object.entries(t).filter(([group]) => !SERVER_ONLY.includes(group)));
  return `${WORDS_PREFIX}${JSON.stringify({ lang, t: shown })};`;
}
