import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { beijingDate, beijingMidnight } from "../beijing";
import { isGame, type Game } from "../games";
import { CLUES, HELP_GAMES, HELP_HOURS, HELP_KEEP_DAYS, HELP_PER_DAY, isHelpKind, SKILLS, type HelpAsk, type HelpKind } from "../help";
import { isOperator } from "../operators";
import { WorldError, type HelpBoard, type HelpItem } from "../world/types";
import { db } from "./db";
import { isUniqueViolation, lockPlayer } from "./guides";
import { nudge } from "./live";
import { earn } from "./passes";
import { friendStars, helpAnswers, helpRequests, users, type UserRow } from "./schema";
import { cardsOf, friendIdsOf, friendKey, userById } from "./world";

/**
 * 求助 among 触须之交 (src/lib/help.ts): 缺线索, 来线索交流, 借助战. A request is seen only by
 * the asker's 触须之交 who play its game, and only while they are 触须之交; it is up for
 * HELP_HOURS unless closed, and a new one of the same kind and game takes its place. Nothing is
 * pushed at anyone: a quiet "help" event refreshes the dot on their 触须之交 card, no message,
 * no pop-up. Everything is deleted after HELP_KEEP_DAYS.
 */

const HOUR = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Request = typeof helpRequests.$inferSelect;

/** Clue numbers 1–7, each once, in order */
function cluesOf(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(Number))].filter((n) => (CLUES as readonly number[]).includes(n)).sort((a, b) => a - b);
}

/** What a request asks, picked from the lists only */
function askOf(input: unknown): HelpAsk {
  const x = (input ?? {}) as Record<string, unknown>;
  if (!isHelpKind(x.kind)) throw new WorldError(T.server.help.noSuchKind);
  if (!isGame(x.game) || !HELP_GAMES[x.kind].includes(x.game)) throw new WorldError(T.server.help.notForThisGame);
  if (x.kind === "clues") {
    const clues = cluesOf(x.clues);
    if (!clues.length) throw new WorldError(T.server.help.pickClues);
    return { kind: "clues", game: x.game, clues };
  }
  if (x.kind === "support") {
    const operator = String(x.operator ?? "");
    if (!isOperator("arknights", operator)) throw new WorldError(T.server.help.pickOperator);
    const skill = Number(x.skill);
    if (!(SKILLS as readonly number[]).includes(skill)) throw new WorldError(T.server.help.pickSkill);
    return { kind: "support", game: "arknights", operator, skill };
  }
  return { kind: "exchange", game: x.game };
}

const askOfRow = (r: Request): HelpAsk => ({
  kind: r.kind as HelpKind,
  game: r.game as Game,
  ...(r.clues ? { clues: r.clues } : {}),
  ...(r.operator ? { operator: r.operator, skill: r.skill ?? 0 } : {}),
});

const openAt = (now: number) => and(isNull(helpRequests.closedAt), gt(helpRequests.expiresAt, new Date(now)));

/** Your 触须之交 who play a game: whom a request for it reaches */
async function playersOf(userId: string, game: Game) {
  const friends = [...(await friendIdsOf(userId))];
  if (!friends.length) return [];
  const rows = await db.select({ id: users.id, games: users.games }).from(users).where(inArray(users.id, friends));
  return rows.filter((u) => u.games.includes(game)).map((u) => u.id);
}

/** Put up a request; one of the same kind and game still up gives way to it */
export async function askHelp(userId: string, input: unknown) {
  const ask = askOf(input);
  const now = Date.now();
  await db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    const [sent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(helpRequests)
      .where(
        and(
          eq(helpRequests.userId, userId),
          eq(helpRequests.kind, ask.kind),
          eq(helpRequests.game, ask.game),
          gte(helpRequests.createdAt, new Date(beijingMidnight(beijingDate(now)))),
        ),
      );
    if (Number(sent?.n ?? 0) >= HELP_PER_DAY) throw new WorldError(fmt(T.server.help.usedUp, { max: HELP_PER_DAY }));
    await tx
      .update(helpRequests)
      .set({ closedAt: new Date(now) })
      .where(and(eq(helpRequests.userId, userId), eq(helpRequests.kind, ask.kind), eq(helpRequests.game, ask.game), isNull(helpRequests.closedAt)));
    await tx.insert(helpRequests).values({
      userId,
      kind: ask.kind,
      game: ask.game,
      clues: ask.clues ?? null,
      operator: ask.operator ?? null,
      skill: ask.kind === "support" ? (ask.skill ?? 0) : null,
      createdAt: new Date(now),
      expiresAt: new Date(now + HELP_HOURS * HOUR),
    });
  });
  nudge(await playersOf(userId, ask.game), "help");
}

/** 关掉 one of yours before its time */
export async function closeHelp(userId: string, requestId: unknown) {
  const id = String(requestId).toLowerCase();
  if (!UUID.test(id)) throw new WorldError(T.server.help.over);
  const [done] = await db
    .update(helpRequests)
    .set({ closedAt: new Date() })
    .where(and(eq(helpRequests.id, id), eq(helpRequests.userId, userId), isNull(helpRequests.closedAt)))
    .returning({ game: helpRequests.game });
  if (!done) throw new WorldError(T.server.help.over);
  nudge(await playersOf(userId, done.game as Game), "help");
}

/** Answer a 触须之交's request once: 送了 (which of the clues asked for), 去拜访了, 我挂上了 */
export async function answerHelp(userId: string, requestId: unknown, clues?: unknown) {
  const id = String(requestId).toLowerCase();
  if (!UUID.test(id)) throw new WorldError(T.server.help.over);
  const now = Date.now();
  const [r] = await db.select().from(helpRequests).where(eq(helpRequests.id, id)).limit(1);
  if (!r || r.closedAt || r.expiresAt.getTime() <= now) throw new WorldError(T.server.help.over);
  if (r.userId === userId) throw new WorldError(T.server.help.yourOwn);
  if (!(await friendIdsOf(userId)).has(r.userId)) throw new WorldError(T.server.common.notFriends);
  const self = await userById(userId);
  if (!self?.games.includes(r.game)) throw new WorldError(T.server.help.notPlaying);
  let sent: number[] | null = null;
  if (r.kind === "clues") {
    sent = cluesOf(clues).filter((n) => r.clues?.includes(n));
    if (!sent.length) throw new WorldError(T.server.help.pickSent);
  }
  try {
    await db.insert(helpAnswers).values({ requestId: r.id, fromUserId: userId, clues: sent, createdAt: new Date(now) });
  } catch (e) {
    if (isUniqueViolation(e)) throw new WorldError(T.server.help.answered);
    throw e;
  }
  await earn(userId, "social");
  nudge([r.userId], "help");
}

/** What is up: your own requests with who answered, and your 触须之交's in your games, 特别关注 first */
export async function helpBoard(userId: string, now = Date.now()): Promise<HelpBoard> {
  const self = await userById(userId);
  if (!self) return { mine: [], theirs: [] };
  const friends = [...(await friendIdsOf(userId))];
  const seenAt = self.helpSeenAt?.getTime() ?? 0;

  const mineRows = await db
    .select()
    .from(helpRequests)
    .where(and(eq(helpRequests.userId, userId), openAt(now)))
    .orderBy(desc(helpRequests.createdAt));
  const answers = mineRows.length
    ? (
        await db
          .select()
          .from(helpAnswers)
          .where(inArray(helpAnswers.requestId, mineRows.map((r) => r.id)))
          .orderBy(desc(helpAnswers.createdAt))
      ).filter((a) => friends.includes(a.fromUserId))
    : [];

  const theirRows =
    friends.length && self.games.length
      ? await db
          .select()
          .from(helpRequests)
          .where(and(inArray(helpRequests.userId, friends), openAt(now), inArray(helpRequests.game, self.games)))
          .orderBy(desc(helpRequests.createdAt))
      : [];
  const mineAnswered = theirRows.length
    ? await db
        .select()
        .from(helpAnswers)
        .where(and(eq(helpAnswers.fromUserId, userId), inArray(helpAnswers.requestId, theirRows.map((r) => r.id))))
    : [];

  const people = new Map<string, UserRow>();
  for (const id of new Set([...answers.map((a) => a.fromUserId), ...theirRows.map((r) => r.userId)])) {
    const u = await userById(id);
    if (u) people.set(id, u);
  }
  const cards = await cardsOf([...people.values()], userId);
  const stars = new Map((await db.select().from(friendStars).where(eq(friendStars.userId, userId))).map((s) => [s.other, s.createdAt.getTime()]));

  const mine: HelpItem[] = mineRows.map((r) => {
    const theirs = answers.filter((a) => a.requestId === r.id && cards.has(a.fromUserId));
    return {
      id: r.id,
      ...askOfRow(r),
      at: r.createdAt.getTime(),
      until: r.expiresAt.getTime(),
      fresh: theirs.some((a) => !a.seenAt),
      answers: theirs.map((a) => ({
        friendId: friendKey(userId, a.fromUserId),
        name: cards.get(a.fromUserId)!.displayName,
        ...(a.clues ? { clues: a.clues } : {}),
        at: a.createdAt.getTime(),
        fresh: !a.seenAt,
      })),
    };
  });
  const theirs: HelpItem[] = theirRows
    .filter((r) => cards.has(r.userId))
    .map((r) => {
      const answered = mineAnswered.find((a) => a.requestId === r.id);
      return {
        id: r.id,
        ...askOfRow(r),
        at: r.createdAt.getTime(),
        until: r.expiresAt.getTime(),
        fresh: r.createdAt.getTime() > seenAt,
        from: cards.get(r.userId)!,
        friendId: friendKey(userId, r.userId),
        answered: answered ? { ...(answered.clues ? { clues: answered.clues } : {}) } : null,
      };
    })
    // 特别关注 first, in the order starred; then the newest
    .sort((x, y) => {
      const sx = stars.get(theirRows.find((r) => r.id === x.id)!.userId) ?? Infinity;
      const sy = stars.get(theirRows.find((r) => r.id === y.id)!.userId) ?? Infinity;
      return sx - sy || y.at - x.at;
    });
  return { mine, theirs };
}

/** You looked: the dot on the 触须之交 card goes, until something new comes up */
export async function seeHelp(userId: string) {
  const now = new Date();
  await db.update(users).set({ helpSeenAt: now }).where(eq(users.id, userId));
  const mine = db.select({ id: helpRequests.id }).from(helpRequests).where(eq(helpRequests.userId, userId));
  await db.update(helpAnswers).set({ seenAt: now }).where(and(isNull(helpAnswers.seenAt), inArray(helpAnswers.requestId, mine)));
}

/** For the dot: your 触须之交's requests up since you last looked, and answers to yours you have not seen */
export async function helpCounts(self: UserRow, now = Date.now()) {
  const friends = [...(await friendIdsOf(self.id))];
  if (!friends.length) return { asks: 0, answers: 0 };
  const [asks] = self.games.length
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(helpRequests)
        .where(
          and(
            inArray(helpRequests.userId, friends),
            openAt(now),
            inArray(helpRequests.game, self.games),
            ...(self.helpSeenAt ? [gt(helpRequests.createdAt, self.helpSeenAt)] : []),
          ),
        )
    : [{ n: 0 }];
  const [answers] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(helpAnswers)
    .innerJoin(helpRequests, eq(helpRequests.id, helpAnswers.requestId))
    .where(and(eq(helpRequests.userId, self.id), openAt(now), isNull(helpAnswers.seenAt), inArray(helpAnswers.fromUserId, friends)));
  return { asks: Number(asks?.n ?? 0), answers: Number(answers?.n ?? 0) };
}

/** The daily clean-up: requests (and their answers with them) after HELP_KEEP_DAYS */
export async function pruneHelp(now = Date.now()) {
  await db.delete(helpRequests).where(lt(helpRequests.createdAt, new Date(now - HELP_KEEP_DAYS * 24 * HOUR)));
}
