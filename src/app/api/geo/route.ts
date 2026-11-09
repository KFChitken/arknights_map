import { NextResponse } from "next/server";
import { isProd } from "@/lib/server/env";
import { geoSearch } from "@/lib/server/geo";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { inMainland } from "@/lib/server/region";
import type { MapView } from "@/lib/types";

/**
 * POST /api/geo { kind: "suggest" | "search", q, near? } → { places, osm }: place search for visitors
 * from mainland China (src/lib/server/geo.ts), and nobody else, so it is no one's free geocoder.
 * The words come in the body, so they are in no address that could be logged. In development,
 * mainland: true stands in for a mainland address, as /?mainland=1 does for the page.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const address = clientIp(req);
  const pretend = !isProd && body.mainland === true;
  if (!pretend && !inMainland(address)) throw new HttpError(403, "这个搜索只给中国大陆的访客用。");
  const kind = body.kind === "suggest" || body.kind === "search" ? body.kind : null;
  const q = typeof body.q === "string" ? body.q.trim().slice(0, 100) : "";
  if (!kind || !q) throw new HttpError(400, "请求格式不对。");
  const found = await geoSearch(address, { kind, q, near: nearOf(body.near) });
  return NextResponse.json(found, { headers: { "cache-control": "no-store" } });
});

function nearOf(v: unknown): MapView | undefined {
  const n = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  const lng = Number(n?.lng);
  const lat = Number(n?.lat);
  const zoom = Number(n?.zoom ?? 5);
  if (!n || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return undefined;
  return { lng, lat, zoom: Number.isFinite(zoom) ? Math.min(22, Math.max(0, zoom)) : 5 };
}
