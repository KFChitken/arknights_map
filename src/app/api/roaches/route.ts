import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { roachFeed } from "@/lib/server/roachFeed";

/**
 * GET /api/roaches?since=<version>: the shared roach feed (src/lib/server/roachFeed.ts).
 * A page asks once a minute; most answers say nothing changed. Whole snapshots
 * carry an ETag, so a browser that already has one gets 304 back.
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  // a signed-in page is limited on its own, so players sharing an address do not crowd each other out
  const who = req.cookies.get("sid")?.value ?? `ip:${clientIp(req)}`;
  if (!allow(`feed:${since ? "diff" : "full"}:${who}`, since ? 10 : 20, 60_000)) {
    return NextResponse.json({ error: "刷新得太频繁了，歇一会儿再试。" }, { status: 429, headers: { "retry-after": "60" } });
  }
  try {
    const answer = await roachFeed(since);
    if (answer.kind === "diff") {
      return new Response(answer.json, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    const etag = `"${answer.v}"`;
    const headers: Record<string, string> = { etag, "cache-control": "no-cache", vary: "accept-encoding" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    headers["content-type"] = "application/json";
    // compressed once per snapshot, not once per request
    if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(answer.gzip), { headers: { ...headers, "content-encoding": "gzip" } });
    }
    return new Response(answer.json, { headers });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "服务器出了点问题，稍后再试试。" }, { status: 500 });
  }
}
