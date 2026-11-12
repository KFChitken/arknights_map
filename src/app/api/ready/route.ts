import { NextResponse } from "next/server";
import { started } from "@/lib/server/ready";
import { feedReady } from "@/lib/server/roachFeed";

export const dynamic = "force-dynamic";

/**
 * GET /api/ready: 200 once this process has started (src/lib/server/ready.ts) and has its roach list
 * (src/lib/server/roachFeed.ts), 503 before, and once it is told to stop. Asked of each process itself, not
 * through the gateway, when it is restarted, so that it gets visitors back only when it can answer them at once.
 * The roach list is started in the background if nobody has asked for it yet, never waited for. Says nothing
 * about anyone.
 */
export async function GET() {
  const ok = started() && feedReady();
  return NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
