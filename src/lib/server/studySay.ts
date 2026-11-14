import "server-only";
import { eq } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import type { StudyTemplate } from "../declarations";
import type { PassesDot } from "../passes";
import { siteDay } from "../siteDay";
import type { StudyAnnounced, StudyDone, StudySaid } from "../study/rules";
import { WorldError } from "../world/types";
import { db } from "./db";
import { HttpError } from "./http";
import { users, type UserRow } from "./schema";
import { logError } from "./signals";
import { dayWords, suspendedMeans } from "./staffNotes";
import { announcedOn, studyGiveUp } from "./study";
import { declare } from "./world";

/**
 * 325大学习's two declarations (src/lib/declarations.ts STUDY_TEMPLATES), which nothing else sends: 苦也！ the moment
 * today's course is given up, and 已完成今日的325大学习 once a site day after it was passed. Each goes as any declaration
 * does (world.ts declare): from the main roach, which must be on the map, a minute after the last, twenty a day, to
 * everyone near; and not while the player's interactions are paused (暂停互动), as the world's own routes refuse it.
 */

/** One of the two, from the player's main roach: how far it reached, and the 每日任务 dot it may have lit */
async function say(userId: string, template: StudyTemplate): Promise<{ reach: string } & PassesDot> {
  const [u] = await db.select({ until: users.suspendedUntil }).from(users).where(eq(users.id, userId));
  if (u?.until && u.until.getTime() > Date.now()) {
    throw new HttpError(403, fmt(T.server.routes.world.suspended, { until: dayWords(u.until.getTime()), means: suspendedMeans() }));
  }
  return declare(userId, { template }, undefined, true);
}

/** 苦也！, said as today's course is given up: whatever becomes of it, today is given up all the same */
async function sayKuye(userId: string): Promise<{ said: StudySaid } & PassesDot> {
  try {
    const { reach, ...dot } = await say(userId, "kuye");
    return { said: { reach }, ...dot };
  } catch (e) {
    if (e instanceof WorldError || e instanceof HttpError) return { said: { failed: e.message } };
    logError("study: kuye not said", e);
    return { said: { failed: T.server.common.serverTrouble } };
  }
}

/** Today's course given up after five rounds of it lost (study.ts studyGiveUp), saying 苦也！ the time it is */
export const studyGiveUpSaying = (user: Pick<UserRow, "id" | "email">, course: unknown, now = Date.now()): Promise<StudyDone> =>
  studyGiveUp(user, course, now, () => sayKuye(user.id));

/**
 * 已完成今日的325大学习, said once today's course is done (passed, or given up), once a site day: refused (409) before,
 * and a second time; refused as any declaration is otherwise (no main roach, a minute after the last, twenty today)
 */
export async function studyAnnounce(user: Pick<UserRow, "id" | "email">, now = Date.now()): Promise<StudyAnnounced> {
  const day = siteDay(now);
  const [u] = await db.select({ studiedOn: users.studiedOn }).from(users).where(eq(users.id, user.id));
  if (!u) throw new HttpError(401, T.server.common.signIn);
  if (u.studiedOn !== day) throw new HttpError(409, T.server.study.notDone);
  if (await announcedOn(user.id, day)) throw new HttpError(409, T.server.study.announced);
  return say(user.id, "studied");
}
