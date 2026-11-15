import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { InviteSent, ListenCatalog, ListenFriend, ListenPlay, ListenRoom, QueueChange } from "./listen";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

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
  open: (song: string | null, invite: string[]) => call<{ room: ListenRoom | null; sent: InviteSent[]; now: number }>("open", post({ song, invite })),
  /** More invitations to your room */
  invite: (friends: string[]) => call<{ room: ListenRoom | null; sent: InviteSent[]; now: number }>("invite", post({ friends })),
  /** In at an invitation to you */
  join: (invite: string) => call<{ room: ListenRoom; now: number }>("join", post({ invite })),
  /** 下次吧 */
  later: (invite: string) => call<{ now: number }>("later", post({ invite })),
  /** Out of your room (the host's ends) */
  leave: () => call<{ now: number }>("leave", post({})),
  /** The host ends it */
  end: () => call<{ now: number }>("end", post({})),
  /** What the host does to its songs */
  queue: (change: QueueChange) =>
    call<{ room: ListenRoom | null; now: number }>("queue", post(typeof change === "object" ? { add: change.add } : { [change]: true })),
  /** A 短评, by its number: sent, or one too many (full: this song's are used up) */
  react: (r: number) => call<{ sent: boolean; full?: boolean; now: number }>("react", post({ r })),
  /** The page is going: a beacon, which outlives it, so the server counts the player only a little longer */
  away: () => {
    const body = JSON.stringify({ away: true });
    try {
      if (navigator.sendBeacon?.("/api/listen/stop", body)) return;
    } catch {}
    apiFetch("/api/listen/stop", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  },
};
