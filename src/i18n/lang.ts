import { isLang, type Lang } from "./core";

/**
 * Which language a visitor gets. Until English is offered (ENGLISH_ON), every page
 * and answer is in Chinese, as before, and nothing is written into a cookie.
 */
export const ENGLISH_ON = false;

/** The visitor's choice, once made or first worked out: kept a year */
export const LANG_COOKIE = "lang";
export const LANG_COOKIE_DAYS = 365;

export type LangSignals = {
  /** The lang cookie, if any */
  cookie: string | null | undefined;
  /** The Accept-Language header */
  acceptLanguage: string | null | undefined;
  /** Whether the visitor holds a session cookie: signed-in players keep Chinese */
  signedIn: boolean;
  /** Whether the visitor's address is in mainland China (src/lib/server/region.ts) */
  mainland: boolean;
};

/**
 * The cookie when there is one. Without: signed-in players and visitors from
 * mainland China get Chinese, whatever their phone says; anyone else gets
 * Chinese when the language they want most is Chinese (zh, zh-CN, zh-Hant…),
 * else English. No Accept-Language at all (a crawler, say) gets Chinese.
 */
export function pickLang({ cookie, acceptLanguage, signedIn, mainland }: LangSignals): Lang {
  if (isLang(cookie)) return cookie;
  if (signedIn || mainland) return "zh";
  const first = firstLanguage(acceptLanguage);
  if (first === null) return "zh";
  return first === "zh" || first.startsWith("zh-") ? "zh" : "en";
}

/** The language a browser wants most, from its Accept-Language ("en-US,en;q=0.9,zh;q=0.8" → "en-us"), or null for none */
export function firstLanguage(header: string | null | undefined): string | null {
  let best: { tag: string; q: number } | null = null;
  for (const part of (header ?? "").split(",")) {
    const [tag, ...attrs] = part.trim().split(";").map((s) => s.trim());
    if (!tag || tag === "*") continue;
    const qAttr = attrs.find((a) => a.startsWith("q="));
    const q = qAttr ? Number(qAttr.slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) continue;
    // the first of equal weight wins, as browsers list them in order
    if (!best || q > best.q) best = { tag: tag.toLowerCase(), q };
  }
  return best?.tag ?? null;
}
