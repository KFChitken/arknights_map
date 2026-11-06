import "server-only";
import { randomInt } from "node:crypto";
import { and, count, countDistinct, desc, eq, gte, inArray, isNull, lt, notInArray, sql, type AnyColumn } from "drizzle-orm";
import { beijingDate } from "../beijing";
import { AWAY_KEPT, AWAY_LINES, AWAY_REPORT_S, PERLICA, PERLICA_MORE, perlicaBirthday } from "../perlica";
import { WorldError, type PerlicaItem, type TouchResult } from "../world/types";
import { db } from "./db";
import { isProd } from "./env";
import {
  deviceDay,
  deviceWeek,
  guideFriend,
  guideTouches,
  isUniqueViolation,
  type Exec,
  type GuideRow,
  type GuideTable,
} from "./guides";
import { amiyaTouches, mingheTouches, perlicaTouches, roaches, talulahTouches, touches, users } from "./schema";

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

const KINDS: PerlicaItem["what"][] = ["touch", "friend", "away", "jealous", "aside", "birthday", "week"];

function toItem(r: PerlicaRow, replied: boolean): PerlicaItem {
  return {
    kind: "perlica",
    id: her.itemId(r.id),
    at: r.createdAt.getTime(),
    seen: Boolean(r.seenAt),
    what: KINDS.find((k) => k === r.kind) ?? "touch",
    bold: r.bold,
    seconds: r.awaySeconds,
    line: r.line,
    times: r.times,
    others: r.others,
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
      await tx
        .delete(perlicaTouches)
        .where(and(eq(perlicaTouches.userId, userId), inArray(perlicaTouches.kind, ["away", "week"])));
    }
  });
}

// ---- what she makes of the other touches of the day (worked out from the touches already kept, never stored apart) ----

/** Which others a player touched in a stretch of time: players (each counted once), and the other guides */
async function othersTouched(exec: Exec, userId: string, from: Date, to?: Date) {
  const when = (at: AnyColumn) => (to ? and(gte(at, from), lt(at, to)) : gte(at, from));
  const [{ n }] = await exec
    .select({ n: countDistinct(touches.toUserId) })
    .from(touches)
    .where(and(eq(touches.fromUserId, userId), when(touches.createdAt)));
  const guide = async (t: typeof amiyaTouches | typeof talulahTouches | typeof mingheTouches, direction: string) =>
    (
      await exec
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.direction, direction), when(t.createdAt)))
        .limit(1)
    ).length > 0;
  const amiya = await guide(amiyaTouches, "to_amiya");
  const talulah = await guide(talulahTouches, "to_talulah");
  const minghe = await guide(mingheTouches, "to_minghe");
  return { players: n, amiya, total: n + Number(amiya) + Number(talulah) + Number(minghe) };
}

/** She said 「罗德岛那位……」 or was jealous today already: once a day is enough for either */
async function spokeUpToday(exec: Exec, userId: string, since: Date) {
  const [row] = await exec
    .select({ id: perlicaTouches.id })
    .from(perlicaTouches)
    .where(
      and(
        eq(perlicaTouches.userId, userId),
        eq(perlicaTouches.direction, her.from),
        inArray(perlicaTouches.kind, ["aside", "jealous"]),
        gte(perlicaTouches.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** One player's touches of the guides are decided one at a time, so a double tap never makes her jealous twice */
const lockPlayer = (exec: Exec, userId: string) =>
  exec.select({ friendSince: users.perlicaFriendSince }).from(users).where(eq(users.id, userId)).for("update");

// 假装今天是佩丽卡生日 (development only): players for whom it is her birthday until then, in this server's memory
const g = globalThis as typeof globalThis & { __perlicaBirthday?: Map<string, number>; __perlicaWeek?: Set<string> };
const birthdays = (g.__perlicaBirthday ??= new Map());
const isBirthday = (userId: string, now: number) => perlicaBirthday(now) || (birthdays.get(userId) ?? 0) > now;

/**
 * The player touches her, maybe answering one of hers: she touches back the same
 * way at once, with one line, the first that fits of: their first bold touch,
 * which makes them 触须之交 ("friend"); her birthday; jealous, on the first touch of
 * her today by a 触须之交 who touched others first ("jealous"); 「罗德岛那位……」 when
 * they touched 阿米娅向导 today ("aside", once a day, and never on a jealous day);
 * or the usual. On bold ones that do not make them 触须之交 she counts their touches
 * of the day. The day is theirs, by their device's clock from 04:00 (offsetMin, never stored).
 */
async function touchBack(userId: string, bold: boolean, replyTo: string | null, offsetMin: unknown): Promise<TouchResult> {
  await her.allow(userId);
  const now = Date.now();
  const since = new Date(deviceDay(offsetMin, now).start);
  let done: { id: string; kind: Answer; times: number | null; others: number | null; line: number | null };
  try {
    done = await db.transaction(async (tx) => {
      const [u] = await lockPlayer(tx, userId);
      const wasFriend = Boolean(u?.friendSince);
      const firstToday = (await her.touchesSince(tx, userId, since)) === 0;
      const made =
        bold && !wasFriend
          ? await tx
              .update(users)
              .set({ perlicaFriendSince: new Date(now) })
              .where(and(eq(users.id, userId), isNull(users.perlicaFriendSince)))
              .returning({ id: users.id })
          : [];
      let kind: Answer = made.length ? "friend" : "touch";
      let others: number | null = null;
      let line: number | null = null;
      if (kind !== "friend") {
        const today = await othersTouched(tx, userId, since);
        if (isBirthday(userId, now)) kind = "birthday";
        else if (wasFriend && firstToday && today.total >= 1) {
          kind = "jealous";
          others = today.total;
          line = today.total === 1 && today.amiya ? 1 : 0;
        } else if (today.amiya && !(await spokeUpToday(tx, userId, since))) {
          kind = "aside";
          line = 0;
        }
      }
      const answer = await her.pair(tx, userId, bold, replyTo, kind);
      const times = bold && kind !== "friend" ? await her.touchesSince(tx, userId, since) : null;
      if (times !== null || others !== null || line !== null) {
        await tx.update(perlicaTouches).set({ times, others, line }).where(eq(perlicaTouches.id, answer.id));
      }
      return { id: answer.id, kind, times, others, line };
    });
  } catch (e) {
    // two answers to the same one of hers at once: reply_to is unique, so one fails
    if (replyTo && isUniqueViolation(e)) throw new WorldError("已经碰过 TA 了。");
    throw e;
  }
  return {
    newFriend: done.kind === "friend" ? PERLICA.name : null,
    guide: {
      id: PERLICA.id,
      itemId: her.itemId(done.id),
      bold,
      kind: done.kind,
      times: done.times,
      others: done.others,
      line: done.line,
    },
  };
}

type Answer = "touch" | "friend" | "jealous" | "aside" | "birthday";

/**
 * The player just touched 阿米娅向导 (within her transaction): if they touched 佩丽卡监督
 * today too, and she has not spoken up today, she says 「罗德岛那位……」 as well, a
 * line of hers that is seen at once (the page shows it along the top).
 */
export async function asideFromAmiya(exec: Exec, userId: string, offsetMin: unknown) {
  const since = new Date(deviceDay(offsetMin).start);
  await lockPlayer(exec, userId);
  if (!(await her.touchesSince(exec, userId, since)) || (await spokeUpToday(exec, userId, since))) return null;
  const now = new Date();
  const [row] = await exec
    .insert(perlicaTouches)
    .values({ userId, direction: her.from, kind: "aside", bold: false, line: 1, seenAt: now, createdAt: now })
    .returning({ id: perlicaTouches.id });
  return { id: "perlica" as const, itemId: her.itemId(row.id) };
}

// 假装过了一周 (development only): players whose next weekly report counts this week as if it were over
const weekAhead = (g.__perlicaWeek ??= new Set());
const WEEK_MS = 7 * 86_400_000;

/**
 * Her weekly report, for a 触须之交 whose 离开计时 is on: once a week (from Monday
 * 04:00 by their device's clock), how many others they touched last week and how
 * often her. Nothing when they touched nobody. Dated the start of this week, not
 * the visit, and seen at once (the page shows it along the top); the unique index
 * makes it one a week however many pages ask. Only the visit that made it gets it.
 */
export async function weeklyReport(
  u: { id: string; perlicaTimer: string | null; perlicaFriendSince: Date | null },
  offsetMin: unknown,
  now = Date.now(),
): Promise<PerlicaItem | null> {
  if (u.perlicaTimer !== "on" || !u.perlicaFriendSince) return null;
  const { start, prevStart } = deviceWeek(offsetMin, weekAhead.has(u.id) ? now + WEEK_MS : now);
  const at = new Date(start);
  const [made] = await db
    .select({ id: perlicaTouches.id })
    .from(perlicaTouches)
    .where(and(eq(perlicaTouches.userId, u.id), eq(perlicaTouches.kind, "week"), eq(perlicaTouches.createdAt, at)))
    .limit(1);
  if (made) return null;
  const from = new Date(prevStart);
  const others = (await othersTouched(db, u.id, from, at)).total;
  const [{ m }] = await db
    .select({ m: count() })
    .from(perlicaTouches)
    .where(
      and(
        eq(perlicaTouches.userId, u.id),
        eq(perlicaTouches.direction, her.to),
        gte(perlicaTouches.createdAt, from),
        lt(perlicaTouches.createdAt, at),
      ),
    );
  if (!others && !m) return null;
  const [row] = await db
    .insert(perlicaTouches)
    .values({
      userId: u.id,
      direction: her.from,
      kind: "week",
      bold: false,
      others,
      times: m,
      line: randomInt(PERLICA_MORE.weekEnds.length),
      createdAt: at,
      seenAt: new Date(now),
    })
    .onConflictDoNothing()
    .returning();
  return row ? toItem(row, false) : null;
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

/** What me() says about her, with her weekly report when this visit made one. */
export async function perlicaOf(
  u: { id: string; perlicaFriendSince: Date | null; perlicaTimer: string | null },
  offsetMin: unknown,
) {
  const timer = u.perlicaTimer === "on" || u.perlicaTimer === "off" ? u.perlicaTimer : null;
  return { friend: Boolean(u.perlicaFriendSince), timer, week: await weeklyReport(u, offsetMin) } as const;
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

/** 假装触须之交第 30 天 (local testing only): as if they became 触须之交 29 days ago */
export async function pretendFriendDays(userId: string) {
  const [u] = await db.select({ since: users.perlicaFriendSince }).from(users).where(eq(users.id, userId));
  if (!u?.since) throw new WorldError("先大胆碰她，成为触须之交。");
  await db
    .update(users)
    .set({ perlicaFriendSince: new Date(Date.now() - 29 * 86_400_000) })
    .where(eq(users.id, userId));
}

/** 假装今天是佩丽卡生日 (local testing only): for an hour, in this server's memory */
export function pretendBirthday(userId: string) {
  if (!isProd) birthdays.set(userId, Date.now() + 3_600_000);
}

/** 假装过了一周 (local testing only): forget their weekly reports, and count this week as the last one from now on */
export async function pretendWeek(userId: string) {
  if (isProd) return;
  await db.delete(perlicaTouches).where(and(eq(perlicaTouches.userId, userId), eq(perlicaTouches.kind, "week")));
  weekAhead.add(userId);
}
