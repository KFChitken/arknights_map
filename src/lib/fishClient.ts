import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { FishSpot } from "./fish/items";
import type { FishBottle, FishCatch, FishDex, FishLine, FishState } from "./fish/rules";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 钓鳞 (src/app/api/fish/[op]), for a signed-in player: refusals become the errors the map page
 * already tells apart (src/lib/world/types.ts), as 325大学习's do; a refusal of the cast or pull itself (the day's casts
 * gone, not bitten yet, no line) is a FishRefused, said on the bank's page.
 */

export class FishRefused extends WorldError {
  constructor(
    message: string,
    /** FISH_FULL, FISH_NOT_YET, FISH_NO_LINE (src/lib/fish/rules.ts), or none */
    public code?: string,
  ) {
    super(message);
  }
}

async function call<R>(op: string, body?: unknown): Promise<R> {
  let res: Response;
  try {
    res = await apiFetch(`/api/fish/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new WorldError(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (res.status === 401) throw new SignInNeeded(json?.error ?? T.requests.signIn);
  if (res.status === 428 && json?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
  if (res.status === 428) throw new ConsentNeeded(json?.error ?? T.requests.reconsent);
  if ((res.status === 409 || res.status === 429 || res.status === 400) && json?.error) throw new FishRefused(json.error, json.code);
  if (!res.ok || !json) throw new WorldError(json?.error ?? T.requests.serverTrouble);
  return json as R;
}

/** The page's minutes east of UTC, for what bites only at some hours of the player's own day */
const tz = () => -new Date().getTimezoneOffset();

export const fishApi = {
  state: (after?: number) => call<FishState & { lastShout: number }>("state", after === undefined ? {} : { after }),
  cast: (spot: FishSpot) => call<{ now: number; casts: number; line: FishLine }>("cast", { spot, tz: tz() }),
  reel: () => call<{ now: number; caught: FishCatch; admiral: boolean; passesDot?: boolean }>("reel"),
  pull: () => call<{ now: number }>("pull"),
  dex: () => call<FishDex>("dex"),
  open: (id: number) => call<FishBottle>("open", { id }),
  throwBack: (id: number, say: number) => call<FishBottle>("throw", { id, say }),
};
