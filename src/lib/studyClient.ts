import { T } from "@/i18n";
import { apiFetch } from "@/lib/apiFetch";
import { AGE_CHECK, ageCheckNeeded } from "./consent";
import { NOT_TODAY, type StudyDone, type StudyToday } from "./study/rules";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "./world/types";

/**
 * The browser's side of 325大学习 (src/app/api/study/[op]), for a signed-in player: refusals become the errors the map
 * page already tells apart (src/lib/world/types.ts), as ServerWorld's do.
 */

/** A round of a course that is not today's any more (the day turned at 04:00): today's, as the server has it now */
export class NotToday extends WorldError {
  constructor(
    message: string,
    public today: StudyToday,
  ) {
    super(message);
  }
}

async function call<R>(op: string, body?: unknown): Promise<R> {
  let res: Response;
  try {
    res = await apiFetch(`/api/study/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new WorldError(T.requests.offline);
  }
  const json = (await res.json().catch(() => null)) as { error?: string; code?: string; today?: StudyToday } | null;
  if (res.status === 401) throw new SignInNeeded(json?.error ?? T.requests.signIn);
  if (res.status === 428 && json?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
  if (res.status === 428) throw new ConsentNeeded(json?.error ?? T.requests.reconsent);
  if (res.status === 409 && json?.code === NOT_TODAY && json.today) throw new NotToday(json.error ?? "", json.today);
  if (!res.ok || !json) throw new WorldError(json?.error ?? T.requests.serverTrouble);
  return json as R;
}

export const studyApi = {
  /** The day's course (drawn the first time today), whether it was played, the days studied */
  today: () => call<StudyToday>("today"),
  /** A round of the day's course was played */
  done: (course: string) => call<StudyDone>("done", { course }),
};
