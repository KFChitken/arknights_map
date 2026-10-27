import "server-only";
import { and, count, countDistinct, eq, gt, inArray, isNull } from "drizzle-orm";
import { declarationText, isReaction, REACTIONS } from "../declarations";
import { displayName } from "../profile";
import { NAME_REPORTS_TO_HIDE, REPORT_NOTE_MAX, REPORTS_PER_DAY, SITE_NAME } from "../rules";
import { isReportReason } from "../safety";
import { DAY } from "../world/logic";
import { WorldError, type BlockedPlayer } from "../world/types";
import { db } from "./db";
import { ADMIN_EMAILS, SITE_URL } from "./env";
import { sendAdminMail } from "./mail";
import { mailRoom } from "./mailQuota";
import { blocks, declarations, deliveries, mailSends, reactions, reports, touches, users } from "./schema";
import { endFriendship, friendIdsOf, friendKey, profileOf, storedDeclaration } from "./world";

/**
 * Blocking and reporting. Both name the other player by something the
 * reporter was shown (an inbox item, or a 触须之交's opaque id), never by
 * user id, so neither can be used to probe who owns what.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sender = { other: string; known: boolean; context: string };

/** Who sent an inbox item ("t:", "d:", "x:" ids) or who a friend is ("friend:<id>"), as far as this player may ask. */
async function whoSent(userId: string, target: string): Promise<Sender | null> {
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
    const reaction = isReaction(row.r.reaction) ? REACTIONS[row.r.reaction] : row.r.reaction;
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

/** Make a player anonymous and take their name off the 「我是…」 declarations they already sent. */
export async function clearName(userId: string) {
  await db.update(users).set({ anonymous: true, name: "" }).where(eq(users.id, userId));
  await db
    .update(declarations)
    .set({ name: "匿名舟P" })
    .where(and(eq(declarations.senderId, userId), eq(declarations.template, "myname")));
}

/** Report whoever sent an inbox item (or a friend). Reporting also blocks them. */
export async function report(userId: string, target: string, reason: unknown, note: unknown) {
  if (!isReportReason(reason)) throw new WorldError("选一个举报理由吧。");
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
  await db.insert(reports).values({
    reporterId: userId,
    targetId: who.other,
    reason,
    note: String(note ?? "")
      .trim()
      .slice(0, REPORT_NOTE_MAX),
    context: who.context,
    targetName: u.name ? `${u.name}${u.anonymous ? "（当时是匿名）" : ""}` : "（没有名字）",
  });

  if (reason === "name") {
    const [reporters] = await db
      .select({ n: countDistinct(reports.reporterId) })
      .from(reports)
      .where(and(eq(reports.targetId, who.other), eq(reports.reason, "name"), isNull(reports.resolvedAt)));
    if (reporters.n >= NAME_REPORTS_TO_HIDE) await clearName(who.other);
  }
  sendReportDigest().catch((e) => console.error("Report digest failed", e));
}

/**
 * Email the admins about reports they have not been told of, at most once a
 * day. Runs after every report and hourly, so a report never waits more than
 * a day plus an hour.
 */
export async function sendReportDigest(now = new Date()) {
  if (!ADMIN_EMAILS.length) return;
  const fresh = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(isNull(reports.resolvedAt), isNull(reports.notifiedAt)));
  if (!fresh.length) return;
  const go = await db.transaction(async (tx) => {
    if (!(await mailRoom(tx, now))) return false;
    // mailRoom keeps only the last day's sends, so any digest row left means one went out today
    const [recent] = await tx.select({ id: mailSends.id }).from(mailSends).where(eq(mailSends.kind, "report")).limit(1);
    if (recent) return false;
    await tx.insert(mailSends).values({ sentAt: now, kind: "report" });
    const ids = fresh.map((f) => f.id);
    await tx.update(reports).set({ notifiedAt: now }).where(inArray(reports.id, ids));
    return true;
  });
  if (!go) return;
  const [open] = await db.select({ n: count() }).from(reports).where(isNull(reports.resolvedAt));
  await sendAdminMail(
    ADMIN_EMAILS,
    `${SITE_NAME}有 ${fresh.length} 条新举报`,
    [`有 ${fresh.length} 条新举报等你处理（一共 ${open.n} 条没处理）。`, "", `打开 ${SITE_URL}/admin 查看。`].join("\n"),
  );
}
