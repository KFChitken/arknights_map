import "server-only";

/**
 * Tells players who have the page open that their inbox changed, through the
 * event stream at /api/events. One server process holds every connection, so
 * a map in memory is enough. It lives on globalThis because Next.js can load
 * this module once per route bundle.
 */

/** inbox: something new in 消息; help: only the 求助 dot on the 触须之交 card, which never opens anything */
export type LiveEvent = "inbox" | "help";
type Listener = (event: LiveEvent) => void;

const g = globalThis as unknown as { inboxListeners?: Map<string, Set<Listener>> };
const listeners = (g.inboxListeners ??= new Map<string, Set<Listener>>());

export function listen(userId: string, fn: Listener) {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size && listeners.get(userId) === set) listeners.delete(userId);
  };
}

/** The nudge carries nothing but "look again", so it reveals no more than the inbox (or 求助) itself. */
export function nudge(userIds: Iterable<string>, event: LiveEvent = "inbox") {
  for (const id of new Set(userIds)) {
    for (const fn of listeners.get(id) ?? []) fn(event);
  }
}
