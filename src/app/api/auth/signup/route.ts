import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { BANNED, isBanned } from "@/lib/server/account";
import { clearSignupProof, readSignupProof, startSession } from "@/lib/server/auth";
import { signedUp } from "@/lib/server/badges";
import { requireTicks } from "@/lib/server/consent";
import { db } from "@/lib/server/db";
import { HttpError, readJson, route } from "@/lib/server/http";
import { firstPassword } from "@/lib/server/passwords";
import { users } from "@/lib/server/schema";
import { passwordProblem } from "@/lib/passwordRules";

/**
 * Finish signing up a verified email: the player ticks that they are old enough,
 * the privacy policy and the separate storage-and-mail consent. Only the times are kept.
 * password: one to sign in with from now on, if they gave one (src/lib/server/passwords.ts).
 */
export const POST = route(async (req) => {
  const email = await readSignupProof();
  if (!email) throw new HttpError(400, "验证已经过期了，请重新获取验证码。");
  // a code sent just before a ban must not open a new account
  if (await isBanned(email)) throw new HttpError(403, BANNED);
  const body = await readJson(req);
  requireTicks(body, ["adult", "acceptPolicy", "acceptCrossBorder"]);
  // a password that will not do turns the sign-up back before any account is made
  const password = typeof body.password === "string" && body.password ? body.password : null;
  const problem = password && passwordProblem(password, email);
  if (problem) throw new HttpError(400, problem);

  const now = new Date();
  let id = await accountOf(email);
  if (!id) {
    const [made] = await db
      .insert(users)
      .values({ email, ageConfirmedAt: now, policyAcceptedAt: now, crossBorderAcceptedAt: now })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    if (made) await signedUp(made.id);
    // the same email signing up twice at once (a double tap, a second tab): the other's row went in
    // first, and this one signs in to that account
    id = made?.id ?? (await accountOf(email));
    if (!id) throw new Error("the new account was neither made nor found");
  }
  if (password) await firstPassword({ id, email }, password);
  await clearSignupProof();
  await startSession(req, id);
  return NextResponse.json({ status: "ok" });
});

const accountOf = async (email: string) =>
  (await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1))[0]?.id;
