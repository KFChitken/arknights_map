import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server/auth";
import { agreeAgain, requireTicks } from "@/lib/server/consent";
import { HttpError, readJson, route } from "@/lib/server/http";

/** 隐私说明更新了: an older account ticks what new players tick at sign-up, and the consent asked before a first roach. */
export const POST = route(async (req) => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "请先登录。");
  requireTicks(await readJson(req), ["adult", "acceptCrossBorder", "acceptPublicPlace"]);
  await agreeAgain(user.id);
  return NextResponse.json({ ok: true });
});
