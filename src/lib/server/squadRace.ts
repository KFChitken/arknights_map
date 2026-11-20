import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { T } from "@/i18n";
import { THROWS } from "../squadFire";
import {
  GIFT_SEATS,
  RACE_CROWN_MS,
  RACE_EARLY_MS,
  RACE_LEAD_MS,
  RACE_MAX_MS,
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
 * as it opens and kept on the room (squad_rooms.mode_data) with what each player did, 加油 counts and 跳s (runIn,
 * checked on the server's clock), from which the same rule (raceRun) the pages draw by says where everyone is. Once
 * all are in or its time is up, the order is settled here, the first wears a small crown, and it ends a little later
 * (settleRace). squadModes.ts opens it, takes players in and out, and ends it.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
/** 急件赛's small crown, worn as 扔东西's things are (never thrown) */
const CROWN = THROWS.find((t) => t.key === "crown")!.no;

/**
 * 企鹅物流急件赛 as it opens (now): its lanes (its opener, those who asked for the next race as they asked, the room's
 * 人机, then the mode's own), its seed and obstacles, its start RACE_LEAD_MS on
 */
export async function makeRace(roomId: string, players: readonly number[], now: number, rand: (n: number) => number): Promise<RaceData> {
  const roomBots = await roomBotsOf(db, roomId);
  const bots = modeBots(roomBots, rand);
  const hs = [...players.slice(0, GIFT_SEATS), ...roomBots.map((b) => b.h)].slice(0, GIFT_SEATS);
  for (const b of bots) if (hs.length < GIFT_SEATS) hs.push(b.h);
  const seed = rand(2 ** 31);
  return { seed, start: now + RACE_LEAD_MS, lanes: hs.map((h) => ({ h, taps: [], jumps: [] })), obs: raceObstacles(seed), bots };
}

/** As late as it could be over (its results shown), from its start: its end till it is settled */
export const raceLatest = (start: number) => start + RACE_MAX_MS + RACE_RESULT_MS;

/**
 * Before it starts, one coming in or going out (a player of the room): a lane of the mode's own 人机 theirs, or theirs
 * one of those again. Says whether it changed. Once it has started, nothing: one coming in runs the next one.
 */
export function relaneRace(data: RaceData, h: number, into: boolean, now: number): boolean {
  if (now >= data.start) return false;
  const lanes = data.lanes;
  const i = lanes.findIndex((l) => l.h === h);
  if (into && i < 0) {
    const free = lanes.findIndex((l) => data.bots.some((b) => b.h === l.h));
    if (free < 0) return false;
    lanes[free] = { h, taps: [], jumps: [] };
    return true;
  }
  if (!into && i >= 0) {
    const bot = data.bots.find((b) => !lanes.some((l) => l.h === b.h));
    if (!bot) return false;
    lanes[i] = { h: bot.h, taps: [], jumps: [] };
    return true;
  }
  return false;
}

/** What a player did, as the room is told: their 加油 count ([when, how many]) or 跳 (when) */
export type RaceDid = { h: number; tap?: [number, number]; jump?: number };

/**
 * 加油 (tap: how many since the last, RACE_TAPS_MAX at most) or 跳 (jump) by a player in a lane, at `at` (the server's
 * clock as the page has it: taken within RACE_EARLY_MS before now, else now; never before their last): refused before
 * the start, once it is over or they are in, and a 跳 while in the air. Within the transaction, the room's row locked.
 */
export function runIn(data: RaceData, me: number, body: Record<string, unknown>, now: number): RaceDid {
  const i = data.lanes.findIndex((l) => l.h === me);
  if (i < 0) throw refuse(409, T.server.squad.notRacing);
  if (data.end) throw refuse(409, T.server.squad.raceOver);
  const lane = data.lanes[i];
  const asked = typeof body.at === "number" && Number.isFinite(body.at) && body.at >= now - RACE_EARLY_MS && body.at <= now + 50 ? body.at : now;
  if (asked < data.start) throw refuse(409, T.server.squad.raceNotYet);
  const jump = body.jump === true;
  const t = Math.max(asked, ...(jump ? lane.jumps : lane.taps.map(([at]) => at)));
  if (t >= data.start + RACE_MAX_MS) throw refuse(409, T.server.squad.raceOver);
  const run = raceRun(data, t);
  if (run.over) throw refuse(409, T.server.squad.raceOver);
  if (run.done[i] !== null) throw refuse(409, T.server.squad.raceIn);
  if (jump) {
    if (run.air[i]) throw refuse(409, T.server.squad.inAir);
    lane.jumps.push(t);
    return { h: me, jump: t };
  }
  const n = typeof body.tap === "number" && Number.isInteger(body.tap) ? Math.min(RACE_TAPS_MAX, Math.max(1, body.tap)) : 1;
  lane.taps.push([t, n]);
  return { h: me, tap: [t, n] };
}

/**
 * The race settled once it is over by now (all in, or its time up), in the room's locked row (data changed in place):
 * the order, each one's time in and metres; the first, a player, with two or more players in it, wears the crown
 * RACE_CROWN_MS from its end. Says when it is to be over (its results shown), or null when it is not over yet.
 */
export async function settleRace(tx: Tx, roomId: string, data: RaceData, now: number): Promise<number | null> {
  if (data.end) return null;
  const run = raceRun(data, now);
  if (!run.over) return null;
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

/** Looked at every half second (by settle, which settles it, tells the room and ends it in time) till it is over, in this process */
export function watchRace(roomId: string, data: RaceData, settle: (roomId: string) => Promise<{ over: boolean }>) {
  forgetRace(roomId);
  const last = raceLatest(data.start) + 2_000;
  const t = setInterval(() => {
    if (Date.now() > last) return forgetRace(roomId);
    void settle(roomId).then(
      (r) => r.over && forgetRace(roomId),
      () => {},
    );
  }, 500);
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
