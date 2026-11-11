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
export type MapStyle = "nation" | "plain" | "hearts" | "lite" | "hidden";

export const MAP_STYLES: MapStyle[] = ["nation", "plain", "hearts", "lite", "hidden"];
/** 舟u本色's hearts are drawn (steps 2 and 3); until then it cannot be picked, and a pick of it shows 默认 */
export const HEARTS_READY = true;
export const DEFAULT_MAP_STYLE: MapStyle = "plain";

export const MAP_STYLE_NAMES: Record<MapStyle, string> = {
  nation: "国度版",
  plain: "默认",
  hearts: "舟u本色",
  lite: "轻量",
  hidden: "全员隐匿",
};
export const MAP_STYLE_NOTES: Record<MapStyle, string> = {
  nation: "远看黑压压一片小强国度（现在的样子）",
  plain: "只有小强，地图看得最清楚",
  hearts: "每只小强头上都在冒爱心",
  lite: "人多卡的时候用：挨得近的合成一大只，最顺、最省电",
  hidden: "地图上只有你自己的小强，别人一只都不画",
};
/** What the other styles say to a visitor who has not signed in, who sees 全员隐匿 only */
export const SIGN_IN_FOR_STYLES = "登录后能选";

const KEY = "zhoup.mapStyle";
/** The hint that the style can be changed has been shown on this device */
const SEEN = "zhoup.mapStyleSeen";

const isMapStyle = (s: unknown): s is MapStyle =>
  typeof s === "string" && (MAP_STYLES as string[]).includes(s);

export function loadMapStyle(): MapStyle {
  try {
    const s = localStorage.getItem(KEY);
    if (isMapStyle(s)) return s;
  } catch {}
  return DEFAULT_MAP_STYLE;
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
