import { useEffect, useState } from "react";

/**
 * A tap for the games that take one anywhere (Stopwatch.tsx, React325.tsx), timed by the press itself: a tap or click
 * anywhere on the screen but 不玩了 (which leaves without a round), and Space on a keyboard. onTap is given the press's
 * own time stamp, on performance.now()'s clock, so neither how often the screen is drawn nor a slow phone moves it.
 * Returns what stops listening.
 */
export function listenTaps(onTap: (at: number) => void): () => void {
  const onPointer = (e: PointerEvent) => {
    if (e.button > 0 || (e.target instanceof Element && e.target.closest("[data-quit]"))) return;
    e.preventDefault();
    onTap(onClock(e.timeStamp));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== " " && e.code !== "Space") return;
    e.preventDefault();
    if (!e.repeat) onTap(onClock(e.timeStamp));
  };
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("keydown", onKey, true);
  };
}

/**
 * An event's time on performance.now()'s clock, which event.timeStamp is in browsers today; one that is not, or
 * says nothing, is read as now
 */
export function onClock(stamp: number): number {
  const now = performance.now();
  return Number.isFinite(stamp) && stamp > 0 && stamp <= now + 50 && now - stamp < 5_000 ? stamp : now;
}

/** Whether there is a keyboard to press Space on, as far as the device tells: the hints say so */
export function useKeys(): boolean {
  const [keys, setKeys] = useState(false);
  useEffect(() => setKeys(window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false), []);
  return keys;
}
