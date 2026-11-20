import { introResponse } from "../introPage";

/**
 * /about/zh: the intro page (../route.ts) in Chinese, made the same way (../introPage.ts). The site's main page stays
 * the Chinese map, at /; this page is for those who come by /about and read Chinese.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return introResponse("zh");
}
