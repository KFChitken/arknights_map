import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { fishMode, squadMode } from "@/lib/server/env";
import { castLine, fishAny, fishDexOf, fishState, pullBack, reelIn } from "@/lib/server/fish";
import { openBottle, throwNote } from "@/lib/server/fishBottle";
import { haulNet, setNet } from "@/lib/server/fishNet";
import { HttpError, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";

/**
 * 钓鳞 (src/lib/server/fish.ts), each for the signed-in player alone:
 *   POST state {after?}       how the bank stands: today's casts, the line in the water, the dex caught, the others on
 *                             the bank, 空军司令, and what purple-or-better was caught there since `after`, nobody named
 *                             (the page asks every 15 s while it is open)
 *   POST cast {spot, tz}      a line in, one of the day's 100 (when it bites and its shadow; what is on it only once
 *                             pulled), in place of the one in the water: spot pier (the bank) or pond (卫戍池塘, the
 *                             room one is in); tz, the page's minutes east of UTC
 *   POST reel                 the pull, once it bit: on time or not by the server's clock, and the catch
 *   POST pull                 the line taken back, nothing caught
 *   POST dex                  the player's dex and the site's biggest of each
 *   POST open {id}            拔开瓶塞: a 漂流瓶 the player caught opened, the pass in it and a 纸条 if the sea had one
 *                             (src/lib/server/fishBottle.ts); one opened already, as it was
 *   POST throw {id, say}      one of the 17 lines thrown back from an opened 漂流瓶, once a bottle
 *   POST net {on, tz}         自动钓 on the bank switched on (a cast every 3 min from now) or off (pulled in first)
 *   POST haul {tz}            收网: what 自动钓 holds, drawn and kept all at once (src/lib/server/fishNet.ts)
 * (open and throw only for a player PASSES lets draw, else 404)
 * While neither FISH (the bank) nor SQUAD (卫戍池塘, in a room) lets this player in (src/lib/server/env.ts), every
 * request is answered 404, as if nothing were here; a cast on the bank needs FISH, one in 卫戍池塘 a room to be in.
 * All wait while the admin asks the player to say again they are 18 or older, or an updated privacy policy is not
 * agreed yet.
 */

const OPS = {
  state: { perMinute: 40 },
  cast: { perMinute: 30 },
  reel: { perMinute: 30 },
  pull: { perMinute: 30 },
  dex: { perMinute: 20 },
  open: { perMinute: 20 },
  throw: { perMinute: 20 },
  net: { perMinute: 20 },
  haul: { perMinute: 20 },
} as const satisfies Record<string, { perMinute: number }>;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

type Ctx = { params: Promise<{ op: string }> };

/** The player this request may act for, or the refusal: 404 to anyone FISH keeps it from, 401 to a visitor once it is open */
async function playerFor(method: string, op: string): Promise<{ user: UserRow; op: Op }> {
  const notHere = () => new HttpError(404, T.server.routes.fish.notHere);
  // the bank's (FISH) and 卫戍池塘's (SQUAD, a room's own): nobody's while both are off
  if ((fishMode() === "off" && squadMode() === "off") || method !== "POST" || !isOp(op)) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (fishMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!fishAny(user)) throw notHere();
  if (!allow(`fish:${op}:${user.id}`, OPS[op].perMinute, 60_000)) throw new HttpError(429, T.server.routes.fish.tooFast);
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
  if (op === "reel") return answer(await reelIn(user));
  if (op === "pull") return answer(await pullBack(user));
  if (op === "dex") return answer(await fishDexOf(user));
  const body = await readJson(req);
  if (op === "cast") return answer(await castLine(user, body));
  if (op === "open") return answer(await openBottle(user, body.id));
  if (op === "throw") return answer(await throwNote(user, body.id, body.say));
  if (op === "net") return answer(await setNet(user, body));
  if (op === "haul") return answer(await haulNet(user, body));
  return answer(await fishState(user, body.after));
});
