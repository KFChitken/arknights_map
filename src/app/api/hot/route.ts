import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { clientIp, inLang } from "@/lib/server/http";
import { hotList } from "@/lib/server/hotList";
import { allow } from "@/lib/server/rateLimit";

/** GET /api/hot: 本周舟P热榜 (src/lib/server/hotList.ts), the same for everyone, signed in or not. */
export const GET = inLang(async (req: NextRequest) => {
  if (!allow(`hot:ip:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: T.server.routes.hot.busy }, { status: 429 });
  }
  try {
    return NextResponse.json(await hotList(), { headers: { "cache-control": "public, max-age=60" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: T.server.routes.hot.unavailable }, { status: 500 });
  }
});
