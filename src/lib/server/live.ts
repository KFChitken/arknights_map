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
 * which never opens anything; listen: what a room of 一起听 does (tellListen), the one event that carries what
 * happened, as a room's phones act on it at once
 */
export type LiveEvent = "inbox" | "declare" | "help" | "listen";
/** data: the event's, as JSON (listen only) */
type Listener = (event: LiveEvent, data?: string) => void;

/**
 * What each process keeps in memory of what the admin changes, read again on every process at once
 * (reloadEverywhere): 公告 (notices.ts), who the moderators are (admins.ts), the places the owner drew (zones.ts),
 * the site's settings such as 全站变灰 (siteSettings.ts), the name blocklist (nameWords.ts), and 听歌's songs
 * (songs.ts). Others add their kind here.
 */
export type ReloadKind = "notices" | "admins" | "zones" | "settings" | "nameWords" | "songs";
type Reload = () => Promise<void>;

const g = globalThis as unknown as {
  inboxListeners?: Map<string, Set<Listener>>;
  liveSelf?: string;
  liveHeard?: boolean;
  liveListened?: boolean;
  liveReloads?: Map<ReloadKind, Reload>;
  liveDrops?: WeakMap<Listener, () => void>;
};
const listeners = (g.inboxListeners ??= new Map<string, Set<Listener>>());
/** How each stream is told to give way to a newer one of the same player (STREAMS_EACH) */
const drops = (g.liveDrops ??= new WeakMap<Listener, () => void>());
const reloads = (g.liveReloads ??= new Map<ReloadKind, Reload>());
/** This process, so it does not deliver its own nudges twice */
const self = (g.liveSelf ??= randomUUID());
const CHANNEL = "live_nudge";
/** A NOTIFY carries at most 8000 bytes: the players go in parts this long */
const PER_NOTIFY = 150;
/** And one that carries what happened (tellListen) at most this long, the players in as many parts as that takes */
const NOTIFY_BYTES = 7_500;
const across = () => process.env.LIVE_ACROSS === "1";

/**
 * Event streams one player may have open on one process (src/app/api/events). One more makes the oldest give
 * way rather than being turned away: a page whose connection dropped without a word can hold its stream for
 * many minutes before the server notices, and the page asking now is the one in use (2026-11-14: with no cap,
 * one signed-in script could open as many as it liked and tie up the process).
 */
export const STREAMS_EACH = 8;

/** Hear this player's nudges; drop, when given, is how the stream is told to give way (STREAMS_EACH) */
export function listen(userId: string, fn: Listener, drop?: () => void) {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  if (drop) drops.set(fn, drop);
  // a Set keeps the order they came in: the first is the oldest, the newest is last
  for (const old of set) {
    if (set.size <= STREAMS_EACH) break;
    set.delete(old);
    drops.get(old)?.();
  }
  return () => {
    set.delete(fn);
    if (!set.size && listeners.get(userId) === set) listeners.delete(userId);
  };
}

/** Signed-in players with a page open on this process (one connected to two processes is counted by both) */
export const connectedPlayers = () => listeners.size;

function deliver(userIds: Iterable<string>, event: LiveEvent, data?: string) {
  for (const id of userIds) {
    for (const fn of listeners.get(id) ?? []) fn(event, data);
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

/** What one of 一起听's rooms did (src/lib/server/listenRooms.ts), to the players in it: src/lib/listen.ts ListenTell */
export function tellListen(userIds: Iterable<string>, data: object) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const d = JSON.stringify(data);
  deliver(ids, "listen", d);
  if (across()) void tellOthersWhat(ids, d);
}

/** The players in as few NOTIFYs as fit what happened, each at most NOTIFY_BYTES */
async function tellOthersWhat(ids: string[], d: string) {
  const head = Buffer.byteLength(JSON.stringify({ p: self, e: "listen", ids: [], d: JSON.parse(d) }));
  const parts: string[][] = [[]];
  let size = head;
  for (const id of ids) {
    const more = Buffer.byteLength(JSON.stringify(id)) + 1;
    if (size + more > NOTIFY_BYTES && parts[parts.length - 1].length) {
      parts.push([]);
      size = head;
    }
    parts[parts.length - 1].push(id);
    size += more;
  }
  for (const part of parts) {
    const payload = `{"p":${JSON.stringify(self)},"e":"listen","ids":${JSON.stringify(part)},"d":${d}}`;
    await pg.notify(CHANNEL, payload).catch((e) => console.error("live: telling the other processes failed", errorCode(e)));
  }
}

const told = new Set<(data: unknown) => void>();
/** Hear what other processes tell rooms (tellListen), as their pages do: src/lib/server/listenRooms.ts forgets who is in one */
export function onToldListen(fn: (data: unknown) => void) {
  told.add(fn);
  return () => void told.delete(fn);
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
        const { p, e, ids, reload, d } = JSON.parse(payload) as { p?: string; e?: string; ids?: unknown[]; reload?: unknown; d?: unknown };
        if (p === self) return;
        if (typeof reload === "string") return void reloadHere(reload as ReloadKind);
        if (!Array.isArray(ids)) return;
        if (e === "listen") {
          if (!d || typeof d !== "object") return;
          for (const fn of told) fn(d);
          return void deliver(ids.map(String), "listen", JSON.stringify(d));
        }
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
