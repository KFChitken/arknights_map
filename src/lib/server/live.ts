import "server-only";
import { randomUUID } from "node:crypto";
import { pg } from "./db";
import { errorCode } from "./signals";

/**
 * Tells players who have the page open that their inbox changed, through the event stream at
 * /api/events. Each server process holds the connections that came to it. With several processes
 * (LIVE_ACROSS=1 on the live site, behind Caddy), a nudge reaches the others through the database:
 * Postgres NOTIFY on one channel that every process listens to, so a page hears of it whichever
 * process it is connected to. It lives on globalThis because Next.js can load this module once per
 * route bundle.
 */

/**
 * inbox: something new in 消息; declare: only declarations, which reach a whole neighbourhood at once,
 * so pages take their time (and several in one look); help: only the 求助 dot on the 触须之交 card,
 * which never opens anything
 */
export type LiveEvent = "inbox" | "declare" | "help";
type Listener = (event: LiveEvent) => void;

/**
 * What each process keeps in memory of what the admin changes, read again on every process at once
 * (reloadEverywhere): 公告 (notices.ts). Others add their kind here.
 */
export type ReloadKind = "notices";
type Reload = () => Promise<void>;

const g = globalThis as unknown as {
  inboxListeners?: Map<string, Set<Listener>>;
  liveSelf?: string;
  liveHeard?: boolean;
  liveListened?: boolean;
  liveReloads?: Map<ReloadKind, Reload>;
};
const listeners = (g.inboxListeners ??= new Map<string, Set<Listener>>());
const reloads = (g.liveReloads ??= new Map<ReloadKind, Reload>());
/** This process, so it does not deliver its own nudges twice */
const self = (g.liveSelf ??= randomUUID());
const CHANNEL = "live_nudge";
/** A NOTIFY carries at most 8000 bytes: the players go in parts this long */
const PER_NOTIFY = 150;
const across = () => process.env.LIVE_ACROSS === "1";

export function listen(userId: string, fn: Listener) {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size && listeners.get(userId) === set) listeners.delete(userId);
  };
}

function deliver(userIds: Iterable<string>, event: LiveEvent) {
  for (const id of userIds) {
    for (const fn of listeners.get(id) ?? []) fn(event);
  }
}

/** The nudge carries nothing but "look again", so it reveals no more than the inbox (or 求助) itself. */
export function nudge(userIds: Iterable<string>, event: LiveEvent = "inbox") {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  deliver(ids, event);
  if (across()) void tellOthers(ids, event);
}

async function tellOthers(ids: string[], event: LiveEvent) {
  for (let i = 0; i < ids.length; i += PER_NOTIFY) {
    const payload = JSON.stringify({ p: self, e: event, ids: ids.slice(i, i + PER_NOTIFY) });
    await pg.notify(CHANNEL, payload).catch((e) => console.error("live: telling the other processes failed", errorCode(e)));
  }
}

/**
 * Every process hears the others' nudges and passes them to the pages connected to it, and reads again what
 * they say changed (src/instrumentation-node.ts)
 */
export async function hearOthers() {
  if (!across() || g.liveHeard) return;
  g.liveHeard = true;
  await pg.listen(
    CHANNEL,
    (payload) => {
      try {
        const { p, e, ids, reload } = JSON.parse(payload) as { p?: string; e?: string; ids?: unknown[]; reload?: unknown };
        if (p === self) return;
        if (typeof reload === "string") return void reloadHere(reload as ReloadKind);
        if (!Array.isArray(ids)) return;
        deliver(ids.map(String), e === "help" || e === "declare" ? e : "inbox");
      } catch {
        // not ours to read
      }
    },
    () => {
      // listening again after the connection dropped: whatever was said meanwhile went unheard, so all of it is read again
      if (g.liveListened) for (const kind of reloads.keys()) reloadHere(kind);
      g.liveListened = true;
    },
  );
}

/** What to read again when told to, here and on the other processes */
export function onReload(kind: ReloadKind, fn: Reload) {
  reloads.set(kind, fn);
}

function reloadHere(kind: ReloadKind) {
  return reloads.get(kind)?.().catch((e) => console.error(`live: reading ${kind} again failed`, errorCode(e)));
}

/**
 * Read it again on this process, then tell the others to (LIVE_ACROSS=1). One that misses the word reads
 * it again by itself soon anyway (every 5 minutes, and when it listens again after the connection dropped).
 */
export async function reloadEverywhere(kind: ReloadKind) {
  await reloadHere(kind);
  if (!across()) return;
  await pg
    .notify(CHANNEL, JSON.stringify({ p: self, reload: kind }))
    .catch((e) => console.error("live: telling the other processes failed", errorCode(e)));
}
