import "server-only";
import { randomInt } from "node:crypto";
import { and, asc, count, desc, eq, exists, inArray, lt, max, min, ne, or, sql, type AnyColumn } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { CATALOG_IDS, GAME_OF, isPassChar, passChar, passCharNamed } from "../passCatalog";
import {
  claimable,
  GIFTS_IN_PER_DAY,
  isDrawSize,
  isFancy,
  isFoil,
  isTask,
  passesDot,
  rollChars,
  TASK_MAX,
  TASKS,
  tiersOf,
  TICKETS_CAP,
  WELCOME_TICKETS,
  WISH_MAX,
  type CharCopies,
  type Collection,
  type Drawn,
  type LogPage,
  type PassesDot,
  type PassesMe,
  type PassOnCard,
  type PassState,
  type Task,
  type TaskState,
  type WornPass,
} from "../passes";
import { nextSiteDayAt, siteDay } from "../siteDay";
import { WorldError } from "../world/types";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { passesMode, passGiftsOn } from "./env";
import type { Exec } from "./guides";
import { HttpError } from "./http";
import { operatorArtIndex, type OperatorArtIndex } from "./operatorArt";
import { passArtIndex } from "./passArt";
import { passCounters, passes, passGifts, passWallets, users, type UserRow } from "./schema";
import { errorCode } from "./signals";

/**
 * 通行证寻访 (src/lib/passes.ts): tickets a player earns by playing, through 每日任务: what they do is counted
 * (didTask), up to TASK_MAX of each a site day (src/lib/siteDay.ts, from 04:00 Beijing time), and claimed on the page
 * (claim), up to TICKETS_CAP held; spent on draws of one or ten (draw), each pass numbered in the order the whole
 * site drew its character; the wish list, PITY draws at most from one of it. Who was drawn is decided here, by
 * crypto.randomInt, before the page shows anything. No ticket is sold or given for money; 触须之交 may give each
 * other one a day (receiveGift, from friendly.ts giftTicket). Switched by PASSES and PASS_GIFTS (env.ts).
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

/** Whether this player may give their 触须之交 tickets, and be given them: PASS_GIFTS on, and 寻访 open to them */
export const giftsOpen = (user: Pick<UserRow, "id" | "email">) => passGiftsOn() && passesOpen(user);

/** Each task's columns: how often it was done today, and how many tickets were claimed for it */
const TASK_COLUMNS = {
  touch: { done: passWallets.touch, got: passWallets.touchGot },
  declare: { done: passWallets.declare, got: passWallets.declareGot },
  reply: { done: passWallets.reply, got: passWallets.replyGot },
  npc: { done: passWallets.npc, got: passWallets.npcGot },
} as const satisfies Record<Task, unknown>;

/** The day's 每日任务 of a wallet: nothing done yet for a row of a past day */
function tasksOf(w: Wallet, day: string): TaskState[] {
  const same = w.day === day;
  const got = { touch: w.touchGot, declare: w.declareGot, reply: w.replyGot, npc: w.npcGot };
  return TASKS.map((task) => ({ task, done: same ? w[task] : 0, got: same ? got[task] : 0, max: TASK_MAX[task] }));
}

/** What a write that starts a new site day sets: every count of the day back to 0 (social and guide, written before 每日任务, too) */
const NEW_DAY = { social: 0, guide: 0, declare: 0, touch: 0, reply: 0, npc: 0, touchGot: 0, declareGot: 0, replyGot: 0, npcGot: 0, giftsIn: 0 };

/**
 * The player did one of 每日任务 (touched someone's roach or touched one back: touch; declared; answered a
 * declaration: reply; touched a guide or touched her back: npc): counted while the day's TASK_MAX of it allows,
 * however many tickets they hold; the ticket is theirs to claim on the page (claim). Only for a player who has
 * opened 寻访 once (their wallet, welcomed: a 触须之交's gift may have made it before), so nothing is written for
 * anyone else. Counted whoever it reached, a player who blocked them too (withheld), so 每日任务 never tell. One
 * statement, which also starts the counts of a new site day. Returns the dot of the 寻访 button after it (passesDot),
 * for the map to light at once; nothing when nothing was counted. Never fails what it is counted for: a fault is
 * only logged.
 */
export async function didTask(userId: string, task: Task, now = Date.now()): Promise<PassesDot> {
  if (passesMode() === "off") return {};
  try {
    const day = siteDay(now);
    const sameDay = sql`${passWallets.day} = ${day}`;
    const kept = (c: AnyColumn) => sql`case when ${sameDay} then ${c} else 0 end`;
    const set: Record<string, unknown> = { day };
    for (const t of TASKS) {
      const c = TASK_COLUMNS[t];
      set[t] = t === task ? sql`case when ${sameDay} then ${c.done} + 1 else 1 end` : kept(c.done);
      set[`${t}Got`] = kept(c.got);
    }
    const [w] = await db
      .update(passWallets)
      .set({ ...set, social: kept(passWallets.social), guide: kept(passWallets.guide), giftsIn: kept(passWallets.giftsIn) })
      .where(
        and(
          eq(passWallets.userId, userId),
          eq(passWallets.welcomed, true),
          or(ne(passWallets.day, day), lt(TASK_COLUMNS[task].done, TASK_MAX[task])),
        ),
      )
      .returning();
    return w ? { passesDot: passesDot(true, w.tickets, tasksOf(w, day)) } : {};
  } catch (e) {
    console.error(`passes: a ${task} of a player was not counted`, errorCode(e));
    return {};
  }
}

/**
 * The tickets of a task done today and not claimed yet, as many as TICKETS_CAP leaves room for; the rest may still be
 * claimed today, once there is room. In one transaction, the wallet locked first, so two claims at once never bring
 * more. A refusal (409) says why: nothing to claim, or 50 held.
 */
export async function claim(user: UserRow, task: unknown, now = Date.now()): Promise<PassState> {
  if (!isTask(task)) throw new HttpError(400, T.server.passes.badTask);
  const day = siteDay(now);
  await db.transaction(async (tx) => {
    const [w] = await tx.select().from(passWallets).where(eq(passWallets.userId, user.id)).for("update");
    if (!w || !w.welcomed) throw new HttpError(409, T.server.passes.openFirst);
    const t = tasksOf(w, day).find((x) => x.task === task)!;
    const n = claimable(t, w.tickets);
    if (n <= 0) throw new HttpError(409, t.done > t.got ? fmt(T.server.passes.claimFull, { n: TICKETS_CAP }) : T.server.passes.nothingToClaim);
    const c = TASK_COLUMNS[task];
    await tx
      .update(passWallets)
      .set({ tickets: sql`${passWallets.tickets} + ${n}`, [`${task}Got`]: sql`${c.got} + ${n}` })
      .where(eq(passWallets.userId, user.id));
  });
  return passState(user.id, now);
}

/** What me() carries for the 寻访 button and 我的资料: undefined when the player may not draw */
export async function passesMe(user: UserRow, now = Date.now()): Promise<PassesMe | undefined> {
  if (!passesOpen(user)) return undefined;
  const [w] = await db.select().from(passWallets).where(eq(passWallets.userId, user.id)).limit(1);
  const tickets = w?.tickets ?? 0;
  return {
    tickets,
    dot: passesDot(Boolean(w?.welcomed), tickets, w ? tasksOf(w, siteDay(now)) : []),
    worn: user.wornPass === null ? null : await wornOf(user.id),
  };
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
    tasks: tasksOf(w, day),
    giftsIn: same ? w.giftsIn : 0,
    wish,
    wishOpen: !wish.length || w.wishDay !== day,
    miss: wish.length ? w.miss : 0,
    wishOwned: owned.map((o) => ({ charId: o.charId, copies: o.copies, no: o.no ?? 0 })),
    plain: w.plain,
    welcomed,
    nextDayAt: nextSiteDayAt(now),
    worn: await wornOf(w.userId),
    gifts: passGiftsOn(),
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

/**
 * A ticket from one 触须之交 to another (friendly.ts giftTicket, which made sure they are), within that transaction.
 * The receiver's wallet is made if they never opened 寻访 (the first ten still come when they do), then locked, so
 * however many give at once, nobody is given more than GIFTS_IN_PER_DAY a site day, whoever came first; a new site
 * day's first starts all the day's counts again. Each giver once a site day (pass_gifts). Past TICKETS_CAP too.
 */
export async function receiveGift(tx: Exec, fromId: string, toId: string, now = Date.now()): Promise<void> {
  const day = siteDay(now);
  await tx.insert(passWallets).values({ userId: toId, day }).onConflictDoNothing();
  const [w] = await tx.select().from(passWallets).where(eq(passWallets.userId, toId)).for("update");
  const same = w.day === day;
  if (same && w.giftsIn >= GIFTS_IN_PER_DAY) throw new WorldError(fmt(T.server.passes.giftsFull, { n: GIFTS_IN_PER_DAY }));
  const [made] = await tx
    .insert(passGifts)
    .values({ fromId, toId, day, createdAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ day: passGifts.day });
  if (!made) throw new WorldError(T.server.passes.giftedToday);
  await tx
    .update(passWallets)
    .set(
      same
        ? { tickets: sql`${passWallets.tickets} + 1`, giftsIn: sql`${passWallets.giftsIn} + 1` }
        : { ...NEW_DAY, tickets: sql`${passWallets.tickets} + 1`, giftsIn: 1, day },
    )
    .where(eq(passWallets.userId, toId));
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

/** What a worn pass's row brings, to make its card of */
const wornColumns = {
  passId: passes.id,
  userId: passes.userId,
  charId: passes.charId,
  no: passes.no,
  drawnAt: passes.drawnAt,
  copies: sql<number>`(select count(*) from passes as q where q.user_id = ${passes.userId} and q.char_id = ${passes.charId})::int`,
  plain: passWallets.plain,
};
type WornRow = { passId: number; charId: number; no: number; drawnAt: Date; copies: number; plain: number[] | null };

type Pictures = { art: Awaited<ReturnType<typeof passArtIndex>>; avatars: OperatorArtIndex };
const pictures = async (): Promise<Pictures> => ({ art: await passArtIndex(), avatars: await operatorArtIndex() });

/** A worn pass as cards show it: what the catalogue and the pictures say of the character; null for one not there */
function cardOf(r: WornRow, { art, avatars }: Pictures): PassOnCard | null {
  const c = passChar(r.charId);
  if (!c) return null;
  const a = art.get(c.id);
  return {
    game: c.game,
    charId: c.id,
    name: c.name,
    en: c.en,
    rarity: c.rarity,
    no: r.no,
    copies: r.copies,
    fancy: isFancy(r.copies, (r.plain ?? []).includes(c.id)),
    color: a?.color ?? c.color,
    art: a?.file ?? null,
    avatar: avatars[GAME_OF[c.game]][c.name] ?? null,
    drawnAt: r.drawnAt.getTime(),
  };
}

/** The pass a player wears, as their own pages show it */
async function wornOf(userId: string): Promise<WornPass | null> {
  const [r] = await db
    .select(wornColumns)
    .from(users)
    .innerJoin(passes, eq(passes.id, users.wornPass))
    .leftJoin(passWallets, eq(passWallets.userId, passes.userId))
    .where(eq(users.id, userId))
    .limit(1);
  const card = r ? cardOf(r, await pictures()) : null;
  return card && { ...card, passId: r.passId };
}

/**
 * Whether a player sees the passes others wear: everyone while PASSES is on, only the 站长 and the admins while it is
 * admins (as only they may draw), nobody while it is off; viewer null: nobody's card is being looked at, so none.
 */
async function passesShownTo(viewerId: string | null): Promise<boolean> {
  const mode = passesMode();
  if (mode === "off" || !viewerId) return false;
  if (mode === "on" || isModHere(viewerId)) return true;
  const [v] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, viewerId)).limit(1);
  return Boolean(v && passesOpen(v));
}

/**
 * The passes these players wear, as their profile cards show them to the viewer (world.ts cardsOf): to those who
 * may see their profile, the number too (src/lib/profile.ts). Nothing asked of the database for players who wear none.
 */
export async function wornPasses(people: readonly Pick<UserRow, "id" | "wornPass">[], viewerId: string | null): Promise<Map<string, PassOnCard>> {
  const out = new Map<string, PassOnCard>();
  const ids = people.flatMap((u) => (u.wornPass === null ? [] : [u.wornPass]));
  if (!ids.length || !(await passesShownTo(viewerId))) return out;
  const rows = await db
    .select(wornColumns)
    .from(passes)
    .leftJoin(passWallets, eq(passWallets.userId, passes.userId))
    .where(inArray(passes.id, ids));
  const pics = await pictures();
  for (const r of rows) {
    const card = cardOf(r, pics);
    if (card) out.set(r.userId, card);
  }
  return out;
}

/** A player's passes of one character, lowest number first: which one to wear */
export async function copiesOf(userId: string, charId: unknown): Promise<CharCopies> {
  if (!isPassChar(charId)) throw new HttpError(400, T.server.passes.badChar);
  const rows = await db
    .select({ id: passes.id, no: passes.no, at: passes.drawnAt })
    .from(passes)
    .where(and(eq(passes.userId, userId), eq(passes.charId, charId)))
    .orderBy(asc(passes.no));
  return { charId, copies: rows.map((r) => ({ id: r.id, no: r.no, at: r.at.getTime() })) };
}

/**
 * The look of a character's passes: plain keeps the normal one (① ③) though the player has two or more, which would
 * bring the special one (② ④); only with two or more, since one pass has no other look yet.
 */
export async function setLook(user: UserRow, charId: unknown, plain: unknown, now = Date.now()): Promise<PassState> {
  if (!isPassChar(charId) || typeof plain !== "boolean") throw new HttpError(400, T.server.passes.badChar);
  await walletOf(user.id);
  const [{ n }] = await db
    .select({ n: count() })
    .from(passes)
    .where(and(eq(passes.userId, user.id), eq(passes.charId, charId)));
  if (n < 2) throw new HttpError(409, T.server.passes.lookNeedsTwo);
  const id = sql`${charId}::smallint`;
  await db
    .update(passWallets)
    .set({ plain: plain ? sql`array_append(array_remove(${passWallets.plain}, ${id}), ${id})` : sql`array_remove(${passWallets.plain}, ${id})` })
    .where(eq(passWallets.userId, user.id));
  return passState(user.id, now);
}

/** Wear one of the player's own passes on their profile card (passId), or none (null) */
export async function wear(user: UserRow, passId: unknown, now = Date.now()): Promise<PassState> {
  if (passId !== null && !(typeof passId === "number" && Number.isSafeInteger(passId) && passId > 0)) {
    throw new HttpError(400, T.server.passes.notYours);
  }
  await walletOf(user.id);
  if (passId === null) {
    await db.update(users).set({ wornPass: null }).where(eq(users.id, user.id));
  } else {
    const theirs = db
      .select({ one: sql`1` })
      .from(passes)
      .where(and(eq(passes.id, passId), eq(passes.userId, user.id)));
    const done = await db
      .update(users)
      .set({ wornPass: passId })
      .where(and(eq(users.id, user.id), exists(theirs)))
      .returning({ id: users.id });
    if (!done.length) throw new HttpError(404, T.server.passes.notYours);
  }
  return passState(user.id, now);
}
