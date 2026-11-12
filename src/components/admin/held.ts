"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a step waits before it is sent, while 撤销 can still take it back without asking the server */
export const HOLD_SECONDS = 5;

/**
 * A step held back: its line for the bar at the bottom (「已警告 · 撤销」), how to send it (keepalive as the page goes
 * away), and what to do if it is taken back, done, or refused.
 */
export type Hold = {
  text: string;
  send: (keepalive: boolean) => Promise<unknown>;
  onUndo?: () => void;
  onDone?: (result: unknown) => void;
  onFail?: (e: unknown) => void;
};

/** The step being held: its line, and the seconds left before it goes */
export type Held = { key: number; text: string; left: number };

/**
 * One step at a time held for HOLD_SECONDS, shared by the 管理台 and the map's 站长 tools: 撤销 drops it unsent; the
 * next step sends the one before at once; the page going away or out of sight sends it with keepalive, so it is
 * never lost. A ban never comes here: it is confirmed with a code and done at once.
 */
export function useHeld() {
  const current = useRef<{ hold: Hold; key: number; timer: number; tick: number } | null>(null);
  const [held, setHeld] = useState<Held | null>(null);

  const stop = useCallback(() => {
    const cur = current.current;
    if (!cur) return null;
    current.current = null;
    window.clearTimeout(cur.timer);
    window.clearInterval(cur.tick);
    setHeld(null);
    return cur.hold;
  }, []);

  /** Send what is held now: the next step came, or the page is going */
  const flush = useCallback(
    (keepalive = false) => {
      const hold = stop();
      if (!hold) return;
      hold.send(keepalive).then(
        (r) => hold.onDone?.(r),
        (e) => hold.onFail?.(e),
      );
    },
    [stop],
  );

  const hold = useCallback(
    (h: Hold) => {
      flush();
      const key = Date.now() + Math.random();
      const started = Date.now();
      const timer = window.setTimeout(() => flush(), HOLD_SECONDS * 1000);
      const tick = window.setInterval(() => {
        const left = Math.max(1, HOLD_SECONDS - Math.floor((Date.now() - started) / 1000));
        setHeld((x) => (x && x.key === key && x.left !== left ? { ...x, left } : x));
      }, 250);
      current.current = { hold: h, key, timer, tick };
      setHeld({ key, text: h.text, left: HOLD_SECONDS });
    },
    [flush],
  );

  const undo = useCallback(() => stop()?.onUndo?.(), [stop]);

  useEffect(() => {
    const away = () => flush(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    window.addEventListener("pagehide", away);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", away);
      document.removeEventListener("visibilitychange", hidden);
      // leaving the page within the app (another tab of the 管理台, the panel closed): sent, not dropped
      flush(true);
    };
  }, [flush]);

  return { held, hold, undo, flush };
}
