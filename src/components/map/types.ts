import type { GuideId } from "@/lib/guides";
import type { FireLevel } from "@/lib/talulah";
import type { PaintingTier } from "@/lib/si";
import type { InkPoint } from "@/lib/siTiles";
import type { InkVariant } from "./inkArt";
import type { StyleSpecification } from "maplibre-gl";
import { hash128 } from "@/lib/prng";
import type { MapStyle } from "@/lib/mapStyle";
import type { LngLat, MapFocus, MapView, RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";

/** Shared interface implemented by both the Amap and the MapLibre view. */
export type MapViewProps = {
  /** Everyone else's roaches */
  roaches: PublicRoach[];
  /**
   * The one of them off stage while a touch scene plays it out over the map: left out where it is drawn, the
   * list itself unchanged so nothing has to be worked out again (none: null or left out)
   */
  hiddenId?: string | null;
  /** Your own roaches at their true positions */
  mine: OwnRoach[];
  /** Your main roach lies asleep (摄入酒精) */
  mineAsleep: boolean;
  /** Where a visitor is trying out placing a roach: drawn faded in your own look, sent nowhere */
  ghost?: LngLat | null;
  /** The guides this page shows (src/lib/guides.ts): 阿米娅向导 on every map, 佩丽卡监督 near your main roach */
  guides: GuideMark[];
  /** 明河都尉's trail of stars: his last stations, oldest first, his own last */
  trail: LngLat[];
  /** 祀掌柜's 缘缘庄 (src/components/map/siMap.ts): what the page has of it; left out, nothing of it is drawn */
  si?: SiMapData;
  /** Your own declarations, each over the roach it went out from, for a few seconds after the shout */
  shouts: ShoutMark[];
  /** Page elements placed on the map at a spot, over the roaches (⚡舟友的酒⚡'s dance floor); only those with onClick take a tap */
  overlays?: MapOverlay[];
  /** The 站长's lines on the map (MapLine): where a reported roach was to where it is now, the circle of a 禁放区 */
  lines?: MapLine[];
  myAvatar: RoachAvatar;
  myColor: RoachColor;
  look: RoachStyle;
  /** 地图画风 (src/lib/mapStyle.ts): the dark swarm only in 国度版, and nothing heavy built for the others */
  mapStyle: MapStyle;
  /** This map cannot draw 舟u本色's hearts (no GPU layer); it then draws 默认 */
  onHeartsUnavailable?: () => void;
  /** 高德 only: its GPU roach layer cannot run on this device (轻量 is then the style of a device that never picked one) */
  onNoGpuLayer?: () => void;
  /** The map starts or stops moving (a drag, a zoom, a fly): for telling whether it feels slow (src/lib/lag.ts) */
  onMoving?: (moving: boolean) => void;
  initialView: MapView;
  /** While placing, every tap is a spot on the map, even on top of a roach */
  placing: boolean;
  focus: MapFocus | null;
  onMapClick: (p: LngLat) => void;
  /** A roach of someone else, or a guide (by her id) */
  onRoachClick: (publicId: string) => void;
  onMineClick: (roachId: string) => void;
  onViewChange: (v: MapView, bounds: [LngLat, LngLat]) => void;
  onError?: (message: string) => void;
  /** The map could not load at all; without it, onError says so */
  onFailed?: () => void;
  /** Shown, or kept hidden behind the other map (mainland visitors abroad); hidden, its roaches stop crawling */
  active?: boolean;
  /** Jump here at once, without flying, as the other map hands over; only a new nonce triggers it */
  jump?: MapFocus | null;
  /** The map has drawn itself for the first time */
  onReady?: () => void;
  /** MapLibre only: a style of its own (our overseas map) instead of OpenFreeMap's */
  style?: StyleSpecification;
  /** MapLibre only: drawn over the map's own land and names, under the roaches (China, on our overseas map) */
  cover?: GeoJSON.FeatureCollection | null;
  /** MapLibre only: what to say when the map is slow to load */
  slowNote?: string;
  /** MapLibre only: a map under it that draws the land and takes the gestures (BaseMap); MapLibre then draws only what is ours */
  base?: BaseMap;
};

/**
 * A map drawn under MapLibre's (腾讯's, TencentView): it shows the land and takes the taps and gestures, and MapLibre
 * draws the roaches over it on a see-through map whose view follows it frame by frame. Views as MapLibre has them:
 * WGS-84 and MapLibre's zoom. Each on…() returns its undo.
 */
export type BaseMap = {
  /** Where it shows now */
  view(): MapView;
  /** f as the base map starts drawing a frame, or comes to rest: the time to follow its view */
  onFrame(f: () => void): () => void;
  /** A tap (not the end of a drag) at a point of the map, in pixels from its top left corner */
  onTap(f: (x: number, y: number) => void): () => void;
  /** The mouse moving over it, for the cursor */
  onPointer(f: (x: number, y: number) => void): () => void;
  /** It starts or stops moving: a drag, a zoom, a glide */
  onMoving(f: (moving: boolean) => void): () => void;
  /** Glide to a view (ms long), or go there at once */
  easeTo(v: MapView, ms?: number): void;
  jumpTo(v: MapView): void;
  setCursor(cursor: string): void;
};

/**
 * A guide on the map: where, whether she is your 触须之交, and what she is saying over
 * her head. fire: how big 塔露拉干员's fire burns; it then sits on that spot, with her beside it.
 * ride: 明河都尉 on his horse, facing ahead (degrees clockwise from north), away from his riders.
 * beside: 佩丽卡监督 keeping watch right beside your drunk main roach, which is at `at`.
 * arrive: 佩丽卡监督 riding her 鬼火 in from where she stood (null: unknown), once per nonce.
 * dance: 阿米娅向导 dancing, from the moment given (a new one starts her dance again).
 * acting: she is in a touch scene over the map (TouchStage), so her figure steps off it meanwhile.
 */
export type GuideMark = {
  id: GuideId;
  at: LngLat;
  friend: boolean;
  bubble: string | null;
  fire?: FireLevel;
  ride?: { ahead: number };
  beside?: boolean;
  arrive?: { from: LngLat | null; nonce: number };
  dance?: number;
  acting?: boolean;
};

/**
 * 缘缘庄 as the maps draw it: its numbers (null before they come: how many queue at the door, how many she
 * has drawn, whether it is full, how far out the homes of those who stayed reach, in metres), the ink
 * roaches of the tiles in view close up (none further out), your own drawn apart over them, and how far
 * today's painting on her scroll has got. Keys say when each changed, so the maps redraw only that.
 */
export type SiMapData = {
  inn: { queue: number; drawn: number; full: boolean; homesReach: number } | null;
  inks: InkPoint[];
  mine: SiMine | null;
  tier: PaintingTier;
  innKey: string;
  inksKey: number;
  mineKey: string;
};

/**
 * Your own ink roach, ringed in your colour (colour), where it is now: its look and which way it is drawn
 * (inkArt.ts), its brush (siInn.ts brushOf); brushFrom: she is drawing it in just now, since then (ms)
 */
export type SiMine = {
  at: LngLat;
  look: RoachAvatar;
  variant: InkVariant;
  color: RoachColor;
  size: number;
  tilt: number;
  ink: number;
  brushFrom: number | null;
};

/** A line just shouted over one of your own roaches (at), on your screen only; limited: a 限定 line */
export type ShoutMark = { id: string; at: LngLat; text: string; limited: boolean };

/** An element over the map at a spot; with onClick it takes the tap (outside placing), and the roach under it does not */
export type MapOverlay = { id: string; at: LngLat; el: HTMLElement; onClick?: () => void };

/**
 * A line the map draws through spots (lines.ts), only on the 站长's own map: red and dashed from where a reported roach
 * was to where it is now; blue round a 禁放区 being drawn (dashed till it is kept), gray round one lifted
 */
export type MapLine = { id: string; path: LngLat[]; color?: "red" | "blue" | "gray"; solid?: boolean };

/** Stable per-roach look (tilt, heading, crawl group) derived from its id, not its list position. */
export function roachTraits(id: string, groups: number, headings: number) {
  const [a, b, c] = hash128(id);
  const heading = b % 360;
  // nearest pre-rendered heading, for maps that cannot rotate icons
  const headingIndex = Math.round((heading * headings) / 360) % headings;
  // seed: drives the roach's own crawl rhythm and walk-cycle phase
  return { rot: (a % 17) - 8, heading, headingIndex, group: c % groups, seed: a };
}
