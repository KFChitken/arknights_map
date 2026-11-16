import type { Map as MaplibreMap } from "maplibre-gl";
import type { RoachStyle } from "@/lib/types";
import type { RoachGl } from "./roachGl";

/**
 * The maps as 听歌's disco (src/components/disco, fetched apart) dances on them: each map offers what it has while it is
 * up, and the disco dances on the one on screen. Only what the disco needs from each, so the maps carry none of it.
 */

/** A page element that dances along, a few at most: your own roaches on the 高德 map (main: your main one), a guide (who nods) */
export type DiscoMark = { el: HTMLElement; kind: "main" | "mine" | "guide"; seed: number; size: number };

/** One roach as the OSM map's disco layer draws it: its icon (MaplibreView's ids, roachIcons.ts); kind 1 your clone, 2 your main roach */
export type DiscoRoach = { lng: number; lat: number; seed: number; icon: string; kind: 0 | 1 | 2 };

type Stage = {
  /** On screen (not hidden, nor under a panel that covers the map) and drawn */
  shown: () => boolean;
  look: () => RoachStyle;
  /** As 地图画风 draws the crowd: every roach, in piles (轻量: lights only), or none (全员隐匿: your own dance alone) */
  crowd: () => "all" | "lite" | "off";
  /** The page elements to dance; seq changes whenever they do */
  marks: () => { seq: number; list: DiscoMark[] };
};

export type AmapStage = Stage & {
  kind: "amap";
  /** The GPU layer drawing the roaches (null: 高德's MassMarks, which cannot dance) */
  gl: () => RoachGl | null;
  /** The cartoon look's icons with both sleeves up, one per style index (null: one with no sleeves, as it is) */
  hands: () => Promise<(string | null)[]>;
  /** A frame of the map asked for */
  redraw: () => void;
};

export type MaplibreStage = Stage & {
  kind: "maplibre";
  map: () => MaplibreMap | null;
  /** The roaches to dance, as drawn now (awake, the crowd's then your own); seq changes whenever they do */
  dancers: () => { seq: number; list: DiscoRoach[] };
  /** Where the disco's layers go: the dim before (under) the sleeping roaches, the dancers before the crawling ones */
  before: { dim: string; dance: string };
  /** The roaches' own layers see-through (still there for taps), and their crawl and hearts stopped; or all as they were */
  hold: (on: boolean) => void;
};

export type DiscoStage = AmapStage | MaplibreStage;

const stages = new Set<DiscoStage>();

/** A map up: offered until the call given back */
export function offerStage(s: DiscoStage) {
  stages.add(s);
  return () => {
    stages.delete(s);
  };
}

/** The map on screen, if any */
export function stageNow(): DiscoStage | null {
  for (const s of stages) if (s.shown()) return s;
  return null;
}

/** Whether a map is still up (offered, and not taken back) */
export const offered = (s: DiscoStage) => stages.has(s);
