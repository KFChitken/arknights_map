import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { ListenCatalog, ListenPlay } from "./listen";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 听歌 (src/app/api/listen/[op]) for a signed-in player: refusals become the errors the map page
 * already tells apart (src/lib/world/types.ts), and a song refused keeps its code (src/lib/listen.ts), so the player
 * can say why.
 */

/** A song refused: too many listening, paused by the 站长, the site gray, or no such song (its code says which) */
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
  /** The page is going: a beacon, which outlives it, so the server counts the player only a little longer */
  away: () => {
    const body = JSON.stringify({ away: true });
    try {
      if (navigator.sendBeacon?.("/api/listen/stop", body)) return;
    } catch {}
    apiFetch("/api/listen/stop", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  },
};
