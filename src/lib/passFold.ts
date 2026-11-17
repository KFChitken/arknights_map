"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the pass on another player's roach card is folded away (src/components/app/passes/RoachPass.tsx): hung
 * whole over the card until whoever looks folds it, then the 立绘 peeking out of the card as it did before, until
 * they hang it out again. Kept on this device, for every card it opens after.
 */
const KEY = "zhoup.passFold";
const CHANGED = "zhoup:passFold";
/** What was said on this page, kept for it where the browser keeps nothing */
let said: boolean | null = null;

export function passFolded(): boolean {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "on" || kept === "off") return kept === "on";
  } catch {
    // storage blocked: what was said on this page
  }
  return said ?? false;
}

export function setPassFolded(on: boolean) {
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

/** Whether passes on roach cards are folded on this device, kept up to date as it is switched */
export const usePassFolded = () => useSyncExternalStore(subscribe, passFolded, () => false);
