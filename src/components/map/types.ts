import { hash128 } from "@/lib/prng";
import type { LngLat, MapFocus, MapView, RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";

/** Shared interface implemented by both the Amap and the MapLibre view. */
export type MapViewProps = {
  /** Everyone else's roaches */
  roaches: PublicRoach[];
  /** Your own roaches at their true positions */
  mine: OwnRoach[];
  myAvatar: RoachAvatar;
  myColor: RoachColor;
  look: RoachStyle;
  initialView: MapView;
  /** While placing, every tap is a spot on the map, even on top of a roach */
  placing: boolean;
  focus: MapFocus | null;
  onMapClick: (p: LngLat) => void;
  onRoachClick: (publicId: string) => void;
  onMineClick: (roachId: string) => void;
  onViewChange: (v: MapView, bounds: [LngLat, LngLat]) => void;
  onError?: (message: string) => void;
};

/** Stable per-roach look (tilt, heading, crawl group) derived from its id, not its list position. */
export function roachTraits(id: string, groups: number, headings: number) {
  const [a, b, c] = hash128(id);
  const heading = b % 360;
  // nearest pre-rendered heading, for maps that cannot rotate icons
  const headingIndex = Math.round((heading * headings) / 360) % headings;
  return { rot: (a % 17) - 8, heading, headingIndex, group: c % groups };
}
