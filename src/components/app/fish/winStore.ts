"use client";

import { useSyncExternalStore } from "react";
import { T } from "@/i18n";
import type { FishSpot } from "@/lib/fish/items";

/**
 * 钓鳞's small window (FishWin.tsx), as the map page keeps it: opened once it is kept (the line's bite heard, its
 * 咕咚 too) and only hidden by ✕; open, or small (a strip on a computer, a ball on a phone), or hidden; and how its
 * line stands, for the menu's word by 钓鳞 (a line in the water, bitten) and the title bar (the day's casts).
 */

export type WinMode = "open" | "small" | "hidden";
export type WinState = {
  /** Opened once since the page loaded: kept, hidden or not */
  kept: boolean;
  mode: WinMode;
  /** The line in the water and where (null: none), whether it has bitten, and the day's casts (null: not known yet) */
  line: FishSpot | null;
  bite: boolean;
  casts: number | null;
};

const FIRST: WinState = { kept: false, mode: "hidden", line: null, bite: false, casts: null };
let now: WinState = FIRST;
const fns = new Set<() => void>();
const set = (next: Partial<WinState>) => {
  const merged = { ...now, ...next };
  if ((Object.keys(next) as (keyof WinState)[]).every((k) => Object.is(merged[k], now[k]))) return;
  now = merged;
  for (const fn of [...fns]) fn();
};
const on = (fn: () => void) => {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
};

// the page's own (the window is drawn in the browser alone): as it stands, there too
export const useFishWin = () => useSyncExternalStore(on, () => now, () => now);
export const fishWinNow = () => now;

/** 钓鳞 opened (the menu, or 卫戍's 「玩」): open where it was, on the line's scene, else the room's or the bank */
export const openFishWin = () => set({ kept: true, mode: "open" });
/** ✕: hidden, the line left as it is */
export const hideFishWin = () => set({ mode: "hidden" });
/** –: small (a strip, a ball), and back */
export const smallFishWin = () => set({ mode: "small" });
export const bigFishWin = () => set({ mode: "open" });
/** Gone for good (out of 卫戍 with no 钓鳞 of one's own), till opened again */
export const dropFishWin = () => set({ kept: false, mode: "hidden", line: null, bite: false });
/** How the line stands, as the window's page has it, and the day's casts */
export const setFishLine = (line: FishSpot | null, bite: boolean, casts: number | null) => set({ line, bite, casts });
/** Signed out: nothing kept */
export const forgetFishWin = () => set(FIRST);

/** The window's own tap (its strip's, its ball's: at the bite the pull, and the window open), for the room small's 收竿 */
let tap: (() => void) | null = null;
export const setFishTap = (fn: (() => void) | null) => {
  tap = fn;
};
export const tapFishNow = () => tap?.();

/** The word by 钓鳞 in the menu (FishNote) */
export type FishNote = {
  text: string;
  /** A dot on its float: the window hidden with a line in the water */
  dot: boolean;
  /** Bitten: the word orange, and the dot */
  bite: boolean;
};

/** The word by 钓鳞 in the menu: the window open (开着) or small (收起着); hidden, the line in the water or bitten, with a dot; null, nothing to say */
export function fishMenuNote(s: WinState): FishNote | null {
  const w = T.fish.win;
  if (!s.kept) return null;
  if (s.mode === "open") return { text: w.menuOpen, dot: false, bite: s.bite };
  if (s.mode === "small") return { text: w.menuSmall, dot: false, bite: s.bite };
  if (s.bite) return { text: w.menuBite, dot: true, bite: true };
  if (s.line) return { text: w.menuLine, dot: true, bite: false };
  return null;
}
