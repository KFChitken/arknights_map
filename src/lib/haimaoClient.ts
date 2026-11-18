import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { HaimaoStep, HaimaoStory } from "./haimaoStory";
import type { HaimaoSpin } from "./haimaoWheel";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 香艳制作人's 今日剧情 and her wheel (src/app/api/haimao/[op]): refusals become the errors the map page
 * already tells apart (src/lib/world/types.ts), as ServerWorld's do. Each sends the device's clock offset, by which
 * the player's day turns at 04:00.
 */
async function call<R>(op: string, body: Record<string, unknown> = {}): Promise<R> {
  let res: Response;
  try {
    res = await apiFetch(`/api/haimao/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, offset: new Date().getTimezoneOffset() }),
    });
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

export const haimaoApi = {
  /** 今日剧情 opened: what today holds */
  story: () => call<HaimaoStory>("story"),
  /** their answer (0–2) to day n's scene */
  pick: (day: number, answer: number) => call<HaimaoStep>("pick", { day, answer }),
  /** ALL END, after the twelfth */
  end: () => call<HaimaoStep>("end"),
  /** 试玩 (站长 and admins): the next day at once, or the story from its start; what today then holds */
  trial: (what: "next" | "restart") => call<HaimaoStory>(what),
  /** 转 ALL: their one spin of her wheel, or the one they had */
  spin: () => call<HaimaoSpin>("spin"),
};
