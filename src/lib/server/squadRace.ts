import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { T } from "@/i18n";
import { THROWS } from "../squadFire";
import {
  GIFT_SEATS,
  RACE_CROWN_MS,
  RACE_EARLY_MS,
  RACE_LATE_MS,
  RACE_LEAD_MS,
  RACE_MAX_MS,
  RACE_REPORT_JUMPS,
  RACE_REPORT_TAPS,
  RACE_RESULT_MS,
  RACE_TAPS_MAX,
  raceObstacles,
  raceOrder,
  raceRun,
  type RaceData,
} from "../squadMode";
import { db } from "./db";
import { HttpError } from "./http";
import { squadMembers } from "./schema";
import { modeBots, roomBotsOf } from "./squadGift";

/**
 * 企鹅物流急件赛 on the server (玩点什么; the rules in src/lib/squadMode.ts): its lanes, obstacles and seed decided
 * as it opens and kept on the room (squad_rooms.mode_data) with what each player sent, 加油 counts and 跳s (raceReport,
 * checked on the server's clock), from which the same rule (raceRun) the pages draw by says where everyone is. Once
 * all are in or its time is up, the order is settled here, the first wears a small crown, and it ends a little later
 * (settleRace). squadModes.ts starts it, takes players out, keeps their reports, and ends it.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
/** 急件赛's small crown, worn as 扔东西's things are (never thrown) */
const CROWN = THROWS.find((t) => t.key === "crown")!.no;

/**
 * 企鹅物流急件赛 as its initiator starts it (now): its lanes (those ready: its initiator, then as they readied; the
 * room's 人机, then the mode's own), its seed and obstacles, its start RACE_LEAD_MS on
 */
export async function makeRace(exec: Tx | typeof db, roomId: string, players: readonly number[], now: number, rand: (n: number) => number): Promise<RaceData> {
  const roomBots = await roomBotsOf(exec, roomId);
  const bots = modeBots(roomBots, rand);
  const hs = [...players.slice(0, GIFT_SEATS), ...roomBots.map((b) => b.h)].slice(0, GIFT_SEATS);
  for (const b of bots) if (hs.length < GIFT_SEATS) hs.push(b.h);
  const seed = rand(2 ** 31);
  return { seed, start: now + RACE_LEAD_MS, lanes: hs.map((h) => ({ h, taps: [], jumps: [] })), obs: raceObstacles(seed), bots };
}

/** As late as it could be over (its results shown), from its start: its end till it is settled */
export const raceLatest = (start: number) => start + RACE_MAX_MS + RACE_RESULT_MS;

/**
 * Before it starts, one going out to watch (a player of the room): their lane one of the mode's own 人机's. Says
 * whether it changed. Once it has started, nothing (their lane stops where it is); one coming in runs the next one.
 */
export function relaneRace(data: RaceData, h: number, now: number): boolean {
  if (now >= data.start) return false;
  const lanes = data.lanes;
  const i = lanes.findIndex((l) => l.h === h);
  if (i < 0) return false;
  const bot = data.bots.find((b) => !lanes.some((l) => l.h === b.h));
  if (!bot) return false;
  lanes[i] = { h: bot.h, taps: [], jumps: [] };
  return true;
}

/** What a player sent, as kept and told to the room: 加油 counts ([when, how many]) and 跳s (when) */
export type RaceReport = { taps: [number, number][]; jumps: number[] };

/**
 * A racer's report (body: taps [[at, n], ...], jumps [at, ...]; squadMode.ts RACE_REPORT_MS), checked against the race
 * as read (no lock: kept by one UPDATE appending to their lane, squadModes.ts runRace): their lane's place, and what
 * counts of it. Each time on the server's clock as the page has it, taken within RACE_EARLY_MS before now (else now);
 * a count rounded into 1..RACE_TAPS_MAX; those before the start or after its time dropped. Refused: no lane of theirs,
 * the race over, too early, too many at once, or not as asked.
 */
export function raceReport(data: RaceData, me: number, body: Record<string, unknown>, now: number): RaceReport & { i: number } {
  const i = data.lanes.findIndex((l) => l.h === me);
  if (i < 0) throw refuse(409, T.server.squad.notRacing);
  if (data.end) throw refuse(409, T.server.squad.raceOver);
  if (now + 50 < data.start) throw refuse(409, T.server.squad.raceNotYet);
  const taps = body.taps ?? [];
  const jumps = body.jumps ?? [];
  if (!Array.isArray(taps) || !Array.isArray(jumps) || taps.length > RACE_REPORT_TAPS || jumps.length > RACE_REPORT_JUMPS) throw refuse(400, T.server.common.badRequest);
  const when = (at: unknown) => (typeof at === "number" && Number.isFinite(at) && at >= now - RACE_EARLY_MS && at <= now + 50 ? at : now);
  const inTime = (at: number) => at >= data.start && at < data.start + RACE_MAX_MS;
  const out: RaceReport & { i: number } = { i, taps: [], jumps: [] };
  for (const cell of taps) {
    if (!Array.isArray(cell) || cell.length !== 2 || typeof cell[1] !== "number" || !Number.isFinite(cell[1])) throw refuse(400, T.server.common.badRequest);
    const at = when(cell[0]);
    if (inTime(at)) out.taps.push([at, Math.min(RACE_TAPS_MAX, Math.max(1, Math.round(cell[1])))]);
  }
  for (const j of jumps) {
    if (typeof j !== "number") throw refuse(400, T.server.common.badRequest);
    const at = when(j);
    if (inTime(at)) out.jumps.push(at);
  }
  return out;
}

/**
 * Whether the race is to be settled by now: everyone in, or its time up RACE_LATE_MS ago (the last reports in by then)
 */
export function raceDue(data: Pick<RaceData, "seed" | "start" | "lanes" | "obs" | "end">, now: number) {
  if (data.end) return false;
  const run = raceRun(data, now);
  return run.over && (run.done.every((d) => d !== null) || now >= data.start + RACE_MAX_MS + RACE_LATE_MS);
}

/**
 * The race settled once it is due by now (raceDue: all in, or its time up a moment ago), in the room's locked row
 * (data changed in place): the order, each one's time in and metres; the first, a player, with two or more players in
 * it, wears the crown RACE_CROWN_MS from its end. Says when it is to be over (its results shown), or null when it is not
 * due yet.
 */
export async function settleRace(tx: Tx, roomId: string, data: RaceData, now: number): Promise<number | null> {
  if (!raceDue(data, now)) return null;
  const run = raceRun(data, now);
  const at = data.start + run.t;
  const order = raceOrder(run);
  data.end = { at, order, times: run.done, metres: run.x.map((m) => Math.round(m * 10) / 10) };
  const players = data.lanes.filter((l) => l.h >= 0).length;
  const first = data.lanes[order[0]];
  if (first && first.h >= 0 && players >= 2 && run.done[order[0]] !== null) {
    await tx
      .update(squadMembers)
      .set({ head: CROWN, headUntil: new Date(at + RACE_CROWN_MS) })
      .where(and(eq(squadMembers.roomId, roomId), eq(squadMembers.handle, first.h), isNull(squadMembers.leftAt)));
  }
  return at + RACE_RESULT_MS;
}

// ---- its end, as it comes ----

const g = globalThis as unknown as { raceTimers?: Map<string, ReturnType<typeof setInterval>> };
const timers = (g.raceTimers ??= new Map());

/**
 * Looked at every second (by settle, which reads it without a lock and settles it, tells the room and ends it in time
 * once it is due) till it is over, in this process
 */
export function watchRace(roomId: string, data: RaceData, settle: (roomId: string) => Promise<{ over: boolean }>) {
  forgetRace(roomId);
  const last = raceLatest(data.start) + RACE_LATE_MS + 2_000;
  const t = setInterval(() => {
    if (Date.now() > last) return forgetRace(roomId);
    void settle(roomId).then(
      (r) => r.over && forgetRace(roomId),
      () => {},
    );
  }, 1_000);
  t.unref?.();
  timers.set(roomId, t);
}
/** Not looked at any more; with no room, none (the tests) */
export function forgetRace(roomId?: string) {
  for (const [id, t] of timers) {
    if (roomId !== undefined && id !== roomId) continue;
    clearInterval(t);
    timers.delete(id);
  }
}
