import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { clientIp, inLang } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { siState } from "@/lib/server/si";

/**
 * GET /api/si: the numbers every page draws 祀掌柜's 缘缘庄 and her painting from (SiState), the same for
 * everyone, visitors too; a page asks once a minute while she or her inn is in view. Nothing in it is anyone's.
 */
export const GET = inLang(async (req: NextRequest) => {
  if (!allow(`si:ip:${clientIp(req)}`, 240, 60_000)) {
    return NextResponse.json({ error: T.server.routes.si.tooFast }, { status: 429, headers: { "retry-after": "20" } });
  }
  try {
    return NextResponse.json(await siState(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: T.server.common.serverTrouble }, { status: 500 });
  }
});
