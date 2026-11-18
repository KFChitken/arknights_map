import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { studyMode } from "@/lib/server/env";
import { boardPage, boardPaused, dealPaper, passPaper, publishPaper, ratePaper, reportPaper, skipPaper, withdrawPaper } from "@/lib/server/handwriting";
import { clientIp, HttpError, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";
import { studyOpen } from "@/lib/server/study";
import { BOARD_PAUSED, SHEET } from "@/lib/study/board";

/**
 * 徒手写's 手写榜 (src/lib/server/handwriting.ts), a part of 325大学习 (src/app/api/study/[op]):
 *   POST board {page}                  a page of the board; for a player, their own paper and whether they may rate.
 *                                      The only one a visitor may ask, once STUDY is open to everyone
 *   POST pass {squares}                a paper of 徒手写 passed: marked again here, the player then known to have passed
 *   POST publish {squares, show}       a paper passed put on the board (anon or named), in place of their last
 *   POST withdraw                      their paper taken off the board, its ratings with it
 *   POST deal                          the paper to rate now
 *   POST rate {deal, score}            it rated 0 to 800; the next one dealt
 *   POST skip {deal}                   it skipped; the next one dealt
 *   POST report {paper, reason, note}  a paper reported
 * While STUDY keeps 325大学习 from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. While the owner has paused the 手写榜 in the 管理台, board answers that it is (with the player's own paper, so
 * it may still be taken down), pass and withdraw go through, and the rest are refused. A request is SHEET.bytes at
 * most. All wait, like the map's world, while the admin asks the player to say again they are 18 or older, or an
 * updated privacy policy is not agreed yet.
 */

const OPS = {
  board: { perMinute: 30 },
  pass: { perMinute: 10 },
  publish: { perMinute: 6 },
  withdraw: { perMinute: 6 },
  deal: { perMinute: 30 },
  rate: { perMinute: 30 },
  skip: { perMinute: 30 },
  report: { perMinute: 6 },
} as const satisfies Record<string, { perMinute: number }>;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

type Ctx = { params: Promise<{ op: string }> };

/** Who this request may act for: a player, or a visitor for the board alone; else the refusal (404 to anyone STUDY keeps it from) */
async function whoFor(req: NextRequest, method: string, op: string): Promise<{ user: UserRow; op: Op } | { user: null; op: "board" }> {
  const notHere = () => new HttpError(404, T.server.routes.writing.notHere);
  const tooFast = () => new HttpError(429, T.server.routes.writing.tooFast);
  if (studyMode() === "off" || method !== "POST" || !isOp(op)) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (studyMode() !== "on") throw notHere();
    if (op !== "board") throw new HttpError(401, T.server.common.signIn);
    if (!allow(`writing:board:${clientIp(req)}`, OPS.board.perMinute, 60_000)) throw tooFast();
    return { user: null, op };
  }
  if (!studyOpen(user)) throw notHere();
  if (!allow(`writing:${op}:${user.id}`, OPS[op].perMinute, 60_000)) throw tooFast();
  if (user.ageCheckAt) throw new HttpError(428, ageCheckNeeded(), AGE_CHECK);
  if (mustReconsent(user)) throw new HttpError(428, reconsentNeeded());
  return { user, op };
}

/** The request's JSON, read no further than SHEET.bytes: anything longer is refused before it is all in */
async function readSmall(req: NextRequest): Promise<Record<string, unknown>> {
  const tooBig = () => new HttpError(413, T.server.board.tooBig);
  if (Number(req.headers.get("content-length")) > SHEET.bytes) throw tooBig();
  const parts: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > SHEET.bytes) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    parts.push(value);
  }
  if (!size) return {};
  try {
    const v: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, T.server.common.badRequest);
}

const answer = (result: unknown) => NextResponse.json(result, { headers: { "cache-control": "no-store" } });

// nothing to read here: asked anyway, the same 404 as anything else that is not
export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  await whoFor(req, "GET", (await params).op);
  return answer(null);
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const who = await whoFor(req, "POST", (await params).op);
  const body = await readSmall(req);
  if (who.op === "board") return answer(await boardPage(who.user, body.page));
  const { user, op } = who;
  if (op === "pass") return answer(await passPaper(user, body.squares));
  if (op === "withdraw") return answer({ gone: await withdrawPaper(user) });
  if (boardPaused()) throw new HttpError(409, T.server.board.paused, BOARD_PAUSED);
  if (op === "publish") return answer({ mine: await publishPaper(user, body.squares, body.show) });
  if (op === "deal") return answer(await dealPaper(user));
  if (op === "rate") return answer(await ratePaper(user, body.deal, body.score));
  if (op === "skip") return answer(await skipPaper(user, body.deal));
  await reportPaper(user.id, body.paper, body.reason, body.note);
  return answer({ ok: true });
});
