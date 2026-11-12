import "server-only";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { noticeExcerpt } from "../noticeText";
import type { NoticeList, NoticePop, PublicNotice } from "../notices";
import { db } from "./db";
import { onReload } from "./live";
import { notices } from "./schema";
import { errorCode } from "./signals";

/**
 * 公告 for everyone (src/components/app/NoticeBoard.tsx), from memory. Each process reads the live notices
 * (a few dozen at most) when it starts, when the admin changes one (reloadEverywhere("notices") in live.ts,
 * on every process) and every 5 minutes in case it missed the word; nothing about them is asked of the
 * database while answering a page, and nothing about who reads them is kept.
 *
 * A page gets them with the map (src/app/page.tsx). Every answer of /api/roaches carries their stamp
 * (x-notices), and a page holding another one asks /api/notices. The stamp comes from the notices alone,
 * so every process gives the same one for the same notices.
 *
 * On globalThis, as Next.js can load this module once per route bundle (as live.ts).
 */

/** The most the board shows */
export const NOTICES_SHOWN = 20;
const RELOAD_MS = 5 * 60_000;

/** A live notice as held here: what everyone gets, and when it leaves by itself and last changed */
export type HeldNotice = PublicNotice & { endsAt: number | null; updatedAt: number };
export type NoticeAnswer = NoticeList & { json: string };

type State = {
  rows: HeldNotice[];
  /** The answer made from rows, good from `from` until the next notice leaves by itself */
  made: { answer: NoticeAnswer; rows: HeldNotice[]; from: number; until: number } | null;
  loading: Promise<void> | null;
  again: boolean;
  started: boolean;
};
const g = globalThis as unknown as { liveNotices?: State };
const state = (g.liveNotices ??= { rows: [], made: null, loading: null, again: false, started: false });

async function readLive(): Promise<HeldNotice[]> {
  const rows = await db
    .select()
    .from(notices)
    .where(and(eq(notices.status, "live"), or(isNull(notices.endsAt), gt(notices.endsAt, sql`now()`))));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    pop: r.pop as NoticePop,
    pinned: r.pinned,
    // set whenever one goes live
    publishedAt: (r.publishedAt ?? r.createdAt).getTime(),
    excerpt: noticeExcerpt(r.body),
    endsAt: r.endsAt?.getTime() ?? null,
    updatedAt: r.updatedAt.getTime(),
  }));
}

/** Read the live notices again. Asked again meanwhile, it reads once more after, so the last change is never missed. */
export function loadNotices(): Promise<void> {
  if (state.loading) {
    state.again = true;
    return state.loading;
  }
  const loading = (async () => {
    try {
      do {
        state.again = false;
        state.rows = await readLive();
      } while (state.again);
    } finally {
      state.loading = null;
    }
  })();
  state.loading = loading;
  return loading;
}

/** At the start of every process (src/instrumentation-node.ts). Never throws: until they can be read, there are none. */
export async function startNotices() {
  if (state.started) return;
  state.started = true;
  onReload("notices", loadNotices);
  setInterval(() => loadNotices().catch((e) => console.error("notices: reading them again failed", errorCode(e))), RELOAD_MS).unref();
  await loadNotices().catch((e) => console.error("notices: reading them failed, so there are none for now", errorCode(e)));
}

/** Pinned first, then the newest; the id settles ties, so every process puts them in the same order */
const boardOrder = (a: HeldNotice, b: HeldNotice) =>
  Number(b.pinned) - Number(a.pinned) || b.publishedAt - a.publishedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** What everyone sees now: live and not yet past its end, pinned first, then the newest, at most NOTICES_SHOWN */
export function visibleNotices(now = Date.now()): HeldNotice[] {
  return state.rows
    .filter((n) => n.endsAt === null || n.endsAt > now)
    .sort(boardOrder)
    .slice(0, NOTICES_SHOWN);
}

/** FNV-1a, 32 bits, in base 36: short, and the same on every process */
function fnv1a(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The notices everyone sees now, their stamp and the answer ready to send. Made again only after the
 * notices are read again or the next one leaves by itself, not for each request.
 */
export function noticeList(now = Date.now()): NoticeAnswer {
  const made = state.made;
  if (made && made.rows === state.rows && made.from <= now && now < made.until) return made.answer;
  const shown = visibleNotices(now);
  const stamp = fnv1a(shown.map((n) => `${n.id}:${n.updatedAt}`).join(","));
  const list: PublicNotice[] = shown.map(({ id, title, body, pop, pinned, publishedAt, excerpt }) => ({
    id,
    title,
    body,
    pop,
    pinned,
    publishedAt,
    excerpt,
  }));
  const answer = { stamp, notices: list, json: JSON.stringify({ stamp, notices: list }) };
  const ends = state.rows.map((n) => n.endsAt ?? Infinity).filter((t) => t > now);
  state.made = { answer, rows: state.rows, from: now, until: Math.min(Infinity, ...ends) };
  return answer;
}

/** Tests: nothing held */
export function forgetNotices() {
  state.rows = [];
  state.made = null;
}
