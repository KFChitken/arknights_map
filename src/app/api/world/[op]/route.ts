import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Declaration } from "@/lib/declarations";
import type { Profile } from "@/lib/profile";
import { currentUser, endSession, homeUserId, setHomeUserId, startSession } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { identities, resetDemo } from "@/lib/server/demo";
import { demoEnabled } from "@/lib/server/env";
import { HttpError, readJson, route } from "@/lib/server/http";
import { users } from "@/lib/server/schema";
import * as world from "@/lib/server/world";
import type { LngLat } from "@/lib/types";
import type { PlaceTarget } from "@/lib/world/types";

/** One endpoint per World method; the browser side is src/lib/world/server.ts. */
export const POST = route(async (req, { params }: { params: Promise<{ op: string }> }) => {
  const { op } = await params;
  const body = await readJson(req);
  const args = Array.isArray(body.args) ? body.args : [];
  const user = await currentUser();
  const uid = () => {
    if (!user) throw new HttpError(401, "请先登录。");
    return user.id;
  };
  const demoOnly = () => {
    if (!demoEnabled) throw new HttpError(404, "没有这个功能。");
  };

  let result: unknown;
  switch (op) {
    case "me":
      result = user ? await world.me(user.id) : null;
      break;
    case "roaches":
      result = await world.publicRoaches(user?.id ?? null);
      break;
    case "saveProfile":
      result = await world.saveProfile(uid(), args[0] as Profile);
      break;
    case "placeRoach":
      result = await world.placeRoach(uid(), args[0] as PlaceTarget, args[1] as LngLat);
      break;
    case "removeRoach":
      result = await world.removeRoach(uid(), String(args[0]));
      break;
    case "touch":
      result = await world.touch(uid(), String(args[0]), args[1] === true);
      break;
    case "reply":
      result = await world.reply(uid(), String(args[0]), args[1] === true);
      break;
    case "inbox":
      result = user ? await world.inbox(user.id) : [];
      break;
    case "markSeen":
      await world.markSeen(uid(), Array.isArray(args[0]) ? (args[0] as string[]) : []);
      break;
    case "declare":
      result = await world.declare(uid(), args[0] as Declaration, Array.isArray(args[1]) ? args[1].map(String) : undefined);
      break;
    case "react":
      await world.react(uid(), String(args[0]), String(args[1]));
      break;
    case "friends":
      result = user ? await world.friends(user.id) : [];
      break;
    case "unfriend":
      await world.unfriend(uid(), String(args[0]));
      break;
    case "radar":
      result = await world.radar(uid());
      break;

    // Development aids: step into demo players on one device
    case "identities":
      result = demoEnabled && user ? await identities(user.id, await homeUserId()) : [];
      break;
    case "become": {
      demoOnly();
      const me = uid();
      const home = (await homeUserId()) ?? (user!.demoKey ? null : me);
      const target = String(args[0]);
      const [t] = await db.select().from(users).where(eq(users.id, target)).limit(1);
      if (!t || (!t.demoKey && t.id !== home)) throw new HttpError(400, "没有这个测试身份。");
      await endSession();
      await startSession(req, t.id);
      await setHomeUserId(req, t.id === home ? null : home);
      break;
    }
    case "reset":
      demoOnly();
      uid();
      await resetDemo();
      break;
    default:
      throw new HttpError(404, "没有这个功能。");
  }
  return NextResponse.json({ result: result ?? null });
});
