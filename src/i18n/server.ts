import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { fill, type Lang, LANGS, type Messages } from "./core";
import { en } from "./en";
import type { Words } from "./index";
import { LANG_HEADER, langOfMark } from "./lang";
import { wordsBody } from "./words";
import { zh } from "./zh";

/**
 * The server's side of src/i18n: every language's words, which one each request is
 * answered in, and the script that gives a page its own (src/app/i18n).
 */

const WORDS: Record<Lang, Words> = {
  zh: { lang: "zh", t: zh },
  // en.ts has every line; filled from zh all the same, so that a line added in Chinese shows until it has its English
  en: { lang: "en", t: fill<Messages>(zh, en) },
};

declare global {
  /** The language of the request being answered (withLang): one for the whole process */
  var __ZP_I18N_LANG: AsyncLocalStorage<Lang> | undefined;
}

// Next bundles this module more than once (per layer and route, each with its own copy), and
// a request's language set through one copy must be the one T reads through any other
const current = (globalThis.__ZP_I18N_LANG ??= new AsyncLocalStorage<Lang>());

/**
 * Whether the English site is up: ENGLISH=off on the server takes it down at once, /en
 * then leading to the Chinese map (src/app/en/layout.tsx) and every answer in Chinese.
 */
export const englishOn = () => process.env.ENGLISH !== "off";

/**
 * The language the request being answered is marked with (src/i18n/lang.ts), as Next keeps the
 * request for its own headers(): through the page's server rendering, its components drawn
 * on the server included, and a route's handler. Read without marking the page as one made
 * for each visit, unlike headers(): a page built ahead of time has no request, and is Chinese.
 */
function markedLang(): Lang | undefined {
  const store = workUnitAsyncStorage.getStore();
  return store?.type === "request" ? langOfMark(store.headers.get(LANG_HEADER)) : undefined;
}

/** The language T is in on the server: as withLang says, else as the request is marked, else Chinese */
const serverLang = (): Lang => (englishOn() ? (current.getStore() ?? markedLang() ?? "zh") : "zh");

// T (src/i18n/index.ts) reads the request's words through this; outside any request, Chinese
globalThis.__ZP_I18N_SERVER = () => WORDS[serverLang()];

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
