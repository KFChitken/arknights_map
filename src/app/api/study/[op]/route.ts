import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { studyMode } from "@/lib/server/env";
import { HttpError, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";
import { studyDone, studyOpen, studyToday } from "@/lib/server/study";

/**
 * 325大学习 (src/lib/server/study.ts), each for the signed-in player alone; a visitor plays on their own page, which
 * never asks here:
 *   POST today           the day's course (drawn now the first time today), whether it was played, the days studied
 *   POST done {course}   a round of the day's course was played: a site day studied, the first time today
 * While STUDY keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were here.
 * Both wait, like the map's world, while the admin asks the player to say again they are 18 or older, or an updated
 * privacy policy is not agreed yet.
 */

const OPS = {
  today: { perMinute: 30 },
  done: { perMinute: 20 },
} as const satisfies Record<string, { perMinute: number }>;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

type Ctx = { params: Promise<{ op: string }> };

/** The player this request may act for, or the refusal: 404 to anyone STUDY keeps it from, 401 to a visitor once it is open */
async function playerFor(method: string, op: string): Promise<{ user: UserRow; op: Op }> {
  const notHere = () => new HttpError(404, T.server.routes.study.notHere);
  if (studyMode() === "off" || method !== "POST" || !isOp(op)) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (studyMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!studyOpen(user)) throw notHere();
  if (!allow(`study:${op}:${user.id}`, OPS[op].perMinute, 60_000)) throw new HttpError(429, T.server.routes.study.tooFast);
  if (user.ageCheckAt) throw new HttpError(428, ageCheckNeeded(), AGE_CHECK);
  if (mustReconsent(user)) throw new HttpError(428, reconsentNeeded());
  return { user, op };
}

const answer = (result: unknown) => NextResponse.json(result, { headers: { "cache-control": "no-store" } });

// nothing to read here: asked anyway, the same 404 as anything else that is not
export const GET = route(async (_req: NextRequest, { params }: Ctx) => {
  await playerFor("GET", (await params).op);
  return answer(null);
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("POST", (await params).op);
  if (op === "today") return answer(await studyToday(user));
  const body = await readJson(req);
  return answer(await studyDone(user, body.course));
});
