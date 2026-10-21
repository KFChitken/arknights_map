import { NextResponse } from "next/server";
import { endSession, setHomeUserId } from "@/lib/server/auth";
import { route } from "@/lib/server/http";

export const POST = route(async (req) => {
  await endSession();
  await setHomeUserId(req, null);
  return NextResponse.json({ ok: true });
});
