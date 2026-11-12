import "server-only";
import { pg } from "./db";
import { errorCode, note, recent, startedAt, type SignalKind } from "./signals";

/**
 * The live site runs the app as three processes (docker-compose.prod.yml), and only the main one
 * (web) runs the site's own checks (watch.ts). The helpers (web2, web3) tell it, through Postgres
 * NOTIFY like live.ts, what they noted that the checks count (signals.ts): every ten seconds, how
 * many of each kind and code came in each minute. Each also says when it started, with its build,
 * so a helper crashing again and again is seen too. On with LIVE_ACROSS=1, as on the live site.
 */

const CHANNEL = "watch_signal";
/** What the checks count from every process; maps are reported to web anyway (Caddy sends /api/health/map there) */
const SHARED: SignalKind[] = ["error", "mailFailed", "mailSent", "codeRefused", "passwordFail", "busy"];
const EVERY_MS = 10_000;
/** A NOTIFY carries at most 8000 bytes */
const MAX_BYTES = 7000;

const across = () => process.env.LIVE_ACROSS === "1";

/** [kind, code, the minute it came in, how many] */
type Count = [SignalKind, string, number, number];
type Message = { p: string; start?: { build: string; at: number }; s?: Count[] };

async function tell(message: Message) {
  await pg.notify(CHANNEL, JSON.stringify(message)).catch((e) => console.error("watch: telling the main process failed", errorCode(e)));
}

/** What this process noted after since and up to now, counted per kind, code and minute */
export function countsSince(since: number, now: number): Count[] {
  const counts = new Map<string, Count>();
  for (const kind of SHARED) {
    for (const s of recent(kind, now - since + 1, now)) {
      if (s.at <= since) continue;
      const minute = s.at - (s.at % 60_000);
      const key = `${kind}\n${s.code}\n${minute}`;
      const c = counts.get(key);
      if (c) c[3]++;
      else counts.set(key, [kind, s.code, minute, 1]);
    }
  }
  return [...counts.values()];
}

/** Counts in messages that each fit in a NOTIFY */
export function batches(name: string, counts: Count[]): Message[] {
  const out: Message[] = [];
  let part: Count[] = [];
  for (const c of counts) {
    if (part.length && JSON.stringify({ p: name, s: [...part, c] }).length > MAX_BYTES) {
      out.push({ p: name, s: part });
      part = [];
    }
    part.push(c);
  }
  if (part.length) out.push({ p: name, s: part });
  return out;
}

/** A helper: say it started, then every ten seconds pass on what it noted */
export function shareSignals(name: string, build: string) {
  if (!across()) return;
  void tell({ p: name, start: { build, at: startedAt() } });
  let since = Date.now();
  setInterval(() => {
    const now = Date.now();
    const counts = countsSince(since, now);
    since = now;
    for (const message of batches(name, counts)) void tell(message);
  }, EVERY_MS).unref();
}

/** What a helper's message says, noted here as this process's own; its start passed to onStart */
export function heardMessage(payload: string, onStart: (start: { name: string; build: string; at: number }) => void) {
  try {
    const m = JSON.parse(payload) as Message;
    if (typeof m.p !== "string") return;
    if (m.start && typeof m.start.build === "string" && Number.isFinite(m.start.at)) onStart({ name: m.p, build: m.start.build, at: m.start.at });
    for (const c of Array.isArray(m.s) ? m.s : []) {
      const [kind, code, at, times] = c;
      if (SHARED.includes(kind) && typeof code === "string" && Number.isFinite(at) && Number.isInteger(times) && times > 0) note(kind, code, at, times);
    }
  } catch {
    // not ours to read
  }
}

/** The main process: hear the helpers (src/instrumentation-node.ts) */
export async function hearSignals(onStart: (start: { name: string; build: string; at: number }) => void) {
  if (!across()) return;
  await pg.listen(CHANNEL, (payload) => heardMessage(payload, onStart));
}
