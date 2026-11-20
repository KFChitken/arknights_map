import "server-only";
import { T } from "@/i18n";
import { woodAfter } from "../squadFire";
import {
  STACK_EARLY_MS,
  STACK_EVERY_MS,
  STACK_HAND_EVERY_MS,
  STACK_HAND_MAX,
  stackHand,
  stackHeight,
  stackPut,
  stackSwing,
  type StackData,
  type StackMode,
} from "../squadMode";
import { HttpError } from "./http";

/**
 * 基建加盖 on the server (玩点什么; the rules in src/lib/squadMode.ts): its tower and each one's hand kept on the room
 * (squad_rooms.mode_data). 放 puts the player's roach where the swing is at the page's time (dropIn), the tower falling
 * when it is too far off; 再来一轮 begins the next round once it fell (againIn). squadModes.ts opens it, takes players
 * in and out, keeps the room's highest (squad_rooms.stack_best) and ends it a minute after the last block.
 */

const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);

/** 基建加盖 as it opens (now): round 1, no blocks, each one's hand full as they first put one */
export const makeStack = (now: number): StackData => ({ round: 1, at: now, blocks: [], hands: {} });

/** What a 放 came to: where the block went (px from the base's middle), whether the tower fell or sways, how high it stands */
export type StackPut = { x: number; falls: boolean; wobbles: boolean; height: number };

/**
 * 放 by the player numbered `me` (in it) at `at` (the server's clock as the page has it: taken within STACK_EARLY_MS
 * before now, else now), in the round the page has (round: refused when another began meanwhile): refused once the
 * tower fell, sooner than STACK_EVERY_MS after their last (the server's clock), or with an empty hand. The block goes
 * where the swing is at that time; the tower falls when it is too far off (squadMode.ts stackPut). In the room's locked
 * row (data changed in place).
 */
export function dropIn(data: StackData, me: number, body: Record<string, unknown>, now: number): StackPut {
  if (typeof body.round === "number" && body.round !== data.round) throw refuse(409, T.server.squad.stackNewRound);
  if (data.fell) throw refuse(409, T.server.squad.stackFell);
  const kept = data.hands[String(me)];
  if (kept && now - kept.last < STACK_EVERY_MS) throw refuse(429, T.server.squad.stackSlow);
  if (stackHand(kept, now).n < 1) throw refuse(409, T.server.squad.stackEmpty);
  const asked = typeof body.at === "number" && Number.isFinite(body.at) && body.at >= now - STACK_EARLY_MS && body.at <= now + 50 ? body.at : now;
  const t = Math.max(asked, data.at);
  // whole px, and never -0
  const x = Math.round(stackSwing(data.at, t)) || 0;
  const put = stackPut(data.blocks, x);
  data.blocks.push({ h: me, x, at: t });
  const after = woodAfter(kept?.n ?? STACK_HAND_MAX, kept?.at ?? null, now, STACK_HAND_MAX, STACK_HAND_EVERY_MS);
  data.hands[String(me)] = { n: after.wood, at: after.at, last: now };
  if (put.falls) data.fell = { at: t, height: data.blocks.length - 1 };
  return { x, falls: put.falls, wobbles: put.wobbles, height: stackHeight(data) };
}

/**
 * 再来一轮 (in the round the page has): the next round from now, once the tower fell. Says whether it began; one asked
 * for a round already over (another began it first) is nothing. Refused while the tower stands.
 */
export function againIn(data: StackData, body: Record<string, unknown>, now: number): boolean {
  if (typeof body.round === "number" && body.round < data.round) return false;
  if (!data.fell) throw refuse(409, T.server.squad.stackStanding);
  data.round += 1;
  data.at = now;
  data.blocks = [];
  delete data.fell;
  return true;
}

/** 基建加盖 as a page has it (the rest of the mode's view given): the tower, the room's highest, and the viewer's hand while they have one */
export function stackView(data: StackData, best: number, viewer: number): Pick<StackMode, "round" | "roundAt" | "blocks" | "fell" | "best" | "hand"> {
  const hand = data.hands[String(viewer)];
  return {
    round: data.round,
    roundAt: data.at,
    blocks: data.blocks.map((b) => ({ ...b })),
    ...(data.fell ? { fell: { ...data.fell } } : {}),
    best,
    ...(hand ? { hand: { n: hand.n, at: hand.at } } : {}),
  };
}
