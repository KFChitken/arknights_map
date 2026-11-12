import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { fill, type Lang, LANGS, type Messages } from "./core";
import { en } from "./en";
import type { Words } from "./index";
import { wordsBody } from "./words";
import { zh } from "./zh";

/**
 * The server's side of src/i18n: every language's words, which one each request is
 * answered in, and the script that gives a page its own (src/app/i18n).
 */

const WORDS: Record<Lang, Words> = {
  zh: { lang: "zh", t: zh },
  // what English still lacks shows in Chinese (src/i18n/en.ts)
  en: { lang: "en", t: fill<Messages>(zh, en) },
};

declare global {
  /** The language of the request being answered (withLang): one for the whole process */
  var __ZP_I18N_LANG: AsyncLocalStorage<Lang> | undefined;
}

// Next bundles this module more than once (per layer and route, each with its own copy), and
// a request's language set through one copy must be the one T reads through any other
const current = (globalThis.__ZP_I18N_LANG ??= new AsyncLocalStorage<Lang>());

// T (src/i18n/index.ts) reads the request's words through this; outside any request, Chinese
globalThis.__ZP_I18N_SERVER = () => WORDS[current.getStore() ?? "zh"];

/** Runs fn with T in lang, everything it awaits included: route() does this for every request (src/lib/server/http.ts) */
export const withLang = <R>(lang: Lang, fn: () => R): R => current.run(lang, fn);

/** One language's words, whatever the request is in: for a page that renders in a language of its own */
export const wordsOf = (lang: Lang): Messages => WORDS[lang].t;

type Script = { body: string; hash: string };
const scripts = new Map<Lang, Script>();

/** The script that sets a page's words, and the hash in its name: the same for as long as the words stay the same */
export function wordsScript(lang: Lang): Script {
  let s = scripts.get(lang);
  if (!s) {
    const body = wordsBody(lang, WORDS[lang].t);
    s = { body, hash: createHash("sha256").update(body).digest("hex").slice(0, 12) };
    scripts.set(lang, s);
  }
  return s;
}

/** Where a page loads its words from */
export const wordsUrl = (lang: Lang) => `/i18n/${lang}-${wordsScript(lang).hash}.js`;

/** The file name /i18n/<lang>-<hash>.js asks for, read: the language, and whether the hash is this version's */
export function wordsFile(file: string): { lang: Lang; current: boolean } | null {
  const m = /^([a-z]+)-([0-9a-f]{12})\.js$/.exec(file);
  const lang = LANGS.find((l) => l === m?.[1]);
  return m && lang ? { lang, current: wordsScript(lang).hash === m[2] } : null;
}
