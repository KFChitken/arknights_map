import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { setSignupProof, startSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { redeemLoginCode } from "@/lib/server/loginCodes";
import { allow } from "@/lib/server/rateLimit";
import { users } from "@/lib/server/schema";

/** Check the emailed code. Known players are signed in; new ones go on to the sign-up step. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const code = String(body.code ?? "").trim();

  if (!allow(`verify:${clientIp(req)}`, 30, 10 * 60_000)) throw new HttpError(429, "试得太频繁了，过几分钟再试。");
  await redeemLoginCode(email, code);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    await startSession(req, user.id);
    return NextResponse.json({ status: "ok" });
  }
  await setSignupProof(req, email);
  return NextResponse.json({ status: "signup" });
});
