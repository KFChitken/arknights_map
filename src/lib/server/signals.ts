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
  /** a visitor's page could not load a map; code: "<map>:<what>:<detail>" */
  | "map"
  /** a background job failed; code: the job's name */
  | "job";

export type Signal = { at: number; code: string };

const KEEP_MS = 24 * 60 * 60_000;
/** Per kind, so a flood of one kind (map reports anyone can send) cannot use up memory */
const MAX_PER_KIND = 5000;

const g = globalThis as unknown as { zhoupSignals?: Map<SignalKind, Signal[]>; zhoupStartedAt?: number };
const store = (g.zhoupSignals ??= new Map<SignalKind, Signal[]>());
g.zhoupStartedAt ??= Date.now();

export function note(kind: SignalKind, code: string, now = Date.now()) {
  const list = store.get(kind) ?? [];
  list.push({ at: now, code: code.slice(0, 120) });
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

/** The short code of an error, without its message (which may hold a query's values, such as an email). */
export function errorCode(e: unknown): string {
  if (!e || typeof e !== "object") return typeof e;
  const x = e as { code?: unknown; responseCode?: unknown; name?: unknown; constructor?: { name?: string } };
  const parts = [x.name ?? x.constructor?.name ?? "Error", x.code, x.responseCode].filter((p) => p !== undefined && p !== "");
  return parts.map(String).join(" ");
}
