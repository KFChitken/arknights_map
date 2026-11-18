import "server-only";
import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { T } from "@/i18n";
import { addLove, HAIMAO, HAIMAO_BOLD_LOVE, HAIMAO_LIFT_FROM, HAIMAO_LIFT_ONE_IN, HAIMAO_LOVE_MAX, haimaoRoach } from "../haimao";
import { answerLove, HAIMAO_BADGE, HAIMAO_DAYS, type HaimaoStep, type HaimaoStory, type HaimaoToday } from "../haimaoStory";
import { WorldError, type HaimaoItem, type HaimaoMe, type TouchResult } from "../world/types";
import { isModHere, isOwnerEmail } from "./admins";
import { award } from "./badges";
import { db } from "./db";
import { haimaoMode } from "./env";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, lockPlayer, type Exec, type GuideRow, type GuideTable } from "./guides";
import { haimaoPlayers, haimaoSpins, haimaoTouches, userBadges, users, type UserRow } from "./schema";

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
  const [p] = await db
    .select({ love: haimaoPlayers.love, plusOn: haimaoPlayers.plusOn, days: haimaoPlayers.days })
    .from(haimaoPlayers)
    .where(eq(haimaoPlayers.userId, u.id));
  return {
    friend: Boolean(u.haimaoFriendSince),
    love: p?.love ?? 0,
    plusToday: p?.plusOn === deviceDay(offsetMin).day,
    days: p?.days ?? 0,
  };
}

// ---- 今日剧情: her story (src/lib/haimaoStory.ts) ----

type PlayerRow = typeof haimaoPlayers.$inferSelect;

/**
 * What today holds for a player, by their row and their device day: after ALL END, ALL END itself on its own day,
 * then their line of the day (chats counts the lines heard, chat_on the day of the latest; a day not looked at yet
 * holds the next one); before it, their scene of the day, the twelfth's waiting for ALL END on any day.
 */
export function todayOf(p: Pick<PlayerRow, "days" | "dayOn" | "picks" | "endAt" | "chats" | "chatOn">, day: string): HaimaoToday {
  if (p.endAt) {
    if (p.chatOn !== day) return { kind: "chat", line: p.chats };
    return p.chats > 0 ? { kind: "chat", line: p.chats - 1 } : { kind: "end" };
  }
  const seenToday = p.days > 0 && (p.dayOn === day || p.days >= HAIMAO_DAYS);
  if (seenToday) return { kind: "scene", day: p.days, picked: p.picks[p.days - 1] ?? null };
  return { kind: "scene", day: p.days + 1, picked: null };
}

const storyOf = (p: PlayerRow, day: string): HaimaoStory => ({
  love: p.love,
  days: p.days,
  picks: p.picks.slice(0, p.days),
  end: Boolean(p.endAt),
  today: todayOf(p, day),
});

/** One of the player's story moves, on their row locked until it is done (lockPlayer, as their touches take it) */
async function withPlayer<R>(userId: string, fn: (tx: Exec, p: PlayerRow) => Promise<R>) {
  return db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    return fn(tx, await haimaoRow(tx, userId));
  });
}

const setPlayer = async (tx: Exec, userId: string, values: Partial<PlayerRow>) =>
  (await tx.update(haimaoPlayers).set(values).where(eq(haimaoPlayers.userId, userId)).returning())[0];

/**
 * 今日剧情 opened: what today holds. After ALL END, the day's first look moves their line on to the next, which the
 * day then keeps; the badge is looked to as well, in case giving it failed when ALL END was seen.
 */
export async function openStory(userId: string, offsetMin?: unknown): Promise<HaimaoStory> {
  await mustBeOpen(userId);
  const { day } = deviceDay(offsetMin);
  const p = await withPlayer(userId, (tx, p) =>
    p.endAt && p.chatOn !== day ? setPlayer(tx, userId, { chats: p.chats + 1, chatOn: day }) : Promise.resolve(p),
  );
  if (p.endAt) await award(userId, [HAIMAO_BADGE]);
  return storyOf(p, day);
}

/**
 * Their answer (0–2) to day n's scene: kept, with the 好感度 it brings (src/lib/haimaoStory.ts answerLove), only when
 * that is the scene today holds and it is not answered yet; anything else (a second tap, a page left open from
 * yesterday) changes nothing, and is told how things stand.
 */
export async function pickStory(userId: string, n: unknown, k: unknown, offsetMin?: unknown): Promise<HaimaoStep> {
  await mustBeOpen(userId);
  const day = Number(n);
  const pick = Number(k);
  if (!Number.isInteger(day) || day < 1 || day > HAIMAO_DAYS || !Number.isInteger(pick) || pick < 0 || pick > 2) {
    throw new WorldError(T.server.common.badRequest);
  }
  const today = deviceDay(offsetMin).day;
  return withPlayer(userId, async (tx, p) => {
    const now = todayOf(p, today);
    if (now.kind !== "scene" || now.day !== day || now.picked !== null) return { ...storyOf(p, today), plus: 0 };
    const love = addLove(p.love, answerLove(day, pick));
    const q = await setPlayer(tx, userId, { love, days: day, dayOn: today, picks: [...p.picks.slice(0, day - 1), pick] });
    return { ...storyOf(q, today), plus: love - p.love };
  });
}

/**
 * ALL END, once the twelfth scene is answered, on that day or any after: her 好感度 to the top, the day theirs for it
 * (their lines of a day start the next), and the badge 被海猫 all 了. Once; asked again, it changes nothing.
 */
export async function endStory(userId: string, offsetMin?: unknown): Promise<HaimaoStep> {
  await mustBeOpen(userId);
  const today = deviceDay(offsetMin).day;
  const { p, plus } = await withPlayer(userId, async (tx, p) => {
    if (p.endAt || p.days < HAIMAO_DAYS) return { p, plus: 0 };
    const q = await setPlayer(tx, userId, { love: HAIMAO_LOVE_MAX, endAt: new Date(), chats: 0, chatOn: today });
    return { p: q, plus: HAIMAO_LOVE_MAX - p.love };
  });
  if (p.endAt) await award(userId, [HAIMAO_BADGE]);
  return { ...storyOf(p, today), plus };
}

/** 清掉我和香艳制作人的记录 (local testing only): as if they had never met her, her badge gone too. */
export async function forgetHaimao(userId: string) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ haimaoFriendSince: null }).where(eq(users.id, userId));
    await tx.delete(haimaoTouches).where(eq(haimaoTouches.userId, userId));
    await tx.delete(haimaoPlayers).where(eq(haimaoPlayers.userId, userId));
    await tx.delete(haimaoSpins).where(eq(haimaoSpins.userId, userId));
    await tx.delete(userBadges).where(and(eq(userBadges.userId, userId), eq(userBadges.badge, HAIMAO_BADGE)));
  });
}
