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

const ruleWords = (rule: string | null) => fmt(T.server.staffNotes.because, { rule: isRuleCode(rule) ? RULES[rule] : RULES.harass });

/** What a suspended player may and may not do, as each message about it says */
export const suspendedMeans = () => T.server.staffNotes.suspendedMeans;

/** What the admin did about the player, told under the rule it was for; slot: removeRoach's roach, 0 the main one */
export function actionWords(action: string, rule: string | null, until: Date | null, slot: number | null = null) {
  const why = ruleWords(rule);
  switch (action) {
    case "removeRoach":
      return fmt(T.server.staffNotes.action.removeRoach, { why, roach: slot === 0 ? T.server.staffNotes.roach.main : T.server.staffNotes.roach.clone });
    case "warn":
      return fmt(T.server.staffNotes.action.warn, { why, days: YELLOW_DAYS, yellows: YELLOWS_TO_WORRY });
    case "suspend":
      return fmt(T.server.staffNotes.action.suspend, { why, until: dayWords((until ?? new Date(Date.now() + SUSPEND_DAYS * 86_400_000)).getTime()), means: suspendedMeans() });
    case "clearName":
      return fmt(T.server.staffNotes.action.clearName, { why });
    case "clearUid":
      return fmt(T.server.staffNotes.action.clearUid, { why });
    case "clearBoth":
      return fmt(T.server.staffNotes.action.clearBoth, { why });
    default:
      return fmt(T.server.staffNotes.action.handled, { why });
  }
}

/** What undoing an action on appeal gave back */
const REVERTED: Partial<Record<AdminAction, string>> = {
  get warn() {
    return T.server.staffNotes.reverted.yellow;
  },
  get removeRoach() {
    return T.server.staffNotes.reverted.yellow;
  },
  get suspend() {
    return T.server.staffNotes.reverted.suspend;
  },
  get clearName() {
    return T.server.staffNotes.reverted.clearName;
  },
  get clearUid() {
    return T.server.staffNotes.reverted.clearUid;
  },
  get clearBoth() {
    return T.server.staffNotes.reverted.clearBoth;
  },
  get ageCheck() {
    return T.server.staffNotes.reverted.ageCheck;
  },
};

/**
 * What came of a player's roaches that stood where no roach may (src/lib/server/offLimits.ts):
 * moved just outside, or, visiting there, sent home. No yellow card: it is not their doing.
 */
export const OFF_LIMITS_WORDS = {
  get moved() {
    return T.server.staffNotes.offLimits.moved;
  },
  get home() {
    return T.server.staffNotes.offLimits.home;
  },
};

/** The words of one note */
export function noteText(n: typeof staffNotes.$inferSelect, action?: typeof modActions.$inferSelect | null) {
  const when = n.reportedOn ? fmt(T.server.staffNotes.note.reportedOn, { day: shortDay(n.reportedOn) }) : "";
  // a roach's report blocks nobody, so there is nobody blocked to mention
  const roach = isRoachReportReason(n.reason);
  const reported = fmt(T.server.staffNotes.note.reported, { when, what: roach ? T.server.staffNotes.note.reportedRoach : T.server.staffNotes.note.reportedPlayer, reason: reasonWords(n.reason) });
  switch (n.kind) {
    case "reportUpheld":
      return fmt(T.server.staffNotes.note.reportUpheld, { seen: reported });
    case "reportDismissed":
      return roach ? fmt(T.server.staffNotes.note.reportDismissed, { seen: reported }) : fmt(T.server.staffNotes.note.reportDismissedBlocked, { seen: reported });
    case "action":
      return actionWords(action?.action ?? "", n.rule ?? action?.rule ?? null, n.until ?? action?.until ?? null, action?.roachSlot ?? null);
    case "appealKept":
      return T.server.staffNotes.note.appealKept;
    case "appealReverted":
      return fmt(T.server.staffNotes.note.appealReverted, { back: REVERTED[(action?.action ?? "") as AdminAction] ?? T.server.staffNotes.note.restored });
    // undone in the 管理台 after the fact, without an appeal
    case "undone":
      return action
        ? fmt(T.server.staffNotes.note.undone, { day: dayWords(action.createdAt.getTime()), back: REVERTED[action.action as AdminAction] ?? T.server.staffNotes.note.restored })
        : T.server.staffNotes.note.undoneOnce;
    case "held":
      return T.profile.hidden;
    case "released":
      return T.server.staffNotes.note.released;
    case "autoSuspended":
      return fmt(T.server.staffNotes.note.autoSuspended, { days: SUSPEND_DAYS });
    case "unsuspended":
      return T.server.staffNotes.note.unsuspended;
    case "offLimits":
      return n.reason === "home" ? OFF_LIMITS_WORDS.home : OFF_LIMITS_WORDS.moved;
    default:
      return T.server.staffNotes.note.generic;
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
