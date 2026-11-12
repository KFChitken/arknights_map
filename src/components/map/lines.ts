import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import type { AMapNS } from "@/lib/amap";
import { toGcj } from "@/lib/coords";
import type { MapLine } from "./types";

/**
 * The 站长's lines (types.ts MapLine) on either map: from where a reported roach was to where it is now, and round a
 * 禁放区. Drawn by the map itself, so they keep to their spots while it moves and zooms; never in the way of a tap.
 */

const COLORS: Record<NonNullable<MapLine["color"]>, string> = { red: "#b42318", blue: "#2253d1", gray: "#5f6774" };
const colorOf = (l: MapLine) => COLORS[l.color ?? "red"];

export function linesGeoJSON(lines: MapLine[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((l) => ({
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates: l.path.map((p) => [p.lng, p.lat]) },
      properties: { color: colorOf(l), solid: Boolean(l.solid) },
    })),
  };
}

/** MapLibre: the lines' source and its two layers, dashed and solid, under whatever is added after them */
export function addMaplibreLines(map: MaplibreMap, lines: MapLine[]) {
  map.addSource("admin-lines", { type: "geojson", data: linesGeoJSON(lines) });
  map.addLayer({
    id: "admin-lines",
    type: "line",
    source: "admin-lines",
    filter: ["!=", ["get", "solid"], true],
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-dasharray": [3, 2] },
  });
  map.addLayer({
    id: "admin-lines-solid",
    type: "line",
    source: "admin-lines",
    filter: ["==", ["get", "solid"], true],
    paint: { "line-color": ["get", "color"], "line-width": 3 },
  });
}

export function setMaplibreLines(map: MaplibreMap, lines: MapLine[]) {
  (map.getSource("admin-lines") as GeoJSONSource | undefined)?.setData(linesGeoJSON(lines));
}

/** Amap: one polyline a line; returns them to remove later */
export function amapLines(AMap: AMapNS, lines: MapLine[]): AMapNS[] {
  return lines.map(
    (l) =>
      new AMap.Polyline({
        path: l.path.map((p) => toGcj(p)),
        strokeColor: colorOf(l),
        strokeWeight: l.solid ? 3 : 2,
        strokeOpacity: 1,
        strokeStyle: l.solid ? "solid" : "dashed",
        strokeDasharray: [6, 4],
        zIndex: 102,
        bubble: true,
        cursor: "default",
      }),
  );
}
