import { NextResponse, type NextRequest } from "next/server";
import { clientIp, inLang } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { roachesNear } from "@/lib/server/roachFeed";

/**
 * GET /api/around?lng=&lat=: how many roaches are within the declaration and the radar radius of a spot,
 * roughly (src/lib/server/nearby.ts), for a visitor who has not signed in and taps the map to see where
 * theirs would go. They get no list of roaches (src/app/api/roaches), so the server counts.
 */
export const GET = inLang(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const lng = Number(q.get("lng"));
  const lat = Number(q.get("lat"));
  if (!q.get("lng") || !q.get("lat") || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    return NextResponse.json({ error: "位置不对。" }, { status: 400 });
  }
  // a visitor taps now and then; this stops scripts walking the map
  if (!allow(`around:ip:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "点得太快了，歇一会儿再看。" }, { status: 429, headers: { "retry-after": "20" } });
  }
  try {
    return NextResponse.json(await roachesNear({ lng, lat }), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "服务器出了点问题，稍后再试试。" }, { status: 500 });
  }
});
