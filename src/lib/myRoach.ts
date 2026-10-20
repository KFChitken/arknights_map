import type { MyRoach } from "./types";

// Prototype: your own roach lives in this browser only until accounts exist.
const KEY = "zhoup.myRoach";

export function loadMyRoach(): MyRoach | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MyRoach) : null;
  } catch {
    return null;
  }
}

export function saveMyRoach(r: MyRoach | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch {}
}
