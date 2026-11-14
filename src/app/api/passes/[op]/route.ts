import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { passesMode } from "@/lib/server/env";
import { HttpError, readJson, route } from "@/lib/server/http";
import { collection, draw, openWallet, passesOpen, passLog, setWish } from "@/lib/server/passes";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";

/**
 * 通行证寻访 (src/lib/server/passes.ts), each for the signed-in player alone:
 *   POST open        the page opened: the wallet as it is (made, with the first tickets, the first time)
 *   POST draw {n}    a draw of 1 or 10
 *   PUT  wish {ids}  the wish list
 *   GET  collection  我的通行证
 *   GET  log         寻访记录, ?before= the id of the last row shown
 * While PASSES keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. Drawing and the wish list wait, like the map's world, while the admin asks the player to say again they are
 * 18 or older, or an updated privacy policy is not agreed yet; what they have stays readable.
 */

const OPS = {
  open: { method: "POST", perMinute: 30, agreed: true },
  draw: { method: "POST", perMinute: 90, agreed: true },
  wish: { method: "PUT", perMinute: 20, agreed: true },
  collection: { method: "GET", perMinute: 30, agreed: false },
  log: { method: "GET", perMinute: 60, agreed: false },
} as const;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

type Ctx = { params: Promise<{ op: string }> };

/** The player this request may act for, or the refusal: 404 to anyone PASSES keeps it from, 401 to a visitor once it is open */
async function playerFor(method: string, op: string): Promise<{ user: UserRow; op: Op }> {
  const notHere = () => new HttpError(404, T.server.routes.passes.notHere);
  if (passesMode() === "off" || !isOp(op) || OPS[op].method !== method) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (passesMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!passesOpen(user)) throw notHere();
  if (!allow(`passes:${op}:${user.id}`, OPS[op].perMinute, 60_000)) throw new HttpError(429, T.server.routes.passes.tooFast);
  if (OPS[op].agreed) {
    if (user.ageCheckAt) throw new HttpError(428, ageCheckNeeded(), AGE_CHECK);
    if (mustReconsent(user)) throw new HttpError(428, reconsentNeeded());
  }
  return { user, op };
}

const answer = (result: unknown) => NextResponse.json(result, { headers: { "cache-control": "no-store" } });

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("GET", (await params).op);
  if (op === "collection") return answer(await collection(user.id));
  const before = Number(req.nextUrl.searchParams.get("before"));
  return answer(await passLog(user.id, before || undefined));
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("POST", (await params).op);
  if (op === "open") return answer(await openWallet(user));
  const body = await readJson(req);
  return answer(await draw(user, body.n));
});

export const PUT = route(async (req: NextRequest, { params }: Ctx) => {
  const { user } = await playerFor("PUT", (await params).op);
  const body = await readJson(req);
  return answer(await setWish(user, body.ids));
});
