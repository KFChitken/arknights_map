import { NextResponse, type NextRequest } from "next/server";
import { LANG_HEADER } from "@/i18n/lang";

/**
 * The English site, zhoupmap.com/en (src/i18n/lang.ts): its pages are marked English for the
 * server that makes them. Only /en is looked at; the Chinese site never comes this way.
 */
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(LANG_HEADER, "en");
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/en", "/en/:path*"] };
