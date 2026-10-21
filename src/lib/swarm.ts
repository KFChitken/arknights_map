import type { RoachStyle } from "./types";

/**
 * Swarm rendering: every roach is always drawn (no cluster bubbles). Icons shrink
 * as the map zooms out, and a dark heatmap underneath makes dense cities look
 * covered in roaches.
 */

/** [MapLibre zoom, icon edge in px] stops, interpolated linearly. */
export const ICON_STOPS: [number, number][] = [
  [1, 10],
  [4, 14],
  [8, 24],
  [12, 36],
];

export function iconPx(zoom: number) {
  const s = ICON_STOPS;
  if (zoom <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    const [z1, p1] = s[i];
    if (zoom <= z1) {
      const [z0, p0] = s[i - 1];
      return p0 + ((p1 - p0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return s[s.length - 1][1];
}

/** Heatmap fades out by this MapLibre zoom, where individual roaches take over. */
export const SWARM_FADE_ZOOM = 10;

/** Dark, slightly warm ramp: sparse areas stay clear, crowded ones go near-black. */
export const SWARM_GRADIENT: Record<number, string> = {
  0: "rgba(20,16,12,0)",
  0.2: "rgba(40,30,22,0.25)",
  0.5: "rgba(30,22,16,0.5)",
  0.8: "rgba(18,14,10,0.7)",
  1: "rgba(8,6,4,0.82)",
};

/** Number of phase groups; each group wanders on its own little loop. */
export const CRAWL_GROUPS = 6;

/**
 * Screen-space offset in px for a crawl group at time t (ms): a slow wander
 * plus a quick twitch, so the crowd looks like it is milling about.
 */
export function crawlOffset(group: number, t: number, scale = 1, agitation = 1): [number, number] {
  const p = (group / CRAWL_GROUPS) * Math.PI * 2;
  const speed = 1 + (agitation - 1) * 0.6;
  const slow = (t * speed) / 1400 + p;
  const fast = (t * speed) / 160 + p * 3;
  const dx = Math.cos(slow) * 2.2 + Math.sin(fast) * 0.5;
  const dy = Math.sin(slow * 1.3) * 1.6 + Math.cos(fast * 1.1) * 0.5;
  return [dx * scale * agitation, dy * scale * agitation];
}

/** Real roaches scurry: bigger and quicker moves than the cartoon ones. */
export const AGITATION: Record<RoachStyle, number> = { cartoon: 1, real: 2.8 };

/** Headings the realistic roach is pre-rendered at for maps without icon rotation. */
export const HEADINGS = Array.from({ length: 8 }, (_, i) => i * 45);

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
