import "server-only";
import { and, count, desc, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import { GUIDE_INBOX_SHOWN, GUIDE_TOUCHES_PER_DAY, guideProfile, type Guide } from "../guides";
import { INBOX_DAYS } from "../rules";
import { DAY } from "../world/logic";
import { WorldError, type Friend, type PublicRoach } from "../world/types";
import { db } from "./db";
import { users, type amiyaTouches } from "./schema";

/**
 * What every guide (src/lib/guides.ts) does the same way on the server: her own
 * 20 touches a day, the player's touch and hers back written together (she touches
 * back once a day, and always when it makes them 触须之交), touching back or crawling
 * away from hers once each, marking them seen, the latest few for the inbox, and her
 * place among the 触须之交. Each guide's own module (amiya.ts, perlica.ts) adds what
 * only she does.
 */

/** Every guide's table starts with the same columns (guideTouchColumns in schema.ts); the shared code is typed by Amiya's. */
export type GuideTable = typeof amiyaTouches;
export type GuideRow = GuideTable["$inferSelect"];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** The database, or a transaction under way */
export type Exec = typeof db | Tx;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { deviceDay, deviceWeek } from "../deviceDay";

export const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: unknown } | null;
  return err?.code === "23505" || (err?.cause !== undefined && isUniqueViolation(err.cause));
};

/**
 * The player's row, locked until the transaction ends: every guide's touch takes it first, so one
 * player's touches of the guides are decided one at a time and a double tap is answered once.
 * First, before writing anything: a touch row written first takes a lighter lock on the same row
 * (for its foreign key), and two touches each holding that while asking for this one wait on each
 * other until the database cancels one (a deadlock).
 */
export const lockPlayer = (exec: Exec, userId: string) =>
  exec.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

/** Her place among the 触须之交 (after any guide before her): no history, no badges, nothing to report. */
export function guideFriend(guide: Guide, since: Date, roaches: PublicRoach[]): Friend {
  return {
    id: guide.id,
    since: since.getTime(),
    profile: guideProfile(guide),
    roaches,
    declarations: 0,
    history: [],
    pokeAgainAt: null,
  };
}

/** Answers she gives however often she has touched back today: the one that makes them 触须之交 */
const ALWAYS_ANSWERED = ["friend", "handshake"];

/** A touch of hers by the player, and what she answers: kind, and whether she answers it even after one already today */
type Pairing = { bold: boolean; replyTo: string | null; dayStart: Date; kind?: string; always?: boolean };

/** The shared part of one guide, working on her own table. */
export function guideTouches(guide: Guide, table: GuideTable) {
  const t = table;
  const to = `to_${guide.id}`;
  const from = `from_${guide.id}`;

  /** One of hers to this player, by its inbox id. */
  async function item(userId: string, itemId: string) {
    const id = itemId.slice(guide.prefix.length);
    const [row] =
      itemId.startsWith(guide.prefix) && UUID.test(id)
        ? await db
            .select()
            .from(t)
            .where(and(eq(t.id, id), eq(t.userId, userId), eq(t.direction, from)))
            .limit(1)
        : [];
    if (!row) throw new WorldError("找不到这条消息了。");
    return row;
  }

  /** The player's touches of her since a moment */
  async function touchesSince(exec: Exec, userId: string, since: Date) {
    const [{ n }] = await exec
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.userId, userId), eq(t.direction, to), gte(t.createdAt, since)));
    return n;
  }

  /** Which of hers the player has answered. */
  async function answered(userId: string, ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await db
      .select({ re: t.replyTo })
      .from(t)
      .where(and(eq(t.userId, userId), inArray(t.replyTo, ids)));
    return new Set(rows.map((r) => r.re));
  }

  return {
    guide,
    to,
    from,
    itemId: (rowId: string) => `${guide.prefix}${rowId}`,
    answered,

    /** Refuses a touch beyond her own allowance; touches between players never count towards it. */
    async allow(userId: string) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.direction, to), gt(t.createdAt, new Date(Date.now() - DAY))));
      if (n >= GUIDE_TOUCHES_PER_DAY) throw new WorldError(`今天跟${guide.short}碰得够多啦，明天再来吧。`);
    },

    /**
     * The player's touch (answering one of hers, or not) and hers back the same way. replyTo is
     * unique, so a touch answers once. She touches back only the player's first touch of the day
     * (dayStart: their 04:00, deviceDay), null for the others, but always the one that makes them
     * 触须之交 (always; ALWAYS_ANSWERED kinds).
     */
    async pair(
      exec: Exec,
      userId: string,
      { bold, replyTo, dayStart, kind = "touch", always = ALWAYS_ANSWERED.includes(kind) }: Pairing,
    ) {
      const first = (await touchesSince(exec, userId, dayStart)) === 0;
      await exec.insert(t).values({ userId, direction: to, bold, replyTo });
      if (!first && !always) return null;
      const [row] = await exec.insert(t).values({ userId, direction: from, kind, bold }).returning({ id: t.id });
      return row;
    },

    /** The player's touches of her since a moment, this one included. */
    touchesSince,

    item,

    /** One of hers the player may still touch back: not crawled away from, not answered. */
    async toAnswer(userId: string, itemId: string) {
      const row = await item(userId, itemId);
      if (row.ignoredAt) throw new WorldError("你已经默默爬走了。");
      if ((await answered(userId, [row.id])).size) throw new WorldError("已经碰过 TA 了。");
      return row;
    },

    /** 默默爬走 from one of hers. */
    async ignore(userId: string, itemId: string) {
      const row = await item(userId, itemId);
      if ((await answered(userId, [row.id])).size) throw new WorldError("已经碰过 TA 了。");
      const now = new Date();
      await db
        .update(t)
        .set({ ignoredAt: now, seenAt: row.seenAt ?? now })
        .where(eq(t.id, row.id));
    },

    /** Marks those of the given inbox ids that are hers, and this player's, as seen. */
    async see(userId: string, itemIds: string[]) {
      const ids = itemIds
        .filter((i) => typeof i === "string" && i.startsWith(guide.prefix))
        .map((i) => i.slice(guide.prefix.length))
        .filter((i) => UUID.test(i));
      if (!ids.length) return;
      await db
        .update(t)
        .set({ seenAt: new Date() })
        .where(and(inArray(t.id, ids), eq(t.userId, userId), isNull(t.seenAt)));
    },

    /** Her latest to the player within the inbox's days, and whether each was answered. */
    async latest(userId: string) {
      const rows = await db
        .select()
        .from(t)
        .where(and(eq(t.userId, userId), eq(t.direction, from), gt(t.createdAt, new Date(Date.now() - INBOX_DAYS * DAY))))
        .orderBy(desc(t.createdAt))
        .limit(GUIDE_INBOX_SHOWN);
      const done = await answered(
        userId,
        rows.map((r) => r.id),
      );
      return rows.map((row) => ({ row, replied: done.has(row.id) }));
    },
  };
}
