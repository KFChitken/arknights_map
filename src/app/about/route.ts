import { introResponse } from "./introPage";

/**
 * /about: a page in English that says what the site is, with the way to the map and to the same page in Chinese
 * (./zh/route.ts), made by ./introPage.ts. It has no script and loads no map; it reads no session and no database.
 * Made when asked rather than at build, where neither 全站变灰 nor the server's ENGLISH can be read, nor how many
 * players are on the map; all three come from memory, and each of the page's ways is made once.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return introResponse("en");
}
