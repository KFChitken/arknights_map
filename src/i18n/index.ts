import type { Lang, Messages } from "./core";
import { WORDS_PREFIX } from "./words";

export * from "./core";

/**
 * The words of one language as a page or request uses them. A page gets its own
 * from /i18n/<lang>-<hash>.js (src/app/i18n), which the root layout loads before
 * the app starts (next/script beforeInteractive): only its language's, and only
 * what the browser shows. The server keeps every language (src/i18n/server.ts)
 * and answers each request in its own.
 */
export type Words = { lang: Lang; t: Messages };

declare global {
  /** Set by /i18n/<lang>-<hash>.js */
  var __ZP_I18N: Words | undefined;
  /** Set by src/i18n/server.ts: the words of the request being answered */
  var __ZP_I18N_SERVER: (() => Words) | undefined;
}

/** Where the page's words come from, for when their script did not load in time: the same script, asked for again */
const WORDS_SCRIPT = /^\/i18n\/[a-z]+-[0-9a-f]+\.js$/;

function loadNow(): Words {
  const queued = ((self as unknown as { __next_s?: [string, unknown][] }).__next_s ?? []).map(([src]) => src);
  const src = queued.find((s) => typeof s === "string" && WORDS_SCRIPT.test(s));
  if (!src) throw new Error("The page's words are missing");
  const xhr = new XMLHttpRequest();
  // synchronous on purpose: nothing on the page can be drawn without its words, and this is only a fallback
  xhr.open("GET", src, false);
  xhr.send();
  const body = xhr.responseText.trim();
  if (xhr.status !== 200 || !body.startsWith(WORDS_PREFIX)) throw new Error(`The page's words could not be loaded (${xhr.status})`);
  window.__ZP_I18N = JSON.parse(body.slice(WORDS_PREFIX.length).replace(/;$/, "")) as Words;
  return window.__ZP_I18N;
}

function words(): Words {
  if (typeof window !== "undefined") return window.__ZP_I18N ?? loadNow();
  const server = globalThis.__ZP_I18N_SERVER;
  if (!server) throw new Error("src/i18n/server.ts has not been loaded on the server");
  return server();
}

/**
 * The text of the language the page, or the request being answered, is in:
 * T.inbox.title, fmt(T.radar.count, { n }). Read it where the text is used,
 * never once at the top of a module: a module is loaded once on the server and
 * serves every language (src/i18n/i18n.test.ts checks for this).
 */
export const T: Messages = new Proxy({} as Messages, {
  get: (_, key) => (words().t as Record<PropertyKey, unknown>)[key],
  has: (_, key) => key in words().t,
  ownKeys: () => Reflect.ownKeys(words().t),
  getOwnPropertyDescriptor: (_, key) => {
    const d = Reflect.getOwnPropertyDescriptor(words().t, key);
    return d && { ...d, configurable: true };
  },
});

/** The language the page, or the request being answered, is in */
export const lang = (): Lang => words().lang;

/** T, for components that read it as a hook */
export const useT = (): Messages => T;
