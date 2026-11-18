import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { haimaoMode } from "@/lib/server/env";
import { endStory, haimaoOpen, openStory, pickStory } from "@/lib/server/haimao";
import { HttpError, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";

/**
 * 香艳制作人's 今日剧情 (src/lib/server/haimao.ts, src/lib/haimaoStory.ts), each for the signed-in player alone, with
 * their device's Date.getTimezoneOffset() as offset (their day turns at 04:00 by it; never stored):
 *   POST story {offset}                 what today holds; after ALL END, the day's first look moves their line on
 *   POST pick {day, answer, offset}     their answer to the day's scene, and the 好感度 it brings
 *   POST end {offset}                   ALL END after the twelfth: her 好感度 to the top, and the badge
 * While HAIMAO keeps her from this player, every request is answered 404, as if nothing were here; once she is out
 * for everyone, visitors are asked to sign in. Like 寻访, it waits while the admin asks the player to say again they
 * are 18 or older, or an updated privacy policy is not agreed yet.
 */

const OPS = { story: 30, pick: 30, end: 10 } as const;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

export const POST = route(async (req: NextRequest, { params }: { params: Promise<{ op: string }> }) => {
  const { op } = await params;
  const notHere = () => new HttpError(404, T.server.haimao.notHere);
  if (haimaoMode() === "off" || !isOp(op)) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (haimaoMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!haimaoOpen(user)) throw notHere();
  if (!allow(`haimao:${op}:${user.id}`, OPS[op], 60_000)) throw new HttpError(429, T.server.routes.world.tooFast);
  if (user.ageCheckAt) throw new HttpError(428, ageCheckNeeded(), AGE_CHECK);
  if (mustReconsent(user)) throw new HttpError(428, reconsentNeeded());
  const body = await readJson(req);
  const result =
    op === "pick"
      ? await pickStory(user.id, body.day, body.answer, body.offset)
      : op === "end"
        ? await endStory(user.id, body.offset)
        : await openStory(user.id, body.offset);
  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
});
