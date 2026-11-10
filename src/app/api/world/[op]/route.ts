import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type { Declaration } from "@/lib/declarations";
import type { Profile } from "@/lib/profile";
import { currentUser, endSession, homeUserId, setHomeUserId, startSession } from "@/lib/server/auth";
import { markBadgesSeen, wear } from "@/lib/server/badges";
import { acceptPublicPlace, mustReconsent, RECONSENT_NEEDED } from "@/lib/server/consent";
import { db } from "@/lib/server/db";
import { identities, pretend, resetDemo } from "@/lib/server/demo";
import { demoEnabled } from "@/lib/server/env";
import { HttpError, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import * as friendly from "@/lib/server/friendly";
import * as help from "@/lib/server/help";
import * as perlica from "@/lib/server/perlica";
import * as safety from "@/lib/server/safety";
import { users } from "@/lib/server/schema";
import * as world from "@/lib/server/world";
import type { LngLat } from "@/lib/types";
import type { PlaceTarget, PretendWhat, RideTarget } from "@/lib/world/types";

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
  // Nothing others see happens until an older account agrees to the updated privacy policy; blocking, reporting and leaving still do
  const agreed = () => {
    const id = uid();
    if (mustReconsent(user!)) throw new HttpError(428, RECONSENT_NEEDED);
    return id;
  };
  const demoOnly = () => {
    if (!demoEnabled) throw new HttpError(404, "没有这个功能。");
  };
  // the costly reads, per player per minute; a page needs far fewer
  const ration = (perMinute: number) => {
    if (user && !allow(`${op}:${user.id}`, perMinute, 60_000)) throw new HttpError(429, "操作太频繁了，歇一会儿再试。");
  };

  let result: unknown;
  switch (op) {
    case "me":
      result = user ? await world.me(user.id, args[0]) : null;
      break;
    // 佩丽卡监督's 离开计时: sent with me() on opening, before anyone knows who is signed in, and only
    // ever about the player themselves, so neither asks for a session or the updated privacy policy
    case "here":
      ration(10);
      result = user ? await perlica.here(user.id) : null;
      break;
    case "leave":
      ration(10);
      if (user) await perlica.leave(user.id);
      break;
    case "setPerlicaTimer":
      await perlica.setTimer(uid(), args[0] === true);
      break;
    case "saveProfile":
      result = await world.saveProfile(agreed(), args[0] as Profile);
      break;
    case "placeRoach":
      result = await world.placeRoach(agreed(), args[0] as PlaceTarget, args[1] as LngLat);
      break;
    case "rideMinghe":
      result = await world.rideMinghe(agreed(), args[0] as RideTarget);
      break;
    case "dismountMinghe":
      result = await world.dismountMinghe(uid());
      break;
    case "acceptPublicPlace":
      await acceptPublicPlace(agreed());
      break;
    case "drink":
      result = await world.drink(agreed());
      break;
    case "sober":
      await world.sober(uid());
      break;
    case "removeRoach":
      result = await world.removeRoach(uid(), String(args[0]));
      break;
    case "touch":
      result = await world.touch(agreed(), String(args[0]), args[1] === true, args[2]);
      break;
    case "reply":
      result = await world.reply(agreed(), String(args[0]), args[1] === true, args[2]);
      break;
    case "poke":
      result = await world.poke(agreed(), String(args[0]));
      break;
    // between 触须之交 (src/lib/server/friendly.ts): each has its own daily rule; this keeps a script from hammering them
    case "remindSanity":
    case "answerSanity":
    case "gesture":
    case "visit":
    case "goHome":
    case "followHost":
    case "sendHome":
    case "gameAsk":
    case "gameAdded":
    case "gameWant": {
      const id = agreed();
      if (!allow(`friendly:${id}`, 30, 60_000)) throw new HttpError(429, "操作太频繁了，歇一会儿再试。");
      if (op === "remindSanity") await friendly.remindSanity(id, args[0]);
      else if (op === "answerSanity") await friendly.answerSanity(id, args[0], args[1]);
      else if (op === "gesture") await friendly.gesture(id, args[0], args[1], args[2]);
      else if (op === "visit") result = await friendly.visit(id, args[0], args[1], args[2]);
      else if (op === "goHome") result = await friendly.goHome(id, args[0]);
      else if (op === "followHost") result = await friendly.followHost(id, args[0]);
      else if (op === "sendHome") await friendly.sendHome(id, args[0]);
      else if (op === "gameAsk") await friendly.gameAsk(id, args[0], args[1]);
      else if (op === "gameAdded") await friendly.gameAdded(id, args[0]);
      else await friendly.gameWant(id, args[0], args[1]);
      break;
    }
    // 一键 (src/lib/friendly.ts): many at once, each checked as one, so its own limit
    case "friendsAct": {
      const id = agreed();
      if (!allow(`friendsAct:${id}`, 10, 60_000)) throw new HttpError(429, "操作太频繁了，歇一会儿再试。");
      result = await friendly.friendsAct(id, args[0], args[1]);
      break;
    }
    // 特别关注: only the player sees it
    case "starFriend": {
      const id = uid();
      if (!allow(`friendly:${id}`, 30, 60_000)) throw new HttpError(429, "操作太频繁了，歇一会儿再试。");
      await world.starFriend(id, args[0], args[1]);
      break;
    }
    // 求助 (src/lib/server/help.ts)
    case "helpBoard":
      ration(30);
      result = user ? await help.helpBoard(user.id) : { mine: [], theirs: [] };
      break;
    case "seeHelp":
      ration(30);
      await help.seeHelp(uid());
      break;
    case "askHelp":
    case "closeHelp":
    case "answerHelp": {
      const id = agreed();
      if (!allow(`help:${id}`, 20, 60_000)) throw new HttpError(429, "操作太频繁了，歇一会儿再试。");
      if (op === "askHelp") await help.askHelp(id, args[0]);
      else if (op === "closeHelp") await help.closeHelp(id, args[0]);
      else await help.answerHelp(id, args[0], args[1]);
      break;
    }
    case "inbox":
      ration(30);
      result = user ? await world.inbox(user.id) : [];
      break;
    case "markSeen":
      await world.markSeen(uid(), Array.isArray(args[0]) ? (args[0] as string[]) : []);
      break;
    case "declare":
      result = await world.declare(agreed(), args[0] as Declaration, Array.isArray(args[1]) ? args[1].map(String) : undefined);
      break;
    case "ignore":
      await world.ignore(uid(), String(args[0]));
      break;
    case "react":
      await world.react(agreed(), String(args[0]), String(args[1]));
      break;
    case "friends":
      ration(30);
      result = user ? await world.friends(user.id) : [];
      break;
    case "unfriend":
      await world.unfriend(uid(), String(args[0]));
      break;
    case "radar":
      ration(6);
      result = await world.radar(uid());
      break;
    case "block":
      if (!allow(`block:${uid()}`, 60, 60 * 60_000)) throw new HttpError(429, "操作太频繁了，歇一会儿再试。");
      await safety.block(uid(), String(args[0]));
      break;
    case "unblock":
      await safety.unblock(uid(), String(args[0]));
      break;
    case "blocks":
      result = await safety.blockList(uid());
      break;
    case "report":
      await safety.report(uid(), String(args[0]), args[1], args[2]);
      break;
    case "wearBadge":
      if (!(await wear(agreed(), args[0] === null ? null : String(args[0])))) throw new HttpError(400, "你还没有这个称号。");
      break;
    case "seeBadges":
      await markBadgesSeen(uid(), Array.isArray(args[0]) ? args[0].map(String) : []);
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
    case "pretend": {
      demoOnly();
      const kinds: PretendWhat[] = [
        "day",
        "away",
        "left",
        "ask",
        "talulah",
        "mingheDay",
        "minghe",
        "perlicaDays",
        "perlicaBirthday",
        "perlicaWeek",
      ];
      const what = kinds.find((k) => k === args[0]) ?? "day";
      await pretend(uid(), what, Number(args[1]) || 0);
      break;
    }
    default:
      throw new HttpError(404, "没有这个功能。");
  }
  return NextResponse.json({ result: result ?? null });
});
