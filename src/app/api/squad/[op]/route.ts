import { NextResponse, type NextRequest } from "next/server";
import { fmt, T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { AGE_CHECK, ageCheckNeeded, mustReconsent, reconsentNeeded } from "@/lib/server/consent";
import { squadMode } from "@/lib/server/env";
import { HttpError, readJson, route } from "@/lib/server/http";
import { allow } from "@/lib/server/rateLimit";
import type { UserRow } from "@/lib/server/schema";
import {
  botInRoom,
  changeKey,
  declareSquad,
  inviteToSquad,
  joinRoom,
  kickMember,
  laterSquadInvite,
  leaveRoom,
  moveInRoom,
  myRoom,
  openRoom,
  saveCard,
  sayInRoom,
  setInGame,
  setPose,
  setPrefs,
  setState,
  setStopped,
  squadFriends,
  squadList,
  touchMember,
} from "@/lib/server/squad";
import { squadOpen } from "@/lib/server/squadOpen";
import { fireBoard } from "@/lib/server/fireBoard";
import { answerQuiz, askQuestion } from "@/lib/server/squadQuiz";
import { danceSong, danceTap, joinMode, openMode } from "@/lib/server/squadModes";
import { addWood, hitBack, shakeOff, throwAt } from "@/lib/server/squadPlay";
import { dayWords, suspendedMeans } from "@/lib/server/staffNotes";

/**
 * 一起卫戍 (src/lib/server/squad.ts), for the signed-in player:
 *   GET  list ?server=&level=     the rooms (src/lib/squad.ts SquadList), with an ETag: a page that holds it gets 304
 *   POST room                     the room you are in, as you see it (null: none)
 *   POST card {card}              your 卫戍名片
 *   POST open {key, server, level, tags?, friendsOnly?}   a new room of yours
 *   POST join {room} / {invite} / {declaration}   in at a room from the list, at an invitation to you, or at a
 *                                 宣言招人 you see in 消息 (the host's invitation opens one only for 触须之交)
 *   POST leave {to?}              out of your room (the host's ends, unless they hand it first to: one's number in it)
 *   POST state {to}               the host: go (开始游戏), wait (结束这局) or end (销毁房间)
 *   POST key {key}                the host changes the 同盟密钥
 *   POST kick {h}                 the host asks someone in it to leave (h: their number in the room), while it waits
 *   POST game {on}                准备 (in the game's alliance, ready), ticked or not
 *   POST prefs {round} / {card}   your picks in this room alone, with the round's 附加盟约 while it plays (round);
 *                                 a page of before sends its picks alone (card)
 *   POST pose {pose}              what your roach keeps doing in the room (站着, 蹦迪, 醉倒睡觉)
 *   POST move {move, to?}         your roach waves, or gives a teammate (to: their number) 击掌 or 贴贴
 *   POST touch {h, bold}          偷偷碰 or 大胆碰 someone in your room, as on the map
 *   POST say {p, to?}             a set line, by its number (to: said to that one in the room, 对 TA 说)
 *   POST music / request / take / drop   the host's songs of before: gone (410), the room's songs are 卫戍的一起听
 *                                 now (src/app/api/listen/[op] squad)
 *   POST friends                  your 触须之交 to invite to your room
 *   POST invite {friends}         invitations to them (their Friend ids): what each came to
 *   POST later {invite}           下次吧, to an invitation to you (whoever sent it sees 没来)
 *   POST declare {from?}          宣言招人: the host calls those nearby, once a room, from the roaches given
 *   POST stop {on}                the host: 停止加入 (on) or 恢复加入: nobody else comes in meanwhile
 *   POST bot {do, h?}             人机, for the 站长 and the admins as host: add one (add), or tick its 准备 (ready),
 *                                 give it another strategy, have it say a line, change its pose, or ask it out (kick)
 *   POST fire                     添一根: a stick from your hand on the room's 篝火 (src/lib/server/squadPlay.ts)
 *   POST throw {to, item}         扔: one of the things (src/lib/squadFire.ts THROWS, by number) at the one numbered to
 *   POST hit                      打回去: the ball on your tile sent back to whoever sent it
 *   POST shake                    甩掉: what crawled onto your roach's head (源石虫) off it
 *   POST mode {kind}              玩点什么: open a mode (src/lib/server/squadModes.ts; dance, 龙门广场舞), none playing
 *   POST modein {in}              加入 the mode playing (in), or 不跳了，去围观 (in false)
 *   POST tap {at?}                跳: a tap in 龙门广场舞, at the server's clock as the page has it
 *   POST song                     龙门广场舞's song: its beats, and its link to one 听歌 is open to
 *   POST fireboard {week}         火焰周榜 (src/lib/server/fireBoard.ts): this week's or last week's, and your room on it
 *   POST question {n}             凯尔希随堂测 (src/lib/server/squadQuiz.ts): question n's three, and its picture or song
 *   POST answer {n, pick, at?}    凯尔希随堂测: an answer to question n, at the server's clock as the page has it
 * 拉黑 and 举报 someone in your room go as anywhere else (src/app/api/world/[op], as sq:<room>:<number>).
 * While SQUAD keeps it from this player (src/lib/server/env.ts), every request is answered 404, as if nothing were
 * here. All wait, like the map's world, while the admin asks the player to say again they are 18 or older, or an
 * updated privacy policy is not agreed yet; one whose 互动 is paused (暂停互动) may look, and leave, but nothing that
 * reaches others.
 */

const OPS = {
  list: { method: "GET", perMinute: 30 },
  room: { method: "POST", perMinute: 40 },
  card: { method: "POST", perMinute: 20 },
  open: { method: "POST", perMinute: 6 },
  join: { method: "POST", perMinute: 10 },
  leave: { method: "POST", perMinute: 10 },
  state: { method: "POST", perMinute: 20 },
  key: { method: "POST", perMinute: 10 },
  kick: { method: "POST", perMinute: 20 },
  game: { method: "POST", perMinute: 20 },
  prefs: { method: "POST", perMinute: 60 },
  pose: { method: "POST", perMinute: 40 },
  move: { method: "POST", perMinute: 30 },
  touch: { method: "POST", perMinute: 20 },
  say: { method: "POST", perMinute: 30 },
  music: { method: "POST", perMinute: 30 },
  request: { method: "POST", perMinute: 10 },
  take: { method: "POST", perMinute: 30 },
  drop: { method: "POST", perMinute: 30 },
  friends: { method: "POST", perMinute: 20 },
  invite: { method: "POST", perMinute: 10 },
  later: { method: "POST", perMinute: 20 },
  declare: { method: "POST", perMinute: 4 },
  bot: { method: "POST", perMinute: 30 },
  stop: { method: "POST", perMinute: 6 },
  fire: { method: "POST", perMinute: 20 },
  throw: { method: "POST", perMinute: 20 },
  hit: { method: "POST", perMinute: 40 },
  shake: { method: "POST", perMinute: 20 },
  mode: { method: "POST", perMinute: 10 },
  modein: { method: "POST", perMinute: 20 },
  tap: { method: "POST", perMinute: 400 },
  song: { method: "POST", perMinute: 20 },
  fireboard: { method: "POST", perMinute: 30 },
  question: { method: "POST", perMinute: 40 },
  answer: { method: "POST", perMinute: 40 },
} as const satisfies Record<string, { method: "GET" | "POST"; perMinute: number }>;
type Op = keyof typeof OPS;
const isOp = (op: string): op is Op => Object.hasOwn(OPS, op);
/** What reaches others: not while 互动 is paused (暂停互动) */
const TALKING: ReadonlySet<Op> = new Set<Op>([
  "open",
  "join",
  "key",
  "game",
  "prefs",
  "pose",
  "move",
  "touch",
  "say",
  "invite",
  "declare",
  "bot",
  "fire",
  "throw",
  "hit",
  "mode",
  "modein",
  "tap",
  "answer",
]);

type Ctx = { params: Promise<{ op: string }> };

/** The player this request may act for, or the refusal: 404 to anyone SQUAD keeps it from, 401 to a visitor once it is open */
async function playerFor(method: string, op: string): Promise<{ user: UserRow; op: Op }> {
  const notHere = () => new HttpError(404, T.server.routes.squad.notHere);
  if (squadMode() === "off" || !isOp(op) || OPS[op].method !== method) throw notHere();
  const user = await currentUser();
  if (!user) {
    if (squadMode() === "on") throw new HttpError(401, T.server.common.signIn);
    throw notHere();
  }
  if (!squadOpen(user)) throw notHere();
  if (!allow(`squad:${op}:${user.id}`, OPS[op].perMinute, 60_000)) throw new HttpError(429, T.server.routes.squad.tooFast);
  if (user.ageCheckAt) throw new HttpError(428, ageCheckNeeded(), AGE_CHECK);
  if (mustReconsent(user)) throw new HttpError(428, reconsentNeeded());
  return { user, op };
}

const answer = (result: unknown) => NextResponse.json(result, { headers: { "cache-control": "no-store" } });

/** Whether If-None-Match names this ETag, as the browser sends it back (a proxy may have made it weak, or added to it) */
const holds = (ifNoneMatch: string | null, etag: string) => Boolean(ifNoneMatch?.includes(etag.slice(1, -1)));

export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  const { user } = await playerFor("GET", (await params).op);
  const q = req.nextUrl.searchParams;
  const level = q.get("level");
  const { list, etag } = await squadList(user, { server: q.get("server") ?? undefined, level: level ? Number(level) : undefined });
  // the player's own, kept by their browser alone, and asked again each time
  const headers = { etag, "cache-control": "private, no-cache", vary: "cookie" };
  if (holds(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers });
  return NextResponse.json(list, { headers });
});

export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  const { user, op } = await playerFor("POST", (await params).op);
  const body = await readJson(req);
  if (TALKING.has(op) && user.suspendedUntil && user.suspendedUntil.getTime() > Date.now()) {
    throw new HttpError(403, fmt(T.server.routes.world.suspended, { until: dayWords(user.suspendedUntil.getTime()), means: suspendedMeans() }));
  }
  switch (op) {
    case "room":
      return answer(await myRoom(user));
    case "card":
      return answer(await saveCard(user, body));
    case "open":
      return answer(await openRoom(user, body));
    case "join":
      return answer(await joinRoom(user, body));
    case "leave":
      return answer(await leaveRoom(user, body));
    case "state":
      return answer(await setState(user, body));
    case "key":
      return answer(await changeKey(user, body));
    case "kick":
      return answer(await kickMember(user, body));
    case "game":
      return answer(await setInGame(user, body));
    case "prefs":
      return answer(await setPrefs(user, body));
    case "pose":
      return answer(await setPose(user, body));
    case "move":
      return answer(await moveInRoom(user, body));
    case "touch":
      return answer(await touchMember(user, body));
    case "fire":
      return answer(await addWood(user));
    case "throw":
      return answer(await throwAt(user, body));
    case "hit":
      return answer(await hitBack(user));
    case "shake":
      return answer(await shakeOff(user));
    case "mode":
      return answer(await openMode(user, body));
    case "modein":
      return answer(await joinMode(user, body));
    case "tap":
      return answer(await danceTap(user, body));
    case "song":
      return answer(await danceSong(user));
    case "question":
      return answer(await askQuestion(user, body));
    case "answer":
      return answer(await answerQuiz(user, body));
    case "fireboard":
      return answer(await fireBoard(user, body.week === "last" ? "last" : "this", { hidden: T.squad.fireBoard.hidden, you: T.squad.room.you }));
    case "say":
      return answer(await sayInRoom(user, body));
    // a page of before: its songs' buttons say to look again
    case "music":
    case "request":
    case "take":
    case "drop":
      throw new HttpError(410, T.server.squad.songsGone);
    case "friends":
      return answer(await squadFriends(user));
    case "invite":
      return answer(await inviteToSquad(user, body));
    case "later":
      return answer(await laterSquadInvite(user, body));
    case "declare":
      return answer(await declareSquad(user, body));
    case "bot":
      return answer(await botInRoom(user, body));
    case "stop":
      return answer(await setStopped(user, body));
    default:
      throw new HttpError(404, T.server.routes.squad.notHere);
  }
});
