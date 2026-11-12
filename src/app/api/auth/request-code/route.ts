import { NextResponse } from "next/server";
import { T } from "@/i18n";
import { banned, isBanned } from "@/lib/server/account";
import { DEV_MAILBOX_PORT } from "@/lib/server/env";
import { clientIp, HttpError, readJson, route } from "@/lib/server/http";
import { issueLoginCode, withdrawLoginCode } from "@/lib/server/loginCodes";
import { neverReached, sendLoginCode } from "@/lib/server/mail";
import { isSlowMail } from "@/lib/server/mailQuota";
import { allow } from "@/lib/server/rateLimit";
import { errorCode, note } from "@/lib/server/signals";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) throw new HttpError(400, T.server.routes.requestCode.badEmail);
  if (await isBanned(email)) throw new HttpError(403, banned());
  const ip = clientIp(req);
  if (!allow(`code:${ip}`, 10, 10 * 60_000)) {
    note("codeRefused", "ip-10min");
    throw new HttpError(429, T.server.routes.requestCode.tooOften);
  }
  // dorms, offices and mobile networks put many people behind one address
  if (!allow(`code-day:${ip}`, 100, 24 * 60 * 60_000)) {
    note("codeRefused", "ip-day");
    throw new HttpError(429, T.server.routes.requestCode.networkDayUsedUp);
  }

  const issued = await issueLoginCode(email);
  try {
    await sendLoginCode(email, issued.code, issued.expiresAt);
    note("mailSent", "login");
  } catch (e) {
    console.error(e);
    note("mailFailed", errorCode(e));
    // nothing went out, so asking again right away is not held up by the wait between codes
    if (neverReached(e)) {
      await withdrawLoginCode(email, issued).catch((w) => console.error("could not withdraw the code", errorCode(w)));
      throw new HttpError(503, T.server.routes.requestCode.mailDownTryAgain);
    }
    throw new HttpError(503, T.server.routes.requestCode.mailDown);
  }
  // a mail service slow to take our mail just now: the page says so (MAIL_SLOW_DOMAINS)
  const slow = isSlowMail(email);
  // waitS: seconds before this address may ask again, which grows with each sending of the same code
  return NextResponse.json({
    ok: true,
    again: issued.again,
    expiresAt: issued.expiresAt.getTime(),
    waitS: issued.waitS,
    slow,
    devMailboxPort: DEV_MAILBOX_PORT || null,
  });
});
