import "server-only";
import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { AMIYA_ID, AMIYA_NAME, AMIYA_PROFILE, AMIYA_TOUCHES_PER_DAY, amiyaRoach, isAmiyaItem } from "../amiya";
import { INBOX_DAYS } from "../rules";
import { DAY, HOUR } from "../world/logic";
import { WorldError, type Friend, type InboxItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { amiyaTouches, users, type UserRow } from "./schema";

/**
 * 阿米娅向导 on the server (src/lib/amiya.ts): her touches with each player and
 * her daily greeting, kept in amiya_touches, which only that player ever reads.
 * None of it counts towards anything between players: the touch quota,
 * 触须之交 badges, the radar or the admin's numbers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Her latest touches the inbox shows, so she never floods it */
const SHOWN = 5;
const MAX_OFFSET_MIN = 14 * 60;

type AmiyaItem = Extract<InboxItem, { kind: "amiya" }>;

/**
 * The player's day by their device's clock, turning at 04:00 like the games' daily
 * reset: its date, and the moment it began. offsetMin is the device's
 * Date.getTimezoneOffset(), kept within ±14 hours and never stored; Beijing time without one.
 */
export function deviceDay(offsetMin: unknown, now = Date.now()) {
  const n = Number(offsetMin);
  const offset = Number.isFinite(n) ? Math.max(-MAX_OFFSET_MIN, Math.min(MAX_OFFSET_MIN, Math.round(n))) : -480;
  const shift = -offset * 60_000;
  const day = new Date(now + shift - 4 * HOUR).toISOString().slice(0, 10);
  return { day, start: Date.parse(`${day}T04:00:00Z`) - shift };
}

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: unknown } | null;
  return err?.code === "23505" || (err?.cause !== undefined && isUniqueViolation(err.cause));
};

/** The player touches her, maybe answering one of her touches: she touches back the same way at once, and bold makes them 触须之交. */
async function touchBack(userId: string, bold: boolean, replyTo: string | null): Promise<TouchResult> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(amiyaTouches)
    .where(
      and(
        eq(amiyaTouches.userId, userId),
        eq(amiyaTouches.direction, "to_amiya"),
        gt(amiyaTouches.createdAt, new Date(Date.now() - DAY)),
      ),
    );
  if (n >= AMIYA_TOUCHES_PER_DAY) throw new WorldError("今天跟阿米娅碰得够多啦，明天再来吧。");
  let answer: { id: string };
  try {
    answer = await db.transaction(async (tx) => {
      await tx.insert(amiyaTouches).values({ userId, direction: "to_amiya", bold, replyTo });
      const [row] = await tx
        .insert(amiyaTouches)
        .values({ userId, direction: "from_amiya", bold })
        .returning({ id: amiyaTouches.id });
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
  return { newFriend: made.length ? AMIYA_NAME : null, amiya: { itemId: `a:${answer.id}`, bold } };
}

export const touchAmiya = (userId: string, bold: boolean) => touchBack(userId, bold, null);

/** One of her touches to this player, by its inbox id. */
async function herItem(userId: string, itemId: string) {
  const id = itemId.slice(2);
  const [row] = UUID.test(id)
    ? await db
        .select()
        .from(amiyaTouches)
        .where(and(eq(amiyaTouches.id, id), eq(amiyaTouches.userId, userId), eq(amiyaTouches.direction, "from_amiya")))
        .limit(1)
    : [];
  if (!row) throw new WorldError("找不到这条消息了。");
  return row;
}

/** Which of her touches the player has answered. */
async function answered(userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ re: amiyaTouches.replyTo })
    .from(amiyaTouches)
    .where(and(eq(amiyaTouches.userId, userId), inArray(amiyaTouches.replyTo, ids)));
  return new Set(rows.map((r) => r.re));
}

/** Touch back one of her touches, once. */
export async function replyAmiya(userId: string, itemId: string, bold: boolean) {
  const item = await herItem(userId, itemId);
  if (item.ignoredAt) throw new WorldError("你已经默默爬走了。");
  if ((await answered(userId, [item.id])).size) throw new WorldError("已经碰过 TA 了。");
  return touchBack(userId, bold, item.id);
}

/** 默默爬走 from one of her touches. */
export async function ignoreAmiya(userId: string, itemId: string) {
  const item = await herItem(userId, itemId);
  if ((await answered(userId, [item.id])).size) throw new WorldError("已经碰过 TA 了。");
  const now = new Date();
  await db
    .update(amiyaTouches)
    .set({ ignoredAt: now, seenAt: item.seenAt ?? now })
    .where(eq(amiyaTouches.id, item.id));
}

export async function seeAmiya(userId: string, itemIds: string[]) {
  const ids = itemIds
    .filter((i) => typeof i === "string" && isAmiyaItem(i))
    .map((i) => i.slice(2))
    .filter((i) => UUID.test(i));
  if (!ids.length) return;
  await db
    .update(amiyaTouches)
    .set({ seenAt: new Date() })
    .where(and(inArray(amiyaTouches.id, ids), eq(amiyaTouches.userId, userId), isNull(amiyaTouches.seenAt)));
}

function toItem(r: typeof amiyaTouches.$inferSelect, replied: boolean): AmiyaItem {
  return {
    kind: "amiya",
    id: `a:${r.id}`,
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
  const rows = await db
    .select()
    .from(amiyaTouches)
    .where(
      and(
        eq(amiyaTouches.userId, userId),
        eq(amiyaTouches.direction, "from_amiya"),
        gt(amiyaTouches.createdAt, new Date(Date.now() - INBOX_DAYS * DAY)),
      ),
    )
    .orderBy(desc(amiyaTouches.createdAt))
    .limit(SHOWN);
  const done = await answered(
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toItem(r, done.has(r.id)));
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
        .values({ userId: u.id, direction: "from_amiya", kind: "greet", bold: false, createdAt: new Date(now) });
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
  return today ? toItem(today, (await answered(u.id, [today.id])).size > 0) : null;
}

/** Her place at the top of the 触须之交 list: no history, no badges, nothing to report. */
export function amiyaFriend(since: Date): Friend {
  return {
    id: AMIYA_ID,
    since: since.getTime(),
    profile: AMIYA_PROFILE,
    roaches: [amiyaRoach(true)],
    declarations: 0,
    history: [],
    pokeAgainAt: null,
  };
}

/** 解除: the greetings stop; a bold touch makes them 触须之交 again. */
export async function unfriendAmiya(userId: string) {
  await db.update(users).set({ amiyaFriendSince: null }).where(eq(users.id, userId));
}
