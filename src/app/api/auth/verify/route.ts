import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { LOGIN_CODE_MAX_ATTEMPTS } from "@/lib/rules";
import { loginCodeMatches, setSignupProof, startSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { HttpError, readJson, route } from "@/lib/server/http";
import { loginCodes, users } from "@/lib/server/schema";

/** Check the emailed code. Known players are signed in; new ones go on to the sign-up step. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const code = String(body.code ?? "").trim();

  const [row] = await db.select().from(loginCodes).where(eq(loginCodes.email, email)).limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) throw new HttpError(400, "验证码过期了，请重新获取。");
  if (row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) throw new HttpError(429, "错误次数太多，请重新获取验证码。");
  if (!/^\d{6}$/.test(code) || !loginCodeMatches(email, code, row.codeHash)) {
    await db
      .update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(eq(loginCodes.email, email));
    throw new HttpError(400, "验证码不对，再看看邮件。");
  }
  await db.delete(loginCodes).where(eq(loginCodes.email, email));

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    await startSession(req, user.id);
    return NextResponse.json({ status: "ok" });
  }
  await setSignupProof(req, email);
  return NextResponse.json({ status: "signup" });
});
