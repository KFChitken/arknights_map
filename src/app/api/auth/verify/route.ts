import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { T } from "@/i18n";
import { setSignupProof, startSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { redeemLoginCode } from "@/lib/server/loginCodes";
import { passwordSetAt } from "@/lib/server/passwords";
import { allow } from "@/lib/server/rateLimit";
import { users } from "@/lib/server/schema";

/**
 * Check the emailed code. Known players are signed in (hasPassword: whether they have one, so the page can
 * offer to set one); new ones go on to the sign-up step.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const code = String(body.code ?? "").trim();

  if (!allow(`verify:${clientIp(req)}`, 30, 10 * 60_000)) throw new HttpError(429, T.server.common.triedTooOftenMinutes);
  await redeemLoginCode(email, code);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    await startSession(req, user.id);
    return NextResponse.json({ status: "ok", hasPassword: (await passwordSetAt(user.id)) !== null });
  }
  await setSignupProof(req, email);
  return NextResponse.json({ status: "signup" });
});
