import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { MIN_SIGNUP_AGE } from "@/lib/rules";
import { BANNED, isBanned } from "@/lib/server/account";
import {
  ageGateClosed,
  clearSignupProof,
  closeAgeGate,
  readSignupProof,
  startSession,
} from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { HttpError, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";

const UNDER_AGE = `很抱歉，目前只开放给 ${MIN_SIGNUP_AGE} 岁及以上的玩家。`;
// Said when the block comes from an earlier answer, so it does not look like the new date was misread
const GATE_CLOSED = `这个浏览器 24 小时内填过不满 ${MIN_SIGNUP_AGE} 岁的出生年月，暂时不能注册，请明天再来。`;

/** Finish signing up a verified email: age check and policy consent. The birth date is not stored. */
export const POST = route(async (req) => {
  const email = await readSignupProof();
  if (!email) throw new HttpError(400, "验证已经过期了，请重新获取验证码。");
  if (await ageGateClosed()) throw new HttpError(403, GATE_CLOSED);
  // a code sent just before a ban must not open a new account
  if (await isBanned(email)) throw new HttpError(403, BANNED);

  const body = await readJson(req);
  const year = Number(body.birthYear);
  const month = Number(body.birthMonth);
  const now = new Date();
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 1900 || year > now.getFullYear()) {
    throw new HttpError(400, "请选择出生年月。");
  }
  if (body.acceptPolicy !== true) throw new HttpError(400, "需要先同意隐私说明。");

  // Months count: someone born this month turns their age this month
  const age = now.getFullYear() - year - (now.getMonth() + 1 < month ? 1 : 0);
  if (age < MIN_SIGNUP_AGE) {
    await closeAgeGate(req);
    await clearSignupProof();
    throw new HttpError(403, UNDER_AGE);
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  const id =
    existing?.id ??
    (
      await db
        .insert(users)
        .values({ email, ageConfirmedAt: now, policyAcceptedAt: now })
        .returning({ id: users.id })
    )[0].id;
  await clearSignupProof();
  await startSession(req, id);
  return NextResponse.json({ status: "ok" });
});
