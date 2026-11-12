import type { EarnedBadge } from "./badges";

/**
 * 获得新称号 pops up once on each device: the badges this browser has shown its player, each as
 * earned at its time (EarnedBadge.at), so that 石棺里的苏醒 given again pops up again. Kept in
 * localStorage, which every tab of the browser shares, or in this page's memory where there is no
 * storage. The server is told as well (seeBadges), but that can fail, a reload of me can come back
 * from before it was told, and another tab only hears of it at its next reload.
 */

type Earned = Pick<EarnedBadge, "id" | "at">;

/** At most this many kept for a player, the latest: far more than there are badges */
export const POPPED_KEEP = 300;

/** A badge as earned at its time, as kept */
export const poppedKey = (b: Earned) => `${b.id}@${b.at}`;

export const poppedStorageKey = (userId: string) => `zhoup.badgesPopped.${userId}`;

// what this page showed, for when storage fails (switched off, or full)
const memory = new Map<string, string[]>();

function stored(userId: string): string[] {
  try {
    const raw = localStorage.getItem(poppedStorageKey(userId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** The badges shown on this device (as poppedKey), read afresh: another tab may have just shown some */
export function poppedBadges(userId: string): Set<string> {
  return new Set([...stored(userId), ...(memory.get(userId) ?? [])]);
}

/**
 * These were just shown, or went straight to the wall: kept with those shown before, the latest POPPED_KEEP.
 * Not cut down to the badges this page knows the player holds: another tab, its list newer, may have just
 * shown one this page has not heard of yet. A badge given again is earned at another time, so it pops up
 * all the same.
 */
export function markBadgesPopped(userId: string, shown: Earned[]) {
  const list = [...new Set([...poppedBadges(userId), ...shown.map(poppedKey)])].slice(-POPPED_KEEP);
  memory.set(userId, list);
  try {
    localStorage.setItem(poppedStorageKey(userId), JSON.stringify(list));
  } catch {}
}

/**
 * Runs fn alone among this browser's tabs, for one player (the Web Locks API), so that two tabs coming
 * to the same badge at once do not both show it; where there are no locks (an older browser, a page
 * not on https), it just runs.
 */
export async function alonePopping<T>(userId: string, fn: () => T): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManager }).locks;
  if (!locks?.request) return fn();
  let ran = false;
  let out: T | undefined;
  try {
    await locks.request(poppedStorageKey(userId), () => {
      ran = true;
      out = fn();
    });
  } catch (e) {
    if (ran) throw e;
    return fn();
  }
  return out as T;
}
