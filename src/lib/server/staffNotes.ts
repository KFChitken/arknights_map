import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { beijingDayWords } from "../beijing";
import { isReportReason, isRuleCode, REPORT_REASONS, RULES } from "../safety";
import { SUSPEND_DAYS, YELLOW_DAYS, YELLOWS_TO_WORRY } from "../rules";
import type { InboxItem } from "../world/types";
import { db } from "./db";
import { modActions, staffNotes } from "./schema";

/**
 * 站长通知: what the admin (or the reports by themselves) did, told in the player's 消息 as 「站长」.
 * A reporter hears what came of their report, without who it was or what was done; the reported player
 * hears what was done and under which rule, never who reported or how many.
 */

export type NoteKind =
  | "reportUpheld"
  | "reportDismissed"
  | "action"
  | "held"
  | "released"
  | "autoSuspended"
  | "unsuspended"
  | "appealKept"
  | "appealReverted";

export type NewNote = {
  userId: string;
  kind: NoteKind;
  actionId?: string | null;
  reason?: string | null;
  rule?: string | null;
  reportedOn?: string | null;
  until?: Date | null;
};

type Exec = Pick<typeof db, "insert">;

export async function addNotes(notes: NewNote[], exec: Exec = db) {
  if (notes.length) await exec.insert(staffNotes).values(notes);
}

/** 「11 月 17 日」, a Beijing date */
export const dayWords = beijingDayWords;

/** 「11/10」 from a Beijing date 2026-11-10 */
const shortDay = (date: string) => {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
};

const ruleWords = (rule: string | null) => `因为社区守则里「${isRuleCode(rule) ? RULES[rule] : RULES.harass}」这一条，`;

/** What a suspended player may and may not do, as each message about it says */
export const SUSPENDED_MEANS = "这期间你还能看地图和消息，但不能碰人、发宣言、回应、戳一戳和做客。";

/** What the admin did about the player, told under the rule it was for */
export function actionWords(action: string, rule: string | null, until: Date | null) {
  const why = ruleWords(rule);
  switch (action) {
    case "warn":
      return `${why}站长提醒你一次，记一张黄牌。${YELLOW_DAYS} 天内 ${YELLOWS_TO_WORRY} 张黄牌可能会被封号。`;
    case "suspend":
      return `${why}站长暂停了你的互动，到 ${dayWords((until ?? new Date(Date.now() + SUSPEND_DAYS * 86_400_000)).getTime())}。${SUSPENDED_MEANS}`;
    case "clearName":
      return `${why}站长清掉了你的名字。这个名字以后不能再用了。`;
    case "clearUid":
      return `${why}站长清掉了你填的 UID。这个 UID 以后不能再填了。`;
    case "clearBoth":
      return `${why}站长清掉了你的名字和你填的 UID。这个名字和 UID 以后都不能再用了。`;
    default:
      return `${why}站长处理了你的账号。`;
  }
}

/** The words of one note */
export function noteText(n: typeof staffNotes.$inferSelect, action?: typeof modActions.$inferSelect | null) {
  const reason = isReportReason(n.reason) ? REPORT_REASONS[n.reason] : n.reason || "其他";
  const when = n.reportedOn ? ` ${shortDay(n.reportedOn)} ` : "";
  const reported = `站长看过你${when}举报的那位舟P（${reason}）了：`;
  switch (n.kind) {
    case "reportUpheld":
      return `${reported}已经处理了，谢谢你。`;
    case "reportDismissed":
      return `${reported}这次没发现违规。TA 已经被你拉黑了，不会再打扰你。`;
    case "action":
      return actionWords(action?.action ?? "", n.rule ?? action?.rule ?? null, n.until ?? action?.until ?? null);
    case "held":
      return "有人举报了你的名字或 UID，站长看过之前先藏起来了，也暂时改不了。没问题的话会恢复。";
    case "released":
      return "站长看过了，你的名字和 UID 没问题，已经恢复。";
    case "autoSuspended":
      return `有人举报你骚扰，站长看过之前先暂停你的互动，最长 ${SUSPEND_DAYS} 天。`;
    case "unsuspended":
      return "站长看过了，没发现问题，你的互动恢复了。";
    default:
      return "站长给你发了一条通知。";
  }
}

/** The player's 站长通知 since a moment, as 消息 shows them */
export async function staffItems(userId: string, since: Date): Promise<InboxItem[]> {
  const rows = await db
    .select({ n: staffNotes, a: modActions })
    .from(staffNotes)
    .leftJoin(modActions, eq(modActions.id, staffNotes.actionId))
    .where(and(eq(staffNotes.userId, userId), gt(staffNotes.createdAt, since)));
  return rows.map(({ n, a }) => ({
    kind: "staff",
    id: `s:${n.id}`,
    at: n.createdAt.getTime(),
    seen: Boolean(n.seenAt),
    text: noteText(n, a),
    replied: true,
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 消息 opened on them */
export async function seeStaff(userId: string, itemIds: string[]) {
  const ids = itemIds
    .filter((i) => typeof i === "string" && i.startsWith("s:"))
    .map((i) => i.slice(2))
    .filter((i) => UUID.test(i));
  if (!ids.length) return;
  await db
    .update(staffNotes)
    .set({ seenAt: new Date() })
    .where(and(inArray(staffNotes.id, ids), eq(staffNotes.userId, userId), isNull(staffNotes.seenAt)));
}
