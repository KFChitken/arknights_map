/**
 * Whether this process has done what it does before answering (src/instrumentation-node.ts: the database brought
 * up to date or found so, the other processes listened to, the notices read): GET /api/ready says so. Kept on
 * globalThis, since Next.js builds the startup code and the routes separately and both must see the same.
 */
const g = globalThis as typeof globalThis & { __zhoupStarted?: boolean };

/** The startup code is done, with the database as it should be */
export function markStarted() {
  g.__zhoupStarted = true;
}

export const started = () => g.__zhoupStarted === true;

/** Tests only: as a process that has not started yet */
export function forgetStarted() {
  g.__zhoupStarted = false;
}

/**
 * Where a release puts a file before it stops this process (DRAIN_FILE, else /tmp/zhoup-draining) (`touch` inside the container): from then on GET
 * /api/ready answers 503, so the gateway, which asks it every few seconds, takes the process out while it still
 * answers everyone it has. In the container's own /tmp, which a new container does not have; the startup code
 * also removes it, so a process that was only restarted takes visitors again once it is ready.
 */
export const drainFile = () => process.env.DRAIN_FILE || "/tmp/zhoup-draining";

