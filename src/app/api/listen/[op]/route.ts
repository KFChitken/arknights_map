import { NextResponse, type NextRequest } from "next/server";
import { fmt, T } from "@/i18n";
import { LISTEN_GRACE_MS } from "@/lib/listen";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { listenMode } from "@/lib/server/env";
import { beatClip } from "@/lib/server/beatClips";
import { HttpError, readJson, route } from "@/lib/server/http";
import { heardSong, hotList, listenHere, myFavs, playSong, setFav, stopSong } from "@/lib/server/listen";
import {
  answerAsk,
  answerRequest,
  askToListen,
  cameBack,
  changeSongs,
  declareRoom,
  endByHost,
  inviteFriends,
  inviteSquad,
  joinRoom,
  kickMember,
  laterInvite,
  leaveRoom,
  listenFriends,
  myRoom,
  openRoom,
  reactInRoom,
  requestSong,
  thereTill,
  touchMember,
  withdrawRequest,
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
 *   POST room {was?}              the room you are in, as you see it (null: none); out of the one your page was in
 *                                 (was) for doing nothing in it, out: idle
 *   POST friends                  your 触须之交 you may invite
 *   POST open {song, invite?, at?}   a new room of yours, with invitations to the 触须之交 given (their Friend ids);
 *                                 at: seconds into the song, which plays from there at once (else it waits for start)
 *   POST invite {friends}         more invitations to your room
 *   POST squad {song?, at?}       「邀请大家一起听」 by the host of a room of 一起卫戍: their own room (opened as open
 *                                 does when there is none), with everyone in the room of 一起卫戍 invited
 *   POST join {invite|declaration|squad}   in at an invitation to you, at a 宣言一起听 you got, or (squad: true) at
 *                                 卫戍的一起听 of the room of 一起卫戍 you are in
 *   POST later {invite}           下次吧
 *   POST leave                    out of your room (the host's ends)
 *   POST end {alone?}             the host ends it; alone: their page counted 5 minutes alone in it down, so it ends
 *                                 as the sweep would, only once that is so by the server's clock (else nothing)
 *   POST queue {start|next|restart|random: true, add: song, seek: seconds, remove: place + song}   what the host
 *                                 does to its songs (random: 随机加 10 首; seek: everyone to that second of the one
 *                                 playing; remove: a song out of 待播, by its place in the songs and its id)
 *   POST request {song}           点歌: ask the host of your room for a song (not the host's own)
 *   POST withdraw {id}            take back a song you asked for, not answered yet
 *   POST answer {id, yes}         the host lets a song asked for into 待播 (yes), or leaves it out
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
 * while); any but what a page asks by itself (BY_ITSELF) says they are there in their room, a song played till it ends
 * (one who is not, as it plays, is out of it after a while: src/lib/server/listenRooms.ts sweepIdle). The songs' files,
 * and the clips', go out at the links, checked by /api/listen/ok.
 */

const OPS = {
  songs: { method: "GET", perMinute: 20 },
  play: { method: "POST", perMinute: 40 },
  stop: { method: "POST", perMinute: 30 },
  room: { method: "POST", perMinute: 40 },
  friends: { method: "POST", perMinute: 10 },
  open: { method: "POST", perMinute: 6 },
  invite: { method: "POST", perMinute: 10 },
  squad: { method: "POST", perMinute: 6 },
  join: { method: "POST", perMinute: 10 },
  later: { method: "POST", perMinute: 20 },
  leave: { method: "POST", perMinute: 10 },
  end: { method: "POST", perMinute: 10 },
  queue: { method: "POST", perMinute: 30 },
  request: { method: "POST", perMinute: 10 },
  withdraw: { method: "POST", perMinute: 20 },
  answer: { method: "POST", perMinute: 30 },
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
/**
 * What a page asks by itself, which says nothing of whether its player is there in their room: the room read again,
 * the counting stopped (or the page going), the room ended (or the host's page ending one it was alone in), 325 节拍's
 * clips; and leaving it, which takes them out anyway
 */
const BY_ITSELF: ReadonlySet<Op> = new Set<Op>(["room", "stop", "end", "leave", "beat"]);
/** What reaches others: not while 互动 is paused (暂停互动) */
const TALKING: ReadonlySet<Op> = new Set<Op>(["open", "invite", "squad", "join", "react", "queue", "request", "answer", "declare", "touch", "ask", "askOk"]);
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);

type Ctx = { params: Promise<{ op: string }> };

/**
 * The player this request may act for, or the refusal: 404 to anyone LISTEN keeps it from (asking from the English
 * site, LISTEN_EN too: listenHere), 401 to a visitor once it is open
 */
async function playerFor(method: string, op: string): Promise<{ user: UserRow; op: Op }> {
  const notHere = () => new HttpError(404, T.server.routes.listen.notHere);
  if (listenMode() === "off" || !isOp(op) || OPS[op].method !== method) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (listenMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!listenHere(user)) throw notHere();
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
  if (!BY_ITSELF.has(op) && op !== "play") await thereTill(user.id);
  switch (op) {
    case "play": {
      const played = await playSong(user, body);
      // there till the song ends, though nothing more is asked meanwhile
      await thereTill(user.id, played.until - LISTEN_GRACE_MS);
      return answer(played);
    }
    case "stop":
      return answer(await stopSong(user, body));
    case "room":
      return answer(await myRoom(user, body));
    case "friends":
      return answer(await listenFriends(user));
    case "open":
      return answer(await openRoom(user, body));
    case "invite":
      return answer(await inviteFriends(user, body));
    case "squad":
      return answer(await inviteSquad(user, body));
    case "join":
      return answer(await joinRoom(user, body));
    case "later":
      return answer(await laterInvite(user, body));
    case "leave":
      return answer(await leaveRoom(user));
    case "end":
      return answer(await endByHost(user, body));
    case "queue":
      return answer(await changeSongs(user, body));
    case "request":
      return answer(await requestSong(user, body));
    case "withdraw":
      return answer(await withdrawRequest(user, body));
    case "answer":
      return answer(await answerRequest(user, body));
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
