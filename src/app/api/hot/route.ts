import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/http";
import { hotList } from "@/lib/server/hotList";
import { allow } from "@/lib/server/rateLimit";

/** GET /api/hot: 本周舟P热榜 (src/lib/server/hotList.ts), the same for everyone, signed in or not. */
export async function GET(req: NextRequest) {
  if (!allow(`hot:ip:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "人有点多，过一会儿再看。" }, { status: 429 });
  }
  try {
    return NextResponse.json(await hotList(), { headers: { "cache-control": "public, max-age=60" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "热榜暂时打不开，稍后再试试。" }, { status: 500 });
  }
}
