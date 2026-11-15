import { songsGoOut } from "@/lib/server/listen";
import { linkGood } from "@/lib/server/musicLinks";

/**
 * GET /api/listen/ok: Caddy asks before each song's file goes out (deploy/Caddyfile, forward_auth), passing the
 * path and query it was asked for in X-Forwarded-Uri. 204 for a link of src/lib/server/musicLinks.ts that is good
 * now, 403 for anything else, and for everything while LISTEN is off or 听歌 is paused in the 管理台. No database, no
 * sign-in and no limit: every song is asked about a few times as it plays, and the link alone says enough.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export function GET(req: Request) {
  const ok = songsGoOut() && linkGood(req.headers.get("x-forwarded-uri") ?? "");
  return new Response(null, { status: ok ? 204 : 403, headers: NO_STORE });
}
