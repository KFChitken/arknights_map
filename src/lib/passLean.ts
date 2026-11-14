"use client";

import { useSyncExternalStore } from "react";

/**
 * 「省流量：不加载立绘」 (我的资料), on this device: passes show only the blur of the character's picture (0.4 KB) and
 * their name, never the picture itself. Left alone, it follows the phone's own data saver (Save-Data); ticked or
 * unticked, it is what the player said.
 */
const KEY = "zhoup.passLean";
const CHANGED = "zhoup:passLean";
/** What the player said on this page, kept for it where the browser keeps nothing */
let said: boolean | null = null;

export function leanArt(): boolean {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "on" || kept === "off") return kept === "on";
  } catch {
    // storage blocked: what was said on this page, else the data saver
  }
  return said ?? Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
}

export function setLeanArt(on: boolean) {
  said = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked: for this page only
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(changed: () => void) {
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}

/** Whether passes on this device show the blur alone, kept up to date as it is switched */
export const useLeanArt = () => useSyncExternalStore(subscribe, leanArt, () => false);
