import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { drainFile, started } from "@/lib/server/ready";
import { feedReady } from "@/lib/server/roachFeed";

export const dynamic = "force-dynamic";

/**
 * GET /api/ready: 200 once this process has started (src/lib/server/ready.ts) and has its roach list
 * (src/lib/server/roachFeed.ts), 503 before, once a release has put its file down (drainFile), and once it is told to stop.
 * Asked of each process itself, by the gateway's health check and by releases, so that a process gets visitors
 * only when it can answer them at once.
 * The roach list is started in the background if nobody has asked for it yet, never waited for. Says nothing
 * about anyone.
 */
export async function GET() {
  const ok = started() && !existsSync(drainFile()) && feedReady();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
