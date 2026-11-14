import { englishOn } from "@/i18n/server";
import { grayUntil } from "@/lib/server/siteSettings";
import { introHtml } from "./introPage";

/**
 * /about: a page in English that says what the site is, with the way to the map (./introPage.ts). It has no script
 * and loads no map; it reads no session and no database. Made when asked rather than at build, where neither
 * 全站变灰 nor the server's ENGLISH can be read; both come from memory (src/lib/server/siteSettings.ts,
 * src/i18n/server.ts), and each of the page's four ways is made once.
 */
export const dynamic = "force-dynamic";

/** How long a browser may keep the page: 全站变灰 and a new release reach it within that */
const MAX_AGE_S = 300;

export function GET() {
  return new Response(introHtml(englishOn(), grayUntil() !== null), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${MAX_AGE_S}` },
  });
}
