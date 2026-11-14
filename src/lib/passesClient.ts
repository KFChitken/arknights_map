import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { CharCopies, Collection, Drawn, DrawSize, LogPage, PassState, RoachPass, Task } from "./passes";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 通行证寻访 (src/app/api/passes/[op]): refusals become the errors the map page already tells
 * apart (src/lib/world/types.ts), as ServerWorld's do.
 */
async function call<R>(method: "GET" | "POST" | "PUT", op: string, body?: unknown, query = ""): Promise<R> {
  let res: Response;
  try {
    res = await apiFetch(
      `/api/passes/${op}${query}`,
      method === "GET" ? { cache: "no-store" } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) },
    );
  } catch {
    throw new WorldError(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (res.status === 401) throw new SignInNeeded(json?.error ?? T.requests.signIn);
  if (res.status === 428 && json?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
  if (res.status === 428) throw new ConsentNeeded(json?.error ?? T.requests.reconsent);
  if (!res.ok || !json) throw new WorldError(json?.error ?? T.requests.serverTrouble);
  return json as R;
}

export const passesApi = {
  /** The page opened: the wallet (the first tickets, the first time) */
  open: () => call<PassState>("POST", "open"),
  draw: (n: DrawSize) => call<{ drawn: Drawn[]; state: PassState }>("POST", "draw", { n }),
  /** 每日任务: claim the tickets of one task done today */
  claim: (task: Task) => call<PassState>("POST", "claim", { task }),
  wish: (ids: number[]) => call<PassState>("PUT", "wish", { ids }),
  collection: () => call<Collection>("GET", "collection"),
  log: (before?: number) => call<LogPage>("GET", "log", undefined, before ? `?before=${before}` : ""),
  copies: (charId: number) => call<CharCopies>("GET", "copies", undefined, `?char=${charId}`),
  /** a character's passes in the normal look (plain) or the special one */
  look: (charId: number, plain: boolean) => call<PassState>("PUT", "look", { charId, plain }),
  /** the pass worn on the player's profile card, or none */
  wear: (passId: number | null) => call<PassState>("PUT", "wear", { passId }),
  /** 送 1 张寻访券 to a 触须之交, by their Friend.id */
  gift: (friendId: string) => call<{ ok: true }>("POST", "gift", { friendId }),
  /** 地图卡片上显示立绘 (我的资料) */
  onMap: (on: boolean) => call<{ onMap: boolean }>("PUT", "map", { on }),
  /** the pass someone wears, for their main roach's card on the map (null: none to show), by the roach's id in the feed */
  roach: (id: string) => call<{ pass: RoachPass | null }>("GET", "roach", undefined, `?id=${encodeURIComponent(id)}`),
};
