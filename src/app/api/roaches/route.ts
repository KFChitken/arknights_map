import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { sessionAlive } from "@/lib/server/auth";
import { clientIp, inLang } from "@/lib/server/http";
import { noticeList } from "@/lib/server/notices";
import { allow } from "@/lib/server/rateLimit";
import { note } from "@/lib/server/signals";
import { compressedArea, roachArea, roachCounts, roachesInView, roachFeed, type FeedForm } from "@/lib/server/roachFeed";
import { parseBox, parseView, type Area, type Box } from "@/lib/world/area";

/** The shape of a session token (auth.ts). Made-up cookies gain nothing: the per-address limit counts every request. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * GET /api/roaches?since=<version>: the shared roach feed (src/lib/server/roachFeed.ts).
 * A page asks every two minutes; most answers say nothing changed. Whole snapshots
 * carry an ETag, so a browser that already has one gets 304 back. f=3: packed with
 * short ids, as pages ask now (src/lib/world/packed.ts); f=2: packed with whole
 * public ids, and nothing: the list, for pages from before each.
 *
 * f=4 (只发看得到的, src/lib/world/area.ts): only an area, &box=west,south,east,north or the overview,
 * &o=2 with each roach as its square of the overview (world/packed.ts), as pages ask now (&o=1 as it was, for
 * pages from before); &n=<view> exactly how many roaches there are in a view, which a page showing the overview
 * counts by. The whole list stays for pages opened before.
 *
 * Only to someone signed in: a visitor gets how many roaches there are, by the fire and riding with
 * 明河都尉, and how many players they belong to (FeedCounts), and hidden: true, a few hundred bytes (their
 * map is 全员隐匿). The answer depends on the cookie, so no cache may hand one person's to another.
 */
export const GET = inLang(async (req: NextRequest) => {
  const res = await answer(req);
  // Every answer, a 304 or a visitor's too, says which notices there are now (公告, src/lib/server/notices.ts),
  // from memory: a page that holds others asks /api/notices. The answer itself and its ETag stay as they are.
  res.headers.set("x-notices", noticeList(Date.now()).stamp);
  return res;
});

async function answer(req: NextRequest): Promise<Response> {
  const since = req.nextUrl.searchParams.get("since");
  const f = req.nextUrl.searchParams.get("f");
  const form: FeedForm = f === "3" ? 3 : f === "2" ? 2 : 1;
  let area: Area | "counts" | { view: Box } | null = null;
  const squares = f === "4" && req.nextUrl.searchParams.get("o") === "2";
  if (f === "4" && req.nextUrl.searchParams.has("n")) {
    const view = parseView(req.nextUrl.searchParams.get("n"));
    if (!view) return NextResponse.json({ error: T.server.routes.roaches.badArea }, { status: 400 });
    area = { view };
  } else if (f === "4") {
    const q = req.nextUrl.searchParams;
    area = q.get("c") === "1" ? "counts" : q.get("o") === "1" || squares ? "overview" : parseBox(q.get("box"));
    if (!area) return NextResponse.json({ error: T.server.routes.roaches.badArea }, { status: 400 });
  }
  try {
    const sid = req.cookies.get("sid")?.value;
    // no cookie, or one of the wrong shape, is nobody, without asking the database
    if (!sid || !SESSION_TOKEN.test(sid) || !(await sessionAlive(sid))) {
      if (!allow(`feed:visitor:ip:${clientIp(req)}`, 300, 60_000)) return BUSY("feed:visitor:ip");
      const counts = await roachCounts();
      return NextResponse.json({ ...counts, hidden: true }, { headers: { "cache-control": "no-store", vary: "cookie" } });
    }
    // f=4 switched off (AREA_FEED=off): the page asks for the whole list instead, as before
    if (area && process.env.AREA_FEED === "off") return NextResponse.json({ whole: true }, { headers: { "cache-control": "no-store", vary: "cookie" } });
    // 全员隐匿 signed in: only how many there are, as a visitor gets them
    if (area === "counts") {
      if (!allow(`area:counts:sid:${sid}`, 20, 60_000)) return BUSY("area:counts:sid");
      const c = await roachCounts();
      return NextResponse.json({ v: c.v, t: [c.total, c.fire, c.riders, c.players] }, { headers: { "cache-control": "no-store", vary: "cookie" } });
    }
    if (area && typeof area === "object" && "view" in area) {
      if (!allow(`area:count:ip:${clientIp(req)}`, 3000, 60_000)) return BUSY("area:count:ip");
      if (!allow(`area:count:sid:${sid}`, 120, 60_000)) return BUSY("area:count:sid");
      return NextResponse.json({ n: await roachesInView(area.view) }, { headers: { "cache-control": "no-store", vary: "cookie" } });
    }
    if (area) return await areaAnswer(req, sid, area, since, squares);
    const answer = await roachFeed(since, Date.now(), form);
    const etag = `"${answer.v}${form === 3 ? "s" : form === 2 ? "p" : ""}"`;
    const headers: Record<string, string> = { etag, "cache-control": "no-cache", vary: "accept-encoding, cookie" };
    // a browser that already holds this snapshot costs nothing, so it is not counted
    if (answer.kind === "full" && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

    // Every answer is made once and shared, so the limits only stop scripts. Per address they are
    // generous, since a dorm or a phone network puts many players behind one; each signed-in page
    // also has a tighter one of its own.
    const full = answer.kind === "full";
    if (!allow(`feed:${answer.kind}:ip:${clientIp(req)}`, full ? 120 : 300, 60_000)) return BUSY(`feed:${answer.kind}:ip`);
    if (!allow(`feed:${answer.kind}:sid:${sid}`, full ? 20 : 10, 60_000)) return BUSY(`feed:${answer.kind}:sid`);

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
    return NextResponse.json({ error: T.server.common.serverTrouble }, { status: 500 });
  }
}

/** Refused by a limit (which one, for the site's checks: watch.ts counts them) */
const BUSY = (limit: string) => {
  note("busy", limit);
  return NextResponse.json({ error: T.server.common.busyRetrying }, { status: 429, headers: { "retry-after": "10" } });
};

/**
 * f=4: an area for a signed-in page. A page asks for a new box each time its view leaves the one it holds,
 * and what changed in it every two minutes, so the limits per page are looser than for the whole list. Someone
 * zooming in and out asks for a new box at each stop, scores of them in a minute: a page held back keeps showing
 * the box it had until it asks again, so its limit for whole areas is generous. Per address they are higher
 * still: a phone network puts thousands of players behind one, and these answers cost no database (a box is
 * made once per version for every page that asks; a page's own limit holds back one that asks too much).
 */
async function areaAnswer(req: NextRequest, sid: string, area: Area, since: string | null, squares: boolean) {
  const answer = await roachArea(area, since, Date.now(), squares);
  if (answer.kind === "diff") {
    if (!allow(`area:diff:ip:${clientIp(req)}`, 3000, 60_000)) return BUSY("area:diff:ip");
    if (!allow(`area:diff:sid:${sid}`, 20, 60_000)) return BUSY("area:diff:sid");
    return new Response(answer.json, { headers: { "content-type": "application/json", "cache-control": "no-store", vary: "cookie" } });
  }
  const etag = `"${answer.v}:${answer.key}"`;
  const headers: Record<string, string> = { etag, "cache-control": "no-cache", vary: "accept-encoding, cookie", "content-type": "application/json" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  if (!allow(`area:full:ip:${clientIp(req)}`, 3000, 60_000)) return BUSY("area:full:ip");
  if (!allow(`area:full:sid:${sid}`, 200, 60_000)) return BUSY("area:full:sid");
  const accepts = req.headers.get("accept-encoding") ?? "";
  const how = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
  if (!how) return new Response(answer.whole.json, { headers });
  return new Response(new Uint8Array(await compressedArea(answer.whole, how)), { headers: { ...headers, "content-encoding": how } });
}
