import { NextResponse } from "next/server";
import { currentUser, endOtherSessions } from "@/lib/server/auth";
import { HttpError, route } from "@/lib/server/http";

/** 退出其他设备: the player's sign-ins on other phones and computers end; this one stays */
export const POST = route(async () => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "先登录才能退出其他设备。");
  const ended = await endOtherSessions(user.id);
  return NextResponse.json({ ok: true, ended });
});
