import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { PassesDot } from "./passes";
import type { SquadBotDo, SquadCard, SquadFriend, SquadInviteSent, SquadList, SquadMove, SquadPose, SquadRoom, SquadRound } from "./squad";
import type { FireBoard, SquadFire } from "./squadFire";
import type { DanceSong, QuizAnswered, QuizAsk, SquadModeKind } from "./squadMode";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError, type TouchResult } from "./world/types";

/**
 * The browser's side of 一起卫戍 (src/app/api/squad/[op]) for a signed-in player: refusals become the errors the map
 * page already tells apart (src/lib/world/types.ts), and a room refused keeps its code (src/lib/squad.ts), so the page
 * can say why and act on it (fill in the card first, the room is over or full). Every answer carries the server's
 * clock (now).
 */

/** A room refused: closed for now, no card yet, the room over, full, playing or shut to you… (its code says which) */
export class SquadRefused extends WorldError {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

async function call<R>(op: string, init: RequestInit): Promise<R> {
  let res: Response;
  try {
    res = await apiFetch(`/api/squad/${op}`, init);
  } catch {
    throw new WorldError(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (res.status === 401) throw new SignInNeeded(json?.error ?? T.requests.signIn);
  if (res.status === 428 && json?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
  if (res.status === 428) throw new ConsentNeeded(json?.error ?? T.requests.reconsent);
  if (!res.ok && json?.code && json.error) throw new SquadRefused(json.error, json.code);
  if (!res.ok || !json) throw new WorldError(json?.error ?? T.requests.serverTrouble);
  return json as R;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
type Room = { room: SquadRoom | null; now: number };

export const squadApi = {
  /** The rooms of a server and 难度 (null: all); asked again each time, the browser's own copy used while it is still the server's (304) */
  list: (server: string | null, level: number | null) => {
    const q = new URLSearchParams();
    if (server) q.set("server", server);
    if (level) q.set("level", String(level));
    const s = q.toString();
    return call<SquadList>(`list${s ? `?${s}` : ""}`, { cache: "no-cache" });
  },
  /** The room you are in, as you see it (null: none) */
  room: () => call<Room>("room", post({})),
  /** Your 卫戍名片 (null clears it), and 列表上显示我的名字, 别人扔我 (off: noThrow) and 火焰周榜写我的名字 (off: fireHide) when given */
  card: (card: SquadCard | null, showName?: boolean, noThrow?: boolean, fireHide?: boolean) =>
    call<{ card: SquadCard | null; showName: boolean; noThrow: boolean; fireHide: boolean; now: number }>(
      "card",
      post({
        card,
        ...(showName === undefined ? {} : { showName }),
        ...(noThrow === undefined ? {} : { noThrow }),
        ...(fireHide === undefined ? {} : { fireHide }),
      }),
    ),
  open: (form: { key: string; server: string; level: number; tags: number[]; friendsOnly: boolean }) => call<Room>("open", post(form)),
  join: (room: string) => call<{ room: SquadRoom; now: number }>("join", post({ room })),
  /** Out of your room (the host's ends, unless handed first to the one numbered to) */
  leave: (to?: number) => call<{ now: number }>("leave", post(to === undefined ? {} : { to })),
  /** The host's 开始游戏 (go), 结束这局 (wait) or 销毁房间 (end) */
  state: (to: "wait" | "go" | "end") => call<Room>("state", post({ to })),
  key: (key: string) => call<Room>("key", post({ key })),
  kick: (h: number) => call<Room>("kick", post({ h })),
  /** 准备, ticked or not */
  game: (on: boolean) => call<Room>("game", post({ on })),
  /** Your picks in this room alone, with the round's 附加盟约 (taken while a round plays) */
  prefs: (round: SquadRound) => call<Room>("prefs", post({ round })),
  /** What your roach keeps doing in the room */
  pose: (pose: SquadPose) => call<Room>("pose", post({ pose })),
  /** The host's 停止加入 (on) and 恢复加入 */
  stop: (on: boolean) => call<Room>("stop", post({ on })),
  /** 人机, for the 站长 and the admins as host: add one, or what the one numbered h does */
  bot: (what: SquadBotDo, h?: number) => call<Room>("bot", post(h === undefined ? { do: what } : { do: what, h })),
  /** Your roach waves, or gives a teammate (to: their number) 击掌 or 贴贴: sent, or one too many (full: the hour's are used up) */
  move: (move: SquadMove, to?: number) => call<{ sent: boolean; full?: boolean; now: number }>("move", post(to === undefined ? { move } : { move, to })),
  /** 添一根: a stick from your hand on the room's 篝火; the fire after it, and your hand */
  fire: () => call<{ now: number; fire: SquadFire; up: boolean; wood: number; woodAt: number }>("fire", post({})),
  /** 扔: one of the things (src/lib/squadFire.ts THROWS, by number) at the one numbered to; out: what a parcel held */
  throwAt: (to: number, item: number) => call<{ now: number; out?: number }>("throw", post({ to, item })),
  /** 打回去: the ball on your tile, back to whoever sent it; the rally after it */
  hit: () => call<{ now: number; n: number }>("hit", post({})),
  /** 甩掉: what crawled onto your roach's head */
  shake: () => call<{ now: number }>("shake", post({})),
  /** 玩点什么: open a mode (none playing) */
  mode: (kind: SquadModeKind) => call<{ now: number }>("mode", post({ kind })),
  /** 加入 the mode playing (in), or 不跳了，去围观 */
  modeIn: (into: boolean) => call<{ now: number }>("modein", post({ in: into })),
  /** 开始: a match's initiator starts a round with those ready */
  start: () => call<{ now: number }>("start", post({})),
  /** 跳: a tap in 龙门广场舞, at the server's clock as this page has it; on the beat or not, the combo after it */
  tap: (at: number) => call<{ now: number; combo: number; ok: boolean; counted: boolean }>("tap", post({ at })),
  /** 龙门广场舞's song: its beats, and its link to one 听歌 is open to */
  song: () => call<DanceSong>("song", post({})),
  /** 凯尔希随堂测: question n's three (a 方舟梗 question's words too) and its picture or song, from just before it starts */
  question: (n: number) => call<QuizAsk>("question", post({ n })),
  /** 凯尔希随堂测: your answer (pick: 0–2) to question n, at the server's clock as this page has it */
  answer: (n: number, pick: number, at: number) => call<QuizAnswered>("answer", post({ n, pick, at })),
  /** W 的礼物: 传, the gift in your hands on to the next seat, at the server's clock as this page has it; its time as taken */
  pass: (at: number) => call<{ now: number; at: number }>("pass", post({ at })),
  /** 企鹅物流急件赛: 加油 (tap: how many since the last) or 跳 (jump), at the server's clock as this page has it; as taken */
  run: (body: { tap: number; at: number } | { jump: true; at: number }) => call<{ now: number; h: number; tap?: [number, number]; jump?: number }>("run", post(body)),
  /**
   * 基建加盖: 放 your roach on the tower (drop, at the server's clock as this page has it) or 再来一轮 (again), in the round
   * this page has; where it went, whether the tower fell or sways, and how high it stands (a drop), the room's highest
   */
  stack: (body: { do: "drop"; round: number; at: number } | { do: "again"; round: number }) =>
    call<{ now: number; round: number; best: number; x?: number; falls?: boolean; wobbles?: boolean; height?: number }>("stack", post(body)),
  /** 火焰周榜: this week's or last week's, and your room on it */
  fireBoard: (week: "this" | "last") => call<FireBoard>("fireboard", post({ week })),
  /** 偷偷碰 or 大胆碰 someone in the room, by their number there */
  touch: (h: number, bold: boolean) => call<TouchResult & { now: number }>("touch", post({ h, bold })),
  /** A set line, by its number (to: the one in the room it is said to, 对 TA 说): sent, or one too many (full: the hour's are used up) */
  say: (p: number, to?: number) => call<{ sent: boolean; full?: boolean; now: number }>("say", post(to === undefined ? { p } : { p, to })),
  /** In at an invitation to you (its id) or a 宣言招人 you got (its declaration's id) */
  joinBy: (by: { invite: string } | { declaration: string }) => call<{ room: SquadRoom; now: number }>("join", post(by)),
  /** Your 触须之交 to invite to your room */
  friends: () => call<{ friends: SquadFriend[]; now: number }>("friends", post({})),
  /** Invitations to them (their Friend ids): what each came to */
  invite: (friends: string[]) => call<{ room: SquadRoom | null; sent: SquadInviteSent[]; now: number }>("invite", post({ friends })),
  /** 下次吧, to an invitation to you */
  later: (invite: string) => call<{ now: number }>("later", post({ invite })),
  /** 宣言招人 from these roaches (null: your main one): what it reached */
  declare: (from: string[] | null) => call<{ reach: string; room: SquadRoom | null; now: number } & PassesDot>("declare", post(from ? { from } : {})),
};
