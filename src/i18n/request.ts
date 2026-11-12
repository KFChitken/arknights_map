import "server-only";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { ipFrom } from "@/lib/server/http";
import { inMainland } from "@/lib/server/region";
import type { Lang } from "./core";
import { ENGLISH_ON, LANG_COOKIE, pickLang } from "./lang";

/**
 * The language of a page's request (src/i18n/lang.ts; an API request's is requestLang in
 * src/lib/server/http.ts). While English is not offered, Chinese without looking at the
 * request at all, so pages that were built ahead of time stay so.
 */
export async function pageLang(): Promise<Lang> {
  if (!ENGLISH_ON) return "zh";
  const [h, jar] = await Promise.all([headers(), cookies()]);
  return pickLang({
    cookie: jar.get(LANG_COOKIE)?.value,
    acceptLanguage: h.get("accept-language"),
    signedIn: jar.has(SESSION_COOKIE),
    mainland: inMainland(ipFrom(h)),
  });
}
