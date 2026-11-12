import { NextResponse } from "next/server";
import { T } from "@/i18n";
import { currentSession, currentUser } from "@/lib/server/auth";
import { HttpError, readJson, route } from "@/lib/server/http";
import { removePassword } from "@/lib/server/passwords";
import { allow } from "@/lib/server/rateLimit";

/** POST {current}: 取消密码, with the current password, or after a sign-in by code moments ago (src/lib/server/passwords.ts) */
export const POST = route(async (req) => {
  const [user, session] = await Promise.all([currentUser(), currentSession()]);
  if (!user || !session) throw new HttpError(401, T.server.common.signIn);
  if (!allow(`pw-set:${user.id}`, 10, 10 * 60_000)) throw new HttpError(429, T.server.common.triedTooOften);
  await removePassword(user.id, session, (await readJson(req)).current);
  return NextResponse.json({ ok: true });
});
