import type { GuideId } from "@/lib/guides";
import type { FireLevel } from "@/lib/talulah";
import type { StyleSpecification } from "maplibre-gl";
import { hash128 } from "@/lib/prng";
import type { LngLat, MapFocus, MapView, RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";

/** Shared interface implemented by both the Amap and the MapLibre view. */
export type MapViewProps = {
  /** Everyone else's roaches */
  roaches: PublicRoach[];
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
  myAvatar: RoachAvatar;
  myColor: RoachColor;
  look: RoachStyle;
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
};

/**
 * A guide on the map: where, whether she is your 触须之交, and what she is saying over
 * her head. fire: how big 塔露拉干员's fire burns; it then sits on that spot, with her beside it.
 * ride: 明河都尉 on his horse, facing ahead (degrees clockwise from north), away from his riders.
 * beside: 佩丽卡监督 keeping watch right beside your drunk main roach, which is at `at`.
 * arrive: 佩丽卡监督 riding her 鬼火 in from where she stood (null: unknown), once per nonce.
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
};

/** Stable per-roach look (tilt, heading, crawl group) derived from its id, not its list position. */
export function roachTraits(id: string, groups: number, headings: number) {
  const [a, b, c] = hash128(id);
  const heading = b % 360;
  // nearest pre-rendered heading, for maps that cannot rotate icons
  const headingIndex = Math.round((heading * headings) / 360) % headings;
  // seed: drives the roach's own crawl rhythm and walk-cycle phase
  return { rot: (a % 17) - 8, heading, headingIndex, group: c % groups, seed: a };
}
