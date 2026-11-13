import { fmt, T } from "@/i18n";
import { beijingDate } from "./beijing";

/**
 * 公告 (src/components/app/NoticeBoard.tsx): what pages get of each notice, and what this device remembers
 * of them. Whether a notice was seen is kept only here, in the browser, and sent nowhere: on another phone
 * or browser, one that pops up once pops up once more.
 */

/** none: only the red dot and the strip; once: pops up once on each device; every: on every visit and sign-in */
export type NoticePop = "none" | "once" | "every";
export const NOTICE_POPS: readonly NoticePop[] = ["none", "once", "every"];

/** A notice as everyone gets it (src/lib/server/notices.ts): no names, nor when it is taken down */
export type PublicNotice = {
  id: string;
  title: string;
  body: string;
  pop: NoticePop;
  pinned: boolean;
  /** ms */
  publishedAt: number;
  /** The first paragraph or list item as plain text (noticeText.ts) */
  excerpt: string;
};

/** The notices everyone sees just now, pinned first, then the newest; the stamp changes with any of them */
export type NoticeList = { stamp: string; notices: PublicNotice[] };

function isNotice(v: unknown): v is PublicNotice {
  const n = v as Record<keyof PublicNotice, unknown> | null;
  return (
    Boolean(n) &&
    typeof n!.id === "string" &&
    typeof n!.title === "string" &&
    typeof n!.body === "string" &&
    NOTICE_POPS.includes(n!.pop as NoticePop) &&
    typeof n!.pinned === "boolean" &&
    typeof n!.publishedAt === "number" &&
    typeof n!.excerpt === "string"
  );
}

/** A list as the server sent it, or null; anything else in it is dropped */
export function readNoticeList(v: unknown): NoticeList | null {
  const o = v as { stamp?: unknown; notices?: unknown } | null;
  if (!o || typeof o.stamp !== "string" || !Array.isArray(o.notices)) return null;
  return { stamp: o.stamp, notices: o.notices.filter(isNotice) };
}

/** The list again, from the server's memory: when /api/roaches says it changed. Null when it could not be had. */
export async function fetchNotices(): Promise<NoticeList | null> {
  try {
    const res = await fetch("/api/notices", { cache: "no-cache" });
    if (!res.ok) return null;
    return readNoticeList(await res.json());
  } catch {
    return null;
  }
}

// ---- the stamp every answer of /api/roaches carries (x-notices) ----

type StampListener = (stamp: string) => void;
const stampListeners = new Set<StampListener>();

/** Told the stamp of the notices the server has, with each answer about the roaches; returns the undo */
export function onNoticeStamp(fn: StampListener) {
  stampListeners.add(fn);
  return () => void stampListeners.delete(fn);
}

/** src/lib/world/server.ts, with the x-notices header of each answer */
export function heardNoticeStamp(stamp: string | null) {
  if (!stamp) return;
  for (const fn of stampListeners) fn(stamp);
}

// ---- what this device remembers ----

/**
 * seen: notices read or put away here (the last SEEN_KEPT); boardAt: when the board was last opened, which
 * puts out the red dot; quietAt: when the strip was last put away (or the board opened), so the next one
 * does not come up at once
 */
export type NoticeMemory = { seen: string[]; boardAt: number; quietAt: number };

export const EMPTY_MEMORY: NoticeMemory = { seen: [], boardAt: 0, quietAt: 0 };
const MEMORY_KEY = "zhoup.notices";
const SEEN_KEPT = 100;

function readMemory(): NoticeMemory | null {
  try {
    const v = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "null") as Partial<NoticeMemory> | null;
    if (!v || typeof v !== "object") return null;
    return {
      seen: Array.isArray(v.seen) ? v.seen.filter((id): id is string => typeof id === "string").slice(-SEEN_KEPT) : [],
      boardAt: Number.isFinite(v.boardAt) ? Number(v.boardAt) : 0,
      quietAt: Number.isFinite(v.quietAt) ? Number(v.quietAt) : 0,
    };
  } catch {
    // storage blocked, or not ours: nothing remembered
    return null;
  }
}

/** What this device remembers; nothing, where storage is blocked */
export const noticeMemory = () => readMemory() ?? EMPTY_MEMORY;

/** Whether this device remembers anything yet: not before the board came */
export const noticeMemoryKept = () => readMemory() !== null;

/**
 * A change to what this device remembers, made to what is stored (another tab may have changed it since
 * this one read it), and stored. Returns what is remembered now.
 */
export function changeNoticeMemory(change: (m: NoticeMemory) => NoticeMemory, held = EMPTY_MEMORY): NoticeMemory {
  const next = change(readMemory() ?? held);
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: remembered on this page only
  }
  return next;
}

/** Read, or put away: it never pops up once again nor shows in the strip */
export const noticeRead = (m: NoticeMemory, id: string): NoticeMemory =>
  m.seen.includes(id) ? m : { ...m, seen: [...m.seen, id].slice(-SEEN_KEPT) };

/**
 * The latest the board holds, or now if later: a phone whose clock is behind still puts out the red dot
 * for what it was shown
 */
const upTo = (list: PublicNotice[], now: number) => Math.max(now, ...list.map((n) => n.publishedAt));

/** The board opened (the button or the strip): the red dot goes out, and the strip stays away */
export const boardOpened = (m: NoticeMemory, list: PublicNotice[], now: number): NoticeMemory => {
  const at = upTo(list, now);
  return { ...m, boardAt: at, quietAt: at };
};

/** The strip's ×: this one is put away, and the next waits for a newer one */
export const stripClosed = (m: NoticeMemory, id: string, list: PublicNotice[], now: number): NoticeMemory => ({
  ...noticeRead(m, id),
  quietAt: upTo(list, now),
});

// ---- the rules ----

/** A notice counts as new for 7 days: the red dot, the strip, 「新」 and popping up once are for these only */
export const FRESH_MS = 7 * 86_400_000;

export const isFresh = (n: PublicNotice, now: number) => now - n.publishedAt < FRESH_MS;
/** New: published in the last 7 days, and not read here */
export const isNew = (n: PublicNotice, m: NoticeMemory, now: number) => isFresh(n, now) && !m.seen.includes(n.id);

const newestFirst = (a: PublicNotice, b: PublicNotice) => b.publishedAt - a.publishedAt;

/**
 * What pops up on opening the map or signing in (never for visitors), one at a time: the newest new one
 * that pops up once, else the one that pops up on every visit, else nothing
 */
export function noticeToPop(list: PublicNotice[], m: NoticeMemory, now: number): PublicNotice | null {
  const once = list.filter((n) => n.pop === "once" && isNew(n, m, now)).sort(newestFirst)[0];
  return once ?? list.find((n) => n.pop === "every") ?? null;
}

/** The red dot on 「公告」: something new since the board was last opened */
export const noticeDot = (list: PublicNotice[], m: NoticeMemory, now: number) =>
  list.some((n) => isNew(n, m, now) && n.publishedAt > m.boardAt);

/** The strip under the counts: the newest new one since the strip was last put away */
export function stripNotice(list: PublicNotice[], m: NoticeMemory, now: number): PublicNotice | null {
  return list.filter((n) => isNew(n, m, now) && n.publishedAt > m.quietAt).sort(newestFirst)[0] ?? null;
}

// ---- once a visit ----

/**
 * Popped up already during this visit, for this account: a visit is this tab until it is closed, so a
 * reload does not pop one up again, while a new tab does. The key is the one the single notice before the
 * board kept (2026-11-11), so tabs that showed it do not show one again when this version comes.
 */
const visitKey = (userId: string) => `zhoup.notice.2026-11-11.${userId}`;

export function poppedThisVisit(userId: string) {
  try {
    return sessionStorage.getItem(visitKey(userId)) === "1";
  } catch {
    // storage blocked: one on every load rather than never
    return false;
  }
}

export function markPopped(userId: string) {
  try {
    sessionStorage.setItem(visitKey(userId), "1");
  } catch {
    // storage blocked: nothing to remember it in
  }
}

/** A notice's day in Beijing, like 「11月12日」 */
export function noticeDay(t: number) {
  const [, m, d] = beijingDate(t).split("-");
  return fmt(T.lib.notices.day, { m: Number(m), d: Number(d) });
}
