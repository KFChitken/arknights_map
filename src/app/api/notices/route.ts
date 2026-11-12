import { NextResponse, type NextRequest } from "next/server";
import { clientIp, inLang } from "@/lib/server/http";
import { noticeList } from "@/lib/server/notices";
import { allow } from "@/lib/server/rateLimit";

/**
 * GET /api/notices: the notices everyone sees (公告, src/lib/server/notices.ts), from memory. A page asks
 * when the stamp on /api/roaches (x-notices) is not the one it holds. The same for everyone, so no cookie
 * is read but for the language of a refusal; the ETag is the stamp, and a browser that holds this list
 * already gets a 304, not counted.
 */
export const GET = inLang(async (req: NextRequest) => {
  const { stamp, json } = noticeList(Date.now());
  const headers = { etag: `"${stamp}"`, "cache-control": "no-cache" };
  if (req.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });
  if (!allow(`notices:ip:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: "人有点多，几秒后自动重试。" }, { status: 429, headers: { "retry-after": "10" } });
  }
  return new Response(json, { headers: { ...headers, "content-type": "application/json" } });
});
