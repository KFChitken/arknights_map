/**
 * The site's words in each language, and the helpers that fill in their blanks.
 *
 * zh.ts holds every piece of text a player can read, by a short name grouped by
 * feature (inbox.*, cards.*, errors.*…); it is the source. en.ts has the same
 * shape. Code never writes player-facing text itself: it reads it from T
 * (src/i18n/index.ts), in the language of the page or request.
 *
 * Text with blanks is written with {name} in the dictionaries and filled in with
 * fmt(); text that changes with a count is a Counted, filled in with count().
 */
import type { zh } from "./zh";

export const LANGS = ["zh", "en"] as const;
export type Lang = (typeof LANGS)[number];
export const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);

/** What <html lang> says for each */
export const HTML_LANG: Record<Lang, string> = { zh: "zh-CN", en: "en" };

/**
 * Words that change with a count. Chinese has one form, written as `other`; English
 * gives `one` for exactly 1 as well: { one: "{n} roach", other: "{n} roaches" }.
 */
export type Counted = { readonly one?: string; readonly other: string };

type Widen<T> = T extends string ? string : T extends Counted ? Counted : { readonly [K in keyof T]: Widen<T[K]> };

/** The shape of every language's dictionary: zh's, with any words in place of its own. Lists of lines keep their length. */
export type Messages = Widen<typeof zh>;

/**
 * A dictionary still being written: anything may be missing, and shows in Chinese
 * until it is there. A list of lines is given whole or not at all.
 */
export type Draft<T> = T extends string | Counted ? T : T extends readonly unknown[] ? T : { readonly [K in keyof T]?: Draft<T[K]> };

export type Params = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Fills in the {name} blanks from params, as a template literal would: String(value).
 * Braces whose name is not in params stay as written.
 */
export function fmt(text: string, params: Params): string {
  return text.replace(/\{([^{}]+)\}/g, (all, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : all));
}

/**
 * fmt, for a sentence shown as JSX text: the words and each value as pieces of their own, which
 * React shows as text nodes of their own, as it did JSX text around {values} (a browser can draw
 * a line a hair apart by where its text nodes break). Empty pieces are left out, as React leaves
 * out empty text.
 */
export function fmtParts(text: string, params: Params): string[] {
  const out: string[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{([^{}]+)\}/g)) {
    if (!Object.hasOwn(params, m[1])) continue;
    out.push(text.slice(at, m.index), String(params[m[1]]));
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out.filter((p) => p !== "");
}

/** The form of a Counted for n, with {n} and any other blanks filled in */
export function count(text: string | Counted, n: number, params: Params = {}): string {
  const form = typeof text === "string" ? text : n === 1 && text.one !== undefined ? text.one : text.other;
  return fmt(form, { n, ...params });
}

const isGroup = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !isCounted(v);

export function isCounted(v: unknown): v is Counted {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return typeof (v as Counted).other === "string" && keys.every((k) => (k === "one" || k === "other") && typeof (v as Record<string, unknown>)[k] === "string");
}

/** base with what over has in its place; what over lacks stays as in base. Only base's names are kept. */
export function fill<T>(base: T, over: Draft<T> | undefined): T {
  if (over === undefined) return base;
  if (!isGroup(base)) return over as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    const o = (over as Record<string, unknown>)[k];
    out[k] = o === undefined ? v : isGroup(v) ? fill(v, o as Draft<typeof v>) : o;
  }
  return out as T;
}

/** The dotted names of everything base has and over lacks, for the list of English still to write */
export function missing(base: unknown, over: unknown, at = ""): string[] {
  if (!isGroup(base)) return over === undefined ? [at] : [];
  return Object.entries(base).flatMap(([k, v]) =>
    missing(v, over === undefined ? undefined : (over as Record<string, unknown>)[k], at ? `${at}.${k}` : k),
  );
}
