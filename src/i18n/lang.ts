import type { Lang } from "./core";

/**
 * Which language a page or answer is in (Breeze, 2026-11-12): zhoupmap.com is always in
 * Chinese, whatever the phone's language, and English lives under zhoupmap.com/en. Nothing
 * is guessed and nothing is kept in a cookie. A page under /en is marked English by
 * src/middleware.ts, and an English page marks each ask it makes of the server the same way
 * (src/lib/apiFetch.ts). Anything not marked is Chinese.
 */
export const LANG_HEADER = "x-zp-lang";

/** Where the English site lives */
export const EN_PATH = "/en";

/**
 * The English site's own manifest (src/app/en/app.webmanifest), to put it on a home screen in English, opening at
 * /en. Each English page names it in its own metadata: Next links the site's manifest (src/app/manifest.ts) over
 * whatever a layout of the top two levels says, and only a page's metadata comes after that.
 */
export const EN_MANIFEST = "/en/app.webmanifest";

/** The language a request is marked with: English only when it says so */
export const langOfMark = (mark: string | null | undefined): Lang => (mark === "en" ? "en" : "zh");

/** A path of the English site: "/en", "/en/privacy"; not "/english" */
export const isEnglishPath = (path: string) => path === EN_PATH || path.startsWith(`${EN_PATH}/`);

/** The same page in a language: ("/privacy#abroad", "en") → "/en/privacy#abroad", ("/", "en") → "/en"; Chinese as given */
export function pathIn(path: string, lang: Lang): string {
  if (lang === "zh") return path;
  if (path === "/") return EN_PATH;
  return path.startsWith("/#") || path.startsWith("/?") ? `${EN_PATH}${path.slice(1)}` : `${EN_PATH}${path}`;
}
