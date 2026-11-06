import "server-only";
import { and, desc, eq, gte, isNotNull, isNull, lt, or } from "drizzle-orm";
import { AMIYA, amiyaRoach } from "../amiya";
import { WorldError, type InboxItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, type GuideRow } from "./guides";
import { asideFromAmiya } from "./perlica";
import { amiyaTouches, users, type UserRow } from "./schema";

/**
 * 阿米娅向导 on the server (src/lib/amiya.ts): her touches with each player and
 * her daily greeting, kept in amiya_touches. What she shares with the other
 * guides is in guides.ts.
 */

export { deviceDay };

type AmiyaItem = Extract<InboxItem, { kind: "amiya" }>;

const her = guideTouches(AMIYA, amiyaTouches);

/**
 * The player touches her, maybe answering one of her touches: she touches back the same
 * way at once, and bold makes them 触须之交. When they touched 佩丽卡监督 today too, she
 * may say something as well (offsetMin: the device's time zone, for which day it is).
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin: unknown): Promise<TouchResult> {
  await her.allow(userId);
  let answer: { id: string };
  let aside: TouchResult["aside"] | null = null;
  try {
    answer = await db.transaction(async (tx) => {
      const row = await her.pair(tx, userId, bold, replyTo);
      aside = await asideFromAmiya(tx, userId, offsetMin);
      return row;
    });
  } catch (e) {
    // two answers to the same touch of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError("已经碰过 TA 了。");
    throw e;
  }
  const made = bold
    ? await db
        .update(users)
        .set({ amiyaFriendSince: new Date() })
        .where(and(eq(users.id, userId), isNull(users.amiyaFriendSince)))
        .returning({ id: users.id })
    : [];
  return {
    newFriend: made.length ? AMIYA.name : null,
    guide: { id: AMIYA.id, itemId: her.itemId(answer.id), bold, kind: "touch", times: null, others: null, line: null },
    ...(aside ? { aside } : {}),
  };
}

export const touchAmiya = (userId: string, bold: boolean, offsetMin?: unknown) => touchBack(userId, bold, null, offsetMin);

/** Touch back one of her touches, once. */
export async function replyAmiya(userId: string, itemId: string, bold: boolean, offsetMin?: unknown) {
  const item = await her.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id, offsetMin);
}

/** 默默爬走 from one of her touches. */
export const ignoreAmiya = (userId: string, itemId: string) => her.ignore(userId, itemId);

export const seeAmiya = (userId: string, itemIds: string[]) => her.see(userId, itemIds);

function toItem(r: GuideRow, replied: boolean): AmiyaItem {
  return {
    kind: "amiya",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    bold: r.bold,
    greet: r.kind === "greet",
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

/** Her latest touches to the player, for the inbox. */
export async function amiyaInbox(userId: string): Promise<AmiyaItem[]> {
  return (await her.latest(userId)).map(({ row, replied }) => toItem(row, replied));
}

/**
 * Her greeting of the day: once a day by the player's device clock (from 04:00),
 * from the day after they became 触须之交, drunk or not. One conditional update
 * claims the day, so two pages opening at once still get a single greeting.
 * Returns today's greeting while it is unseen.
 */
export async function greetAmiya(u: Pick<UserRow, "id" | "amiyaFriendSince">, offsetMin: unknown, now = Date.now()) {
  if (!u.amiyaFriendSince) return null;
  const { day, start } = deviceDay(offsetMin, now);
  if (u.amiyaFriendSince.getTime() < start) {
    const [claimed] = await db
      .update(users)
      .set({ amiyaGreetedOn: day })
      .where(
        and(
          eq(users.id, u.id),
          isNotNull(users.amiyaFriendSince),
          or(isNull(users.amiyaGreetedOn), lt(users.amiyaGreetedOn, day)),
        ),
      )
      .returning({ id: users.id });
    if (claimed) {
      await db
        .insert(amiyaTouches)
        .values({ userId: u.id, direction: her.from, kind: "greet", bold: false, createdAt: new Date(now) });
    }
  }
  const [today] = await db
    .select()
    .from(amiyaTouches)
    .where(
      and(
        eq(amiyaTouches.userId, u.id),
        eq(amiyaTouches.kind, "greet"),
        isNull(amiyaTouches.seenAt),
        gte(amiyaTouches.createdAt, new Date(start)),
      ),
    )
    .orderBy(desc(amiyaTouches.createdAt))
    .limit(1);
  return today ? toItem(today, (await her.answered(u.id, [today.id])).size > 0) : null;
}

/** Her place at the top of the 触须之交 list. */
export const amiyaFriend = (since: Date) => guideFriend(AMIYA, since, [amiyaRoach(true)]);

/** 解除: the greetings stop; a bold touch makes them 触须之交 again. */
export async function unfriendAmiya(userId: string) {
  await db.update(users).set({ amiyaFriendSince: null }).where(eq(users.id, userId));
}
