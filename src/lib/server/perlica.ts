import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { beijingDate } from "../beijing";
import { AWAY_KEPT, AWAY_LINES, AWAY_REPORT_S, PERLICA } from "../perlica";
import { WorldError, type PerlicaItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { deviceDay, guideFriend, guideTouches, isUniqueViolation, type GuideRow, type GuideTable } from "./guides";
import { perlicaTouches, roaches, users } from "./schema";

/**
 * 佩丽卡监督 on the server (src/lib/perlica.ts): her touches with each player
 * and her reports of how long they were away, kept in perlica_touches, and her
 * 离开计时 in the player's own row. The timer runs only once the player said yes
 * to it (perlica_timer "on"): the page says 「还在」 (here) while it is looked at
 * and 「走了」 (leave) when it goes out of sight, and last_active_at keeps the
 * latest of either, one moment overwritten each time. Where she stands is
 * worked out by the page alone; the server never knows.
 */

type PerlicaRow = typeof perlicaTouches.$inferSelect;

// her table starts with the columns every guide's has (schema.ts), plus her own
const her = guideTouches(PERLICA, perlicaTouches as unknown as GuideTable);

function toItem(r: PerlicaRow, replied: boolean): PerlicaItem {
  const what = r.kind === "away" || r.kind === "friend" ? r.kind : "touch";
  return {
    kind: "perlica",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    what,
    bold: r.bold,
    seconds: r.awaySeconds,
    line: r.line,
    times: r.times,
    replied,
    ignored: Boolean(r.ignoredAt),
  };
}

const asPerlicaRow = (r: GuideRow) => r as unknown as PerlicaRow;

/**
 * 「还在」: the page is open and looked at (on opening, on coming back into view,
 * and every minute meanwhile). With the timer on, the time kept moves to now; when
 * the one before was AWAY_REPORT_S or more ago and the player has a main roach
 * (she stands beside it), she tells them how long they were gone: a new report,
 * seen as soon as it is made, of which only the latest AWAY_KEPT stay. The row
 * is locked meanwhile, so two pages saying it at once make one report at most.
 */
export async function here(userId: string, now = Date.now()): Promise<PerlicaItem | null> {
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({ timer: users.perlicaTimer, last: users.lastActiveAt })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (u?.timer !== "on") return null;
    await tx
      .update(users)
      .set({ lastActiveAt: new Date(now) })
      .where(eq(users.id, userId));
    if (!u.last) return null;
    const seconds = Math.floor((now - u.last.getTime()) / 1000);
    if (seconds < AWAY_REPORT_S) return null;
    const [main] = await tx
      .select({ id: roaches.id })
      .from(roaches)
      .where(and(eq(roaches.userId, userId), eq(roaches.slot, 0)))
      .limit(1);
    if (!main) return null;
    const [row] = await tx
      .insert(perlicaTouches)
      .values({
        userId,
        direction: her.from,
        kind: "away",
        bold: false,
        awaySeconds: seconds,
        line: randomInt(AWAY_LINES),
        createdAt: new Date(now),
        seenAt: new Date(now),
      })
      .returning();
    const kept = tx
      .select({ id: perlicaTouches.id })
      .from(perlicaTouches)
      .where(and(eq(perlicaTouches.userId, userId), eq(perlicaTouches.kind, "away")))
      .orderBy(desc(perlicaTouches.createdAt))
      .limit(AWAY_KEPT);
    await tx
      .delete(perlicaTouches)
      .where(and(eq(perlicaTouches.userId, userId), eq(perlicaTouches.kind, "away"), notInArray(perlicaTouches.id, kept)));
    return toItem(row, false);
  });
}

/** 「走了」: the page went out of sight or closed. With the timer on, the time kept moves to now. */
export async function leave(userId: string) {
  await db
    .update(users)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.perlicaTimer, "on")));
}

/**
 * Her 离开计时, answered on her card or changed in 资料; when, too, as with any
 * consent. On starts from now, so she speaks after the next time away; off
 * forgets the time kept and every report of hers, and leaves the touches.
 */
export async function setTimer(userId: string, on: boolean) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ perlicaTimer: on ? "on" : "off", perlicaTimerAt: now, lastActiveAt: on ? now : null })
      .where(eq(users.id, userId));
    if (!on) {
      await tx.delete(perlicaTouches).where(and(eq(perlicaTouches.userId, userId), eq(perlicaTouches.kind, "away")));
    }
  });
}

/**
 * The player touches her, maybe answering one of hers: she touches back the same
 * way at once. Their first bold touch makes them 触须之交 (her touch back is then
 * kind "friend"); on later bold ones she counts their touches of the day, by
 * their device's clock from 04:00 (offsetMin, never stored).
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin: unknown): Promise<TouchResult> {
  await her.allow(userId);
  const since = new Date(deviceDay(offsetMin).start);
  let done: { id: string; friend: boolean; times: number | null };
  try {
    done = await db.transaction(async (tx) => {
      const made = bold
        ? await tx
            .update(users)
            .set({ perlicaFriendSince: new Date() })
            .where(and(eq(users.id, userId), isNull(users.perlicaFriendSince)))
            .returning({ id: users.id })
        : [];
      const friend = made.length > 0;
      const answer = await her.pair(tx, userId, bold, replyTo, friend ? "friend" : "touch");
      const times = bold && !friend ? await her.touchesSince(tx, userId, since) : null;
      if (times !== null) await tx.update(perlicaTouches).set({ times }).where(eq(perlicaTouches.id, answer.id));
      return { id: answer.id, friend, times };
    });
  } catch (e) {
    // two answers to the same one of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError("已经碰过 TA 了。");
    throw e;
  }
  return {
    newFriend: done.friend ? PERLICA.name : null,
    guide: { id: PERLICA.id, itemId: her.itemId(done.id), bold, kind: done.friend ? "friend" : "touch", times: done.times },
  };
}

export const touchPerlica = (userId: string, bold: boolean, offsetMin?: unknown) => touchBack(userId, bold, null, offsetMin);

/** Touch back one of hers, her reports of time away included, once. */
export async function replyPerlica(userId: string, itemId: string, bold: boolean, offsetMin?: unknown) {
  const item = await her.toAnswer(userId, itemId);
  return touchBack(userId, bold, item.id, offsetMin);
}

export const ignorePerlica = (userId: string, itemId: string) => her.ignore(userId, itemId);

export const seePerlica = (userId: string, itemIds: string[]) => her.see(userId, itemIds);

/** Her latest to the player, touches and reports together, for the inbox. */
export async function perlicaInbox(userId: string): Promise<PerlicaItem[]> {
  return (await her.latest(userId)).map(({ row, replied }) => toItem(asPerlicaRow(row), replied));
}

/** Her place among the 触须之交, after 阿米娅向导. Where she stands only the page knows, so it fills in her roach. */
export const perlicaFriend = (since: Date) => guideFriend(PERLICA, since, []);

/** 解除: nothing else changes, the timer included; a bold touch makes them 触须之交 again. */
export async function unfriendPerlica(userId: string) {
  await db.update(users).set({ perlicaFriendSince: null }).where(eq(users.id, userId));
}

/** What me() says about her. */
export function perlicaOf(u: { perlicaFriendSince: Date | null; perlicaTimer: string | null }) {
  const timer = u.perlicaTimer === "on" || u.perlicaTimer === "off" ? u.perlicaTimer : null;
  return { friend: Boolean(u.perlicaFriendSince), timer } as const;
}

/**
 * For trying her out locally (the identity sheet): 假装离开 moves the time kept back
 * that many seconds, and two days or more moves the last visit back as many days,
 * so 欢迎回家 shows too; 让佩丽卡重新问一次 forgets the answer to her question.
 */
export async function pretendAway(userId: string, seconds: number) {
  const [u] = await db.select({ timer: users.perlicaTimer }).from(users).where(eq(users.id, userId));
  if (u?.timer !== "on") throw new WorldError("先在介绍卡或资料里让佩丽卡开始记时间。");
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  await db
    .update(users)
    .set({
      lastActiveAt: sql`coalesce(${users.lastActiveAt}, now()) - make_interval(secs => ${s})`,
      ...(days >= 2 ? { lastSeenOn: beijingDate(Date.now() - days * 86_400_000) } : {}),
    })
    .where(eq(users.id, userId));
}

export async function askAgain(userId: string) {
  await db.update(users).set({ perlicaTimer: null, perlicaTimerAt: null, lastActiveAt: null }).where(eq(users.id, userId));
}
