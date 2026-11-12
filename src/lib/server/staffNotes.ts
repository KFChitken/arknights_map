import "server-only";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { fmt, T } from "@/i18n";
import { beijingDayWords } from "../beijing";
import { APPEAL_MAX, APPEAL_MIN, APPEALABLE, isRoachReportReason, isRuleCode, reasonWords, RULES, type AdminAction } from "../safety";
import { INBOX_DAYS, SUSPEND_DAYS, YELLOW_DAYS, YELLOWS_TO_WORRY } from "../rules";
import { WorldError, type InboxItem, type StaffAppeal } from "../world/types";
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
  | "appealReverted"
  | "undone"
  | "offLimits";

export type NewNote = {
  userId: string;
  kind: NoteKind;
  actionId?: string | null;
  /** For a reporter, the reason they gave; for offLimits, what came of their roaches (OFF_LIMITS_WORDS) */
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
export const suspendedMeans = () => "这期间你还能看地图和消息，但不能碰人、发宣言、回应、戳一戳和做客。";

/** What the admin did about the player, told under the rule it was for; slot: removeRoach's roach, 0 the main one */
export function actionWords(action: string, rule: string | null, until: Date | null, slot: number | null = null) {
  const why = ruleWords(rule);
  switch (action) {
    case "removeRoach":
      return `${why}站长把你的一只${slot === 0 ? "本体" : "克隆体"}收回到你手里了，记一张黄牌。`;
    case "warn":
      return `${why}站长提醒你一次，记一张黄牌。${YELLOW_DAYS} 天内 ${YELLOWS_TO_WORRY} 张黄牌可能会被封号。`;
    case "suspend":
      return `${why}站长暂停了你的互动，到 ${dayWords((until ?? new Date(Date.now() + SUSPEND_DAYS * 86_400_000)).getTime())}。${suspendedMeans()}`;
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

/** What undoing an action on appeal gave back */
const REVERTED: Partial<Record<AdminAction, string>> = {
  warn: "黄牌不算了",
  removeRoach: "黄牌不算了",
  suspend: "互动恢复了",
  clearName: "可以再用原来的名字了（要在「我的资料」里重新填上）",
  clearUid: "可以再填原来的 UID 了（要在「我的资料」里重新填上）",
  clearBoth: "可以再用原来的名字和 UID 了（要在「我的资料」里重新填上）",
  ageCheck: "不用再确认年龄了",
};

/**
 * What came of a player's roaches that stood where no roach may (src/lib/server/offLimits.ts):
 * moved just outside, or, visiting there, sent home. No yellow card: it is not their doing.
 */
export const OFF_LIMITS_WORDS = {
  moved: "有些地方不能放蟑螂。你有蟑螂放在了这样的地方，站长已经帮你挪到旁边了。这不算违规，不用做什么。",
  home: "有些地方不能放蟑螂。你有克隆体在这样的地方做客，站长已经把它送回家了。这不算违规，不用做什么。",
};

/** The words of one note */
export function noteText(n: typeof staffNotes.$inferSelect, action?: typeof modActions.$inferSelect | null) {
  const when = n.reportedOn ? ` ${shortDay(n.reportedOn)} ` : "";
  // a roach's report blocks nobody, so there is nobody blocked to mention
  const roach = isRoachReportReason(n.reason);
  const reported = `站长看过你${when}举报的那${roach ? "只蟑螂" : "位舟P"}（${reasonWords(n.reason)}）了：`;
  switch (n.kind) {
    case "reportUpheld":
      return `${reported}已经处理了，谢谢你。`;
    case "reportDismissed":
      return roach ? `${reported}这次没发现问题。` : `${reported}这次没发现违规。TA 已经被你拉黑了，不会再打扰你。`;
    case "action":
      return actionWords(action?.action ?? "", n.rule ?? action?.rule ?? null, n.until ?? action?.until ?? null, action?.roachSlot ?? null);
    case "appealKept":
      return "站长看了你的申诉：维持原来的处理。";
    case "appealReverted":
      return `站长看了你的申诉：撤销了这次处理，${REVERTED[(action?.action ?? "") as AdminAction] ?? "恢复原样了"}。`;
    // undone in the 管理台 after the fact, without an appeal
    case "undone":
      return action
        ? `站长撤销了 ${dayWords(action.createdAt.getTime())}对你的处理，${REVERTED[action.action as AdminAction] ?? "恢复原样了"}。`
        : "站长撤销了对你的一次处理。";
    case "held":
      return "有人举报了你的名字或 UID，站长看过之前先藏起来了，也暂时改不了。没问题的话会恢复。";
    case "released":
      return "站长看过了，你的名字和 UID 没问题，已经恢复。";
    case "autoSuspended":
      return `有人举报你骚扰，站长看过之前先暂停你的互动，最长 ${SUSPEND_DAYS} 天。`;
    case "unsuspended":
      return "站长看过了，没发现问题，你的互动恢复了。";
    case "offLimits":
      return n.reason === "home" ? OFF_LIMITS_WORDS.home : OFF_LIMITS_WORDS.moved;
    default:
      return "站长给你发了一条通知。";
  }
}

/** Whether the player may still appeal an action: one the admin took, of a kind told in 站长通知, within INBOX_DAYS */
const appealable = (a: typeof modActions.$inferSelect, now: number) =>
  !a.auto && APPEALABLE.includes(a.action as AdminAction) && now - a.createdAt.getTime() < INBOX_DAYS * DAY_MS;

/** 「我觉得处理错了」 under the note that told of the action: open, sent, or answered (the answer is a note of its own) */
function appealOf(n: typeof staffNotes.$inferSelect, a: typeof modActions.$inferSelect | null, now: number): StaffAppeal | undefined {
  if (n.kind !== "action" || !a || a.auto || !APPEALABLE.includes(a.action as AdminAction)) return undefined;
  // answered, or undone in the 管理台: nothing left to appeal
  if (a.answeredAt || a.undoneAt) return { actionId: a.id, state: "answered" };
  if (a.appealedAt) return { actionId: a.id, state: "sent" };
  return appealable(a, now) ? { actionId: a.id, state: "open" } : undefined;
}

/** The player's 站长通知 since a moment, as 消息 shows them */
export async function staffItems(userId: string, since: Date, now = Date.now()): Promise<InboxItem[]> {
  const rows = await db
    .select({ n: staffNotes, a: modActions })
    .from(staffNotes)
    .leftJoin(modActions, eq(modActions.id, staffNotes.actionId))
    .where(and(eq(staffNotes.userId, userId), gt(staffNotes.createdAt, since)));
  return rows.map(({ n, a }) => {
    const appeal = appealOf(n, a, now);
    return {
      kind: "staff",
      id: `s:${n.id}`,
      at: n.createdAt.getTime(),
      seen: Boolean(n.seenAt),
      text: noteText(n, a),
      ...(appeal ? { appeal } : {}),
      replied: true,
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/**
 * 我觉得处理错了: the player's one appeal of an action told in their 站长通知, in APPEAL_MIN to APPEAL_MAX
 * characters, within INBOX_DAYS of it. The admin answers it on the admin page (src/lib/server/admin.ts).
 */
export async function appeal(userId: string, actionId: unknown, text: unknown, now = Date.now()) {
  const said = String(text ?? "").trim();
  const length = [...said].length;
  if (length < APPEAL_MIN) throw new WorldError(T.server.staffNotes.appealSayWhy);
  if (length > APPEAL_MAX) throw new WorldError(fmt(T.server.staffNotes.appealTooLong, { max: APPEAL_MAX }));
  const id = String(actionId);
  const [a] = UUID.test(id)
    ? await db
        .select()
        .from(modActions)
        .where(and(eq(modActions.id, id), eq(modActions.userId, userId)))
        .limit(1)
    : [];
  if (!a || a.auto || !APPEALABLE.includes(a.action as AdminAction)) throw new WorldError(T.server.staffNotes.noAction);
  if (a.undoneAt) throw new WorldError(T.server.staffNotes.undone);
  if (a.appealedAt) throw new WorldError(T.server.staffNotes.appealedAlready);
  if (!appealable(a, now)) throw new WorldError(fmt(T.server.staffNotes.appealTooLate, { days: INBOX_DAYS }));
  const sent = await db
    .update(modActions)
    .set({ appeal: said, appealedAt: new Date(now) })
    .where(and(eq(modActions.id, a.id), isNull(modActions.appealedAt)))
    .returning({ id: modActions.id });
  if (!sent.length) throw new WorldError(T.server.staffNotes.appealedAlready);
}

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
