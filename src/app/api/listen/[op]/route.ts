import { NextResponse, type NextRequest } from "next/server";
import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { listenMode } from "@/lib/server/env";
import { HttpError, readJson, route } from "@/lib/server/http";
import { listenOpen, playSong, stopSong } from "@/lib/server/listen";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";
import { songList } from "@/lib/server/songs";

/**
 * 听歌 (src/lib/server/listen.ts), for the signed-in player:
 *   GET  songs                  the whole list (src/lib/listen.ts ListenCatalog), with an ETag: a browser that holds
 *                               it already gets 304
 *   POST play {song, next?, at?} the song's link, and the next one's to fetch early; at: seconds in, to go on from
 *   POST stop {away?}           not listening any more; away: the page is going, so only soon
 * While LISTEN keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. All wait, like the map's world, while the admin asks the player to say again they are 18 or older, or an
 * updated privacy policy is not agreed yet. The songs' files go out at the links, checked by /api/listen/ok.
 */

const OPS = {
  songs: { method: "GET", perMinute: 20 },
  play: { method: "POST", perMinute: 40 },
  stop: { method: "POST", perMinute: 30 },
} as const satisfies Record<string, { method: "GET" | "POST"; perMinute: number }>;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

type Ctx = { params: Promise<{ op: string }> };

/** The player this request may act for, or the refusal: 404 to anyone LISTEN keeps it from, 401 to a visitor once it is open */
async function playerFor(method: string, op: string): Promise<{ user: UserRow; op: Op }> {
  const notHere = () => new HttpError(404, T.server.routes.listen.notHere);
  if (listenMode() === "off" || !isOp(op) || OPS[op].method !== method) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (listenMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!listenOpen(user)) throw notHere();
  if (!allow(`listen:${op}:${user.id}`, OPS[op].perMinute, 60_000)) throw new HttpError(429, T.server.routes.listen.tooFast);
  if (user.ageCheckAt) throw new HttpError(428, ageCheckNeeded(), AGE_CHECK);
  if (mustReconsent(user)) throw new HttpError(428, reconsentNeeded());
  return { user, op };
}

const answer = (result: unknown) => NextResponse.json(result, { headers: { "cache-control": "no-store" } });

/** Whether If-None-Match names this ETag, as the browser sends it back (a proxy may have made it weak, or added to it) */
const holds = (ifNoneMatch: string | null, etag: string) => Boolean(ifNoneMatch?.includes(etag.slice(1, -1)));

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  await playerFor("GET", (await params).op);
  const list = await songList();
  // the same for every player who may listen, kept by their browser alone, and asked again each time
  const headers = { etag: list.etag, "cache-control": "private, no-cache", vary: "accept-encoding, cookie" };
  if (holds(req.headers.get("if-none-match"), list.etag)) return new Response(null, { status: 304, headers });
  return new Response(list.json, { headers: { ...headers, "content-type": "application/json" } });
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("POST", (await params).op);
  const body = await readJson(req);
  if (op === "play") return answer(await playSong(user, body));
  return answer(await stopSong(user, body));
});
