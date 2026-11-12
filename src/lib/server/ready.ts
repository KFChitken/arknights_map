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
