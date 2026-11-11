import { NextResponse, type NextRequest } from "next/server";
import { sessionAlive } from "@/lib/server/auth";
import { clientIp } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { roachCounts, roachFeed, type FeedForm } from "@/lib/server/roachFeed";

/** The shape of a session token (auth.ts). Made-up cookies gain nothing: the per-address limit counts every request. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * GET /api/roaches?since=<version>: the shared roach feed (src/lib/server/roachFeed.ts).
 * A page asks every two minutes; most answers say nothing changed. Whole snapshots
 * carry an ETag, so a browser that already has one gets 304 back. f=3: packed with
 * short ids, as pages ask now (src/lib/world/packed.ts); f=2: packed with whole
 * public ids, and nothing: the list, for pages from before each.
 *
 * Only to someone signed in: a visitor gets how many roaches there are, by the fire and riding with
 * 明河都尉 (FeedCounts), and hidden: true, a few hundred bytes (their map is 全员隐匿). The answer depends
 * on the cookie, so no cache may hand one person's to another.
 */
export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const f = req.nextUrl.searchParams.get("f");
  const form: FeedForm = f === "3" ? 3 : f === "2" ? 2 : 1;
  try {
    const sid = req.cookies.get("sid")?.value;
    // no cookie, or one of the wrong shape, is nobody, without asking the database
    if (!sid || !SESSION_TOKEN.test(sid) || !(await sessionAlive(sid))) {
      if (!allow(`feed:visitor:ip:${clientIp(req)}`, 300, 60_000)) {
        return NextResponse.json({ error: "人有点多，几秒后自动重试。" }, { status: 429, headers: { "retry-after": "10" } });
      }
      const counts = await roachCounts();
      return NextResponse.json({ ...counts, hidden: true }, { headers: { "cache-control": "no-store", vary: "cookie" } });
    }
    const answer = await roachFeed(since, Date.now(), form);
    const etag = `"${answer.v}${form === 3 ? "s" : form === 2 ? "p" : ""}"`;
    const headers: Record<string, string> = { etag, "cache-control": "no-cache", vary: "accept-encoding, cookie" };
    // a browser that already holds this snapshot costs nothing, so it is not counted
    if (answer.kind === "full" && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    // Every answer is made once and shared, so the limits only stop scripts. Per address they are
    // generous, since a dorm or a phone network puts many players behind one; each signed-in page
    // also has a tighter one of its own.
    const full = answer.kind === "full";
    const perAddress = allow(`feed:${answer.kind}:ip:${clientIp(req)}`, full ? 120 : 300, 60_000);
    const perPage = allow(`feed:${answer.kind}:sid:${sid}`, full ? 20 : 10, 60_000);
    if (!perAddress || !perPage) {
      return NextResponse.json({ error: "人有点多，几秒后自动重试。" }, { status: 429, headers: { "retry-after": "10" } });
    }

    if (answer.kind === "diff") {
      return new Response(answer.json, { headers: { "content-type": "application/json", "cache-control": "no-store", vary: "cookie" } });
    }
    headers["content-type"] = "application/json";
    // compressed once per snapshot, not once per request
    const accepts = req.headers.get("accept-encoding") ?? "";
    if (answer.br && /\bbr\b/.test(accepts)) {
      return new Response(new Uint8Array(answer.br), { headers: { ...headers, "content-encoding": "br" } });
    }
    if (/\bgzip\b/.test(accepts)) {
      return new Response(new Uint8Array(answer.gzip), { headers: { ...headers, "content-encoding": "gzip" } });
    }
    return new Response(answer.json, { headers });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "服务器出了点问题，稍后再试试。" }, { status: 500 });
  }
}
