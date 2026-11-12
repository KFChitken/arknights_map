"use client";

import { useState, useSyncExternalStore } from "react";
import { isGray, onGrayChange, seedGray } from "@/lib/grayMode";

/**
 * Filters the whole page to gray. On the root element, a filter leaves everything fixed where it is (on any other
 * element it would not), and the map is filtered with the rest.
 */
const GRAY_CSS = "html{filter:grayscale(1)}";

/**
 * 全站变灰 (src/lib/grayMode.ts): the page in gray while it is on. Rendered on the server with the page, so the first
 * look is gray already; it goes by itself at the time set, and follows what the roach feed says after.
 */
export default function GrayMode({ until }: { until: number | null }) {
  // the page's word, kept before anything else on it renders (each page on the server renders its own)
  useState(() => {
    if (typeof window !== "undefined") seedGray(until);
  });
  return useGrayNow(until !== null) ? <style>{GRAY_CSS}</style> : null;
}

/** Whether the page is gray now, following the feed and the time; what the server rendered first, as it hydrates */
export function useGrayNow(rendered = false) {
  return useSyncExternalStore(onGrayChange, isGray, () => rendered);
}
