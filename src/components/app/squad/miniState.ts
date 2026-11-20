"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSquadRoom } from "./squading";

/**
 * The room of 一起卫戍 small (卫戍碎片时间玩法 ⑧; SquadMini.tsx draws it): in a window of its own over everything (电脑小窗:
 * the browser's Document Picture-in-Picture, opened by a tap, only where the browser has it), or as the whole page
 * while the page itself is small (窗口很小时: shorter than MINI_H or narrower than MINI_W, as a phone's own floating
 * window or a squeezed window on a computer is), only while one is in a room. A phone held upright is never small.
 */

/** The page is small (in a room): shorter than this, or narrower than MINI_W (px) */
export const MINI_H = 500;
export const MINI_W = 340;
/** The window over everything, as it first opens (px) */
export const PIP_W = 340;
export const PIP_H = 500;

/** Whether the page shows the room small: in a room, and the page shorter than MINI_H or narrower than MINI_W */
export const miniWanted = (w: number, h: number, inRoom: boolean) => inRoom && (h < MINI_H || w < MINI_W);

/** The page's size, as it changes */
function useViewport() {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const read = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return size;
}

/** The room small as the whole page now (miniWanted) */
export function useMiniPage() {
  const room = useSquadRoom();
  const size = useViewport();
  return Boolean(size) && miniWanted(size!.w, size!.h, Boolean(room));
}

// ---- the window over everything ----

type PipApi = { requestWindow: (o: { width: number; height: number }) => Promise<Window>; window: Window | null };
const api = () => (typeof window === "undefined" ? undefined : (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture);

/** Whether this browser can open the window over everything (Chrome and Edge on a computer, Firefox from 151; never Safari nor a phone) */
export const pipSupported = () => Boolean(api());

let pip: Window | null = null;
const fns = new Set<() => void>();
const setPip = (w: Window | null) => {
  if (pip === w) return;
  pip = w;
  for (const fn of [...fns]) fn();
};
const onPip = (fn: () => void) => {
  fns.add(fn);
  return () => {
    fns.delete(fn);
  };
};
/** The window over everything while it is open (its own document, the room drawn into it), else null */
export const useSquadPip = () => useSyncExternalStore(onPip, () => pip, () => null);

/** The page's styles, as they are and as more come, in the window's document too */
function copyStyles(from: Document, to: Document) {
  const base = to.createElement("base");
  base.href = from.baseURI;
  to.head.appendChild(base);
  const copy = (el: Element) => {
    if (el instanceof HTMLStyleElement || (el instanceof HTMLLinkElement && el.rel === "stylesheet")) to.head.appendChild(to.importNode(el, true));
  };
  for (const el of from.head.querySelectorAll("style, link[rel='stylesheet']")) copy(el);
  const seen = new MutationObserver((changes) => {
    for (const c of changes) for (const n of c.addedNodes) if (n instanceof Element) copy(n);
  });
  seen.observe(from.head, { childList: true });
  return () => seen.disconnect();
}

/**
 * 弹出小窗: the window over everything opened (from a tap: the browser asks for one), the page's styles in it; it is
 * forgotten as it closes (its ✕, the browser's way back to the page, or the page going)
 */
export async function openSquadPip() {
  const dpip = api();
  if (!dpip) return null;
  if (pip) return pip;
  const w = await dpip.requestWindow({ width: PIP_W, height: PIP_H });
  const stop = copyStyles(document, w.document);
  w.document.documentElement.lang = document.documentElement.lang;
  w.document.body.className = "sq-pipbody";
  w.addEventListener(
    "pagehide",
    () => {
      stop();
      setPip(null);
    },
    { once: true },
  );
  setPip(w);
  return w;
}

/** 收回小窗: the window over everything closed */
export function closeSquadPip() {
  pip?.close();
  setPip(null);
}
