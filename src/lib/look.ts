import type { RoachStyle } from "./types";

const KEY = "zhoup.look";

export function loadLook(): RoachStyle {
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
