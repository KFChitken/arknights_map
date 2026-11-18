import "server-only";
import { and, asc, eq, gt, gte, inArray, isNotNull, lt, min, or, sql } from "drizzle-orm";
import { INBOX_DAYS, KEEP_ACTIVITY_DAYS, KEEP_ADMIN_LOG_DAYS, KEEP_ANSWERED_REQUEST_DAYS, KEEP_MOD_ACTION_DAYS, KEEP_REPORT_DAYS } from "../rules";
import { db } from "./db";
import { pruneFriendly } from "./friendly";
import { pruneHelp } from "./help";
import {
  adminLog,
  adminNotes,
  adminRequests,
  amiyaTouches,
  declarations,
  deliveries,
  drinks,
  friendCuts,
  moves,
  mingheTouches,
  modActions,
  offLimitsAreas,
  perlicaTouches,
  pokes,
  radarScans,
  reactions,
  reports,
  sessions,
  siTouches,
  haimaoTouches,
  staffNotes,
  talulahTouches,
  touches,
  users,
  watchIncidents,
  watchMails,
} from "./schema";
import { forgetOldSpots } from "./declarationInbox";
import { pruneDeskCodes } from "./deskCodes";
import { pruneSongHeard } from "./songs";

const DAY_MS = 86_400_000;
/** Deleting deliveries a few hundred declarations at a time, with a pause, so the database never stalls */
const DELIVERY_BATCH = 500;
const DELIVERY_PAUSE_MS = 200;
/** Touches and declarations go an hour of them after another, and at most this many in one statement, with a pause */
const PRUNE_BATCH = 2000;
const PRUNE_PAUSE_MS = 100;
const HOUR_MS = 3_600_000;

/**
 * Delete activity older than KEEP_ACTIVITY_DAYS and handled reports older than
 * KEEP_REPORT_DAYS, as the privacy page promises. Deliveries and reactions go
 * with their declaration. Touches, declarations and reactions leave only how many
 * there were, on each player's row, for 「我的记录」's totals (pruneTouches,
 * pruneDeclarations). The site's own checks keep as long.
 */
export async function pruneOldActivity(now = Date.now()) {
  const cutoff = new Date(now - KEEP_ACTIVITY_DAYS * DAY_MS);
  await pruneTouches(cutoff);
  await db.delete(pokes).where(lt(pokes.createdAt, cutoff));
  await db.delete(amiyaTouches).where(lt(amiyaTouches.createdAt, cutoff));
  await db.delete(perlicaTouches).where(lt(perlicaTouches.createdAt, cutoff));
  await db.delete(talulahTouches).where(lt(talulahTouches.createdAt, cutoff));
  await db.delete(mingheTouches).where(lt(mingheTouches.createdAt, cutoff));
  // 祀掌柜's lines go like any guide's; her ink roaches and their tickets stay, as the painting they make
  await db.delete(siTouches).where(lt(siTouches.createdAt, cutoff));
  // 香艳制作人's too; her 好感度 and the rest in haimao_players stay, as the privacy page says
  await db.delete(haimaoTouches).where(lt(haimaoTouches.createdAt, cutoff));
  await pruneDeclarations(cutoff);
  await db.delete(moves).where(lt(moves.at, cutoff));
  await db.delete(drinks).where(lt(drinks.at, cutoff));
  // a cut only matters for touches made before it, which are gone by now
  await db.delete(friendCuts).where(lt(friendCuts.cutAt, cutoff));
  await pruneFriendly(cutoff, now);
  await pruneHelp(now);
  await pruneDeliveries(now);
  // where a declaration was sent from, once it shows to nobody (DECLARATION_DAYS)
  await forgetOldSpots(now);
  // only the last day of radar scans is ever used
  await db.delete(radarScans).where(lt(radarScans.createdAt, new Date(now - DAY_MS)));
  const reportCutoff = new Date(now - KEEP_REPORT_DAYS * DAY_MS);
  await db.delete(reports).where(and(isNotNull(reports.resolvedAt), lt(reports.resolvedAt, reportCutoff)));
  // 站长通知 like any message; what the admin did, a year
  await db.delete(staffNotes).where(lt(staffNotes.createdAt, cutoff));
  await db.delete(modActions).where(lt(modActions.createdAt, new Date(now - KEEP_MOD_ACTION_DAYS * DAY_MS)));
  // the 管理台's record of itself, and its notes on accounts, a year too
  const adminCutoff = new Date(now - KEEP_ADMIN_LOG_DAYS * DAY_MS);
  await db.delete(adminLog).where(lt(adminLog.at, adminCutoff));
  await db.delete(adminNotes).where(lt(adminNotes.createdAt, adminCutoff));
  // bans a moderator asked for, once answered: the 操作记录 keeps what came of them
  await db.delete(adminRequests).where(lt(adminRequests.answeredAt, new Date(now - KEEP_ANSWERED_REQUEST_DAYS * DAY_MS)));
  // places the owner drew and lifted again, kept a year to show why they were drawn (src/lib/server/zones.ts)
  await db.delete(offLimitsAreas).where(lt(offLimitsAreas.liftedAt, adminCutoff));
  // the site's own checks: what they found and emailed, for 网站状态
  await db.delete(watchIncidents).where(lt(watchIncidents.endedAt, cutoff));
  await db.delete(watchMails).where(lt(watchMails.at, cutoff));
  // sign-ins that ran out (nothing removed them before 11/11)
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now - DAY_MS)));
  // 登录码 that ran out sign nobody in
  await pruneDeskCodes(now);
  // 热播榜's days it no longer counts
  await pruneSongHeard(now);
}

const pause = () => new Promise((r) => setTimeout(r, PRUNE_PAUSE_MS));

type Hours = {
  /** The time of the oldest row before the cutoff, at or after `from` if given; null if none */
  oldest: (from?: Date) => Promise<Date | null>;
  /** Deletes up to PRUNE_BATCH rows from `from` to before `to`, counting them where they are counted; how many went */
  prune: (from: Date, to: Date) => Promise<number>;
};

/**
 * Each hour from the oldest row before the cutoff up to the cutoff, in turn: up to PRUNE_BATCH of its rows go in one
 * statement, again until fewer go, with a pause between, so no player's row waits on a long statement. An hour with
 * none skips to the next row there is.
 */
async function byHour(cutoff: Date, { oldest, prune }: Hours) {
  let at = await oldest();
  while (at && at.getTime() < cutoff.getTime()) {
    const from = new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
    const to = new Date(Math.min(from.getTime() + HOUR_MS, cutoff.getTime()));
    let n = await prune(from, to);
    const any = n > 0;
    while (n >= PRUNE_BATCH) {
      await pause();
      n = await prune(from, to);
    }
    at = any ? to : await oldest(to);
  }
}

/**
 * Touches older than the cutoff. The statement that deletes a batch adds what went to users.old_touches_out (the
 * sender's, withheld ones too: those are theirs) and old_touches_in (the receiver's, not the withheld ones, which they
 * never saw), so each touch is counted once however often this runs, and each player's row changes once a statement.
 */
async function pruneTouches(cutoff: Date) {
  await byHour(cutoff, {
    oldest: async (from) => {
      const [row] = await db
        .select({ at: min(touches.createdAt) })
        .from(touches)
        .where(and(from ? gte(touches.createdAt, from) : undefined, lt(touches.createdAt, cutoff)));
      return row?.at ?? null;
    },
    prune: async (from, to) => {
      const [row] = await db.execute<{ n: number }>(sql`
        with gone as (
          delete from ${touches} where id in (
            select id from ${touches} where created_at >= ${from.toISOString()}::timestamptz and created_at < ${to.toISOString()}::timestamptz limit ${PRUNE_BATCH}
          )
          returning from_user_id, to_user_id, withheld
        ),
        counted as (
          select id, sum(sent)::int sent, sum(got)::int got from (
            select from_user_id id, 1 sent, 0 got from gone
            union all
            select to_user_id, 0, 1 from gone where not withheld
          ) one group by id
        ),
        kept as (
          update ${users} set old_touches_out = old_touches_out + counted.sent, old_touches_in = old_touches_in + counted.got
          from counted where ${users.id} = counted.id
        )
        select count(*)::int n from gone`);
      return row.n;
    },
  });
}

/**
 * Declarations older than the cutoff, and with them (cascading) the reactions to them: counted first, in the same
 * statement, into the sender's users.old_declarations and old_reactions_in (not the withheld ones) and the reacting
 * player's old_reactions_out, then deleted; each counted once, each player's row changed once a statement.
 */
async function pruneDeclarations(cutoff: Date) {
  await byHour(cutoff, {
    oldest: async (from) => {
      const [row] = await db
        .select({ at: min(declarations.createdAt) })
        .from(declarations)
        .where(and(from ? gte(declarations.createdAt, from) : undefined, lt(declarations.createdAt, cutoff)));
      return row?.at ?? null;
    },
    prune: async (from, to) => {
      const [row] = await db.execute<{ n: number }>(sql`
        with doomed as (
          select id, sender_id from ${declarations}
          where created_at >= ${from.toISOString()}::timestamptz and created_at < ${to.toISOString()}::timestamptz
          limit ${PRUNE_BATCH}
          for update
        ),
        answers as (
          select r.from_user_id, r.withheld, doomed.sender_id from ${reactions} r join doomed on doomed.id = r.declaration_id
        ),
        counted as (
          select id, sum(sent)::int sent, sum(got)::int got, sum(gave)::int gave from (
            select sender_id id, 1 sent, 0 got, 0 gave from doomed
            union all
            select sender_id, 0, 1, 0 from answers where not withheld
            union all
            select from_user_id, 0, 0, 1 from answers
          ) one group by id
        ),
        kept as (
          update ${users}
          set old_declarations = old_declarations + counted.sent, old_reactions_in = old_reactions_in + counted.got,
            old_reactions_out = old_reactions_out + counted.gave
          from counted where ${users.id} = counted.id
        ),
        gone as (delete from ${declarations} where id in (select id from doomed) returning 1)
        select count(*)::int n from gone`);
      return row.n;
    },
  });
}

/**
 * A declaration's deliveries (who it reached) are read only while it can show in an inbox (INBOX_DAYS),
 * but a busy day writes millions of them. So they go once a declaration is older than that, except a
 * 触须之交's birthday sent as one (to_friend), whose sender is named; the declarations themselves stay
 * KEEP_ACTIVITY_DAYS. A few hundred declarations at a time, only those of the week before the cutoff
 * (anything older went on an earlier day).
 */
async function pruneDeliveries(now: number) {
  const cutoff = new Date(now - INBOX_DAYS * DAY_MS);
  const from = new Date(cutoff.getTime() - 7 * DAY_MS);
  let after: { at: Date; id: string } | null = null;
  for (;;) {
    const page: { at: Date; id: string }[] = await db
      .select({ at: declarations.createdAt, id: declarations.id })
      .from(declarations)
      .where(
        and(
          gte(declarations.createdAt, from),
          lt(declarations.createdAt, cutoff),
          after ? or(gt(declarations.createdAt, after.at), and(eq(declarations.createdAt, after.at), gt(declarations.id, after.id))) : undefined,
        ),
      )
      .orderBy(asc(declarations.createdAt), asc(declarations.id))
      .limit(DELIVERY_BATCH);
    if (!page.length) return;
    await db.delete(deliveries).where(and(inArray(deliveries.declarationId, page.map((d) => d.id)), eq(deliveries.toFriend, false)));
    if (page.length < DELIVERY_BATCH) return;
    after = page[page.length - 1];
    await new Promise((r) => setTimeout(r, DELIVERY_PAUSE_MS));
  }
}
