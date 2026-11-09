/**
 * Where this browser last saw the signed-in player's main roach, so the next visit opens the map
 * there at once instead of waiting for the server, which a slow line can hold up for many seconds.
 * Kept on this device only, and dropped on signing out. Every main roach's spot is public anyway.
 */
const KEY = "zhoup.home";

export type Home = { lng: number; lat: number };

export function loadHome(): Home | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Home> | null;
    return v && Number.isFinite(v.lng) && Number.isFinite(v.lat) ? { lng: Number(v.lng), lat: Number(v.lat) } : null;
  } catch {
    return null;
  }
}

/** null forgets it */
export function saveHome(at: Home | null) {
  try {
    if (at) localStorage.setItem(KEY, JSON.stringify({ lng: at.lng, lat: at.lat }));
    else localStorage.removeItem(KEY);
  } catch {}
}
