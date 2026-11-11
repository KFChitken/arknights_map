/**
 * In-memory sliding-window limiter for one server process. Good enough for a
 * single VPS; anything that must hold across restarts is checked in the database.
 *
 * Keys whose window has passed are cleared out once a minute (prune), never while answering: the daily
 * keys (one for each address that asked for a sign-in code today, say) keep tens of thousands in here all
 * day, and walking them all on every call cost about a millisecond a call at 50,000 keys. A call only
 * drops its own key's old times. At most MAX_KEYS are kept: past that, the keys hit longest ago go first.
 */
const hits = new Map<string, { windowMs: number; times: number[] }>();

/** How often keys whose window has passed are cleared out */
export const PRUNE_MS = 60_000;
/** The most keys kept; past it, those hit longest ago are forgotten (and so start their count again) */
export const MAX_KEYS = 200_000;
/** How often prune says in the log how many keys there are */
const SAY_EVERY_MS = 60 * 60_000;
let saidAt = 0;

export function allow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
  // set anew, so the Map stays in the order keys were last hit, and a full one forgets the stalest
  hits.delete(key);
  if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  hits.set(key, { windowMs, times: recent });
  return allowed;
}

/**
 * Clear out the keys whose last hit is a whole window old, each by its own window, so a short limit never
 * clears a daily one. Times are kept in order, so the last one says.
 */
export function prune(now = Date.now()) {
  const started = performance.now();
  const before = hits.size;
  for (const [k, v] of hits) {
    const last = v.times[v.times.length - 1];
    if (last === undefined || now - last >= v.windowMs) hits.delete(k);
  }
  if (now - saidAt >= SAY_EVERY_MS && process.env.NODE_ENV !== "test") {
    saidAt = now;
    console.info(`rate limits: ${hits.size} keys kept, ${before - hits.size} cleared in ${Math.round(performance.now() - started)} ms`);
  }
}

/** How many keys are kept just now */
export const keptKeys = () => hits.size;

/** Tests: nothing counted */
export function forgetHits() {
  hits.clear();
}

// in the background, never keeping a process alive by itself
setInterval(() => prune(), PRUNE_MS).unref();
