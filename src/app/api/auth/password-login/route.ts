import { NextResponse } from "next/server";
import { T } from "@/i18n";
import { startSession } from "@/lib/server/auth";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { passwordLogin } from "@/lib/server/passwords";
import { allow } from "@/lib/server/rateLimit";

/**
 * 密码登录: sign in with an email and password (src/lib/server/passwords.ts). No mail goes out, so neither
 * the mail lock nor the day's mail allowance is touched; each network may try 20 times in 10 minutes and
 * 200 times a day.
 */
export const POST = route(async (req) => {
  const ip = clientIp(req);
  if (!allow(`pw:${ip}`, 20, 10 * 60_000) || !allow(`pw-day:${ip}`, 200, 24 * 60 * 60_000)) {
    throw new HttpError(429, T.server.common.triedTooOften);
  }
  const body = await readJson(req);
  const userId = await passwordLogin(body.email, body.password);
  await startSession(req, userId, "password");
  return NextResponse.json({ status: "ok" });
});
