import type { GuideId } from "@/lib/guides";
import type { FireLevel } from "@/lib/talulah";
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
};

/**
 * A guide on the map: where, whether she is your 触须之交, and what she is saying over
 * her head. fire: how big 塔露拉干员's fire burns; it then sits on that spot, with her beside it.
 */
export type GuideMark = { id: GuideId; at: LngLat; friend: boolean; bubble: string | null; fire?: FireLevel };

/** Stable per-roach look (tilt, heading, crawl group) derived from its id, not its list position. */
export function roachTraits(id: string, groups: number, headings: number) {
  const [a, b, c] = hash128(id);
  const heading = b % 360;
  // nearest pre-rendered heading, for maps that cannot rotate icons
  const headingIndex = Math.round((heading * headings) / 360) % headings;
  // seed: drives the roach's own crawl rhythm and walk-cycle phase
  return { rot: (a % 17) - 8, heading, headingIndex, group: c % groups, seed: a };
}
