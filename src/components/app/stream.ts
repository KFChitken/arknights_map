import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The page's event stream (/api/events, MapApp.tsx): whether it is down, and since when, for 一起卫戍's room and
 * 一起听's player to say so (StreamDown.tsx) once it has been down a few seconds; set by MapApp as the stream errs
 * and opens again (what it missed meanwhile is read again then, as before).
 */

/** Said once the stream has been down this long (a moment's drop, such as a deploy's, says nothing) */
export const STREAM_DOWN_SAID_MS = 3_000;

let since: number | null = null;
const fns = new Set<() => void>();
const set = (next: number | null) => {
  if (next === since) return;
  since = next;
  for (const fn of [...fns]) fn();
};
const on = (fn: () => void) => {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
};

/** The stream erred (it tries again by itself): down from now, unless it already was */
export const streamDropped = (now = Date.now()) => {
  if (since === null) set(now);
};
/** The stream is open again, or gone with the page's player: up */
export const streamUp = () => set(null);
/** Since when the stream is down (null: up), for the tests */
export const streamDownSince = () => since;

/** Whether a stream down since `at` (null: up) is to be said at `now` */
export const streamDownSaid = (at: number | null, now: number) => at !== null && now - at >= STREAM_DOWN_SAID_MS;

/** Whether the stream has been down STREAM_DOWN_SAID_MS or more (drawn again as it gets there) */
export function useStreamDown(): boolean {
  const at = useSyncExternalStore(on, () => since, () => null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (at === null) return;
    const left = at + STREAM_DOWN_SAID_MS - Date.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => tick((n) => n + 1), left);
    return () => window.clearTimeout(timer);
  }, [at]);
  return streamDownSaid(at, Date.now());
}
