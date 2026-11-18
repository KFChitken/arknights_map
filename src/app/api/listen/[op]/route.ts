import { NextResponse, type NextRequest } from "next/server";
import { fmt, T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { listenMode } from "@/lib/server/env";
import { beatClip } from "@/lib/server/beatClips";
import { HttpError, readJson, route } from "@/lib/server/http";
import { heardSong, hotList, listenOpen, myFavs, playSong, setFav, stopSong } from "@/lib/server/listen";
import {
  answerAsk,
  askToListen,
  cameBack,
  changeSongs,
  declareRoom,
  endByHost,
  inviteFriends,
  joinRoom,
  kickMember,
  laterInvite,
  leaveRoom,
  listenFriends,
  myRoom,
  openRoom,
  reactInRoom,
  touchMember,
} from "@/lib/server/listenRooms";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";
import { songList } from "@/lib/server/songs";
import { dayWords, suspendedMeans } from "@/lib/server/staffNotes";

/**
 * 听歌 (src/lib/server/listen.ts) and 一起听 (src/lib/server/listenRooms.ts), for the signed-in player:
 *   GET  songs                    the whole list (src/lib/listen.ts ListenCatalog), with an ETag: a browser that holds
 *                                 it already gets 304
 *   POST play {song, next?, at?}  the song's link, and the next one's to fetch early; at: seconds in, to go on from
 *   POST stop {away?}             not listening any more; away: the page is going, so only soon
 *   POST room                     the room you are in, as you see it (null: none)
 *   POST friends                  your 触须之交 you may invite
 *   POST open {song, invite?, at?}   a new room of yours, with invitations to the 触须之交 given (their Friend ids);
 *                                 at: seconds into the song, which plays from there at once (else it waits for start)
 *   POST invite {friends}         more invitations to your room
 *   POST join {invite|declaration}   in at an invitation to you, or at a 宣言一起听 you got
 *   POST later {invite}           下次吧
 *   POST leave                    out of your room (the host's ends)
 *   POST end                      the host ends it
 *   POST queue {start|next|restart|random: true, add: song, seek: seconds}   what the host does to its songs
 *                                 (random: 随机加 10 首; seek: everyone to that second of the one playing)
 *   POST react {r}                a 短评, by its number: in your room, or (rows one and two) to the song you play alone
 *   POST declare {from?, song?}   宣言一起听 for your room, once (not in one: a room of your own first, song first)
 *   POST kick {h}                 the host asks someone in it to leave (h: their number in the room)
 *   POST touch {h, bold}          偷偷碰 or 大胆碰 someone in your room, as on the map
 *   POST ask {friend}             想一起听: ask a 触须之交 who is listening to invite you (their Friend id)
 *   POST askOk {item}             一起听 at a 想一起听 to you (its item in 消息): your room, TA invited to it
 *   POST beat {not?}              a clip for a round of 325 节拍 (src/lib/server/beatClips.ts), of a song not among
 *                                 those named where another is left: its link and its beats, or null
 *   POST heard {song}             30 s of the song you play were heard, for 热播榜 (counted once a time it is played)
 *   POST hot                      热播榜: the songs heard most in the last 7 days, and how many times (never who)
 *   POST favs                     your 收藏, the latest first: yours alone
 *   POST fav {song, on}           a song put in your 收藏 or taken out; your 收藏 after it
 * 拉黑 and 举报 someone in your room go as anywhere else (src/app/api/world/[op], as lr:<room>:<number>).
 * While LISTEN keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. All wait, like the map's world, while the admin asks the player to say again they are 18 or older, or an
 * updated privacy policy is not agreed yet; one whose 互动 is paused (暂停互动) may listen alone, not with others. Any
 * request but the page's going and 325 节拍's says the player is back (a room keeps the place of one whose page went a
 * while). The songs' files, and the clips', go out at the links, checked by /api/listen/ok.
 */

const OPS = {
  songs: { method: "GET", perMinute: 20 },
  play: { method: "POST", perMinute: 40 },
  stop: { method: "POST", perMinute: 30 },
  room: { method: "POST", perMinute: 40 },
  friends: { method: "POST", perMinute: 10 },
  open: { method: "POST", perMinute: 6 },
  invite: { method: "POST", perMinute: 10 },
  join: { method: "POST", perMinute: 10 },
  later: { method: "POST", perMinute: 20 },
  leave: { method: "POST", perMinute: 10 },
  end: { method: "POST", perMinute: 10 },
  queue: { method: "POST", perMinute: 30 },
  react: { method: "POST", perMinute: 30 },
  declare: { method: "POST", perMinute: 6 },
  kick: { method: "POST", perMinute: 20 },
  touch: { method: "POST", perMinute: 20 },
  ask: { method: "POST", perMinute: 10 },
  askOk: { method: "POST", perMinute: 10 },
  beat: { method: "POST", perMinute: 20 },
  heard: { method: "POST", perMinute: 10 },
  hot: { method: "POST", perMinute: 20 },
  favs: { method: "POST", perMinute: 20 },
  fav: { method: "POST", perMinute: 60 },
} as const satisfies Record<string, { method: "GET" | "POST"; perMinute: number }>;
/** What reaches others: not while 互动 is paused (暂停互动) */
const TALKING: ReadonlySet<Op> = new Set<Op>(["open", "invite", "join", "react", "queue", "declare", "touch", "ask", "askOk"]);
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
  if (TALKING.has(op) && user.suspendedUntil && user.suspendedUntil.getTime() > Date.now()) {
    throw new HttpError(403, fmt(T.server.routes.world.suspended, { until: dayWords(user.suspendedUntil.getTime()), means: suspendedMeans() }));
  }
  if (op !== "beat" && !(op === "stop" && body.away === true)) await cameBack(user.id);
  switch (op) {
    case "play":
      return answer(await playSong(user, body));
    case "stop":
      return answer(await stopSong(user, body));
    case "room":
      return answer(await myRoom(user));
    case "friends":
      return answer(await listenFriends(user));
    case "open":
      return answer(await openRoom(user, body));
    case "invite":
      return answer(await inviteFriends(user, body));
    case "join":
      return answer(await joinRoom(user, body));
    case "later":
      return answer(await laterInvite(user, body));
    case "leave":
      return answer(await leaveRoom(user));
    case "end":
      return answer(await endByHost(user));
    case "queue":
      return answer(await changeSongs(user, body));
    case "react":
      return answer(await reactInRoom(user, body));
    case "declare":
      return answer(await declareRoom(user, body));
    case "kick":
      return answer(await kickMember(user, body));
    case "touch":
      return answer(await touchMember(user, body));
    case "ask":
      return answer(await askToListen(user, body));
    case "askOk":
      return answer(await answerAsk(user, body));
    case "beat":
      return answer(await beatClip(user, body));
    case "heard":
      return answer(await heardSong(user, body));
    case "hot":
      return answer(await hotList());
    case "favs":
      return answer(await myFavs(user));
    case "fav":
      return answer(await setFav(user, body));
    default:
      throw new HttpError(404, T.server.routes.listen.notHere);
  }
});
