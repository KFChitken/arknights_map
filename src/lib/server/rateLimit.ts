/**
 * In-memory sliding-window limiter for one server process. Good enough for a
 * single VPS; anything that must hold across restarts is checked in the database.
 */
const hits = new Map<string, { windowMs: number; times: number[] }>();

export function allow(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(key)?.times ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, { windowMs, times: recent });
    return false;
  }
  recent.push(now);
  hits.set(key, { windowMs, times: recent });
  if (hits.size > 10_000) {
    // each key is pruned by its own window, so a short limit never clears a daily one
    for (const [k, v] of hits) if (v.times.every((t) => now - t >= v.windowMs)) hits.delete(k);
  }
  return true;
}
