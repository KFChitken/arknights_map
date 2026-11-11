import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { DESK_CODE_WRONG } from "@/lib/deskCode";
import { DESK_CODE_TRIES } from "@/lib/rules";
import { isBanned } from "@/lib/server/account";
import { countApp } from "@/lib/server/appCounts";
import { startSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { redeemDeskCode } from "@/lib/server/deskCodes";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import { users } from "@/lib/server/schema";
import { note } from "@/lib/server/signals";

/**
 * Sign in with a 桌面登录码. Every failure says the same, whatever it was; failures and networks trying
 * too often are noted for the site's checks (src/lib/server/watch.ts), to see anyone guessing.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  if (!allow(`deskcode:${clientIp(req)}`, DESK_CODE_TRIES, 10 * 60_000)) {
    note("codeRefused", "desk-ip");
    throw new HttpError(429, "试得太频繁了，过几分钟再试。");
  }
  const userId = await redeemDeskCode(body.code);
  const [user] = userId ? await db.select().from(users).where(eq(users.id, userId)).limit(1) : [];
  if (!user || (user.email && (await isBanned(user.email)))) {
    note("codeRefused", "desk-wrong");
    throw new HttpError(400, DESK_CODE_WRONG);
  }
  await startSession(req, user.id);
  countApp("code-redeemed");
  return NextResponse.json({ status: "ok" });
});
