import type { Basemap } from "./types";

const KEY = "zhoup.basemap";
const CN_TIMEZONES = ["Asia/Shanghai", "Asia/Urumqi", "Asia/Chongqing", "Asia/Harbin"];

export const amapConfigured = Boolean(process.env.NEXT_PUBLIC_AMAP_KEY);

/**
 * Visitors from mainland China (cn, told by the server from their address) always
 * get Amap, which has the map approval number. Everyone else keeps their own
 * choice, or gets Amap in a mainland China time zone and OSM elsewhere.
 */
export function guessBasemap(cn: boolean): Basemap {
  if (!amapConfigured) return "osm";
  if (cn) return "amap";
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
