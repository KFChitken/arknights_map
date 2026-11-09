/** All coordinates are WGS-84; only the Amap view converts to GCJ-02 internally. */
export type LngLat = { lng: number; lat: number };

export type Roach = LngLat & {
  id: string;
  color: RoachColor;
};

/** zoom uses MapLibre levels (512px tiles); Amap levels are +1. */
export type MapView = LngLat & { zoom: number };

export type Basemap = "amap" | "osm";

/** cartoon: the chibi hood roach; real: a drawn top-down cockroach. */
export type RoachStyle = "cartoon" | "real";

/** Color of the hood side lights; every roach wears the same black hood. */
export const ROACH_COLORS = [
  "cyan",
  "pink",
  "gold",
  "green",
  "purple",
  "orange",
  "red",
  "white",
] as const;
export type RoachColor = (typeof ROACH_COLORS)[number];

/** Cartoon looks a player can pick; the realistic roach is the same for everyone. */
// new looks go at the end: the map lists its icons by position here
export const ROACH_AVATARS = ["hood", "doctor", "endmin", "imp", "gugu"] as const;
export type RoachAvatar = (typeof ROACH_AVATARS)[number];
/** The guides' own looks (src/lib/guides.ts): drawn like the others, never offered to players */
export const GUIDE_AVATARS = ["amiya", "perlica", "talulah", "minghe"] as const;
export type GuideAvatar = (typeof GUIDE_AVATARS)[number];
/** Every look the map can draw */
export type DrawnAvatar = RoachAvatar | GuideAvatar;

/** Ask the map to fly somewhere; only a new nonce triggers it. */
export type MapFocus = MapView & { nonce: number };
