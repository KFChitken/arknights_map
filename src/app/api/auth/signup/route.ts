import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { BANNED, isBanned } from "@/lib/server/account";
import { clearSignupProof, readSignupProof, startSession } from "@/lib/server/auth";
import { signedUp } from "@/lib/server/badges";
import { requireTicks } from "@/lib/server/consent";
import { db } from "@/lib/server/db";
import { HttpError, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

/**
 * Finish signing up a verified email: the player ticks that they are old enough,
 * the privacy policy and the separate storage-and-mail consent. Only the times are kept.
 */
export const POST = route(async (req) => {
  const email = await readSignupProof();
  if (!email) throw new HttpError(400, "验证已经过期了，请重新获取验证码。");
  // a code sent just before a ban must not open a new account
  if (await isBanned(email)) throw new HttpError(403, BANNED);
  requireTicks(await readJson(req), ["adult", "acceptPolicy", "acceptCrossBorder"]);

  const now = new Date();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  let id = existing?.id;
  if (!id) {
    [{ id }] = await db
      .insert(users)
      .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now })
      .returning({ id: users.id });
    await signedUp(id);
  }
  await clearSignupProof();
  await startSession(req, id);
  return NextResponse.json({ status: "ok" });
});
