import type { Basemap } from "./types";

const KEY = "zhoup.basemap";
const CN_TIMEZONES = ["Asia/Shanghai", "Asia/Urumqi", "Asia/Chongqing", "Asia/Harbin"];

export const amapConfigured = Boolean(process.env.NEXT_PUBLIC_AMAP_KEY);

/**
 * Guess from the time zone for now: mainland China time zones get Amap,
 * everyone else gets OSM. Server-side IP detection will replace this.
 */
export function guessBasemap(): Basemap {
  if (!amapConfigured) return "osm";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "amap" || saved === "osm") return saved;
  } catch {}
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return CN_TIMEZONES.includes(tz) ? "amap" : "osm";
}

export function saveBasemap(b: Basemap) {
  try {
    localStorage.setItem(KEY, b);
  } catch {}
}
