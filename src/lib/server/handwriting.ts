import "server-only";
import { and, asc, count, eq, gte, inArray, isNull, lt, ne, notExists, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { beijingDayWords } from "../beijing";
import { cleanPlayerText } from "../playerText";
import { displayName } from "../profile";
import { RELIABLE_AFTER_DAYS, REPORT_NOTE_MAX, REPORTS_PER_DAY } from "../rules";
import { isWritingReportReason, noteMissing, WRITING_REPORT_REASONS } from "../safety";
import { siteDay } from "../siteDay";
import {
  averageOf,
  BOARD,
  isScore,
  isShow,
  markSheet,
  rankAmong,
  rankPapers,
  readSheet,
  scoreOf,
  simplified,
  STALE_DEAL,
  type BoardDesk,
  type BoardMine,
  type BoardPage,
  type BoardRow,
  type DealState,
  type Dealt,
  type Passed,
  type Ranked,
  type RateState,
  type Sheet,
} from "../study/board";
import { db } from "./db";
import { studyMode } from "./env";
import { HttpError } from "./http";
import { nameThen, paperContext, reliableReporter, reportedToday, tellAdmin } from "./safety";
import { blocks, handwritingRatings, handwritings, reports, users, type UserRow } from "./schema";
import { boardSettings } from "./siteSettings";

/**
 * 手写榜 (src/lib/study/board.ts): a player's paper of 徒手写, passed (the server marks it again, as the page did), put
 * up for everyone, one a player (each replaces the last, its ratings with it); rated 0 to BOARD.max by players who once
 * passed 徒手写, three days or more after they signed up, never their own, nor one of someone they blocked or who
 * blocked them, each once; reported like a roach on the map (nobody blocked, the writer never named to the reporter),
 * hidden while three reliable players' reports of it wait for the admin (admin.ts settles them). Rated papers are
 * ranked at most once a minute by each process; a page of the board reads only its papers and their writers' names.
 * Who rated what is never shown. Paused from the 管理台 (siteSettings.ts): no board, nothing put up, nothing rated.
 */

const DAY_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Reliable players whose reports of a paper wait, from which it is hidden */
export const HIDE_AFTER = 3;
/** Papers dealt from: those so few have rated, the fewest first, one of them at random */
const DEAL_FROM = 20;
/** How long a process keeps the board as ranked */
const RANK_MS = 60_000;
/** The reasons of a paper's reports, which are cases of their own (admin.ts) */
export const WRITING_KEYS = Object.keys(WRITING_REPORT_REASONS) as (keyof typeof WRITING_REPORT_REASONS)[];

/** Whether the owner paused the 手写榜 in the 管理台 */
export const boardPaused = () => boardSettings().paused;

// ---- the board, ranked ----

/** The board as ranked: when, the site's average rating then, and the papers on it, the highest first */
type Ranking = { at: number; average: number; ranked: Ranked[] };
const g = globalThis as unknown as { handwritingBoard?: { ranking: Ranking | null; loading: Promise<Ranking> | null; gen: number } };
const kept = (g.handwritingBoard ??= { ranking: null, loading: null, gen: 0 });

async function rankNow(now: number): Promise<Ranking> {
  const [[all], rows] = await Promise.all([
    db
      .select({
        sum: sql<number>`coalesce(sum(${handwritings.sum}), 0)`.mapWith(Number),
        n: sql<number>`coalesce(sum(${handwritings.n}), 0)`.mapWith(Number),
      })
      .from(handwritings),
    db
      .select({ id: handwritings.id, n: handwritings.n, sum: handwritings.sum, n799: handwritings.n799, at: handwritings.createdAt })
      .from(handwritings)
      .where(and(isNull(handwritings.hiddenAt), gte(handwritings.n, BOARD.minRaters))),
  ]);
  const average = averageOf(all.sum, all.n);
  return { at: now, average, ranked: rankPapers(rows.map((r) => ({ ...r, at: r.at.getTime() })), average) };
}

/** The board as ranked in the last minute, or ranked again now; asked for meanwhile, the one ranking answers all */
export function ranking(now = Date.now()): Promise<Ranking> {
  const r = kept.ranking;
  if (r && now >= r.at && now - r.at < RANK_MS) return Promise.resolve(r);
  if (kept.loading) return kept.loading;
  const gen = kept.gen;
  const loading = rankNow(now)
    .then((fresh) => {
      // changed while ranking: kept only till the next ask
      if (kept.gen === gen) kept.ranking = fresh;
      return fresh;
    })
    .finally(() => {
      if (kept.loading === loading) kept.loading = null;
    });
  kept.loading = loading;
  return loading;
}

/** Ranked again at the next ask: this process put a paper up, took one down, hid it or let it back */
export function boardChanged() {
  kept.gen++;
  kept.ranking = null;
  kept.loading = null;
}

/** The 管理台's 手写榜 card: STUDY, paused or not, the papers up, on the board and hidden, and the ratings given */
export async function boardDesk(now = Date.now()): Promise<BoardDesk> {
  const [[c], board] = await Promise.all([
    db
      .select({
        papers: count(),
        hidden: count(handwritings.hiddenAt),
        ratings: sql<number>`coalesce(sum(${handwritings.n}), 0)`.mapWith(Number),
      })
      .from(handwritings),
    ranking(now),
  ]);
  return { mode: studyMode(), paused: boardPaused(), papers: c.papers, ranked: board.ranked.length, hidden: c.hidden, ratings: c.ratings };
}

/** A paper's score now, as the board would give it (the 管理台's case shows it) */
export const scoreNow = async (sum: number, n: number, now = Date.now()) => scoreOf(sum, n, (await ranking(now)).average);

/** The name a paper is shown under: its writer's on the map, or null for 匿名舟P (put up anonymously, or anonymous on the map, or no name) */
const shownName = (show: string, u: Pick<UserRow, "name" | "anonymous" | "drPrefix">) => (show === "named" && !u.anonymous && u.name.trim() ? displayName(u) : null);

/** The player's own paper, for the line under the board: its place, unless it is not on the board yet (or hidden) */
async function mineOf(userId: string, now: number): Promise<BoardMine | null> {
  const [p] = await db
    .select({ id: handwritings.id, n: handwritings.n, sum: handwritings.sum, n799: handwritings.n799, at: handwritings.createdAt, hiddenAt: handwritings.hiddenAt })
    .from(handwritings)
    .where(eq(handwritings.userId, userId));
  if (!p) return null;
  const board = await ranking(now);
  const score = scoreOf(p.sum, p.n, board.average);
  const hidden = p.hiddenAt !== null;
  const on = !hidden && p.n >= BOARD.minRaters;
  return {
    id: p.id,
    rank: on ? rankAmong(board.ranked, { id: p.id, score, n: p.n, n799: p.n799, at: p.at.getTime() }) : null,
    score,
    n: p.n,
    n799: p.n799,
    hidden,
  };
}

/**
 * A page of the board (from 1; past the last, the last), and for a player their own paper and whether they may rate.
 * While it is paused, only their own paper, so they may still take it down.
 */
export async function boardPage(user: UserRow | null, page: unknown, now = Date.now()): Promise<BoardPage> {
  const mine = user ? await mineOf(user.id, now) : null;
  if (boardPaused()) return { paused: true, mine };
  const board = await ranking(now);
  const pages = Math.max(1, Math.ceil(board.ranked.length / BOARD.page));
  const p = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  const slice = board.ranked.slice((p - 1) * BOARD.page, p * BOARD.page);
  const found = slice.length
    ? await db
        .select({
          id: handwritings.id,
          strokes: handwritings.strokes,
          show: handwritings.show,
          hiddenAt: handwritings.hiddenAt,
          name: users.name,
          anonymous: users.anonymous,
          drPrefix: users.drPrefix,
        })
        .from(handwritings)
        .innerJoin(users, eq(users.id, handwritings.userId))
        .where(
          inArray(
            handwritings.id,
            slice.map((r) => r.id),
          ),
        )
    : [];
  const byId = new Map(found.map((f) => [f.id, f]));
  // one taken down or hidden since the ranking is left out till the next
  const rows = slice.flatMap((r, i): BoardRow[] => {
    const f = byId.get(r.id);
    if (!f || f.hiddenAt) return [];
    return [{ id: r.id, rank: (p - 1) * BOARD.page + i + 1, sheet: f.strokes, name: shownName(f.show, f), score: r.score, n: r.n, n799: r.n799 }];
  });
  return { paused: false, rows, page: p, pages, mine, rate: user ? rateStateOf(user, siteDay(now), now) : { can: false, why: "signIn" } };
}

// ---- a paper passed, put up and taken down ----

/** A paper as sent, or the refusal: too big, or none at all */
function sheetOf(v: unknown): Sheet {
  const sheet = readSheet(v);
  if (sheet === "big") throw new HttpError(400, T.server.board.tooBig);
  if (!sheet) throw new HttpError(400, T.server.board.badPaper);
  return sheet;
}

/** The counts of a site day: kept while it is the day they were counted on, none once it is another */
const counted = (col: AnyColumn, day: string) => sql<number>`case when ${users.writeDay} = ${day} then ${col} else 0 end`;
/** Today's counts, carried into the day they are counted on now (one of them then goes up by one) */
const dayCounts = (day: string) => ({
  writeDay: day,
  writeRates: counted(users.writeRates, day),
  writeSkips: counted(users.writeSkips, day),
  writePublishes: counted(users.writePublishes, day),
});
const ofToday = (u: Pick<UserRow, "writeDay">, n: number, day: string) => (u.writeDay === day ? n : 0);

/** Why a paused player may not put a paper up or rate: until when */
const suspendedTill = (u: Pick<UserRow, "suspendedUntil">, now: number) => (u.suspendedUntil && u.suspendedUntil.getTime() > now ? u.suspendedUntil.getTime() : null);

/**
 * A paper passed: marked again here as the page marked it, the player then known to have passed 徒手写 (whatever day,
 * for rating), the paper itself not kept. Under 60, or a square read as another digit, is refused. Says their own
 * paper on the board (for putting up this one in its place), how many more they may put up today, and whether the
 * board is paused.
 */
export async function passPaper(user: UserRow, squares: unknown, now = Date.now()): Promise<Passed> {
  const sheet = sheetOf(squares);
  if (!markSheet(sheet).passed) throw new HttpError(400, T.server.board.notPassed);
  await db.update(users).set({ writePassedAt: new Date(now) }).where(eq(users.id, user.id));
  const day = siteDay(now);
  return { mine: await mineOf(user.id, now), publishesLeft: Math.max(0, BOARD.publishesPerDay - ofToday(user, user.writePublishes, day)), paused: boardPaused() };
}

/**
 * A paper passed put on the board (show: as 匿名舟P, or named), in place of the player's last one, whose ratings go
 * with it; BOARD.publishesPerDay a site day. Marked again here, and kept simplified (board.ts simplified). Not while
 * their interactions are paused (暂停互动). Says their own paper now.
 */
export async function publishPaper(user: UserRow, squares: unknown, show: unknown, now = Date.now()): Promise<BoardMine | null> {
  const sheet = sheetOf(squares);
  if (!isShow(show)) throw new HttpError(400, T.server.board.pickShow);
  const paused = suspendedTill(user, now);
  if (paused) throw new HttpError(403, fmt(T.server.board.suspendedPublish, { until: beijingDayWords(paused) }));
  const { mark, passed } = markSheet(sheet);
  if (!passed) throw new HttpError(400, T.server.board.notPassed);
  const day = siteDay(now);
  await db.transaction(async (tx) => {
    const [u] = await tx
      .update(users)
      .set({ ...dayCounts(day), writePublishes: sql`${counted(users.writePublishes, day)} + 1`, writePassedAt: new Date(now) })
      .where(and(eq(users.id, user.id), or(isNull(users.writeDay), ne(users.writeDay, day), lt(users.writePublishes, BOARD.publishesPerDay))))
      .returning({ id: users.id });
    if (!u) throw new HttpError(429, fmt(T.server.board.publishedEnough, { n: BOARD.publishesPerDay }));
    await tx.delete(handwritings).where(eq(handwritings.userId, user.id));
    await tx.insert(handwritings).values({ userId: user.id, strokes: simplified(sheet), mark, show, createdAt: new Date(now) });
  });
  boardChanged();
  return mineOf(user.id, now);
}

/** The player's own paper taken off the board, and every rating it had with it. Says whether there was one. */
export async function withdrawPaper(user: Pick<UserRow, "id">): Promise<boolean> {
  const gone = await db.delete(handwritings).where(eq(handwritings.userId, user.id)).returning({ id: handwritings.id });
  if (gone.length) boardChanged();
  return gone.length > 0;
}

// ---- rating ----

/** Whether this player may rate now (STUDY open to them is the route's to say), and if not why */
export function rateStateOf(u: Pick<UserRow, "createdAt" | "suspendedUntil" | "writePassedAt" | "writeDay" | "writeRates" | "writeSkips">, day: string, now: number): RateState {
  if (!u.writePassedAt) return { can: false, why: "pass" };
  if (now - u.createdAt.getTime() < RELIABLE_AFTER_DAYS * DAY_MS) return { can: false, why: "young" };
  const until = suspendedTill(u, now);
  if (until) return { can: false, why: "suspended", until };
  const rates = ofToday(u, u.writeRates, day);
  if (rates >= BOARD.ratesPerDay) return { can: false, why: "full" };
  return { can: true, left: BOARD.ratesPerDay - rates, skipsLeft: Math.max(0, BOARD.skipsPerDay - ofToday(u, u.writeSkips, day)) };
}

/** A refusal for a player who may not rate, in their words */
function cannotRate(r: Exclude<RateState, { can: true }>): HttpError {
  if (r.why === "suspended") return new HttpError(403, fmt(T.server.board.suspendedRate, { until: beijingDayWords(r.until) }));
  return new HttpError(r.why === "full" ? 429 : 403, fmt(T.server.board.cannotRate[r.why], { n: BOARD.ratesPerDay, days: RELIABLE_AFTER_DAYS }));
}

/**
 * Papers this player may be dealt: not hidden, not their own, not rated or reported by them yet, and neither written
 * by someone they blocked nor by someone who blocked them
 */
function dealable(userId: string): SQL {
  return and(
    isNull(handwritings.hiddenAt),
    ne(handwritings.userId, userId),
    notExists(
      db
        .select({ one: sql`1` })
        .from(handwritingRatings)
        .where(and(eq(handwritingRatings.writingId, handwritings.id), eq(handwritingRatings.raterId, userId))),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(reports)
        .where(and(eq(reports.writingId, handwritings.id), eq(reports.reporterId, userId))),
    ),
    notExists(
      db
        .select({ one: sql`1` })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, userId), eq(blocks.blockedId, handwritings.userId)),
            and(eq(blocks.blockerId, handwritings.userId), eq(blocks.blockedId, userId)),
          ),
        ),
    ),
  )!;
}

/** A paper dealt to this player now, kept as theirs to rate (never the one just skipped): of the fewest rated, one at random; null when none is left */
async function dealNew(userId: string, skipped: string | null, random: () => number): Promise<Dealt | null> {
  const few = await db
    .select({ id: handwritings.id, strokes: handwritings.strokes })
    .from(handwritings)
    .where(skipped ? and(dealable(userId), ne(handwritings.id, skipped)) : dealable(userId))
    .orderBy(asc(handwritings.n), asc(handwritings.createdAt))
    .limit(DEAL_FROM);
  const pick = few.length ? few[Math.min(few.length - 1, Math.floor(random() * few.length))] : null;
  await db
    .update(users)
    .set({ writeDeal: pick?.id ?? null })
    .where(eq(users.id, userId));
  return pick && { id: pick.id, sheet: pick.strokes };
}

/** The paper this player is to rate: the one dealt them, while they still may be dealt it, else another */
export async function dealPaper(user: UserRow, now = Date.now(), random: () => number = Math.random): Promise<DealState> {
  const rate = rateStateOf(user, siteDay(now), now);
  if (!rate.can) return { deal: null, rate };
  if (user.writeDeal) {
    const [still] = await db
      .select({ id: handwritings.id, strokes: handwritings.strokes })
      .from(handwritings)
      .where(and(eq(handwritings.id, user.writeDeal), dealable(user.id)));
    if (still) return { deal: { id: still.id, sheet: still.strokes }, rate };
  }
  return { deal: await dealNew(user.id, null, random), rate };
}

/** What is read back of the player after rating or skipping, for whether they may rate on */
const RATER = {
  createdAt: users.createdAt,
  suspendedUntil: users.suspendedUntil,
  writePassedAt: users.writePassedAt,
  writeDay: users.writeDay,
  writeRates: users.writeRates,
  writeSkips: users.writeSkips,
};

/**
 * The paper dealt (deal) rated: a whole number from 0 to BOARD.max, once, on the player's day's BOARD.ratesPerDay;
 * its count, sum and 799s go up with it. Another paper than the one dealt them (another tab, or it was hidden or
 * taken down meanwhile), or one they may be dealt no longer (they reported it since, or a block stands between them
 * and its writer), is refused (409), and the page asks for the one to rate. Says the next, dealt now.
 */
export async function ratePaper(user: UserRow, deal: unknown, score: unknown, now = Date.now(), random: () => number = Math.random): Promise<DealState> {
  const day = siteDay(now);
  const may = rateStateOf(user, day, now);
  if (!may.can) throw cannotRate(may);
  if (!isScore(score)) throw new HttpError(400, fmt(T.server.board.badScore, { max: BOARD.max }));
  const id = String(deal);
  if (!UUID.test(id)) throw new HttpError(409, T.server.board.staleDeal, STALE_DEAL);
  const meme = score === BOARD.meme;
  const after = await db.transaction(async (tx) => {
    const [u] = await tx
      .update(users)
      .set({ ...dayCounts(day), writeRates: sql`${counted(users.writeRates, day)} + 1`, writeDeal: null })
      .where(and(eq(users.id, user.id), eq(users.writeDeal, id), or(isNull(users.writeDay), ne(users.writeDay, day), lt(users.writeRates, BOARD.ratesPerDay))))
      .returning(RATER);
    if (!u) throw new HttpError(409, T.server.board.staleDeal, STALE_DEAL);
    const [up] = await tx
      .update(handwritings)
      .set({ n: sql`${handwritings.n} + 1`, sum: sql`${handwritings.sum} + ${score}`, n799: sql`${handwritings.n799} + ${meme ? 1 : 0}` })
      .where(and(eq(handwritings.id, id), dealable(user.id)))
      .returning({ id: handwritings.id });
    if (!up) throw new HttpError(409, T.server.board.staleDeal, STALE_DEAL);
    const [rated] = await tx.insert(handwritingRatings).values({ writingId: id, raterId: user.id, score, meme, createdAt: new Date(now) }).onConflictDoNothing().returning({ at: handwritingRatings.createdAt });
    if (!rated) throw new HttpError(409, T.server.board.ratedAlready, STALE_DEAL);
    return u;
  });
  const rate = rateStateOf(after, day, now);
  return { deal: rate.can ? await dealNew(user.id, null, random) : null, rate };
}

/** The paper dealt skipped: another dealt in its place, never it again at once; BOARD.skipsPerDay a site day */
export async function skipPaper(user: UserRow, deal: unknown, now = Date.now(), random: () => number = Math.random): Promise<DealState> {
  const day = siteDay(now);
  const may = rateStateOf(user, day, now);
  if (!may.can) throw cannotRate(may);
  if (may.skipsLeft <= 0) throw new HttpError(429, fmt(T.server.board.skippedEnough, { n: BOARD.skipsPerDay }));
  const id = String(deal);
  if (!UUID.test(id)) throw new HttpError(409, T.server.board.staleDeal, STALE_DEAL);
  const [u] = await db
    .update(users)
    .set({ ...dayCounts(day), writeSkips: sql`${counted(users.writeSkips, day)} + 1`, writeDeal: null })
    .where(and(eq(users.id, user.id), eq(users.writeDeal, id), or(isNull(users.writeDay), ne(users.writeDay, day), lt(users.writeSkips, BOARD.skipsPerDay))))
    .returning(RATER);
  if (!u) throw new HttpError(409, T.server.board.staleDeal, STALE_DEAL);
  const rate = rateStateOf(u, day, now);
  return { deal: rate.can ? await dealNew(user.id, id, random) : null, rate };
}

// ---- reports ----

/** Different reliable players whose reports of this paper wait */
async function reliableReportersOf(paperId: string, now: number) {
  const rows = await db
    .selectDistinct({ id: users.id, createdAt: users.createdAt, reportsUpheld: users.reportsUpheld, reportsDismissed: users.reportsDismissed })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.reporterId))
    .where(and(eq(reports.writingId, paperId), isNull(reports.resolvedAt), inArray(reports.reason, WRITING_KEYS)));
  return rows.filter((r) => reliableReporter(r, now)).length;
}

/**
 * A paper on the 手写榜 reported, as a roach on the map is (safety.ts reportRoach): its writer is not blocked and the
 * reporter is never told who it is; it counts toward REPORTS_PER_DAY, never toward holding a name or pausing an
 * account; once a paper while its reports wait. Reported by HIDE_AFTER reliable players, it is hidden (off the board,
 * dealt to nobody) until the admin looks. A paper dealt to the reporter is never dealt them again.
 */
export async function reportPaper(userId: string, paperId: unknown, reason: unknown, note: unknown, now = Date.now()): Promise<void> {
  if (!isWritingReportReason(reason)) throw new HttpError(400, T.server.safety.pickReason);
  // kept as plain words: what cannot be seen or would move the words around it goes (src/lib/playerText.ts)
  const said = cleanPlayerText(String(note ?? ""), REPORT_NOTE_MAX);
  if (noteMissing(reason, said)) throw new HttpError(400, T.server.board.sayWhatOther);
  const id = String(paperId);
  const [paper] = UUID.test(id) ? await db.select({ userId: handwritings.userId, show: handwritings.show }).from(handwritings).where(eq(handwritings.id, id)) : [];
  if (!paper) throw new HttpError(404, T.server.board.gone);
  if (paper.userId === userId) throw new HttpError(400, T.server.board.yourOwn);
  if ((await reportedToday(userId)) >= REPORTS_PER_DAY) throw new HttpError(429, T.server.safety.reportedEnough);
  const [open] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.reporterId, userId), eq(reports.writingId, id), isNull(reports.resolvedAt)))
    .limit(1);
  if (open) return;
  const [u] = await db.select().from(users).where(eq(users.id, paper.userId)).limit(1);
  if (!u) return;
  await db.insert(reports).values({
    reporterId: userId,
    targetId: paper.userId,
    reason,
    note: said,
    context: paperContext(paper.show),
    targetName: nameThen(u),
    writingId: id,
    createdAt: new Date(now),
  });
  if ((await reliableReportersOf(id, now)) >= HIDE_AFTER) {
    const hid = await db
      .update(handwritings)
      .set({ hiddenAt: new Date(now) })
      .where(and(eq(handwritings.id, id), isNull(handwritings.hiddenAt)))
      .returning({ id: handwritings.id });
    if (hid.length) boardChanged();
  }
  tellAdmin();
}
