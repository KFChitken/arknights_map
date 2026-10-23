import { NextResponse } from "next/server";
import { BANNED, isBanned } from "@/lib/server/account";
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
  if (await isBanned(email)) throw new HttpError(403, BANNED);
  const ip = clientIp(req);
  if (!allow(`code:${ip}`, 10, 10 * 60_000)) throw new HttpError(429, "发得太频繁了，过几分钟再试。");
  // dorms, offices and mobile networks put many people behind one address
  if (!allow(`code-day:${ip}`, 100, 24 * 60 * 60_000)) throw new HttpError(429, "这个网络今天发的验证码太多了，明天再试吧。");

  const code = await issueLoginCode(email);
  try {
    await sendLoginCode(email, code);
  } catch (e) {
    console.error(e);
    throw new HttpError(503, "验证码邮件暂时发不出去，请过几分钟再试。");
  }
  return NextResponse.json({ ok: true, devMailboxPort: DEV_MAILBOX_PORT || null });
});
