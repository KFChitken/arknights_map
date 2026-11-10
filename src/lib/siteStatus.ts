/**
 * 网站状态 on the admin page: what the site's own checks (src/lib/server/watch.ts) found, as the page
 * shows it. urgent problems are emailed at once and again when over, daily ones go into the morning's
 * digest, quiet ones are only kept here.
 */

export type Level = "urgent" | "daily" | "quiet";

export const LEVELS: readonly Level[] = ["urgent", "daily", "quiet"];

export const LEVEL_MARK: Record<Level, string> = { urgent: "🔴", daily: "🟡", quiet: "⚪" };

/** Higher is more pressing; anything else read from the database counts as quiet */
export const levelRank = (level: string) => (level === "urgent" ? 2 : level === "daily" ? 1 : 0);

export const asLevel = (level: string): Level => (level === "urgent" || level === "daily" ? level : "quiet");

/** One problem the checks found, from the moment it counted until it was over */
export type IncidentView = {
  id: string;
  key: string;
  level: Level;
  title: string;
  detail: string;
  advice: string;
  /** The worst it got, in words */
  worst: string | null;
  startedAt: number;
  lastSeenAt: number;
  /** null while it lasts */
  endedAt: number | null;
  /** How many times it came back within an hour of its end, plus one */
  times: number;
  mailedAt: number | null;
  recoveredMailedAt: number | null;
  /** An email about it was due when the day's were used up */
  skippedAt: number | null;
  ackedAt: number | null;
};

/** The few figures the morning's digest gives, and the page with them */
export type SiteNumbers = {
  /** Sign-in code emails in the last 24 hours, against MAIL_DAILY_LIMIT */
  loginMails: number;
  mailLimit: number;
  /** null where it cannot be read (not Linux, in development) */
  disk: { used: number; free: number } | null;
  memory: { available: number; total: number } | null;
  load: { fifteen: number; cores: number };
  /** The last night's backup, in words */
  backup: string;
  /** Days left on the HTTPS certificate when it was last asked; null where there is none (development) */
  tlsDays: number | null;
  /** 高德's map loads this Beijing month (an estimate) */
  amap: { count: number; limit: number };
  /** Signups and new 触须之交 pairs on yesterday's Beijing date; null before the totals have such a row */
  yesterday: { signups: number; friendships: number } | null;
};

export type SiteStatus = {
  now: number;
  /** When the checks last ran, from any process's view; null before they ever did */
  lastRound: number | null;
  /** Open now, the most pressing first */
  open: IncidentView[];
  /** Begun in the last 7 days, the newest first */
  week: IncidentView[];
  numbers: SiteNumbers;
  /** The latest emails: urgent, recovered, digest, report, or skipped (over the day's cap) */
  mails: { at: number; subject: string; kind: string }[];
};

/** How long, as 「25 分钟」, 「2 小时 10 分」 or 「3 天 4 小时」 */
export function lasted(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分` : `${hours} 小时`;
  return hours % 24 ? `${Math.floor(hours / 24)} 天 ${hours % 24} 小时` : `${Math.floor(hours / 24)} 天`;
}
