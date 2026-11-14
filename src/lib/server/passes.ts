import "server-only";
import { randomInt } from "node:crypto";
import { and, count, desc, eq, inArray, lt, max, min, ne, or, sql } from "drizzle-orm";
import { T } from "@/i18n";
import { CATALOG_IDS, isPassChar, passCharNamed } from "../passCatalog";
import {
  EARN_CAPS,
  isDrawSize,
  isFoil,
  rollChars,
  tiersOf,
  TICKETS_CAP,
  WELCOME_TICKETS,
  WISH_MAX,
  type Collection,
  type Drawn,
  type EarnKind,
  type LogPage,
  type PassesMe,
  type PassState,
} from "../passes";
import { nextSiteDayAt, siteDay } from "../siteDay";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { passesMode } from "./env";
import { HttpError } from "./http";
import { passCounters, passes, passWallets, type UserRow } from "./schema";
import { errorCode } from "./signals";

/**
 * 通行证寻访 (src/lib/passes.ts): tickets a player earns by playing (earn), up to EARN_CAPS of each kind a site day
 * (src/lib/siteDay.ts, from 04:00 Beijing time) and TICKETS_CAP held; spent on draws of one or ten (draw), each pass
 * numbered in the order the whole site drew its character; the wish list, PITY draws at most from one of it.
 * Who was drawn is decided here, by crypto.randomInt, before the page shows anything. No ticket is sold or given
 * for money. Switched by PASSES (env.ts).
 */

type Wallet = typeof passWallets.$inferSelect;

/** One draw a second for each player, on every web process */
const DRAW_GAP_MS = 1000;
/** 寻访记录, a page at a time */
const LOG_PAGE = 50;

/** Whether this player may earn tickets and draw: everyone (on), the 站长 and the admins (admins), or nobody (off) */
export function passesOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = passesMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/**
 * A ticket for something the player just did (touched, touched back, answered a declaration or did something for a
 * 触须之交: social; touched a guide or answered one: guide; declared: declare), while the day's EARN_CAPS of that kind
 * and TICKETS_CAP allow. Only for a player who has opened 寻访 once (their wallet), so nothing is written for anyone
 * else. Counted whoever it reached, a player who blocked them too (withheld), so tickets never tell. One statement,
 * which also starts the counts of a new site day. Never fails what it is counted for: a fault is only logged.
 */
export async function earn(userId: string, kind: EarnKind, now = Date.now()): Promise<void> {
  if (passesMode() === "off") return;
  try {
    const day = siteDay(now);
    const sameDay = sql`${passWallets.day} = ${day}`;
    const counted = (k: EarnKind) =>
      k === kind ? sql`case when ${sameDay} then ${passWallets[k]} + 1 else 1 end` : sql`case when ${sameDay} then ${passWallets[k]} else 0 end`;
    await db
      .update(passWallets)
      .set({
        day,
        tickets: sql`${passWallets.tickets} + 1`,
        social: counted("social"),
        guide: counted("guide"),
        declare: counted("declare"),
        giftsIn: sql`case when ${sameDay} then ${passWallets.giftsIn} else 0 end`,
      })
      .where(
        and(
          eq(passWallets.userId, userId),
          lt(passWallets.tickets, TICKETS_CAP),
          or(ne(passWallets.day, day), lt(passWallets[kind], EARN_CAPS[kind])),
        ),
      );
  } catch (e) {
    console.error(`passes: a ${kind} ticket for a player was not counted`, errorCode(e));
  }
}

/** What me() carries for the 寻访 button: undefined when the player may not draw */
export async function passesMe(user: UserRow): Promise<PassesMe | undefined> {
  if (!passesOpen(user)) return undefined;
  const [w] = await db
    .select({ tickets: passWallets.tickets, welcomed: passWallets.welcomed })
    .from(passWallets)
    .where(eq(passWallets.userId, user.id))
    .limit(1);
  const tickets = w?.tickets ?? 0;
  return { tickets, dot: !w?.welcomed || tickets >= 10 };
}

/** Their 厨力 as a first wish list: each game's in the order picked, those in the catalogue, at most WISH_MAX */
export function wishFromFavourites(user: Pick<UserRow, "favArknights" | "favEndfield">): number[] {
  const ids = [
    ...user.favArknights.map((n) => passCharNamed("arknights", n)?.id),
    ...user.favEndfield.map((n) => passCharNamed("endfield", n)?.id),
  ].filter((id): id is number => id !== undefined);
  return [...new Set(ids)].slice(0, WISH_MAX);
}

/**
 * Opening 寻访: the wallet, made the first time with WELCOME_TICKETS and their 厨力 as the wish list (which they may
 * change that day all the same). A wallet made before they first came (a 触须之交's gift) gets the same, once.
 */
export async function openWallet(user: UserRow, now = Date.now()): Promise<PassState> {
  const day = siteDay(now);
  const [made] = await db
    .insert(passWallets)
    .values({ userId: user.id, tickets: WELCOME_TICKETS, day, welcomed: true, wish: wishFromFavourites(user) })
    .onConflictDoNothing()
    .returning();
  if (made) return stateOf(made, now, true);
  const [late] = await db
    .update(passWallets)
    .set({
      welcomed: true,
      tickets: sql`${passWallets.tickets} + ${WELCOME_TICKETS}`,
      wish: sql`case when ${passWallets.wishDay} is null and cardinality(${passWallets.wish}) = 0 then ${sqlIds(wishFromFavourites(user))} else ${passWallets.wish} end`,
    })
    .where(and(eq(passWallets.userId, user.id), eq(passWallets.welcomed, false)))
    .returning();
  if (late) return stateOf(late, now, true);
  return stateOf(await walletOf(user.id), now);
}

/** The page's view of a wallet: the day's counts (none yet, for a row of a past day), the wish list and what of it they own */
async function stateOf(w: Wallet, now: number, welcomed = false): Promise<PassState> {
  const day = siteDay(now);
  const same = w.day === day;
  const wish = w.wish.filter(isPassChar);
  const owned = wish.length
    ? await db
        .select({ charId: passes.charId, copies: count(), no: min(passes.no) })
        .from(passes)
        .where(and(eq(passes.userId, w.userId), inArray(passes.charId, wish)))
        .groupBy(passes.charId)
    : [];
  return {
    tickets: w.tickets,
    today: {
      social: same ? w.social : 0,
      guide: same ? w.guide : 0,
      declare: same ? w.declare : 0,
      giftsIn: same ? w.giftsIn : 0,
    },
    wish,
    wishOpen: !wish.length || w.wishDay !== day,
    miss: wish.length ? w.miss : 0,
    wishOwned: owned.map((o) => ({ charId: o.charId, copies: o.copies, no: o.no ?? 0 })),
    plain: w.plain,
    welcomed,
    nextDayAt: nextSiteDayAt(now),
  };
}

async function walletOf(userId: string): Promise<Wallet> {
  const [w] = await db.select().from(passWallets).where(eq(passWallets.userId, userId)).limit(1);
  if (!w) throw new HttpError(409, T.server.passes.openFirst);
  return w;
}

/** The page's view of a player's wallet, as after any change */
export async function passState(userId: string, now = Date.now()): Promise<PassState> {
  return stateOf(await walletOf(userId), now);
}

/** A list of catalogue ids as a smallint[] for the database */
const sqlIds = (ids: readonly number[]) => sql`${`{${ids.map((i) => Math.trunc(i)).join(",")}}`}::smallint[]`;

/**
 * A draw of 1 or 10, all in one transaction, so no ticket is spent twice and no number given twice: the wallet
 * locked first (one draw at a time for each player, one a second); who comes (rollChars); what each is to the player
 * (tiersOf: their copies before it); then the numbers, taken from each character's counter in order of charId, so
 * two draws never wait on each other the wrong way round, and last, so those rows are held the shortest. Returns the
 * passes in the order drawn, and the wallet after. rand: the dice (crypto.randomInt, a test's own in the tests).
 */
export async function draw(
  user: UserRow,
  size: unknown,
  now = Date.now(),
  rand: (n: number) => number = randomInt,
): Promise<{ drawn: Drawn[]; state: PassState }> {
  if (!isDrawSize(size)) throw new HttpError(400, T.server.passes.badDraw);
  const drawn = await db.transaction(async (tx) => {
    const [w] = await tx.select().from(passWallets).where(eq(passWallets.userId, user.id)).for("update");
    if (!w || !w.welcomed) throw new HttpError(409, T.server.passes.openFirst);
    const since = w.drawnAt ? now - w.drawnAt.getTime() : Infinity;
    if (since >= 0 && since < DRAW_GAP_MS) throw new HttpError(429, T.server.passes.tooFast);
    if (w.tickets < size) throw new HttpError(409, T.server.passes.notEnough);

    const { picks, miss } = rollChars(CATALOG_IDS, w.wish.filter(isPassChar), w.miss, size, rand);
    const chars = [...new Set(picks.map((p) => p.charId))].sort((a, b) => a - b);
    const had = await tx
      .select({ charId: passes.charId, n: count() })
      .from(passes)
      .where(and(eq(passes.userId, user.id), inArray(passes.charId, chars)))
      .groupBy(passes.charId);
    const tiers = tiersOf(picks, new Map(had.map((h) => [h.charId, h.n])), w.plain);

    const at = new Date(now);
    await tx
      .update(passWallets)
      .set({ tickets: sql`${passWallets.tickets} - ${size}`, miss, drawnAt: at })
      .where(eq(passWallets.userId, user.id));
    const wanted = new Map<number, number>();
    for (const p of picks) wanted.set(p.charId, (wanted.get(p.charId) ?? 0) + 1);
    const counters = await tx
      .insert(passCounters)
      .values(chars.map((charId) => ({ charId, lastNo: wanted.get(charId)! })))
      .onConflictDoUpdate({ target: passCounters.charId, set: { lastNo: sql`${passCounters.lastNo} + excluded.last_no` } })
      .returning();
    const next = new Map(counters.map((c) => [c.charId, c.lastNo - wanted.get(c.charId)! + 1]));
    const rows = picks.map((p) => {
      const no = next.get(p.charId)!;
      next.set(p.charId, no + 1);
      return { userId: user.id, charId: p.charId, no, wish: p.wish, drawnAt: at };
    });
    await tx.insert(passes).values(rows);
    return rows.map((r, i): Drawn => ({ charId: r.charId, no: r.no, ...tiers[i], foil: isFoil(r.no) }));
  });
  return { drawn, state: await passState(user.id, now) };
}

/**
 * The wish list: 1 to WISH_MAX characters of the catalogue, none twice. Once a site day; the first time the list
 * is filled (it was empty: they had no 厨力) does not count. The count towards PITY stays as it was.
 */
export async function setWish(user: UserRow, ids: unknown, now = Date.now()): Promise<PassState> {
  if (!Array.isArray(ids) || !ids.length || ids.length > WISH_MAX || !ids.every(isPassChar) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, T.server.passes.badWish);
  }
  const day = siteDay(now);
  await db.transaction(async (tx) => {
    const [w] = await tx.select().from(passWallets).where(eq(passWallets.userId, user.id)).for("update");
    if (!w || !w.welcomed) throw new HttpError(409, T.server.passes.openFirst);
    const first = !w.wish.length;
    if (!first && w.wishDay === day) throw new HttpError(409, T.server.passes.wishChangedToday);
    await tx
      .update(passWallets)
      .set({ wish: ids, ...(first ? {} : { wishDay: day }) })
      .where(eq(passWallets.userId, user.id));
  });
  return passState(user.id, now);
}

/** 我的通行证: each character the player has, how many and the number of their first, and how many passes in all */
export async function collection(userId: string): Promise<Collection> {
  const rows = await db
    .select({ charId: passes.charId, copies: count(), no: min(passes.no), lastAt: max(passes.drawnAt) })
    .from(passes)
    .where(eq(passes.userId, userId))
    .groupBy(passes.charId);
  return {
    chars: rows.map((r) => ({ charId: r.charId, copies: r.copies, no: r.no ?? 0, lastAt: r.lastAt?.getTime() ?? 0 })),
    passes: rows.reduce((n, r) => n + r.copies, 0),
  };
}

/** 寻访记录: the player's passes, newest first, LOG_PAGE at a time; before: the id of the last one shown */
export async function passLog(userId: string, before?: unknown): Promise<LogPage> {
  const from = typeof before === "number" && Number.isSafeInteger(before) && before > 0 ? before : null;
  const rows = await db
    .select({ id: passes.id, charId: passes.charId, no: passes.no, wish: passes.wish, at: passes.drawnAt })
    .from(passes)
    .where(from ? and(eq(passes.userId, userId), lt(passes.id, from)) : eq(passes.userId, userId))
    .orderBy(desc(passes.id))
    .limit(LOG_PAGE + 1);
  return {
    rows: rows.slice(0, LOG_PAGE).map((r) => ({ id: r.id, charId: r.charId, no: r.no, wish: r.wish, at: r.at.getTime() })),
    more: rows.length > LOG_PAGE,
  };
}
