import { beijingDate, beijingShort } from "./beijing";
import type { AdminAction, AdminPerson, AnyReason, ReporterInfo, RoachReportReason, RuleCode } from "./safety";

/**
 * The 管理台 (src/app/admin, src/components/admin) and its endpoints (src/app/api/admin): who may open it, the
 * authenticator at its door, what it keeps a record of. Shared by the server and the page.
 */

/** What the 管理台 calls the owner; players only ever see 「站长」, whoever it was */
export const OWNER_ALIAS = "站长";

export type AdminRole = "owner" | "mod";

/** How long a right authenticator code keeps the 管理台 open on a device */
export const UNLOCK_HOURS = 12;
/** The heaviest steps (a ban, new backup codes) want a right code from this recently */
export const FRESH_MINUTES = 10;
/** Setting up an authenticator takes a sign-in this recent, so a stolen cookie cannot bind one first */
export const SETUP_LOGIN_MINUTES = 15;
/** Wrong codes in a row before the 管理台 pauses for the person: PAUSE_MINUTES, twice as long each time after, a day at most */
export const CODE_TRIES = 5;
export const PAUSE_MINUTES = 15;
export const PAUSE_MAX_HOURS = 24;

/** What a 管理台 endpoint answers with when the door is shut, so the page can show the right screen */
export const GATE_CODES = ["ADMIN_PAUSED", "ADMIN_SETUP", "ADMIN_LOCKED", "ADMIN_FRESH"] as const;
export type GateCode = (typeof GATE_CODES)[number];
export const isGateCode = (c: unknown): c is GateCode => typeof c === "string" && (GATE_CODES as readonly string[]).includes(c);

/** Who stands at the door: their name in the 管理台, their role and their sign-in email, masked */
export type GateWho = { alias: string; role: AdminRole; email: string };

/**
 * Where they stand: to set up an authenticator (recentLogin: signed in recently enough to), to type a code on this
 * device, paused after wrong codes (until when, and for how many minutes in all), or in until a moment (and until
 * when the heaviest steps go without typing a code again, null when they want one now).
 */
export type GateState = GateWho &
  (
    | { state: "setup"; recentLogin: boolean }
    | { state: "locked"; triesLeft: number; backupLeft: number }
    | { state: "paused"; until: number; minutes: number }
    | { state: "open"; until: number; backupLeft: number; freshUntil: number | null }
  );

/** How long the pause after the nth time of too many wrong codes lasts (n from 1), in minutes */
export const pauseMinutes = (n: number) => Math.min(PAUSE_MINUTES * 2 ** Math.max(0, Math.min(n - 1, 10)), PAUSE_MAX_HOURS * 60);

/** A number of minutes in words: 「15 分钟」, 「1 小时」, 「1 小时 30 分钟」 */
export function minutesWords(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} 小时` : "", m || !h ? `${m} 分钟` : ""].filter(Boolean).join(" ");
}

/** A moment as Beijing wall-clock time: 「14:40」 on the same day, 「11/13 14:40」 on another */
export const clockWords = (t: number, now: number) => (beijingDate(t) === beijingDate(now) ? beijingShort(t).split(" ")[1] : beijingShort(t));

/** What the door says while too many wrong codes pause someone: the owner is told by email, a moderator tells the owner */
export function pausedWords(role: AdminRole, until: number, minutes: number, now: number) {
  return `输错太多次，先暂停 ${minutesWords(minutes)}（到 ${clockWords(until, now)}）。${
    role === "owner"
      ? "已经发邮件到你的邮箱。如果不是你在输，说明有人登进了你的舟P账号：在「我的资料」里退出其他设备。"
      : "已经发邮件告诉站长。如果不是你在输，告诉站长。"
  }`;
}

/** A new authenticator to add: the QR code (an SVG), and the secret to type in instead, in groups of four */
export type SetupStart = { qr: string; secret: string };

/** An email shown masked: its first two letters and its domain, like ow***@example.com */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? "");
  if (!e) return "";
  const at = e.lastIndexOf("@");
  return at < 0 ? `${e.slice(0, 2)}***` : `${e.slice(0, Math.min(2, at))}***${e.slice(at)}`;
}

// ---- 操作记录 ----

/** act: something done to an account or the site; view and search: a look; gate: the door; admin: who may come in */
export type AdminLogKind = "act" | "view" | "search" | "gate" | "admin";
/** The log's filters: everything, what was done, looks and searches, the door, or who may come in */
export type AdminLogFilter = "all" | "act" | "look" | "gate" | "admin";

export type AdminLogEntry = {
  id: number;
  at: number;
  /** Who, as the 管理台 called them then */
  actor: string;
  kind: AdminLogKind;
  /** e.g. act.warn, view.account, gate.unlock */
  what: string;
  /** The account it was about as it is now; gone: it was about one that is no more (deleted, or banned) */
  target: { id: string; name: string } | null;
  gone: boolean;
  detail: string | null;
  /** The action it did (mod_actions), for 撤销 */
  actionId: string | null;
  canUndo: boolean;
  undone: boolean;
};

/** A page of the log, newest first, and today's numbers (Beijing time): things done, looks, searches and wrong codes */
export type AdminLogPage = {
  entries: AdminLogEntry[];
  today: { acts: number; views: number; searches: number; fails: number };
  more: boolean;
};

// ---- 搜索账号 ----

/** A row of 搜索账号: who it is, and the marks beside them */
export type FoundAccount = {
  id: string;
  email: string;
  name: string;
  anonymous: boolean;
  joinedAt: number;
  /** 暂停互动 until then, or null */
  suspendedUntil: number | null;
  /** Yellow cards in the last YELLOW_DAYS */
  yellow: number;
  /** Cases about them waiting in 待处理 */
  open: number;
  /** Their name and UIDs held while reports wait */
  held: boolean;
};
export type FoundAccounts = { players: FoundAccount[]; total: number };

/** One action in an account's 处理记录 (mod_actions) */
export type AdminHistoryItem = {
  actionId: string;
  /** One of AdminAction, or unsuspend */
  action: AdminAction | "unsuspend";
  rule: RuleCode | null;
  /** Who did it, as the 管理台 called them (「站长」 for what was done before there were others); null for the reports' own steps */
  by: string | null;
  auto: boolean;
  at: number;
  /** A suspension's end */
  until: number | null;
  /** removeRoach: whether it was the main roach */
  main: boolean;
  appeal: { text: string; at: number; result: "kept" | "reverted" | null } | null;
  undoneAt: number | null;
  canUndo: boolean;
};

/** A report about the account, open or handled: never who made it */
export type AdminAccountReport = {
  reason: AnyReason;
  note: string;
  at: number;
  reporter: ReporterInfo | null;
  /** About one of their roaches: whether it was the main one */
  roach: { main: boolean } | null;
  /** Handled: when, how (reports.resolution), and who in the 管理台 when that can be told */
  resolvedAt: number | null;
  resolution: string | null;
  by: string | null;
};

/** A note between the people of the 管理台, which the player never sees */
export type AdminNote = { id: string; by: string; text: string; at: number };

/** Everything the 管理台 shows of one account: never where their roaches are or when they came by */
export type AdminAccount = {
  person: AdminPerson;
  /** Names and UIDs cleared from it, which it may not take again */
  cleared: { kind: "name" | "uid"; value: string; at: number }[];
  last24: { touches: number; declarations: number };
  /** Declarations of the last 7 days, without where they were sent from */
  declarations: { text: string; at: number }[];
  reports: AdminAccountReport[];
  /** Reports they made: upheld, dismissed, waiting, and whether the automatic steps count them */
  reportsMade: { upheld: number; dismissed: number; open: number; reliable: boolean };
  history: AdminHistoryItem[];
  notes: AdminNote[];
  /** Cases about them waiting in 待处理 */
  openCases: number;
};

/** What the 管理台 may undo after the 5 seconds have passed: what it did can be given back */
export const UNDOABLE: readonly string[] = ["warn", "suspend", "clearName", "clearUid", "clearBoth", "ageCheck"];

/** What 搜到以后直接处理 may do to an account (act) */
export const ACCOUNT_ACTIONS: readonly AdminAction[] = ["warn", "suspend", "clearName", "clearUid", "clearBoth", "ageCheck", "ban"];

// ---- the map's 看被举报的蟑螂 ----

/**
 * A roach case open for where it was put (stalk, place, pattern): the case, the roach on the map now (null once
 * taken back), main or clone, whose, where it is now and where it was at the latest report, whether it is still
 * there, and the case's reports by reason, its reporters as 待处理 counts them, and its oldest report. nearM: for
 * 「一直贴着我放」, how far it was from the reporter's nearest roach. Never who reported, nor where their roaches are.
 */
export type ReportedPlace = {
  caseId: string;
  id: string | null;
  main: boolean;
  owner: string;
  now: { lng: number; lat: number } | null;
  was: { lng: number; lat: number };
  state: "here" | "moved" | "gone";
  reasons: { reason: RoachReportReason; n: number }[];
  reporters: number;
  reliable: number;
  since: number;
  nearM: number | null;
};

/**
 * The owner's view of every roach of a player with open reports: where, whose, the reasons reported about the
 * owner and their roaches, the case to settle it in (its own, else the owner's, else another of the owner's
 * roaches'), and why in a few words: about itself (self), about its owner (owner, e.g. 「名字不合适 ×2」), or about
 * another of the owner's roaches (sibling, 「它的另一只克隆体被举报：放在不合适的地方」).
 */
export type ReportedRoachAll = {
  caseId: string;
  id: string;
  lng: number;
  lat: number;
  main: boolean;
  owner: string;
  reasons: string[];
  why: string;
  about: "self" | "owner" | "sibling";
};

/** A roach report's reason in a few words, as the map's switches say it */
export const ROACH_REASON_SHORT: Record<RoachReportReason, string> = {
  stalk: "贴着别人放",
  place: "放在不合适的地方",
  pattern: "摆字或图案",
};

export type ReportedRoaches = { view: "place"; places: ReportedPlace[] } | { view: "all"; roaches: ReportedRoachAll[] };
