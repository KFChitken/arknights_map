import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { GAMES } from "../games";
import { HOT_BOARDS, HOT_MIN_PLAYERS, HOT_SIZE, WEEK, weekStartOf, type HotBoard, type HotList, type HotRow } from "../hotList";
import { isOperator } from "../operators";
import { db } from "./db";
import { declarations, users } from "./schema";

/** One board for one week: each player counts once per character, however often they shouted it. */
async function board(template: HotBoard, from: number, to: number): Promise<HotRow[]> {
  const players = sql<number>`count(distinct ${declarations.senderId})::int`;
  const rows = await db
    .select({ character: declarations.character, players })
    .from(declarations)
    .innerJoin(users, eq(users.id, declarations.senderId))
    .where(
      and(
        eq(declarations.template, template),
        gte(declarations.createdAt, new Date(from)),
        lt(declarations.createdAt, new Date(to)),
        isNull(users.demoKey),
      ),
    )
    .groupBy(declarations.character)
    .having(sql`count(distinct ${declarations.senderId}) >= ${HOT_MIN_PLAYERS}`)
    .orderBy(desc(players), asc(declarations.character))
    .limit(HOT_SIZE);
  return rows.map((r) => ({
    // ties share a place
    rank: rows.findIndex((x) => x.players === r.players) + 1,
    character: r.character ?? "",
    // a declaration keeps only the name, so the game comes from the lists; a name in both gets both
    games: GAMES.filter((g) => isOperator(g, r.character ?? "")),
    players: r.players,
  }));
}

/** This week's boards and last week's winners, worked out from the declarations, which are kept 90 days. */
export async function computeHotList(now = Date.now()): Promise<HotList> {
  const weekStart = weekStartOf(now);
  const boards = {} as HotList["boards"];
  const lastWeek = {} as HotList["lastWeek"];
  for (const { id } of HOT_BOARDS) {
    boards[id] = await board(id, weekStart, weekStart + WEEK);
    lastWeek[id] = (await board(id, weekStart - WEEK, weekStart))[0] ?? null;
  }
  return { weekStart, boards, lastWeek };
}

const CACHE_MS = 5 * 60_000;
let cached: { at: number; list: HotList } | null = null;

/** The same for every viewer, worked out at most every few minutes. */
export async function hotList(now = Date.now()) {
  if (!cached || now - cached.at > CACHE_MS || weekStartOf(now) !== cached.list.weekStart) {
    cached = { at: now, list: await computeHotList(now) };
  }
  return cached.list;
}
