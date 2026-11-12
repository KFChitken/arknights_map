import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { clientIp, inLang } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { inkTile } from "@/lib/server/siInk";
import { INK_TILE_ZOOM } from "@/lib/siTiles";

/**
 * GET /api/si/ink?z=17&x=&y=: one tile's ink roaches at 缘缘庄 (src/lib/siTiles.ts), for the map close up:
 * bytes, the same for everyone who asks (visitors too), kept by browsers half a minute. Only tiles near
 * 宏村 have any; a tile elsewhere is empty.
 */
export const GET = inLang(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams;
  const z = Number(q.get("z"));
  const x = Number(q.get("x"));
  const y = Number(q.get("y"));
  const n = 2 ** INK_TILE_ZOOM;
  if (z !== INK_TILE_ZOOM || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    return NextResponse.json({ error: T.server.routes.si.noSuchTile }, { status: 400 });
  }
  // a screen close up takes a dozen tiles, again every half minute
  if (!allow(`si-ink:ip:${clientIp(req)}`, 600, 60_000)) {
    return NextResponse.json({ error: T.server.routes.si.tooFast }, { status: 429, headers: { "retry-after": "20" } });
  }
  try {
    const bytes = await inkTile(x, y);
    return new Response(new Uint8Array(bytes).buffer, {
      headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=30" },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: T.server.common.serverTrouble }, { status: 500 });
  }
});
