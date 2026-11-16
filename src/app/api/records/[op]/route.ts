import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { readOffset } from "@/lib/records";
import { currentUser } from "@/lib/server/auth";
import { recordsMode } from "@/lib/server/env";
import { HttpError, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { recordsLite, recordsOpen, recordsSummary, recordsTimeline, readTimelineQuery } from "@/lib/server/records";

/**
 * 「我的记录」 (src/lib/server/records.ts), each for the signed-in player alone, read only:
 *   GET summary   ?offset= the device's minutes east of UTC; &lite=1 only the last 7 days of 「我的资料」's card
 *   GET timeline  ?before= the cursor of the last item shown &dir= &cat= &kind= (src/lib/records.ts); the page puts the
 *                 items in days by its own clock
 * While RECORDS keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. Never kept by anyone along the way: it is the player's own.
 */
const PER_MINUTE = { summary: 20, timeline: 60 } as const;
type Op = keyof typeof PER_MINUTE;
const isOp = (op: string): op is Op => Object.hasOwn(PER_MINUTE, op);
const NO_STORE = { "cache-control": "private, no-store" };

type Ctx = { params: Promise<{ op: string }> };

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { op } = await params;
  const notHere = () => new HttpError(404, T.server.routes.records.notHere);
  if (recordsMode() === "off" || !isOp(op)) throw notHere();
  const user = await currentUser();
  if (!user) {
    // a visitor is asked to sign in only once it is open to everyone
    if (recordsMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!recordsOpen(user)) throw notHere();
  if (!allow(`records:${op}:${user.id}`, PER_MINUTE[op], 60_000)) throw new HttpError(429, T.server.routes.records.tooFast);
  const q = req.nextUrl.searchParams;
  const offset = readOffset(q.get("offset"));
  if (op === "summary") {
    const body = q.get("lite") === "1" ? await recordsLite(user, offset) : await recordsSummary(user, offset);
    return NextResponse.json(body, { headers: NO_STORE });
  }
  return NextResponse.json(await recordsTimeline(user, readTimelineQuery(q)), { headers: NO_STORE });
});
