import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { HotSong, InviteSent, ListenCatalog, ListenFriend, ListenPlay, ListenRoom, QueueChange, QueueRemove } from "./listen";
import type { PassesDot } from "./passes";
import type { BeatSong } from "./study/beat325";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError, type TouchResult } from "./world/types";

/**
 * The browser's side of 听歌 and 一起听 (src/app/api/listen/[op]) for a signed-in player: refusals become the errors the
 * map page already tells apart (src/lib/world/types.ts), and a song or a room refused keeps its code
 * (src/lib/listen.ts), so the page can say why. Every answer carries the server's clock (now).
 */

/** A song or a room refused: too many listening, paused by the 站长, the site gray, no such song, the room over or full… (its code says which) */
export class ListenRefused extends WorldError {
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
    res = await apiFetch(`/api/listen/${op}`, init);
  } catch {
    throw new WorldError(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (res.status === 401) throw new SignInNeeded(json?.error ?? T.requests.signIn);
  if (res.status === 428 && json?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
  if (res.status === 428) throw new ConsentNeeded(json?.error ?? T.requests.reconsent);
  if (!res.ok && json?.code && json.error) throw new ListenRefused(json.error, json.code);
  if (!res.ok || !json) throw new WorldError(json?.error ?? T.requests.serverTrouble);
  return json as R;
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const listenApi = {
  /** The whole list; asked again each time, so the browser's own copy is used while it is still the server's (304) */
  songs: () => call<ListenCatalog>("songs", { cache: "no-cache" }),
  /** A song from its start, or from `at` seconds in; with the next song's link too, to fetch early */
  play: (song: string, at: number, next: string | null) => call<ListenPlay>("play", post(next ? { song, at, next } : { song, at })),
  /** Not listening any more */
  stop: () => call<{ now: number }>("stop", post({})),
  /** The room you are in, as you see it (null: none) */
  room: () => call<{ room: ListenRoom | null; now: number }>("room", post({})),
  /** Your 触须之交 you may invite */
  friends: () => call<{ friends: ListenFriend[]; now: number }>("friends", post({})),
  /** A room of your own, with this song first (null: 新歌's first), and invitations to these 触须之交 (their Friend ids) */
  open: (song: string | null, invite: string[], at?: number) =>
    call<{ room: ListenRoom | null; sent: InviteSent[]; now: number }>("open", post(at === undefined ? { song, invite } : { song, invite, at })),
  /** More invitations to your room */
  invite: (friends: string[]) => call<{ room: ListenRoom | null; sent: InviteSent[]; now: number }>("invite", post({ friends })),
  /** In at an invitation to you */
  join: (invite: string) => call<{ room: ListenRoom; now: number }>("join", post({ invite })),
  /** In at a 宣言一起听 you got (the declaration's id) */
  joinCall: (declaration: string) => call<{ room: ListenRoom; now: number }>("join", post({ declaration })),
  /**
   * 宣言一起听 for your room, from these roaches (none: your main one); not in a room, one of your own first, with this
   * song first (null: 新歌's first). reach: as roughly as any declaration says how many it reached
   */
  declare: (from: string[] | null, song: string | null) =>
    call<{ room: ListenRoom | null; reach: string; now: number } & PassesDot>("declare", post({ ...(from ? { from } : {}), song })),
  /** The host asks someone in the room to leave it, by their number there */
  kick: (h: number) => call<{ room: ListenRoom | null; now: number }>("kick", post({ h })),
  /** 偷偷碰 or 大胆碰 someone in the room, by their number there: as a touch on the map answers */
  touch: (h: number, bold: boolean) => call<TouchResult & { now: number }>("touch", post({ h, bold })),
  /** 下次吧 */
  later: (invite: string) => call<{ now: number }>("later", post({ invite })),
  /** Out of your room (the host's ends) */
  leave: () => call<{ now: number }>("leave", post({})),
  /** The host ends it; alone: as their page counted 5 minutes alone in it down (ended: it was so, by the server's clock) */
  end: (alone = false) => call<{ ended: boolean; now: number }>("end", post(alone ? { alone } : {})),
  /**
   * What the host does to its songs: a song added ({add}), a second of the one playing gone to ({seek}), a song taken
   * out of 待播 ({remove, song}), or the rest
   */
  queue: (change: QueueChange | QueueRemove) =>
    call<{ room: ListenRoom | null; now: number }>("queue", post(typeof change === "object" ? change : { [change]: true })),
  /** 点歌: ask the host of your room for a song */
  request: (song: string) => call<{ room: ListenRoom | null; now: number }>("request", post({ song })),
  /** Take back a song you asked for (its id), not answered yet */
  withdraw: (id: number) => call<{ room: ListenRoom | null; now: number }>("withdraw", post({ id })),
  /** The host lets a song asked for (its id) into 待播 (yes), or leaves it out */
  answer: (id: number, yes: boolean) => call<{ room: ListenRoom | null; now: number }>("answer", post({ id, yes })),
  /** A 短评, by its number, in your room or to the song you play alone: sent, or one too many (full: this song's are used up) */
  react: (r: number) => call<{ sent: boolean; full?: boolean; now: number }>("react", post({ r })),
  /** 想一起听: ask a 触须之交 who is listening (their Friend id) to invite you */
  ask: (friend: string) => call<{ now: number }>("ask", post({ friend })),
  /** 一起听 at a 想一起听 to you (its item id in 消息): your room, TA invited to it */
  askOk: (item: string) => call<{ room: ListenRoom | null; sent: InviteSent[]; now: number }>("askOk", post({ item })),
  /** A clip to play a round of 325 节拍 to, of a song not among these where another is left (null: none to be had now) */
  beat: (not: string[]) => call<{ clip: BeatSong | null; now: number }>("beat", post({ not })),
  /** 30 s of the song playing were heard (热播榜): counted, or not (once a time it is played) */
  heard: (song: string) => call<{ counted: boolean; now: number }>("heard", post({ song })),
  /** 热播榜: the songs heard most in the last 7 days, most first, and how many times */
  hot: () => call<{ hot: HotSong[]; now: number }>("hot", post({})),
  /** Your 收藏, the latest first */
  favs: () => call<{ favs: string[]; now: number }>("favs", post({})),
  /** A song put in your 收藏 (on) or taken out: your 收藏 after it */
  fav: (song: string, on: boolean) => call<{ favs: string[]; now: number }>("fav", post({ song, on })),
  /** The page is going: a beacon, which outlives it, so the server counts the player only a little longer */
  away: () => {
    const body = JSON.stringify({ away: true });
    try {
      if (navigator.sendBeacon?.("/api/listen/stop", body)) return;
    } catch {}
    apiFetch("/api/listen/stop", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  },
};
