import { NextResponse } from "next/server";
import { DEV_MAILBOX_PORT } from "@/lib/server/env";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { issueLoginCode } from "@/lib/server/loginCodes";
import { sendLoginCode } from "@/lib/server/mail";
import { allow } from "@/lib/server/rateLimit";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, "邮箱格式不对。");
  if (!allow(`code:${clientIp(req)}`, 10, 10 * 60_000)) throw new HttpError(429, "发得太频繁了，过几分钟再试。");

  const code = await issueLoginCode(email);
  await sendLoginCode(email, code);
  return NextResponse.json({ ok: true, devMailboxPort: DEV_MAILBOX_PORT || null });
});
