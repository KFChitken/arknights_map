import { NextResponse } from "next/server";
import { T } from "@/i18n";
import { deleteAccount } from "@/lib/server/account";
import { currentUser, endSession, setHomeUserId } from "@/lib/server/auth";
import { HttpError, route } from "@/lib/server/http";

/** Delete the account and everything tied to it (roaches, touches, declarations, friends). */
export const POST = route(async (req) => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, T.server.common.signIn);
  if (user.demoKey) throw new HttpError(400, T.server.routes.deleteAccount.testPlayersStay);
  await deleteAccount(user);
  await endSession();
  await setHomeUserId(req, null);
  return NextResponse.json({ ok: true });
});
