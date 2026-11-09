import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { note } from "@/lib/server/signals";

const MAPS = new Set(["amap", "osm", "overseas"]);
const TROUBLES = new Set(["load", "key", "slow", "style", "tiles"]);

/**
 * POST /api/health/map: a page could not load a map (src/components/map/report.ts). Only which
 * map, what went wrong and the map service's own short code are kept, in memory, for the site's
 * checks (src/lib/server/watch.ts); nothing about the visitor, not even the address.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const map = String(body.map ?? "");
  const what = String(body.what ?? "");
  const detail = String(body.detail ?? "")
    .replace(/[^\w.-]/g, "")
    .slice(0, 40);
  // anyone can send these: a cap for the whole site keeps a flood from filling memory
  if (MAPS.has(map) && TROUBLES.has(what) && allow("map-trouble", 300, 10 * 60_000)) note("map", `${map}:${what}:${detail}`);
  return new NextResponse(null, { status: 204 });
});
