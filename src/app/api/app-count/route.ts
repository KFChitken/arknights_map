import { NextResponse } from "next/server";
import { isPageCountName } from "@/lib/appCounts";
import { countApp } from "@/lib/server/appCounts";
import { clientIp, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";

/** 存到桌面's counts from the page (src/lib/appCounts.ts): only the names it may send, nothing about who sent them */
export const POST = route(async (req) => {
  const body = await readJson(req);
  if (allow(`appcount:${clientIp(req)}`, 30, 60_000) && isPageCountName(body.name)) countApp(body.name);
  return NextResponse.json({ ok: true });
});
