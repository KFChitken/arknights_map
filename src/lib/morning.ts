import type { LngLat } from "./types";

/** A drunk roach wakes up at this hour, local time where it lies. */
export const WAKE_HOUR = 8;

const HOUR_MS = 3_600_000;

/**
 * Local time there, as a UTC offset in ms, guessed from the longitude: 15 degrees
 * to the hour. Close enough for most places; it does not follow summer time or
 * countries that keep one clock across several zones.
 */
const offsetFromLongitude = (at: LngLat) => Math.round(at.lng / 15) * HOUR_MS;

/** The first WAKE_HOUR o'clock after `now`, local time at `at`. */
export function nextMorning(at: LngLat, now = Date.now()) {
  const offset = offsetFromLongitude(at);
  const local = new Date(now + offset);
  const wake = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), WAKE_HOUR) - offset;
  return wake > now ? wake : wake + 24 * HOUR_MS;
}
