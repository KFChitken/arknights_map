"use client";

import { useSyncExternalStore } from "react";

/**
 * 听歌's disco on this device: whether its switch (the ball by 在听) is on, kept in this browser; whether 「点我蹦迪」 has
 * been shown; and the disco itself (src/components/disco), a part of the page of its own, fetched when first wanted or,
 * once 听歌 opens, ahead of that while the page has nothing else to do (but not on a phone saving data).
 */
const KEY = "zhoup.disco";
const HINT_KEY = "zhoup.discoHint";
const CHANGED = "zhoup:disco";

/** What was said on this page, kept for it where the browser keeps nothing */
let chosenHere: boolean | null = null;
let hintHere = false;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage blocked: for this page only
  }
};
const told = () => window.dispatchEvent(new Event(CHANGED));

/**
 * Whether 听歌's disco is there for the player on this page: where 听歌 is (shown: the server opened it to them, the
 * page is in Chinese and the site is not gray) and the server opened its disco to them too (me().listen.disco: DISCO)
 */
export const discoOpenTo = (shown: boolean, listen: { disco?: true } | undefined): boolean => shown && listen?.disco === true;

export const discoChosen = (): boolean => chosenHere ?? read(KEY) === "1";

export function setDiscoChosen(on: boolean) {
  chosenHere = on;
  write(KEY, on ? "1" : "0");
  told();
}

export const discoHintSeen = (): boolean => hintHere || read(HINT_KEY) === "1";

/** 「点我蹦迪」 shown: never again on this device */
export function seeDiscoHint() {
  if (discoHintSeen()) return;
  hintHere = true;
  write(HINT_KEY, "1");
  told();
}

function subscribe(changed: () => void) {
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}

export const useDiscoChosen = () => useSyncExternalStore(subscribe, discoChosen, () => false);
export const useDiscoHintSeen = () => useSyncExternalStore(subscribe, discoHintSeen, () => true);

type Engine = typeof import("@/components/disco/engine");
let loading: Promise<Engine> | null = null;

/** The disco's own part of the page, fetched once (again after a failure) */
export function loadDisco(): Promise<Engine> {
  loading ??= import("@/components/disco/engine").catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Fetched ahead once the page has nothing else to do, so the ball comes down at once when tapped; not when saving data */
export function prefetchDisco() {
  if (loading || typeof window === "undefined") return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const go = () => void loadDisco().catch(() => {});
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(go, { timeout: 10_000 });
  else window.setTimeout(go, 2000);
}

/** For tests: as a page that has said and fetched nothing */
export function forgetDisco() {
  chosenHere = null;
  hintHere = false;
  loading = null;
}
