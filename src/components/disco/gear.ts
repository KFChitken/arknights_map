/**
 * 听歌's disco, how much of it a phone draws: all of it; 省电版 (lite: fewer frames, no beams, spots or floor lights,
 * bobbing and swaying only); or the lights alone (nobody dances). It steps down by itself when too few frames are drawn
 * (only ever down, and only on this page: it is tried again from the top when the page is opened again), and nobody
 * dances where the map cannot draw them dancing, or where less motion is asked for.
 */

export type Gear = "full" | "lite" | "lights";

/** Fewer frames than this a second, SLOW_SECONDS running: a step down (all to 省电版, 省电版 to the lights alone) */
export const FULL_FPS = 24;
export const LITE_FPS = 16;
export const SLOW_SECONDS = 3;
/** Just started, or just back to the page, the frames are not counted for this long (as src/lib/lag.ts) */
export const BACK_MS = 2000;
/** A frame this long after the one before: the page stopped (a dialog, another tab), not a slow phone */
const GAP_MS = 1000;

/** Counts the frames drawn while the roaches dance, a second at a time */
export class GearWatch {
  gear: Gear = "full";
  private from = 0;
  private last = 0;
  private frames = 0;
  private slow = 0;
  private until = 0;

  /** Not counted until wait ms from t (ms): just started, back to the page, or a step down */
  rest(t: number, wait = 0) {
    this.from = 0;
    this.frames = 0;
    this.slow = 0;
    this.until = t + wait;
  }

  /** A frame drawn at t (ms) with the roaches dancing: true when it is time to step down (gear is then the new one) */
  frame(t: number): boolean {
    if (this.gear === "lights" || t < this.until) return false;
    if (!this.from || t - this.last > GAP_MS) {
      this.from = t;
      this.last = t;
      this.frames = 0;
      return false;
    }
    this.frames++;
    this.last = t;
    if (t - this.from < 1000) return false;
    const fps = (this.frames * 1000) / (t - this.from);
    this.from = t;
    this.frames = 0;
    this.slow = fps < (this.gear === "full" ? FULL_FPS : LITE_FPS) ? this.slow + 1 : 0;
    if (this.slow < SLOW_SECONDS) return false;
    this.gear = this.gear === "full" ? "lite" : "lights";
    this.rest(t);
    return true;
  }
}

/** The lights as drawn: all; 省电版's; the lights alone after a step down (and a slow wash of colour); less motion's */
export type Fx = "full" | "lite" | "calm" | "still";

export type Mode = {
  /** Whether the roaches dance: the crowd, your own and the guides */
  dance: boolean;
  fx: Fx;
};

/**
 * still: less motion asked for (prefersReducedMotion); gear: GearWatch's; dances: the map on screen can draw its roaches
 * dancing (the cartoon look, each roach drawn rather than piles of them, by the GPU)
 */
export function modeOf(still: boolean, gear: Gear, dances: boolean): Mode {
  if (still) return { dance: false, fx: "still" };
  if (gear === "lights") return { dance: false, fx: "calm" };
  return { dance: dances, fx: gear };
}

/** The frames a second the disco draws at most: 30, 20 in 省电版 */
export const fpsCap = (gear: Gear) => (gear === "full" ? 30 : 20);
