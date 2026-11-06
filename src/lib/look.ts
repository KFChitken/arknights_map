import type { RoachStyle } from "./types";

const KEY = "zhoup.look";

/**
 * Whether players may switch the roaches to 写实. Off for now (11/2026): everyone
 * sees the cartoon roaches, whatever they picked before, which this browser still keeps.
 */
export const REAL_LOOK_OFFERED = false;

export function loadLook(): RoachStyle {
  if (!REAL_LOOK_OFFERED) return "cartoon";
  try {
    if (localStorage.getItem(KEY) === "real") return "real";
  } catch {}
  return "cartoon";
}

export function saveLook(look: RoachStyle) {
  try {
    localStorage.setItem(KEY, look);
  } catch {}
}
