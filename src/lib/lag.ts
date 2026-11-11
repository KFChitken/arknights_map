/**
 * Whether the map feels slow on this device (卡了提醒一次, src/lib/mapStyle.ts), measured by the page alone:
 * nothing of it is sent. Slow is a drag or a zoom drawing under SLOW_FPS frames a second for SLOW_SECONDS
 * seconds in all (not necessarily in a row), or the whole page stopping for over STALL_MS twice within
 * STALL_WINDOW_MS. Nothing counts while quiet() says the player is busy, nor just after the page comes back
 * into view.
 */

export const SLOW_FPS = 25;
export const SLOW_SECONDS = 3;
export const STALL_MS = 1000;
export const STALLS = 2;
export const STALL_WINDOW_MS = 5 * 60_000;
/** After the page comes back into view, this long is not counted */
const BACK_MS = 2000;
const TICK_MS = 250;

export type LagWatch = {
  /** The map starts or stops moving (a drag, a zoom, a fly) */
  moving: (on: boolean) => void;
  stop: () => void;
};

/** Watches until slow, then says so once and stops */
export function lagWatch(onLag: () => void, quiet: () => boolean): LagWatch {
  let moving = false;
  let raf = 0;
  let frames = 0;
  let since = 0;
  let slowSeconds = 0;
  let last = performance.now();
  let backAt = -Infinity;
  let stalls: number[] = [];
  let done = false;

  const lag = () => {
    if (done) return;
    stop();
    onLag();
  };
  // frames counted while the map moves, a second at a time
  const frame = (t: number) => {
    if (!moving || done) {
      raf = 0;
      return;
    }
    frames++;
    if (t - since >= 1000) {
      const fps = (frames * 1000) / (t - since);
      if (!quiet() && fps < SLOW_FPS && ++slowSeconds >= SLOW_SECONDS) return lag();
      frames = 0;
      since = t;
    }
    raf = requestAnimationFrame(frame);
  };
  // the page stopping: a tick that comes over a second late
  const tick = () => {
    const now = performance.now();
    const gap = now - last;
    last = now;
    if (document.visibilityState !== "visible" || now - backAt < BACK_MS || gap < STALL_MS || quiet()) return;
    stalls = stalls.filter((t) => now - t < STALL_WINDOW_MS);
    stalls.push(now);
    if (stalls.length >= STALLS) lag();
  };
  const timer = setInterval(tick, TICK_MS);
  const back = () => {
    backAt = performance.now();
    last = backAt;
  };
  document.addEventListener("visibilitychange", back);

  function stop() {
    done = true;
    clearInterval(timer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener("visibilitychange", back);
  }

  return {
    moving: (on) => {
      moving = on;
      if (on && !raf && !done) {
        frames = 0;
        since = performance.now();
        raf = requestAnimationFrame(frame);
      }
    },
    stop,
  };
}
