import { T } from "@/i18n";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { Collection, Drawn, DrawSize, LogPage, PassState } from "./passes";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 通行证寻访 (src/app/api/passes/[op]): refusals become the errors the map page already tells
 * apart (src/lib/world/types.ts), as ServerWorld's do.
 */
async function call<R>(method: "GET" | "POST" | "PUT", op: string, body?: unknown, query = ""): Promise<R> {
  let res: Response;
  try {
    res = await fetch(
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
  wish: (ids: number[]) => call<PassState>("PUT", "wish", { ids }),
  collection: () => call<Collection>("GET", "collection"),
  log: (before?: number) => call<LogPage>("GET", "log", undefined, before ? `?before=${before}` : ""),
};
