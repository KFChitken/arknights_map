import { NextResponse } from "next/server";
import { LOGIN_CODE_COOLDOWN_S, LOGIN_CODE_TTL_MIN } from "@/lib/rules";
import { hashLoginCode, newLoginCode } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { DEV_MAILBOX_PORT } from "@/lib/server/env";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { sendLoginCode } from "@/lib/server/mail";
import { allow } from "@/lib/server/rateLimit";
import { loginCodes } from "@/lib/server/schema";
import { eq } from "drizzle-orm";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, "邮箱格式不对。");
  if (!allow(`code:${clientIp(req)}`, 10, 10 * 60_000)) throw new HttpError(429, "发得太频繁了，过几分钟再试。");

  const [last] = await db.select().from(loginCodes).where(eq(loginCodes.email, email)).limit(1);
  const wait = last ? LOGIN_CODE_COOLDOWN_S - Math.floor((Date.now() - last.sentAt.getTime()) / 1000) : 0;
  if (wait > 0) throw new HttpError(429, `验证码刚发过，${wait} 秒后可以再发。`);

  const code = newLoginCode();
  const row = {
    codeHash: hashLoginCode(email, code),
    sentAt: new Date(),
    expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MIN * 60_000),
    attempts: 0,
  };
  await db
    .insert(loginCodes)
    .values({ email, ...row })
    .onConflictDoUpdate({ target: loginCodes.email, set: row });
  await sendLoginCode(email, code);
  return NextResponse.json({ ok: true, devMailboxPort: DEV_MAILBOX_PORT || null });
});
