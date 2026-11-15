import { NextResponse } from "next/server";
import { readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { note } from "@/lib/server/signals";
import { troubleLine } from "@/lib/troubleLine";

/** What a page could say of the maps it had up when their drawing was lost (src/lib/pageTrouble.ts) */
const MAPS_UP = /^(amap|tencent|own|osm)(\+overseas)?$/;

/**
 * POST /api/health/page: a page broke, or could not draw its map with the graphics card (src/lib/pageTrouble.ts).
 * Kept in memory for the site's checks (pages in src/lib/server/watch.ts): which of the three, and for a break one
 * line of what the browser said, made fit to keep here again (troubleLine), whatever the page sent; for the
 * others only words this knows. Nothing about the visitor, not even the address.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const what = String(body.what ?? "");
  const said = String(body.detail ?? "");
  const detail =
    what === "crash" ? troubleLine(said) : what === "nogl" ? (said === "map" ? "map" : "start") : what === "lost" && MAPS_UP.test(said) ? said : "";
  // anyone can send these: a cap for each process keeps a flood from filling memory
  if (["crash", "nogl", "lost"].includes(what) && allow("page-trouble", 300, 10 * 60_000)) note("page", `${what}:${detail}`);
  return new NextResponse(null, { status: 204 });
});
