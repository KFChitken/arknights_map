import { NextResponse, type NextRequest } from "next/server";
import { fmt, T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { passesMode } from "@/lib/server/env";
import { giftTicket } from "@/lib/server/friendly";
import { HttpError, readJson, route } from "@/lib/server/http";
import { claim, collection, copiesOf, draw, openWallet, passesOpen, passLog, setLook, setWish, wear } from "@/lib/server/passes";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";
import { dayWords, suspendedMeans } from "@/lib/server/staffNotes";

/**
 * 通行证寻访 (src/lib/server/passes.ts), each for the signed-in player alone:
 *   POST open        the page opened: the wallet as it is (made, with the first tickets, the first time)
 *   POST draw {n}    a draw of 1 or 10
 *   POST claim {task}          每日任务: the tickets of one task done today, as many as may be held
 *   POST gift {friendId}       送 1 张寻访券 to a 触须之交 (src/lib/server/friendly.ts giftTicket); 一键 is world's friendsAct
 *   PUT  wish {ids}  the wish list
 *   PUT  look {charId, plain}  a character's passes in the normal look (plain) or the special one
 *   PUT  wear {passId}         the pass worn on their profile card (null: none)
 *   GET  collection  我的通行证
 *   GET  copies      their passes of one character, ?char= its id
 *   GET  log         寻访记录, ?before= the id of the last row shown
 * While PASSES keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. Drawing and the wish list wait, like the map's world, while the admin asks the player to say again they are
 * 18 or older, or an updated privacy policy is not agreed yet; what they have stays readable. A gift reaches another
 * player, so it also waits while the admin has paused the giver's 互动, as world's do.
 */

type Limit = { method: "GET" | "POST" | "PUT"; agreed: boolean } & ({ perMinute: number } | { perSecond: number });
const OPS = {
  open: { method: "POST", perMinute: 30, agreed: true },
  draw: { method: "POST", perMinute: 90, agreed: true },
  // the rows of 每日任务 tapped one after the other never wait
  claim: { method: "POST", perSecond: 5, agreed: true },
  gift: { method: "POST", perMinute: 30, agreed: true },
  wish: { method: "PUT", perMinute: 20, agreed: true },
  look: { method: "PUT", perMinute: 30, agreed: true },
  wear: { method: "PUT", perMinute: 30, agreed: true },
  collection: { method: "GET", perMinute: 30, agreed: false },
  copies: { method: "GET", perMinute: 60, agreed: false },
  log: { method: "GET", perMinute: 60, agreed: false },
} as const satisfies Record<string, Limit>;
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
  const limit: Limit = OPS[op];
  const [times, ms] = "perSecond" in limit ? [limit.perSecond, 1000] : [limit.perMinute, 60_000];
  if (!allow(`passes:${op}:${user.id}`, times, ms)) throw new HttpError(429, T.server.routes.passes.tooFast);
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
  if (op === "copies") return answer(await copiesOf(user.id, Number(req.nextUrl.searchParams.get("char"))));
  const before = Number(req.nextUrl.searchParams.get("before"));
  return answer(await passLog(user.id, before || undefined));
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("POST", (await params).op);
  if (op === "open") return answer(await openWallet(user));
  const body = await readJson(req);
  if (op === "gift") {
    if (user.suspendedUntil && user.suspendedUntil.getTime() > Date.now()) {
      throw new HttpError(403, fmt(T.server.routes.world.suspended, { until: dayWords(user.suspendedUntil.getTime()), means: suspendedMeans() }));
    }
    await giftTicket(user, body.friendId);
    return answer({ ok: true });
  }
  if (op === "claim") return answer(await claim(user, body.task));
  return answer(await draw(user, body.n));
});

export const PUT = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("PUT", (await params).op);
  const body = await readJson(req);
  if (op === "look") return answer(await setLook(user, body.charId, body.plain));
  if (op === "wear") return answer(await wear(user, body.passId));
  return answer(await setWish(user, body.ids));
});
