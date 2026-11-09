import { NextResponse } from "next/server";
import { healthy } from "@/lib/server/watch";

export const dynamic = "force-dynamic";

/**
 * GET /api/health, which .github/workflows/uptime.yml checks from outside every few minutes:
 * 200 while the site, its database and its emails work; 503 otherwise, so GitHub emails the
 * owner even when the site cannot. Says nothing about anyone.
 */
export async function GET() {
  const h = await healthy();
  return NextResponse.json(h, { status: h.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
