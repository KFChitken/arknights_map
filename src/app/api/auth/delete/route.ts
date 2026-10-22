import { eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUser, endSession, setHomeUserId } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { HttpError, route } from "@/lib/server/http";
import { forgetLoginCodes } from "@/lib/server/loginCodes";
import { friendCuts, users } from "@/lib/server/schema";

/** Delete the account and everything tied to it (roaches, touches, declarations, friends). */
export const POST = route(async (req) => {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "请先登录。");
  if (user.demoKey) throw new HttpError(400, "测试玩家不能注销。");
  await db.delete(users).where(eq(users.id, user.id));
  if (user.email) await forgetLoginCodes(user.email);
  // the one table that names players without a foreign key
  await db.delete(friendCuts).where(or(eq(friendCuts.a, user.id), eq(friendCuts.b, user.id)));
  await endSession();
  await setHomeUserId(req, null);
  return NextResponse.json({ ok: true });
});
