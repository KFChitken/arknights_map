/**
 * 地图画风: how the map draws the roaches, which each device remembers on its own (never the
 * account or the server). nation 国度版: the roaches and the dark swarm under them, as the map
 * always was; plain 默认: only the roaches, the lightest to load, where everyone starts; hearts
 * 舟u本色: the roaches with hearts rising from them, and no swarm; lite 轻量: roaches close together on
 * screen drawn as one bigger roach with a count, standing still, the smoothest and the lightest on the
 * battery when a city is crowded; hidden 全员隐匿: nobody's roaches
 * but your own (the guides still there), the only style for visitors who have not signed in, whom the
 * server sends no list of roaches at all.
 */
import { T } from "@/i18n";
export type MapStyle = "nation" | "plain" | "hearts" | "lite" | "hidden";

export const MAP_STYLES: MapStyle[] = ["nation", "plain", "hearts", "lite", "hidden"];
/** 舟u本色's hearts are drawn (steps 2 and 3); until then it cannot be picked, and a pick of it shows 默认 */
export const HEARTS_READY = true;
export const DEFAULT_MAP_STYLE: MapStyle = "plain";

export const MAP_STYLE_NAMES: Record<MapStyle, string> = {
  get nation() {
    return T.lib.mapStyle.names.nation;
  },
  get plain() {
    return T.lib.mapStyle.names.plain;
  },
  get hearts() {
    return T.lib.mapStyle.names.hearts;
  },
  get lite() {
    return T.lib.mapStyle.names.lite;
  },
  get hidden() {
    return T.lib.mapStyle.names.hidden;
  },
};
export const MAP_STYLE_NOTES: Record<MapStyle, string> = {
  get nation() {
    return T.lib.mapStyle.notes.nation;
  },
  get plain() {
    return T.lib.mapStyle.notes.plain;
  },
  get hearts() {
    return T.lib.mapStyle.notes.hearts;
  },
  get lite() {
    return T.lib.mapStyle.notes.lite;
  },
  get hidden() {
    return T.lib.mapStyle.notes.hidden;
  },
};
/** What the other styles say to a visitor who has not signed in, who sees 全员隐匿 only */
export const signInForStyles = () => T.lib.mapStyle.signIn;

const KEY = "zhoup.mapStyle";
/** The hint that the style can be changed has been shown on this device */
const SEEN = "zhoup.mapStyleSeen";

const isMapStyle = (s: unknown): s is MapStyle =>
  typeof s === "string" && (MAP_STYLES as string[]).includes(s);

export function loadMapStyle(): MapStyle {
  return storedMapStyle() ?? DEFAULT_MAP_STYLE;
}

/** The style this device picked, or null if it never picked one */
export function storedMapStyle(): MapStyle | null {
  try {
    const s = localStorage.getItem(KEY);
    if (isMapStyle(s)) return s;
  } catch {}
  return null;
}

/** 卡了提醒一次: the hint to try 轻量 has been shown on this device (whatever the answer, or none) */
const LITE_HINT = "zhoup.liteHintSeen";

export function liteHintSeen(): boolean {
  try {
    return localStorage.getItem(LITE_HINT) === "1";
  } catch {
    // nowhere to remember it: never shown
    return true;
  }
}

export function markLiteHintSeen() {
  try {
    localStorage.setItem(LITE_HINT, "1");
  } catch {}
}

export function saveMapStyle(style: MapStyle) {
  try {
    localStorage.setItem(KEY, style);
  } catch {}
}

export function mapStyleSeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    // nowhere to remember it: never pester
    return true;
  }
}

export function markMapStyleSeen() {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {}
}
