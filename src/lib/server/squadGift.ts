import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { T } from "@/i18n";
import { ROACH_AVATARS, ROACH_COLORS } from "../types";
import { THROWS } from "../squadFire";
import {
  GIFT_BOT_FROM,
  GIFT_EARLY_MS,
  GIFT_LADLE_MS,
  GIFT_ROUND_MAX_MS,
  GIFT_ROUND_MIN_MS,
  GIFT_ROUNDS,
  GIFT_SEATS,
  giftAt,
  giftLatest,
  giftPlan,
  giftSeats,
  type GiftBot,
  type GiftData,
  type GiftRound,
} from "../squadMode";
import { db } from "./db";
import { HttpError } from "./http";
import { squadBots, squadMembers, squadRooms } from "./schema";

/**
 * W 的礼物 on the server (玩点什么; the rules in src/lib/squadMode.ts): its rounds' times decided as it opens, kept on
 * the room (squad_rooms.mode_data) with who sits where and the passes players made, a round's stop never sent before it
 * comes. Where the gift is follows from those alone (giftAt), so nothing runs while it goes round: a 传 is checked
 * against it and kept (passGift); as a round's song stops (a timer in the process that opened it, the sweep, or the
 * next 传), the one holding it is hit, wears 漏勺 (two or more players in it), and the next round is seated
 * (settleGift). squadModes.ts opens it, takes players in and out, and ends it.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const refuse = (status: number, message: string, code?: string) => new HttpError(status, message, code);
/** 漏勺, as 扔东西 puts it on a head */
const LADLE = THROWS.find((t) => t.key === "ladle")!.no;
/** The looks the mode's own 人机 come in (鸭爵 is a thanks, never theirs) */
const BOT_LOOKS = ROACH_AVATARS.filter((a) => a !== "duck");

/** The room's own 人机 now, by number, in the order they came */
async function roomBotsOf(exec: Tx | typeof db, roomId: string): Promise<{ h: number; no: number }[]> {
  return exec
    .select({ h: squadBots.handle, no: squadBots.no })
    .from(squadBots)
    .where(and(eq(squadBots.roomId, roomId), isNull(squadBots.goneAt)))
    .orderBy(asc(squadBots.addedAt));
}

/** Those playing it now (not 人机), as they came (each one's coming kept in mode_tap_at) */
async function playersOf(exec: Tx | typeof db, roomId: string): Promise<number[]> {
  const rows = await exec
    .select({ h: squadMembers.handle, at: squadMembers.modeTapAt })
    .from(squadMembers)
    .where(and(eq(squadMembers.roomId, roomId), isNull(squadMembers.leftAt), eq(squadMembers.modeIn, true)));
  return rows.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) || a.h - b.h).map((r) => r.h);
}

/**
 * W 的礼物 as it opens (at now): its five rounds' times, GIFT_ROUND_MIN_MS–GIFT_ROUND_MAX_MS each; its seed; the
 * mode's own 人机 (numbered after the room's, enough for every seat but its opener's); the first round seated, from
 * its opener.
 */
export async function makeGift(roomId: string, opener: number, now: number, rand: (n: number) => number): Promise<GiftData> {
  const lens = Array.from({ length: GIFT_ROUNDS }, () => GIFT_ROUND_MIN_MS + rand(GIFT_ROUND_MAX_MS - GIFT_ROUND_MIN_MS + 1));
  const plan = giftPlan(now, lens);
  const roomBots = await roomBotsOf(db, roomId);
  const used = new Set(roomBots.map((b) => b.no));
  const bots: GiftBot[] = [];
  for (let no = 1; bots.length < GIFT_SEATS - 1; no++) {
    if (used.has(no)) continue;
    bots.push({ h: GIFT_BOT_FROM - bots.length, no, avatar: BOT_LOOKS[rand(BOT_LOOKS.length)], color: ROACH_COLORS[rand(ROACH_COLORS.length)] });
  }
  const seats = giftSeats(
    [],
    [opener],
    roomBots.map((b) => b.h),
    bots.map((b) => b.h),
  );
  return { seed: rand(2 ** 31), plan, rounds: [{ at: plan[0].at, seats, from: 0, taps: [] }], bots };
}

/**
 * The rounds as the room's pages have them: those begun or seated, each with its stop and the seat hit once its song
 * has stopped (worked out from the passes when it is not settled yet)
 */
export function giftView(data: GiftData, now: number): GiftRound[] {
  return data.rounds.map((r, i) => {
    const stop = data.plan[i].stop;
    if (stop > now) return { ...r, taps: [...r.taps] };
    return { ...r, taps: [...r.taps], stop, hit: r.hit ?? giftAt(r, data.seed, i, stop).seat };
  });
}

/** As late as the pages are told it may go on: its true end once its last round's song has stopped, else as late as it could */
export const giftShownUntil = (data: GiftData, until: number, now: number) => (data.plan.at(-1)!.stop <= now ? until : giftLatest(data.plan[0].at));

/**
 * The rounds whose song has stopped by now settled, in the room's locked row (data changed in place): each hit seat,
 * its player (still in it) hit once more and, with two or more playing, wearing 漏勺 GIFT_LADLE_MS from the stop; the
 * next round seated (players as they are now, from the one hit). Says whether anything changed, and whether no one
 * plays it any more (it should end).
 */
export async function settleGift(tx: Tx, roomId: string, data: GiftData, now: number): Promise<{ changed: boolean; empty: boolean }> {
  let changed = false;
  let empty = false;
  for (let r = 0; r < data.rounds.length; r++) {
    const round = data.rounds[r];
    const stop = data.plan[r].stop;
    if (round.hit !== undefined || stop > now) continue;
    const hit = giftAt(round, data.seed, r, stop).seat;
    round.hit = hit;
    changed = true;
    const h = round.seats[hit];
    const players = await playersOf(tx, roomId);
    if (h >= 0 && players.includes(h)) {
      const mine = and(eq(squadMembers.roomId, roomId), eq(squadMembers.handle, h), isNull(squadMembers.leftAt));
      const [row] = await tx.select({ combo: squadMembers.modeCombo }).from(squadMembers).where(mine);
      await tx
        .update(squadMembers)
        .set({
          modeCombo: (row?.combo ?? 0) + 1,
          ...(players.length >= 2 ? { head: LADLE, headUntil: new Date(stop + GIFT_LADLE_MS) } : {}),
        })
        .where(mine);
    }
    if (!players.length) {
      empty = true;
      break;
    }
    if (r + 1 < GIFT_ROUNDS && data.rounds.length === r + 1) {
      const roomBots = (await roomBotsOf(tx, roomId)).map((b) => b.h);
      const seats = giftSeats(
        round.seats,
        players,
        roomBots,
        data.bots.map((b) => b.h),
      );
      const from = seats.indexOf(h);
      data.rounds.push({ at: data.plan[r + 1].at, seats, from: from >= 0 ? from : hit, taps: [] });
    }
  }
  return { changed, empty };
}

/**
 * One coming in or going out (a player of the room): the next round, while it has not started, seated again as the
 * players are now. Within the transaction that changed them, the room's row locked. Says whether it changed.
 */
export async function reseatGift(tx: Tx, roomId: string, data: GiftData, now: number): Promise<boolean> {
  const r = data.rounds.length - 1;
  const next = data.rounds[r];
  if (!next || next.at <= now || next.hit !== undefined) return false;
  const players = await playersOf(tx, roomId);
  const roomBots = (await roomBotsOf(tx, roomId)).map((b) => b.h);
  const seats = giftSeats(
    next.seats,
    players,
    roomBots,
    data.bots.map((b) => b.h),
  );
  if (seats.every((h, i) => h === next.seats[i])) return false;
  const from = next.seats[next.from];
  data.rounds[r] = { ...next, seats, from: Math.max(0, seats.indexOf(from)) };
  return true;
}

/**
 * 传: the gift, held by the player now (at `at`, the server's clock as the page has it: taken within GIFT_EARLY_MS
 * before now, else now; never before the round's last pass), on to the next seat. Refused when the round's song has
 * stopped, the player is not in it, or the gift is not in their hands. Within the transaction, the room's row locked.
 */
export function passIn(data: GiftData, me: number, asked: unknown, now: number): { round: number; at: number } {
  const t0 = typeof asked === "number" && Number.isFinite(asked) && asked >= now - GIFT_EARLY_MS && asked <= now + 50 ? asked : now;
  const r = data.rounds.findLastIndex((x) => x.at <= t0);
  const round = r >= 0 ? data.rounds[r] : undefined;
  if (!round) throw refuse(409, T.server.squad.giftNotYet);
  if (round.hit !== undefined || data.plan[r].stop <= t0) throw refuse(409, T.server.squad.giftStopped);
  const t = Math.max(t0, ...round.taps.map((x) => x.at));
  if (data.plan[r].stop <= t) throw refuse(409, T.server.squad.giftStopped);
  const held = giftAt(round, data.seed, r, t);
  if (round.seats[held.seat] !== me) throw refuse(409, T.server.squad.notHolding);
  round.taps.push({ at: t, seat: held.seat });
  return { round: r, at: t };
}

// ---- the stops, as they come ----

const g = globalThis as unknown as { giftTimers?: Map<string, ReturnType<typeof setTimeout>[]> };
const timers = (g.giftTimers ??= new Map());

/** Each of its rounds' stops looked at as it comes (by settle, which settles and tells the room), in this process */
export function watchGift(roomId: string, data: GiftData, settle: (roomId: string) => Promise<unknown>, now = Date.now()) {
  forgetGift(roomId);
  timers.set(
    roomId,
    data.plan.map((p) => {
      const t = setTimeout(() => void settle(roomId).catch(() => {}), Math.max(0, p.stop - now) + 30);
      t.unref?.();
      return t;
    }),
  );
}
/** Its stops not looked at any more (it ended); with no room, none of any (the tests) */
export function forgetGift(roomId?: string) {
  for (const [id, list] of timers) {
    if (roomId !== undefined && id !== roomId) continue;
    list.forEach((t: ReturnType<typeof setTimeout>) => clearTimeout(t));
    timers.delete(id);
  }
}

/** The rooms playing W 的礼物 now, for the sweep */
export async function giftRooms(): Promise<string[]> {
  const rows = await db
    .select({ id: squadRooms.id })
    .from(squadRooms)
    .where(and(isNull(squadRooms.endedAt), eq(squadRooms.mode, "gift")));
  return rows.map((r) => r.id);
}
