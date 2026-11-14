import { NextResponse, type NextRequest } from "next/server";
import { lang, T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { sponsorMode } from "@/lib/server/env";
import { clientIp, HttpError, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { sponsorCard } from "@/lib/server/sponsor";

/** The answer may carry the player's own email: never kept by anyone along the way */
const NO_STORE = { "cache-control": "private, no-store" };

/**
 * GET /api/sponsor: 支持舟P地图's card (src/lib/sponsor.ts), asked for as 我的资料 opens; { sponsor: null }
 * while the entry is off, to anyone SPONSOR does not show it to (src/lib/server/env.ts), and always on the
 * English site, which has no entry for now (爱发电 is only in Chinese). A signed-in player also gets their own
 * login email, for 复制我的登录邮箱.
 */
export const GET = route(async (req: NextRequest) => {
  if (lang() !== "zh") return NextResponse.json({ sponsor: null }, { headers: NO_STORE });
  if (!allow(`sponsor:ip:${clientIp(req)}`, 60, 60_000)) throw new HttpError(429, T.server.routes.sponsor.busy);
  // nobody's session is looked up while SPONSOR is off: it is shown to no one
  const user = sponsorMode() === "off" ? null : await currentUser();
  const card = await sponsorCard(user);
  const sponsor = card && { ...card, email: user?.email ?? null };
  return NextResponse.json({ sponsor }, { headers: NO_STORE });
});
