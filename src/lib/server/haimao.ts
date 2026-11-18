import "server-only";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { T } from "@/i18n";
import { addLove, HAIMAO, HAIMAO_BOLD_LOVE, HAIMAO_LIFT_FROM, HAIMAO_LIFT_ONE_IN, HAIMAO_LOVE_MAX, haimaoRoach } from "../haimao";
import { WorldError, type HaimaoItem, type HaimaoMe, type TouchResult } from "../world/types";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { haimaoMode } from "./env";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, lockPlayer, type Exec, type GuideRow, type GuideTable } from "./guides";
import { haimaoPlayers, haimaoSpins, haimaoTouches, users, type UserRow } from "./schema";

/**
 * 香艳制作人 on the server (src/lib/haimao.ts): her answers to each player's touches, kept in
 * haimao_touches, and what she keeps of each player in haimao_players, her 好感度 first. She shows only
 * to those HAIMAO lets her (haimaoOpen): to anyone else she is not there, and touching her is refused.
 */

// her table has exactly the columns every guide's has (schema.ts)
const her = guideTouches(HAIMAO, haimaoTouches as unknown as GuideTable);

/** Whether she shows to this player: HAIMAO=on, everyone; admins, the 站长 and the admins; off, nobody */
export function haimaoOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = haimaoMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/** Whether she shows to the player with this id */
async function openTo(userId: string) {
  const [u] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, userId));
  return Boolean(u && haimaoOpen(u));
}

/** Refuses whatever is done with her by a player she does not show to, as though she were not there */
async function mustBeOpen(userId: string) {
  if (!(await openTo(userId))) throw new WorldError(T.server.haimao.notHere);
}

const LINES: HaimaoItem["line"][] = ["touch", "friend", "plus", "lift"];

function toItem(r: GuideRow, replied: boolean): HaimaoItem {
  return {
    kind: "haimao",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    line: LINES.find((l) => l === r.kind) ?? "touch",
    bold: r.bold,
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

/** Her row for this player, made the first time anything needs it; within a transaction that holds lockPlayer */
export async function haimaoRow(tx: Exec, userId: string) {
  await tx.insert(haimaoPlayers).values({ userId }).onConflictDoNothing();
  const [row] = await tx.select().from(haimaoPlayers).where(eq(haimaoPlayers.userId, userId));
  return row;
}

/**
 * How she answers a touch: the one that makes them 触须之交 (friend); the day's first bold one while her
 * 好感度 can still go up (plus); now and then past HAIMAO_LIFT_FROM, and to any bold touch that raises
 * nothing, her line about the lift; otherwise her line to a sneaky touch.
 */
export function answerKind(t: { bold: boolean; newFriend: boolean; raises: boolean; love: number; roll: number }): HaimaoItem["line"] {
  if (t.newFriend) return "friend";
  if (t.raises) return "plus";
  if (t.love > HAIMAO_LIFT_FROM && (t.bold || t.roll === 0)) return "lift";
  return "touch";
}

/**
 * The player touches her, maybe answering one of hers. Their first bold touch of a day raises her 好感度
 * by HAIMAO_BOLD_LOVE (until it is full) and is always answered, as is the one that makes them 触须之交;
 * otherwise she answers the first touch of their day, the rest of the day not.
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin?: unknown): Promise<TouchResult> {
  await mustBeOpen(userId);
  await her.allow(userId);
  const day = deviceDay(offsetMin);
  let done: { id: string | null; friend: boolean; kind: HaimaoItem["line"]; love: number; plus: boolean };
  try {
    done = await db.transaction(async (tx) => {
      await lockPlayer(tx, userId);
      const [u] = await tx.select({ friendSince: users.haimaoFriendSince }).from(users).where(eq(users.id, userId));
      const p = await haimaoRow(tx, userId);
      const friend = bold && !u.friendSince;
      if (friend) await tx.update(users).set({ haimaoFriendSince: new Date() }).where(eq(users.id, userId));
      const raises = bold && p.plusOn !== day.day && p.love < HAIMAO_LOVE_MAX;
      const love = raises ? addLove(p.love, HAIMAO_BOLD_LOVE) : p.love;
      if (raises) await tx.update(haimaoPlayers).set({ love, plusOn: day.day }).where(eq(haimaoPlayers.userId, userId));
      const kind = answerKind({ bold, newFriend: friend, raises, love, roll: randomInt(HAIMAO_LIFT_ONE_IN) });
      const answer = await her.pair(tx, userId, {
        bold,
        replyTo,
        dayStart: new Date(day.start),
        kind,
        always: friend || raises,
      });
      return { id: answer?.id ?? null, friend, kind, love, plus: raises };
    });
  } catch (e) {
    // two answers to the same one of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError(T.server.common.touched);
    throw e;
  }
  return {
    newFriend: done.friend ? HAIMAO.name : null,
    guide: {
      id: HAIMAO.id,
      itemId: done.id && her.itemId(done.id),
      bold,
      kind: done.friend ? "friend" : "touch",
      times: null,
      others: null,
      line: null,
    },
    haimao: { answer: done.id ? done.kind : null, love: done.love, plus: done.plus },
  };
}

export const touchHaimao = (userId: string, bold: boolean, offsetMin?: unknown) => touchBack(userId, bold, null, offsetMin);

/** Touch back one of hers, once; it counts as touching her, her 好感度 and all. */
export async function replyHaimao(userId: string, itemId: string, bold: boolean, offsetMin?: unknown) {
  await mustBeOpen(userId);
  const item = await her.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id, offsetMin);
}

export const ignoreHaimao = (userId: string, itemId: string) => her.ignore(userId, itemId);

export const seeHaimao = (userId: string, itemIds: string[]) => her.see(userId, itemIds);

/** Her latest to the player, for the inbox; none while she does not show to them. */
export async function haimaoInbox(userId: string): Promise<HaimaoItem[]> {
  if (!(await openTo(userId))) return [];
  return (await her.latest(userId)).map(({ row, replied }) => toItem(row, replied));
}

/** Her place among the 触须之交, last, while she shows to them. */
export const haimaoFriend = (u: Pick<UserRow, "id" | "email" | "haimaoFriendSince">) =>
  u.haimaoFriendSince && haimaoOpen(u) ? guideFriend(HAIMAO, u.haimaoFriendSince, [haimaoRoach(true)]) : null;

/** 解除: only that; her 好感度 stays. A bold touch makes them 触须之交 again. */
export async function unfriendHaimao(userId: string) {
  await db.update(users).set({ haimaoFriendSince: null }).where(eq(users.id, userId));
}

/** What me() says about her: nothing for a player she does not show to. */
export async function haimaoOf(u: Pick<UserRow, "id" | "email" | "haimaoFriendSince">, offsetMin?: unknown): Promise<HaimaoMe | undefined> {
  if (!haimaoOpen(u)) return undefined;
  const [p] = await db.select({ love: haimaoPlayers.love, plusOn: haimaoPlayers.plusOn }).from(haimaoPlayers).where(eq(haimaoPlayers.userId, u.id));
  return {
    friend: Boolean(u.haimaoFriendSince),
    love: p?.love ?? 0,
    plusToday: p?.plusOn === deviceDay(offsetMin).day,
  };
}

/** 清掉我和香艳制作人的记录 (local testing only): as if they had never met her. */
export async function forgetHaimao(userId: string) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ haimaoFriendSince: null }).where(eq(users.id, userId));
    await tx.delete(haimaoTouches).where(eq(haimaoTouches.userId, userId));
    await tx.delete(haimaoPlayers).where(eq(haimaoPlayers.userId, userId));
    await tx.delete(haimaoSpins).where(eq(haimaoSpins.userId, userId));
  });
}
