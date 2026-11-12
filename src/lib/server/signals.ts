/**
 * Things that went wrong in this server process, kept in memory for a day, for the site's own
 * checks (watch.ts) to look back on: a kind, a short code and the time. Never an address, an
 * email or a message that might hold one.
 *
 * Kept on globalThis: Next.js builds the startup code (where the checks run) and the routes
 * (where most of these are noted) separately, and both must see the same list. No Node-only
 * imports, so the edge build of instrumentation.ts can note errors too.
 */

export type SignalKind =
  /** a request failed with an unexpected error; code: "<path> <error name or code>" */
  | "error"
  /** a sign-in code email could not be handed to the mail provider; code: the SMTP error */
  | "mailFailed"
  /** a sign-in code email went out */
  | "mailSent"
  /** a sign-in code request was refused by a limit; code: which limit */
  | "codeRefused"
  /** a sign-in with a password failed (src/lib/server/passwords.ts); code: none, paused, wrong or banned */
  | "passwordFail"
  /** a visitor's page could not load a map; code: "<map>:<what>:<detail>" */
  | "map"
  /** a background job failed; code: the job's name */
  | "job"
  /** a request was refused by a limit (429); code: which limit, as "area:full:sid" */
  | "busy";

export type Signal = { at: number; code: string };

const KEEP_MS = 24 * 60 * 60_000;
/** Per kind, so a flood of one kind (map reports anyone can send) cannot use up memory */
const MAX_PER_KIND = 5000;

const g = globalThis as unknown as { zhoupSignals?: Map<SignalKind, Signal[]>; zhoupStartedAt?: number };
const store = (g.zhoupSignals ??= new Map<SignalKind, Signal[]>());
g.zhoupStartedAt ??= Date.now();

/**
 * times: as many at once, for what another process noted (src/lib/server/watchSignals.ts), which may
 * come a little after newer ones of this process's: the list stays in time order.
 */
export function note(kind: SignalKind, code: string, now = Date.now(), times = 1) {
  const list = store.get(kind) ?? [];
  const added = Array.from({ length: Math.min(times, MAX_PER_KIND) }, () => ({ at: now, code: code.slice(0, 120) }));
  let i = list.length;
  while (i > 0 && list[i - 1].at > now) i--;
  list.splice(i, 0, ...added);
  const keep = list.filter((s) => now - s.at < KEEP_MS);
  store.set(kind, keep.length > MAX_PER_KIND ? keep.slice(-MAX_PER_KIND) : keep);
}

/** Signals of one kind from the last withinMs, oldest first. */
export function recent(kind: SignalKind, withinMs: number, now = Date.now()): Signal[] {
  return (store.get(kind) ?? []).filter((s) => now - s.at < withinMs && s.at <= now);
}

/** When this process started noting signals: a check looking back further than this sees only part of it. */
export function startedAt() {
  return g.zhoupStartedAt!;
}

/** For tests: forget everything, as a fresh process would. */
export function forgetSignals(now = Date.now()) {
  store.clear();
  g.zhoupStartedAt = now;
}

/**
 * The short code of an error, without its message (which may hold a query's values, such as an email),
 * then its cause's: a query error from drizzle has no code of its own, and the database's error inside
 * it says what went wrong (40P01 a deadlock, 23505 and the unique index a duplicate). A mail error adds
 * how it timed out (CONNECT_TIMEOUT: the mail server could not be reached).
 */
export function errorCode(e: unknown, depth = 0): string {
  if (!e || typeof e !== "object") return typeof e;
  const x = e as {
    code?: unknown;
    responseCode?: unknown;
    timeoutType?: unknown;
    constraint_name?: unknown;
    name?: unknown;
    constructor?: { name?: string };
    cause?: unknown;
  };
  // a class that leaves its name as Error is known by its own (DrizzleQueryError)
  const name = typeof x.name === "string" && x.name !== "Error" ? x.name : (x.constructor?.name ?? "Error");
  const parts = [name, x.code, x.responseCode, x.timeoutType, x.constraint_name].filter((p) => p !== undefined && p !== null && p !== "");
  const own = parts.map(String).join(" ");
  return x.cause && typeof x.cause === "object" && depth < 3 ? `${own} caused by ${errorCode(x.cause, depth + 1)}` : own;
}
