import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { PassesDot } from "./passes";
import type { SquadBotDo, SquadCard, SquadFriend, SquadInviteSent, SquadList, SquadMove, SquadPose, SquadRoom, SquadRound, SquadSongChange } from "./squad";
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
  /** Your 卫戍名片 (null clears it), and 列表上显示我的名字 when given */
  card: (card: SquadCard | null, showName?: boolean) =>
    call<{ card: SquadCard | null; showName: boolean; now: number }>("card", post(showName === undefined ? { card } : { card, showName })),
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
  /** 偷偷碰 or 大胆碰 someone in the room, by their number there */
  touch: (h: number, bold: boolean) => call<TouchResult & { now: number }>("touch", post({ h, bold })),
  /** A set line, by its number: sent, or one too many (full: the hour's are used up) */
  say: (p: number) => call<{ sent: boolean; full?: boolean; now: number }>("say", post({ p })),
  /** What the host does to the room's songs */
  music: (change: SquadSongChange) => call<Room>("music", post(typeof change === "object" ? change : { [change]: true })),
  /** 点歌 */
  request: (song: string) => call<Room>("request", post({ song })),
  /** The host takes a song asked for into the songs, or drops it */
  take: (id: number) => call<Room>("take", post({ id })),
  drop: (id: number) => call<Room>("drop", post({ id })),
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
