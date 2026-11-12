import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { clientIp, inLang } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { inkTile } from "@/lib/server/siInk";
import { INK_TILE_V, INK_TILE_ZOOM, oldTile } from "@/lib/siTiles";

/**
 * GET /api/si/ink?z=17&x=&y=&v=2: one tile's ink roaches at 缘缘庄 (src/lib/siTiles.ts), for the map close up:
 * bytes, the same for everyone who asks (visitors too), kept by browsers half a minute. Only tiles near
 * 宏村 have any; a tile elsewhere is empty. Without v (a page from before the tap number), each ink's first
 * OLD_INK_BYTES, as that page reads them.
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
    const current = q.get("v") === INK_TILE_V;
    return new Response(new Uint8Array(current ? bytes : oldTile(bytes)).buffer, {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "public, max-age=30",
        ...(current ? { "x-ink-v": INK_TILE_V } : {}),
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: T.server.common.serverTrouble }, { status: 500 });
  }
});
