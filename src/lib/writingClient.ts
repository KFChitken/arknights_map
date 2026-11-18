import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import type { WritingReportReason } from "./safety";
import { BOARD_PAUSED, STALE_DEAL, type BoardMine, type BoardPage, type DealState, type Passed, type Sheet, type Show } from "./study/board";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 徒手写's 手写榜 (src/app/api/writing/[op]): refusals become the errors the map page already
 * tells apart (src/lib/world/types.ts), as studyClient's do, and two of its own: the board paused, and a paper to
 * rate that is not the one dealt any more.
 */

/** The owner has paused the 手写榜 for now */
export class BoardPaused extends WorldError {}

/** The paper rated or skipped is not the one dealt any more (another tab, or it was hidden or taken down): ask for the one to rate */
export class StaleDeal extends WorldError {}

async function call<R>(op: string, body?: unknown): Promise<R> {
  let res: Response;
  try {
    res = await apiFetch(`/api/writing/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new WorldError(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (res.status === 401) throw new SignInNeeded(json?.error ?? T.requests.signIn);
  if (res.status === 428 && json?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
  if (res.status === 428) throw new ConsentNeeded(json?.error ?? T.requests.reconsent);
  if (res.status === 409 && json?.code === BOARD_PAUSED) throw new BoardPaused(json.error ?? "");
  if (res.status === 409 && json?.code === STALE_DEAL) throw new StaleDeal(json.error ?? "");
  if (!res.ok || !json) throw new WorldError(json?.error ?? T.requests.serverTrouble);
  return json as R;
}

export const writingApi = {
  /** A page of the board (from 1), the player's own paper and whether they may rate */
  board: (page: number) => call<BoardPage>("board", { page }),
  /** A paper of 徒手写 passed, as the page marked it */
  pass: (squares: Sheet) => call<Passed>("pass", { squares }),
  /** That paper put on the board, as 匿名舟P or named, in place of the player's last */
  publish: (squares: Sheet, show: Show) => call<{ mine: BoardMine | null }>("publish", { squares, show }),
  /** The player's paper taken off the board */
  withdraw: () => call<{ gone: boolean }>("withdraw"),
  /** The paper to rate now */
  deal: () => call<DealState>("deal"),
  /** The paper dealt rated, and the next one */
  rate: (deal: string, score: number) => call<DealState>("rate", { deal, score }),
  /** The paper dealt skipped, and the next one */
  skip: (deal: string) => call<DealState>("skip", { deal }),
  /** A paper reported */
  report: (paper: string, reason: WritingReportReason, note: string) => call<{ ok: true }>("report", { paper, reason, note }),
};
