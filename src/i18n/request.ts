import "server-only";
import type { Lang } from "./core";
import { lang } from "./index";
import "./server";

/**
 * The language of the page being made: English under /en (src/middleware.ts marks it), else
 * Chinese (src/i18n/lang.ts). Read without making the page one that is made for each visit,
 * so pages built ahead of time (the 管理台) stay so, in Chinese.
 */
export async function pageLang(): Promise<Lang> {
  return lang();
}
