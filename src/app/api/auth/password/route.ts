import { NextResponse } from "next/server";
import { currentSession, currentUser } from "@/lib/server/auth";
import { HttpError, readJson, route } from "@/lib/server/http";
import { freshFor, NeedsCode, passwordSetAt, setPassword } from "@/lib/server/passwords";
import { allow } from "@/lib/server/rateLimit";

/**
 * GET: when the signed-in player set their password (setAt, null: none); their own email, for a sign-in by
 * code to confirm it is them; and how much longer this sign-in counts as one by code moments ago
 * (freshForMs, 0: not), when no current password is asked for
 */
export const GET = route(async () => {
  const [user, session] = await Promise.all([currentUser(), currentSession()]);
  if (!user || !session) throw new HttpError(401, "请先登录。");
  return NextResponse.json({ setAt: await passwordSetAt(user.id), email: user.email, freshForMs: freshFor(session) });
});

/**
 * POST {password, current?}: set the password, or change it (src/lib/server/passwords.ts). Without a fresh
 * sign-in by code where one is needed, 403 with needsCode, for the page to offer one.
 */
export const POST = route(async (req) => {
  const [user, session] = await Promise.all([currentUser(), currentSession()]);
  if (!user || !session) throw new HttpError(401, "请先登录。");
  if (!allow(`pw-set:${user.id}`, 10, 10 * 60_000)) throw new HttpError(429, "试得太频繁了，过一会儿再试。");
  const body = await readJson(req);
  try {
    const { changed } = await setPassword(user, session, body.password, body.current);
    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    if (e instanceof NeedsCode) return NextResponse.json({ error: e.message, needsCode: true }, { status: 403 });
    throw e;
  }
});
