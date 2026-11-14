import { fmt, T } from "@/i18n";
import { beijingDate } from "./beijing";

/**
 * 支持舟P地图: a link out to the site's page on a sponsoring platform (爱发电, and Ko-fi once there is a link
 * for it), a card saying what the servers cost this month and how much has come in, and every month's
 * accounts at /support. Nothing is paid on the site itself, which never sees anyone's payment details.
 * It stays out of sight until the owner switches it on in the 管理台 with an 爱发电 link (src/lib/server/sponsorAdmin.ts),
 * and then shows only to those SPONSOR lets see it (src/lib/server/env.ts). Sums are kept in fen.
 */

/** Who SPONSOR (src/lib/server/env.ts) shows 支持舟P地图 to: everyone, the 站长 and the admins, or nobody */
export type SponsorMode = "on" | "admins" | "off";

/** The longest link the owner may give */
export const SPONSOR_LINK_MAX = 300;
/** The longest note on where a month's money went */
export const SPONSOR_NOTE_MAX = 100;
/** The most a month's sum may be, in yuan */
export const SPONSOR_YUAN_MAX = 1_000_000;

/** A month's accounts as the owner enters them: what the servers and mail cost, what came in (fen both), and where it went */
export type SponsorMonth = { month: string; spent: number; received: number; note: string };

/**
 * A month with what was left over from the months before it (carried, never below 0) and what is left
 * after it (balance): below 0, the owner paid the rest; above 0, it pays back what starting the site cost
 * first, as far as it goes (repaid), and what is left after that pays towards the next month's bills.
 */
export type LedgerRow = SponsorMonth & { carried: number; balance: number; repaid: number };

/** The switch and the links as the owner keeps them; "" for a link not given */
export type SponsorSettings = { enabled: boolean; afdian: string; kofi: string };

/**
 * What starting the site cost (fen) and what it went on: paid by the owner, shown on /support apart from
 * the months, and paid back from what the months have left over after their bills, as far as that goes
 * (what is never paid back, the owner bears). spent 0: none given.
 */
export type SponsorStartup = { spent: number; note: string };

/** The same with how much of it the months have paid back so far */
export type StartupPaid = SponsorStartup & { repaid: number };

/** The 管理台's 支持舟P地图: the settings as stored, whether it shows and to whom, what starting the site cost, and every month newest first */
export type SponsorAdmin = SponsorSettings & {
  /** Switched on with an 爱发电 link: shown to those mode lets see it */
  shows: boolean;
  mode: SponsorMode;
  startup: StartupPaid;
  months: LedgerRow[];
};

/** What the card shows: where its buttons go, and the month it is about (current: this Beijing month) */
export type SponsorView = {
  afdian: string;
  kofi: string | null;
  month: (LedgerRow & { current: boolean }) | null;
  /** Some of what starting the site cost is still to be paid back, so what is left over goes there first */
  repaying: boolean;
  /** The signed-in player's own login email, for 复制我的登录邮箱; null for visitors */
  email: string | null;
};

/** 2026-11 */
export const isMonth = (s: unknown): s is string => typeof s === "string" && /^20[2-9]\d-(0[1-9]|1[0-2])$/.test(s);

/** The Beijing month a moment falls in, as 2026-11 */
export const monthOf = (now = Date.now()) => beijingDate(now).slice(0, 7);

const yearOf = (month: string) => month.slice(0, 4);
const monthNumber = (month: string) => Number(month.slice(5, 7));

/** 「2026 年 11 月」 */
export const monthWords = (month: string) => fmt(T.lib.sponsor.yearMonth, { year: yearOf(month), month: monthNumber(month) });

/** The same for a narrow table cell: when it has to wrap, 「2026 年」 goes over 「11 月」 */
export const monthCell = (month: string) => fmt(T.lib.sponsor.yearMonthCell, { year: yearOf(month), month: monthNumber(month) });

/** 「这个月」 for the month it is, else 「11 月」 */
export const whichMonth = (row: { month: string; current: boolean }) =>
  row.current ? T.lib.sponsor.thisMonth : fmt(T.lib.sponsor.month, { month: monthNumber(row.month) });

/**
 * The months oldest first, each with what the ones before it left over, and what it paid back of what
 * starting the site cost (startup, fen) before leaving the rest to the next month
 */
export function ledger(months: SponsorMonth[], startup = 0): LedgerRow[] {
  let left = 0;
  let owed = startup;
  return [...months]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const carried = left;
      const balance = carried + m.received - m.spent;
      const repaid = Math.min(Math.max(0, balance), owed);
      owed -= repaid;
      left = Math.max(0, balance - repaid);
      return { ...m, carried, balance, repaid };
    });
}

/** How much of what starting the site cost the months have paid back */
export const repaidOf = (rows: LedgerRow[]) => rows.reduce((sum, r) => sum + r.repaid, 0);

/** The month the card is about: this Beijing month, else the latest one before it; none before any is entered */
export function cardMonth(rows: LedgerRow[], now = Date.now()) {
  const thisMonth = monthOf(now);
  const row = rows.filter((r) => r.month <= thisMonth).at(-1);
  return row ? { ...row, current: row.month === thisMonth } : null;
}

/** What the month has to pay its bills with: what came in, and what the months before left over */
export const inHand = (row: LedgerRow) => row.carried + row.received;

/** 够啦: there is a bill this month, and what came in (with what was left over) pays it */
export const enough = (row: LedgerRow) => row.spent > 0 && inHand(row) >= row.spent;

/** How far the bar goes, 0 to 1 */
export const share = (row: LedgerRow) => (row.spent > 0 ? Math.min(1, inHand(row) / row.spent) : 0);

/**
 * How many months, the month itself among them, what is in hand keeps the servers going at its bill, once
 * what goes to paying back the start is taken off: whole months only, so the card never says more than
 * there is (the owner enters the bill on the high side). 0 without a bill.
 */
export const monthsCovered = (row: LedgerRow) => (row.spent > 0 ? Math.floor((inHand(row) - row.repaid) / row.spent) : 0);

/** 「¥1,234」, 「¥1,234.50」, 「−¥300」 */
export function yuan(fen: number) {
  const whole = Math.round(Math.abs(fen));
  const cents = whole % 100;
  return `${fen < 0 ? "−" : ""}¥${Math.floor(whole / 100).toLocaleString("zh-CN")}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
}

/** A sum as the owner would type it again: 1500, 320.5 */
export const yuanTyped = (fen: number) => String(fen / 100);

/** A sum the owner typed, in yuan (1234, 1,234.5, ¥1234): in fen, or null when it is not one */
export function parseYuan(input: unknown): number | null {
  const s = String(input ?? "").replace(/[¥￥,，\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, part = ""] = s.split(".");
  const fen = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return fen <= SPONSOR_YUAN_MAX * 100 ? fen : null;
}

/** A sponsoring page's link: "" for none, the link itself when it is a plain https one, null for anything else */
export function sponsorLink(input: unknown): string | null {
  const s = String(input ?? "").trim();
  if (!s) return "";
  if (s.length > SPONSOR_LINK_MAX) return null;
  try {
    const url = new URL(s);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
