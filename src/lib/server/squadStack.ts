import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { T } from "@/i18n";
import { weekStartOf } from "../hotList";
import {
  STACK_BUSY_MS,
  STACK_EARLY_MS,
  STACK_EVERY_MS,
  STACK_GEAR_EVERY,
  STACK_REBUILD_MS,
  STACK_TOP,
  stackPut,
  stackShift,
  stackSwing,
  type SquadStack,
  type StackTower,
} from "../squadMode";
import { db } from "./db";
import { HttpError } from "./http";
import { squadStackBlocks, squadStackTowers } from "./schema";

/**
 * 基建加盖 on the server (the room's tower; the rules in src/lib/squadMode.ts): kept on the room (squad_rooms.stack),
 * its top blocks only. 放 by anyone in the room puts their roach where the swing is at the page's time (dropIn), the
 * tower falling when it is too far off; the next round begins by itself STACK_REBUILD_MS after (towerNow, worked out
 * as it is asked for, never by a timer). Each block counted for 基建周榜 in the same transaction (countBlock).
 * squadModes.ts stackDrop takes the 放 and tells the room with the next quarter second's (squad.ts stackInRoom).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);

/** What a 放 came to: the round and the tower's height after it, where the block went, whether it fell or sways, the swing's start after it, its time */
export type StackPut = { round: number; n: number; x: number; falls: boolean; wobbles: boolean; swingAt: number; at: number };

/**
 * 放 by the player numbered `me` at `at` (the server's clock as the page has it: taken within STACK_EARLY_MS before
 * now, else now; never before the round began nor before the top block), in the round the page has (round: refused
 * when another began meanwhile), on the tower as it is now (towerNow: changed in place). Refused while a tower that
 * fell waits to be rebuilt, or sooner than STACK_EVERY_MS after the player's last. Up to the top, the tower falls when
 * the block is too far off (stackPut); else, as it reaches each STACK_GEAR_EVERY layers, its swing goes faster from
 * where it is (stackShift).
 */
export function dropIn(tower: StackTower, me: number, body: Record<string, unknown>, now: number): StackPut {
  if (tower.fell) throw refuse(409, T.server.squad.stackRebuilding);
  if (typeof body.round === "number" && body.round !== tower.round) throw refuse(409, T.server.squad.stackNewRound);
  const last = tower.last[String(me)];
  if (last !== undefined && now - last < STACK_EVERY_MS) throw refuse(429, T.server.squad.stackSlow);
  const asked = typeof body.at === "number" && Number.isFinite(body.at) && body.at >= now - STACK_EARLY_MS && body.at <= now + 50 ? body.at : now;
  const t = Math.max(asked, tower.at, tower.top.at(-1)?.at ?? 0);
  const before = tower.n;
  // whole px, and never -0
  const x = Math.round(stackSwing(tower.swingAt, before, t)) || 0;
  const put = stackPut(tower, x);
  tower.top = [...tower.top, { h: me, x, at: t }].slice(-STACK_TOP);
  tower.n = before + 1;
  tower.sum += x;
  tower.last[String(me)] = now;
  if (put.falls) tower.fell = { at: t, height: before };
  else if (tower.n % STACK_GEAR_EVERY === 0) tower.swingAt = stackShift(tower.swingAt, before, tower.n, t);
  return { round: tower.round, n: tower.n, x, falls: put.falls, wobbles: put.wobbles, swingAt: tower.swingAt, at: t };
}

/** The tower as a room's pages have it (towerNow first): as kept, the room's highest, and those who put a block within STACK_BUSY_MS */
export function stackView(tower: StackTower, best: number, now: number): SquadStack {
  return {
    round: tower.round,
    at: tower.at,
    n: tower.n,
    sum: tower.sum,
    top: tower.top.map((b) => ({ ...b })),
    ...(tower.fell ? { fell: { ...tower.fell } } : {}),
    swingAt: tower.swingAt,
    best,
    busy: Object.entries(tower.last)
      .filter(([, at]) => at > now - STACK_BUSY_MS)
      .map(([h]) => Number(h))
      .sort((a, b) => a - b),
  };
}

/**
 * 基建周榜: a block put counted in the same transaction. A tower counts in the week of its first block that stood
 * (its row made then); in a week gone by (the tower stood past Monday 04:00), nothing more is counted. A block that
 * stood: one more of the player's on it (their first's time kept), and its height when that is its highest yet; the
 * one that made it fall is not counted.
 */
export async function countBlock(tx: Tx, roomId: string, put: StackPut, userId: string, now: number) {
  if (put.falls) return;
  const week = weekStartOf(now);
  const [row] = await tx
    .insert(squadStackTowers)
    .values({ roomId, round: put.round, week: new Date(week), peak: 0 })
    .onConflictDoUpdate({ target: [squadStackTowers.roomId, squadStackTowers.round], set: { roomId } })
    .returning({ week: squadStackTowers.week, peak: squadStackTowers.peak });
  if (!row || row.week.getTime() < week) return;
  await tx
    .insert(squadStackBlocks)
    .values({ roomId, round: put.round, userId, week: row.week, blocks: 1, firstAt: new Date(now) })
    .onConflictDoUpdate({ target: [squadStackBlocks.roomId, squadStackBlocks.round, squadStackBlocks.userId], set: { blocks: sql`${squadStackBlocks.blocks} + 1` } });
  if (put.n > row.peak) {
    await tx
      .update(squadStackTowers)
      .set({ peak: put.n, peakAt: new Date(now) })
      .where(and(eq(squadStackTowers.roomId, roomId), eq(squadStackTowers.round, put.round)));
  }
}

/** When a tower that fell at `at` is rebuilt (its next round begins) */
export const rebuiltAt = (at: number) => at + STACK_REBUILD_MS;
