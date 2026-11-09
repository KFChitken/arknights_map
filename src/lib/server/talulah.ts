import "server-only";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { isNearFire, TALULAH, talulahRoach } from "../talulah";
import type { LngLat } from "../types";
import { WorldError, type TalulahItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, type GuideRow, type GuideTable } from "./guides";
import { talulahTouches, users } from "./schema";

/**
 * 塔露拉干员 on the server (src/lib/talulah.ts): her answers to each player's
 * touches, her handshake, her welcome at the fire and her birthday answer, kept
 * in talulah_touches. She never starts anything: each comes from something the
 * player did. Her fire, its size and the seats round it are the page's.
 */

const YEAR_MS = 365 * 86_400_000;

// her table has exactly the columns every guide's has (schema.ts)
const her = guideTouches(TALULAH, talulahTouches as unknown as GuideTable);

function toItem(r: GuideRow, replied: boolean): TalulahItem {
  const line = r.kind === "handshake" || r.kind === "welcome" || r.kind === "birthday" ? r.kind : "touch";
  return {
    kind: "talulah",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    line,
    bold: r.bold,
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

/**
 * The player touches her, maybe answering one of hers: the first touch of their day she
 * answers at once, openly whichever way they touched (bold keeps how they did, which picks
 * her line), the rest of the day not. Their first bold touch is a handshake that makes them
 * 触须之交, answered whenever it comes.
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin?: unknown): Promise<TouchResult> {
  await her.allow(userId);
  let done: { id: string | null; friend: boolean };
  try {
    done = await db.transaction(async (tx) => {
      const made = bold
        ? await tx
            .update(users)
            .set({ talulahFriendSince: new Date() })
            .where(and(eq(users.id, userId), isNull(users.talulahFriendSince)))
            .returning({ id: users.id })
        : [];
      const friend = made.length > 0;
      const dayStart = new Date(deviceDay(offsetMin).start);
      const answer = await her.pair(tx, userId, { bold, replyTo, dayStart, kind: friend ? "handshake" : "touch" });
      return { id: answer?.id ?? null, friend };
    });
  } catch (e) {
    // two answers to the same one of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError("已经碰过 TA 了。");
    throw e;
  }
  return {
    newFriend: done.friend ? TALULAH.name : null,
    guide: {
      id: TALULAH.id,
      itemId: done.id && her.itemId(done.id),
      bold,
      kind: done.friend ? "friend" : "touch",
      times: null,
      others: null,
      line: null,
    },
  };
}

export const touchTalulah = (userId: string, bold: boolean, offsetMin?: unknown) => touchBack(userId, bold, null, offsetMin);

/** Touch back one of hers, once; it counts towards her 20 like any touch. */
export async function replyTalulah(userId: string, itemId: string, bold: boolean, offsetMin?: unknown) {
  const item = await her.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id, offsetMin);
}

export const ignoreTalulah = (userId: string, itemId: string) => her.ignore(userId, itemId);

export const seeTalulah = (userId: string, itemIds: string[]) => her.see(userId, itemIds);

/** Her latest to the player, for the inbox. */
export async function talulahInbox(userId: string): Promise<TalulahItem[]> {
  return (await her.latest(userId)).map(({ row, replied }) => toItem(row, replied));
}

/**
 * A roach of theirs was just put down or moved to spot: the first time one sits
 * within FIRE_RADIUS_M of her fire (main roach or clone, by hand or sent from her
 * card), she welcomes them, once for good. One conditional update claims it, so
 * two roaches arriving at once still bring one welcome.
 */
export async function arrivedAt(userId: string, spot: LngLat) {
  if (!isNearFire(spot)) return;
  const [first] = await db
    .update(users)
    .set({ talulahWelcomedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.talulahWelcomedAt)))
    .returning({ id: users.id });
  if (first) await db.insert(talulahTouches).values({ userId, direction: her.from, kind: "welcome", bold: false });
}

/**
 * A birthday declaration (「祝我生日快乐」) from one of her 触须之交, wherever they
 * are: she answers it, at most once a year. The declaration itself goes out as
 * ever; she is never among its recipients.
 */
export async function birthdayDeclared(userId: string) {
  const [claimed] = await db
    .update(users)
    .set({ talulahBirthdayAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        isNotNull(users.talulahFriendSince),
        or(isNull(users.talulahBirthdayAt), lt(users.talulahBirthdayAt, new Date(Date.now() - YEAR_MS))),
      ),
    )
    .returning({ id: users.id });
  if (claimed) await db.insert(talulahTouches).values({ userId, direction: her.from, kind: "birthday", bold: false });
}

/** Her place among the 触须之交, after 阿米娅向导 and 佩丽卡监督. */
export const talulahFriend = (since: Date) => guideFriend(TALULAH, since, [talulahRoach(true)]);

/** 解除: she stays by her fire; a bold touch shakes hands again. */
export async function unfriendTalulah(userId: string) {
  await db.update(users).set({ talulahFriendSince: null }).where(eq(users.id, userId));
}

/** What me() says about her. */
export const talulahOf = (u: { talulahFriendSince: Date | null; talulahWelcomedAt: Date | null }) => ({
  friend: Boolean(u.talulahFriendSince),
  visited: Boolean(u.talulahWelcomedAt),
});

/** 清掉我和塔露拉的记录 (local testing only): as if they had never met her. */
export async function forgetTalulah(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ talulahFriendSince: null, talulahWelcomedAt: null, talulahBirthdayAt: null })
      .where(eq(users.id, userId));
    await tx.delete(talulahTouches).where(eq(talulahTouches.userId, userId));
  });
}
