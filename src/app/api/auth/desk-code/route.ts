import { NextResponse } from "next/server";
import { T } from "@/i18n";
import { formatDeskCode } from "@/lib/deskCode";
import { currentUser } from "@/lib/server/auth";
import { issueDeskCode } from "@/lib/server/deskCodes";
import { HttpError, route } from "@/lib/server/http";

/** 拿登录码: a code for the signed-in player to sign in once on another device or the home-screen icon (src/lib/deskCode.ts) */
export const POST = route(async () => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, T.server.routes.deskCode.signInFirst);
  const issued = await issueDeskCode(user.id);
  return NextResponse.json({ code: formatDeskCode(issued.code), expiresAt: issued.expiresAt });
});
