import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import type { AMapNS } from "@/lib/amap";
import { toGcj } from "@/lib/coords";
import type { MapLine } from "./types";

/**
 * The 站长's dashed red lines (types.ts MapLine) on either map: from where a reported roach was to where it is now.
 * Drawn by the map itself, so they keep to both spots while it moves and zooms; never in the way of a tap.
 */

const RED = "#b42318";

export function linesGeoJSON(lines: MapLine[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((l) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: [[l.from.lng, l.from.lat], [l.to.lng, l.to.lat]] },
      properties: {},
    })),
  };
}

/** MapLibre: the lines' source and layer, under whatever is added after them */
export function addMaplibreLines(map: MaplibreMap, lines: MapLine[]) {
  map.addSource("admin-lines", { type: "geojson", data: linesGeoJSON(lines) });
  map.addLayer({
    id: "admin-lines",
    type: "line",
    source: "admin-lines",
    paint: { "line-color": RED, "line-width": 2, "line-dasharray": [3, 2] },
  });
}

export function setMaplibreLines(map: MaplibreMap, lines: MapLine[]) {
  (map.getSource("admin-lines") as GeoJSONSource | undefined)?.setData(linesGeoJSON(lines));
}

/** Amap: one dashed polyline a line; returns them to remove later */
export function amapLines(AMap: AMapNS, lines: MapLine[]): AMapNS[] {
  return lines.map(
    (l) =>
      new AMap.Polyline({
        path: [toGcj(l.from), toGcj(l.to)],
        strokeColor: RED,
        strokeWeight: 2,
        strokeOpacity: 1,
        strokeStyle: "dashed",
        strokeDasharray: [6, 4],
        zIndex: 102,
        bubble: true,
        cursor: "default",
      }),
  );
}
