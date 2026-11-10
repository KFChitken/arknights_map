import "server-only";
import { and, count, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { declarationText, replyOf } from "../declarations";
import { guideById, guideOfItem } from "../guides";
import { bare } from "../nameRules";
import { displayName } from "../profile";
import {
  PROFILE_REPORTS_TO_HOLD,
  RELIABLE_AFTER_DAYS,
  REPORT_NOTE_MAX,
  REPORTS_PER_DAY,
  SITE_NAME,
  SUSPEND_DAYS,
  UNRELIABLE_DISMISSED_MIN,
  UNRELIABLE_DISMISSED_RATIO,
} from "../rules";
import { isReportReason, noteMissing, PROFILE_REASONS, REPORT_REASONS, URGENT_REASONS, type ReportReason } from "../safety";
import { DAY, MINUTE } from "../world/logic";
import { WorldError, type BlockedPlayer } from "../world/types";
import { db } from "./db";
import { ADMIN_EMAILS, SITE_URL } from "./env";
import { sendAdminMail } from "./mail";
import {
  blocks,
  clearedValues,
  declarations,
  deliveries,
  mailSends,
  modActions,
  pokes,
  reactions,
  reports,
  touches,
  users,
  watchMails,
  type UserRow,
} from "./schema";
import { addNotes } from "./staffNotes";
import { note as noteSignal } from "./signals";
import { endFriendship, friendIdsOf, friendKey, profileOf, storedDeclaration } from "./world";

/**
 * Blocking and reporting. Both name the other player by something the
 * reporter was shown (an inbox item, or a 触须之交's opaque id), never by
 * user id, so neither can be used to probe who owns what.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sender = { other: string; known: boolean; context: string };

/** Who sent an inbox item ("t:", "d:", "x:", "p:" ids) or who a friend is ("friend:<id>"), as far as this player may ask. */
async function whoSent(userId: string, target: string): Promise<Sender | null> {
  // the page offers neither on the guides; this is the backstop
  const guide = target.startsWith("friend:") ? guideById(target.slice("friend:".length)) : guideOfItem(target);
  if (guide) throw new WorldError(`${guide.name}不是真人，不用拉黑。`);
  if (target.startsWith("friend:")) {
    const key = target.slice("friend:".length);
    const other = [...(await friendIdsOf(userId))].find((o) => friendKey(userId, o) === key);
    return other ? { other, known: true, context: "触须之交" } : null;
  }
  const [kind, id] = target.split(":");
  if (!UUID.test(id ?? "")) return null;
  if (kind === "t") {
    const [t] = await db
      .select()
      .from(touches)
      .where(and(eq(touches.id, id), eq(touches.toUserId, userId)))
      .limit(1);
    if (!t) return null;
    const how = t.bold ? "大胆" : "偷偷";
    const what = t.replyTo ? "碰回了举报人" : t.toSlot ? "碰了举报人的克隆体" : "碰了举报人的本体";
    return { other: t.fromUserId, known: t.bold, context: `${how}${what}` };
  }
  if (kind === "p") {
    const [p] = await db
      .select({ from: pokes.fromUserId })
      .from(pokes)
      .where(and(eq(pokes.id, id), eq(pokes.toUserId, userId)))
      .limit(1);
    // only 触须之交 poke, so the poked player knew who it was
    return p ? { other: p.from, known: true, context: "趁举报人的蟑螂睡着时戳了戳它" } : null;
  }
  if (kind === "d") {
    const [row] = await db
      .select({ d: declarations })
      .from(deliveries)
      .innerJoin(declarations, eq(declarations.id, deliveries.declarationId))
      .where(and(eq(deliveries.declarationId, id), eq(deliveries.recipientId, userId)))
      .limit(1);
    if (!row) return null;
    return { other: row.d.senderId, known: false, context: `独立宣言「${declarationText(storedDeclaration(row.d))}」` };
  }
  if (kind === "x") {
    const [row] = await db
      .select({ r: reactions, d: declarations })
      .from(reactions)
      .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
      .where(and(eq(reactions.id, id), eq(declarations.senderId, userId)))
      .limit(1);
    if (!row) return null;
    const reaction = replyOf(storedDeclaration(row.d), row.r.reaction)?.text ?? row.r.reaction;
    return {
      other: row.r.fromUserId,
      known: false,
      context: `回应「${reaction}」，回应的是举报人的宣言「${declarationText(storedDeclaration(row.d))}」`,
    };
  }
  return null;
}

async function blockSender(userId: string, who: Sender) {
  await db
    .insert(blocks)
    .values({ blockerId: userId, blockedId: who.other, known: who.known })
    .onConflictDoUpdate({
      target: [blocks.blockerId, blocks.blockedId],
      // once you knew who it was, you keep knowing
      set: { known: who.known ? true : blocks.known },
    });
  if ((await friendIdsOf(userId)).has(who.other)) await endFriendship(userId, who.other);
}

export async function block(userId: string, target: string) {
  const who = await whoSent(userId, String(target));
  if (!who) throw new WorldError("找不到这条消息了。");
  await blockSender(userId, who);
}

export async function unblock(userId: string, blockId: string) {
  if (!UUID.test(String(blockId))) throw new WorldError("找不到这条拉黑记录了。");
  await db.delete(blocks).where(and(eq(blocks.id, blockId), eq(blocks.blockerId, userId)));
}

/** Your block list, newest first. Players you never saw named stay anonymous here too. */
export async function blockList(userId: string): Promise<BlockedPlayer[]> {
  const rows = await db
    .select({ b: blocks, u: users })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(eq(blocks.blockerId, userId));
  return rows
    .map(({ b, u }) => ({ id: b.id, name: b.known ? displayName(profileOf(u)) : null, at: b.createdAt.getTime() }))
    .sort((x, y) => y.at - x.at);
}

// ---- holding and clearing what a player wrote about themselves ----

/** What a held 「我是…」 declaration says instead of its sender's name, and what a cleared one says for good */
const NO_NAME = "匿名舟P";

/**
 * 先藏起来: hide a reported player's name and UIDs from everyone until the admin looks. Every place
 * that shows a player goes through anonymous and shareUid, so switching the one on and the other off
 * hides both; what the player had chosen is kept to put back, and saveProfile locks them meanwhile.
 * Holding someone already held changes nothing, so two reports at once cannot lose their choice.
 */
export async function holdProfile(userId: string) {
  await db.transaction(async (tx) => {
    const held = await tx
      .update(users)
      .set({
        // the old row's values, as every expression of an update reads them
        heldAnonymous: sql`${users.anonymous}`,
        heldShareUid: sql`${users.shareUid}`,
        anonymous: true,
        shareUid: false,
        profileHeldAt: new Date(),
      })
      .where(and(eq(users.id, userId), isNull(users.profileHeldAt)))
      .returning({ id: users.id });
    if (!held.length) return;
    await tx
      .update(declarations)
      .set({ heldName: sql`${declarations.name}`, name: NO_NAME })
      .where(and(eq(declarations.senderId, userId), eq(declarations.template, "myname"), isNull(declarations.heldName)));
    // told why, never by whom or how many
    await addNotes([{ userId, kind: "held" }], tx);
  });
}

/**
 * The admin's verdict on what a player wrote about themselves: clear the name, the UIDs, both or
 * neither, and let whatever was not cleared out of a hold as it was. A cleared name (as bare() cleans
 * it) or UID goes into cleared_values, so this account cannot take it again.
 */
async function settleProfile(userId: string, clear: { name: boolean; uid: boolean }) {
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u) return;
    await tx
      .update(users)
      .set({
        ...(clear.name ? { name: "", anonymous: true } : { anonymous: u.heldAnonymous ?? u.anonymous }),
        ...(clear.uid ? { uidArknights: "", uidEndfield: "" } : {}),
        // sharing UIDs was never the problem
        shareUid: u.heldShareUid ?? u.shareUid,
        profileHeldAt: null,
        heldAnonymous: null,
        heldShareUid: null,
      })
      .where(eq(users.id, userId));
    const theirs = eq(declarations.senderId, userId);
    if (clear.name) {
      await tx
        .update(declarations)
        .set({ name: NO_NAME, heldName: null })
        .where(and(theirs, eq(declarations.template, "myname")));
    } else {
      await tx
        .update(declarations)
        .set({ name: sql`${declarations.heldName}`, heldName: null })
        .where(and(theirs, isNotNull(declarations.heldName)));
    }
    const gone = new Map<string, { kind: string; value: string }>();
    if (clear.name && bare(u.name)) gone.set(`name|${bare(u.name)}`, { kind: "name", value: bare(u.name) });
    for (const uid of clear.uid ? [u.uidArknights, u.uidEndfield] : []) {
      if (uid.trim()) gone.set(`uid|${uid.trim()}`, { kind: "uid", value: uid.trim() });
    }
    if (gone.size) {
      await tx
        .insert(clearedValues)
        .values([...gone.values()].map((g) => ({ userId, ...g })))
        .onConflictDoNothing();
    }
  });
}

/** Nothing wrong after all: a held name and UIDs show again, and the 「我是…」 declarations say the name again */
export const releaseProfile = (userId: string) => settleProfile(userId, { name: false, uid: false });
/** Make a player anonymous for good, and take their name off the 「我是…」 declarations they already sent */
export const clearName = (userId: string) => settleProfile(userId, { name: true, uid: false });
/** Take a player's UIDs away (the servers they picked stay) */
export const clearUid = (userId: string) => settleProfile(userId, { name: false, uid: true });
export const clearBoth = (userId: string) => settleProfile(userId, { name: true, uid: true });

/**
 * A reporter the automatic steps (holding a profile, suspending a new account) count: an account
 * RELIABLE_AFTER_DAYS old or more, whose reports the admin did not often find nothing in.
 */
export function reliableReporter(u: Pick<UserRow, "createdAt" | "reportsUpheld" | "reportsDismissed">, now = Date.now()) {
  const old = now - u.createdAt.getTime() >= RELIABLE_AFTER_DAYS * DAY;
  const doubtful = u.reportsDismissed >= UNRELIABLE_DISMISSED_MIN && u.reportsDismissed >= UNRELIABLE_DISMISSED_RATIO * u.reportsUpheld;
  return old && !doubtful;
}

/** Different reliable players with open reports about someone, for any of these reasons */
async function reliableReporters(targetId: string, reasons: readonly string[], now: number) {
  const rows = await db
    .selectDistinct({ id: users.id, createdAt: users.createdAt, reportsUpheld: users.reportsUpheld, reportsDismissed: users.reportsDismissed })
    .from(reports)
    .innerJoin(users, eq(users.id, reports.reporterId))
    .where(and(eq(reports.targetId, targetId), inArray(reports.reason, [...reasons]), isNull(reports.resolvedAt)));
  return rows.filter((r) => reliableReporter(r, now)).length;
}

/**
 * A new account (under RELIABLE_AFTER_DAYS) reported for spam by two different reliable players: its
 * interactions stop for SUSPEND_DAYS until the admin looks. Someone back under a new address is
 * most likely a new account. Never cuts short a longer suspension.
 */
async function suspendIfNew(target: UserRow, now: number) {
  if (now - target.createdAt.getTime() >= RELIABLE_AFTER_DAYS * DAY) return;
  if (target.suspendedUntil && target.suspendedUntil.getTime() > now) return;
  if ((await reliableReporters(target.id, ["spam"], now)) < 2) return;
  const until = new Date(now + SUSPEND_DAYS * DAY);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ suspendedUntil: until, suspendedAuto: true }).where(eq(users.id, target.id));
    const [action] = await tx
      .insert(modActions)
      .values({ userId: target.id, action: "suspend", rule: "harass", until, auto: true })
      .returning({ id: modActions.id });
    await addNotes([{ userId: target.id, kind: "autoSuspended", actionId: action.id, until }], tx);
  });
}

/** Report whoever sent an inbox item (or a friend). Reporting also blocks them. */
export async function report(userId: string, target: string, reason: unknown, note: unknown) {
  if (!isReportReason(reason)) throw new WorldError("选一个举报理由吧。");
  const said = String(note ?? "")
    .trim()
    .slice(0, REPORT_NOTE_MAX);
  if (noteMissing(reason, said)) throw new WorldError("选了「其他」的话，写一句是什么事吧。");
  const who = await whoSent(userId, String(target));
  if (!who) throw new WorldError("找不到这条消息了。");
  const [today] = await db
    .select({ n: count() })
    .from(reports)
    .where(and(eq(reports.reporterId, userId), gt(reports.createdAt, new Date(Date.now() - DAY))));
  if (today.n >= REPORTS_PER_DAY) throw new WorldError("今天举报得够多了，明天再来吧。");

  await blockSender(userId, who);
  // A second report of the same player while the first is still open adds nothing
  const [open] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.reporterId, userId), eq(reports.targetId, who.other), isNull(reports.resolvedAt)))
    .limit(1);
  if (open) return;

  const [u] = await db.select().from(users).where(eq(users.id, who.other)).limit(1);
  if (!u) return;
  // while held, anonymous is the hold's doing; what they had chosen is kept beside it
  const anonymous = u.profileHeldAt ? (u.heldAnonymous ?? u.anonymous) : u.anonymous;
  await db.insert(reports).values({
    reporterId: userId,
    targetId: who.other,
    reason,
    note: said,
    context: who.context,
    targetName: u.name ? `${u.name}${anonymous ? "（当时是匿名）" : ""}` : "（没有名字）",
  });

  const now = Date.now();
  // only reliable reporters count towards the automatic steps; every report still reaches the admin
  if (PROFILE_REASONS.includes(reason) && (await reliableReporters(who.other, PROFILE_REASONS, now)) >= PROFILE_REPORTS_TO_HOLD) {
    await holdProfile(who.other);
  }
  if (reason === "spam") await suspendIfNew(u, now);
  sendReportDigest().catch((e) => {
    console.error("Report digest failed", e);
    noteSignal("job", "digest");
  });
}

// ---- telling the admin ----

/** Advisory lock taken while deciding on an urgent report reminder; the login codes' is mailQuota.ts's */
const REPORT_MAIL_LOCK = 7_316_002;
/** Urgent reminders go at least this far apart, and at most this many in a day */
const URGENT_GAP = 30 * MINUTE;
const URGENT_PER_DAY = 12;

const isUrgent = (reason: string) => (URGENT_REASONS as readonly string[]).includes(reason);

/** 「名字不合适 2 条、骚扰刷屏 1 条」, the reasons in the order given (the report sheet's unless told) */
export function byReason(rows: { reason: string }[], order: readonly ReportReason[] = Object.keys(REPORT_REASONS) as ReportReason[]) {
  const tally = new Map<ReportReason, number>();
  for (const r of rows) {
    const reason = isReportReason(r.reason) ? r.reason : "other";
    tally.set(reason, (tally.get(reason) ?? 0) + 1);
  }
  return order.flatMap((r) => (tally.has(r) ? [`${REPORT_REASONS[r]} ${tally.get(r)} 条`] : [])).join("、");
}

/**
 * Email the admins at once when a report they have not heard of is for URGENT_REASONS, at least half
 * an hour after the last such email and at most 12 a day; it tells of every report waiting. The others
 * wait for the morning's digest of the site's checks (watch.ts), which tells of the day's reports and
 * marks them told. Neither counts against MAIL_DAILY_LIMIT, so a day the login codes used it up still
 * gets them. Runs after every report and every 10 minutes, so an urgent report reaches the admin within
 * about 40 minutes.
 */
export async function sendReportDigest(now = new Date()) {
  if (!ADMIN_EMAILS.length) return;
  const due = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${REPORT_MAIL_LOCK})`);
    const fresh = await tx
      .select({ id: reports.id, reason: reports.reason })
      .from(reports)
      .where(and(isNull(reports.resolvedAt), isNull(reports.notifiedAt)));
    if (!fresh.some((f) => isUrgent(f.reason))) return null;
    // only the last day counts, whatever older rows the login codes' clean-up has not got to yet
    const sent = await tx
      .select({ at: mailSends.sentAt })
      .from(mailSends)
      .where(and(eq(mailSends.kind, "report-urgent"), gt(mailSends.sentAt, new Date(now.getTime() - DAY))));
    if (sent.length >= URGENT_PER_DAY || sent.some((m) => now.getTime() - m.at.getTime() < URGENT_GAP)) return null;
    const [row] = await tx.insert(mailSends).values({ sentAt: now, kind: "report-urgent" }).returning({ id: mailSends.id });
    const ids = fresh.map((f) => f.id);
    await tx.update(reports).set({ notifiedAt: now }).where(inArray(reports.id, ids));
    return { fresh, ids, row: row.id };
  });
  if (!due) return;

  const [open] = await db.select({ n: count() }).from(reports).where(isNull(reports.resolvedAt));
  const pressing = due.fresh.filter((f) => isUrgent(f.reason));
  const rest = due.fresh.filter((f) => !isUrgent(f.reason));
  const subject = `${SITE_NAME}：有 ${pressing.length} 条举报要尽快看`;
  const lines = [
    byReason(pressing, URGENT_REASONS),
    ...(rest.length ? [`另外还有 ${rest.length} 条新举报：${byReason(rest)}`] : []),
    `一共 ${open.n} 条没处理。`,
    "",
    `打开 ${SITE_URL}/admin 查看。`,
  ];
  try {
    await sendAdminMail(ADMIN_EMAILS, subject, lines.join("\n"));
  } catch (e) {
    // it never went: forget that it did, so the next run tries again
    await db.delete(mailSends).where(eq(mailSends.id, due.row));
    await db
      .update(reports)
      .set({ notifiedAt: null })
      .where(and(inArray(reports.id, due.ids), eq(reports.notifiedAt, now)));
    throw e;
  }
  // listed with the checks' emails on the admin page
  await db
    .insert(watchMails)
    .values({ at: now, subject, kind: "report" })
    .catch((e) => console.error("Could not list the report email", e));
}
