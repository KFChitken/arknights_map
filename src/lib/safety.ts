import type { Game } from "./games";
import type { RoachAvatar, RoachColor } from "./types";

import { OTHER_NOTE_MIN } from "./rules";

/** Why one player may report another, worded as the reporter picks it, in the order the report sheet shows them. */
export const REPORT_REASONS = {
  name: "名字不合适",
  contact: "留了联系方式或个人信息",
  impersonate: "冒充官方或别人",
  spam: "骚扰刷屏",
  minor: "可能未成年",
  other: "其他",
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

export const isReportReason = (r: unknown): r is ReportReason => typeof r === "string" && Object.hasOwn(REPORT_REASONS, r);

/** Reports about what a player wrote about themselves: enough different reporters hold their name and UIDs for the admin */
export const PROFILE_REASONS: readonly ReportReason[] = ["name", "contact", "impersonate"];

/** Reports the admin is emailed about within the hour, even after the day's reminder went out */
export const URGENT_REASONS: readonly ReportReason[] = ["minor", "contact"];

/** A report for 「其他」 must say what happened; the note is counted in characters, emoji as one */
export const noteMissing = (reason: ReportReason, note: string) => reason === "other" && [...note.trim()].length < OTHER_NOTE_MIN;

/** How soon a case wants the admin: red first, then yellow, then green */
export type CaseLevel = "red" | "yellow" | "green";
export const CASE_LEVELS: readonly CaseLevel[] = ["red", "yellow", "green"];
export const REPORT_LEVEL: Record<ReportReason, CaseLevel> = {
  name: "green",
  contact: "red",
  impersonate: "yellow",
  spam: "yellow",
  minor: "red",
  other: "green",
};
/** Being blocked by many is no report, but a case of its own */
export const BLOCKS_LEVEL: CaseLevel = "yellow";

/**
 * The community rules, as the privacy page states each one at its start: a player told what was done
 * about them can find which rule it was under.
 */
export const RULES = {
  name: "名字和资料里不能有违法、色情、赌博、广告引流的内容",
  contact: "不能留联系方式或个人信息",
  impersonate: "不能冒充官方或他人",
  harass: "不能骚扰别人",
  age: "只对满 18 岁开放",
} as const;
export type RuleCode = keyof typeof RULES;
export const isRuleCode = (r: unknown): r is RuleCode => typeof r === "string" && Object.hasOwn(RULES, r);

/** The rule a report's reason points to, for the admin's choice made ahead */
export const RULE_OF_REASON: Record<ReportReason, RuleCode> = {
  name: "name",
  contact: "contact",
  impersonate: "impersonate",
  spam: "harass",
  minor: "age",
  other: "harass",
};

/** How a reporter's reports went before, for the admin: never who they are */
export type ReporterInfo = { days: number; upheld: number; dismissed: number; reliable: boolean };

/**
 * What the admin page shows about one reported player: their open reports, what they did lately,
 * and everything they wrote about themselves (UIDs included). Never where their roaches are or
 * when they came by.
 */
export type AdminCase = {
  targetId: string;
  /** The name as saved, even while they are anonymous or held */
  name: string;
  /** Anonymous by their own choice: while held, the choice they made before */
  anonymous: boolean;
  /** When enough reports held their name and UIDs for the admin (src/lib/server/safety.ts holdProfile); null when not held */
  heldAt: number | null;
  drPrefix: boolean;
  avatar: RoachAvatar;
  color: RoachColor;
  joinedAt: number;
  /** Their login email, as 所有玩家 shows it */
  email: string;
  /** Each game they say they play: the UID and its server as they filled them in, and the operators they like */
  games: { game: Game; uid: string; server: string; favourites: string[] }[];
  /** Whether their UIDs go along with a bold touch: while held, what they had chosen before */
  shareUid: boolean;
  /** 我的助战 */
  support: string[];
  /** Their badges by name, and the one they wear */
  badges: string[];
  worn: string | null;
  /** How many roaches they have out (never where) */
  roaches: { main: boolean; clones: number };
  friends: number;
  /** How many players have blocked them */
  blockedBy: number;
  /** How cases about them were settled before, by how; clearing both counts as clearing the name and the UID */
  settled: { dismissed: number; nameCleared: number; uidCleared: number; warned: number; suspended: number; ageChecks: number };
  /** Warnings in the last YELLOW_DAYS */
  yellow: number;
  /** 暂停互动 until then (auto: the reports did it), or null */
  suspendedUntil: number | null;
  suspendedAuto: boolean;
  /** When the admin asked them to say again they are 18 or older, while they have not; and when they last said so */
  ageCheckAt: number | null;
  ageConfirmedAt: number | null;
  /** Different players who blocked them in the last BLOCKS_WINDOW_DAYS, since the admin last looked */
  blockedRecently: number;
  last24h: { touches: number; declarations: number };
  declarations: { text: string; at: number }[];
  /** The most pressing of its open reports (or being blocked by many, for a case without any) */
  level: CaseLevel;
  reporters: number;
  /** Of them, reporters the automatic steps count */
  reliable: number;
  /** Several accounts younger than RELIABLE_AFTER_DAYS reported them within an hour: maybe a pile-on */
  brigade: boolean;
  /** The rule the admin's action is put under unless they choose another */
  rule: RuleCode;
  /** The oldest open report, the time the case has waited since */
  since: number;
  reports: { reason: ReportReason; note: string; context: string; name: string; at: number; reporter: ReporterInfo | null }[];
};

/**
 * dismiss also lets a held name and UIDs out again; the clearing ones keep what they cleared from coming
 * back on that account; warn is a yellow card; suspend stops their interactions for SUSPEND_DAYS;
 * ageCheck asks them to say again they are 18 or older. Only dismiss, clearName and warn go in batches,
 * and ban never.
 */
export type AdminAction = "dismiss" | "clearName" | "clearUid" | "clearBoth" | "warn" | "suspend" | "ageCheck" | "ban";
export const BATCH_ACTIONS: readonly AdminAction[] = ["dismiss", "clearName", "warn"];

/** The admin's corner of the map: open reports, and how many of them are for URGENT_REASONS */
export type ReportCounts = { open: number; urgent: number };

/** A row of the admin page's 所有玩家: who an account is, never where its roaches are or when it visited. */
export type AdminPlayer = { id: string; email: string; name: string; anonymous: boolean; joinedAt: number };

/** The admin page's retention numbers: totals only, nothing about anyone in particular. */
export type RetentionStats = {
  /** Players seen in the last 7 days, and in the 7 days before those; null until a row of totals that old exists */
  activeWeek: number;
  activeWeekBefore: number | null;
  /** Players who signed up 7 to 13 days ago, and how many of them came back in the last 7 days */
  lastWeekSignups: number;
  lastWeekSignupsBack: number;
  /** Pairs who became 触须之交 in the last 7 days */
  friendshipsWeek: number;
};
