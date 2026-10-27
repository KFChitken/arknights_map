import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { roachFeed } from "@/lib/server/roachFeed";

/** The shape of a session token (auth.ts). Made-up cookies gain nothing: the per-address limit counts every request. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * GET /api/roaches?since=<version>: the shared roach feed (src/lib/server/roachFeed.ts).
 * A page asks once a minute; most answers say nothing changed. Whole snapshots
 * carry an ETag, so a browser that already has one gets 304 back.
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  try {
    const answer = await roachFeed(since);
    const etag = `"${answer.v}"`;
    const headers: Record<string, string> = { etag, "cache-control": "no-cache", vary: "accept-encoding" };
    // a browser that already holds this snapshot costs nothing, so it is not counted
    if (answer.kind === "full" && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    // Every answer is made once and shared, so the limits only stop scripts. Per address they are
    // generous, since a dorm or a phone network puts many players behind one; a signed-in page
    // also has a tighter one of its own.
    const full = answer.kind === "full";
    const sid = req.cookies.get("sid")?.value;
    const perAddress = allow(`feed:${answer.kind}:ip:${clientIp(req)}`, full ? 120 : 300, 60_000);
    const perPage = !sid || !SESSION_TOKEN.test(sid) || allow(`feed:${answer.kind}:sid:${sid}`, full ? 20 : 10, 60_000);
    if (!perAddress || !perPage) {
      return NextResponse.json({ error: "人有点多，几秒后自动重试。" }, { status: 429, headers: { "retry-after": "10" } });
    }

    if (answer.kind === "diff") {
      return new Response(answer.json, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
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
