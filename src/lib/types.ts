/** All coordinates are WGS-84; only the Amap view converts to GCJ-02 internally. */
export type LngLat = { lng: number; lat: number };

export type Roach = LngLat & {
  id: string;
  color: RoachColor;
};

export type MyRoach = LngLat & {
  color: RoachColor;
  placedAt: number;
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

/** Shared interface implemented by both the Amap and the MapLibre view. */
export type MapViewProps = {
  roaches: Roach[];
  myRoach: MyRoach | null;
  look: RoachStyle;
  initialView: MapView;
  placing: boolean;
  focus: MapFocus | null;
  onMapClick: (p: LngLat) => void;
  onRoachClick: (r: Roach) => void;
  onViewChange: (v: MapView, bounds: [LngLat, LngLat]) => void;
  onError?: (message: string) => void;
};

/** Ask the map to fly somewhere; only a new nonce triggers it. */
export type MapFocus = MapView & { nonce: number };
