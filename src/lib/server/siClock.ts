import "server-only";
import { isProd } from "./env";

/**
 * 祀掌柜's clock (src/lib/server/si.ts): now, moved on by 祀快进 in development only, and the other
 * switches development keeps beside it; one per process, kept across reloads of the modules.
 */

export const siGlobals = globalThis as typeof globalThis & { __siShift?: number; __siWrongNext?: boolean; __siToday?: number | null };

/** Milliseconds added by 祀快进; always 0 on the live site */
export const siShift = () => (isProd ? 0 : (siGlobals.__siShift ?? 0));
/** Her clock: now, moved on in development */
export const siNow = () => Date.now() + siShift();
export function fastForwardSi(ms: number) {
  if (!isProd) siGlobals.__siShift = siShift() + ms;
}
