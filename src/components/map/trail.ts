import type { GeoJSONSource, Map as MaplibreMap } from "maplibre-gl";
import type { AMapNS } from "@/lib/amap";
import { toGcj } from "@/lib/coords";
import type { LngLat } from "@/lib/types";

/**
 * 明河都尉's trail of stars on either map: his last stations joined by a line of silver
 * dots with a small star at each, fading the further back they are. A dark edge keeps
 * them clear on the light maps. Drawn under the roaches, and never in the way of a tap.
 */

const SILVER = "#e3ecff";
const EDGE = "#1f2b46";
/** How much each station further back fades */
const FADE = 0.11;

/** Opacity of a station or a stretch so many steps back from his own (0) */
export const trailOpacity = (age: number) => Math.max(0.25, 1 - age * FADE);

/** The trail as GeoJSON: each stretch between two stations, and each station, with how far back it is */
export function trailGeoJSON(trail: LngLat[]): GeoJSON.FeatureCollection {
  const last = trail.length - 1;
  const stretches = trail.slice(1).map((to, i) => ({
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates: [[trail[i].lng, trail[i].lat], [to.lng, to.lat]] },
    properties: { age: last - 1 - i },
  }));
  const stars = trail.map((at, i) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [at.lng, at.lat] },
    properties: { age: last - i },
  }));
  return { type: "FeatureCollection", features: [...stretches, ...stars] };
}

/** A five-pointed star, drawn once for MapLibre */
function starImage(px: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const c = px / 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? px * 0.2 : px * 0.44;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(c + r * Math.cos(a), c + r * Math.sin(a) + px * 0.03);
  }
  ctx.closePath();
  ctx.fillStyle = SILVER;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = px * 0.08;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  return ctx.getImageData(0, 0, px, px);
}

const fade = ["max", 0.25, ["-", 1, ["*", ["get", "age"], FADE]]];

/** MapLibre: add the trail's source and layers, under whatever is added after them */
export function addMaplibreTrail(map: MaplibreMap, trail: LngLat[]) {
  if (!map.hasImage("minghe-star")) map.addImage("minghe-star", starImage(40), { pixelRatio: 2 });
  map.addSource("minghe-trail", { type: "geojson", data: trailGeoJSON(trail) });
  const line = ["==", ["geometry-type"], "LineString"];
  // round dots: dashes of no length; the edge's are wider at the same spacing (6 × 2 = 4 × 3)
  map.addLayer({
    id: "minghe-trail-edge",
    type: "line",
    source: "minghe-trail",
    filter: line as never,
    layout: { "line-cap": "round" },
    paint: { "line-color": EDGE, "line-width": 6, "line-dasharray": [0, 2], "line-opacity": fade as never },
  });
  map.addLayer({
    id: "minghe-trail-dots",
    type: "line",
    source: "minghe-trail",
    filter: line as never,
    layout: { "line-cap": "round" },
    paint: { "line-color": SILVER, "line-width": 4, "line-dasharray": [0, 3], "line-opacity": fade as never },
  });
  map.addLayer({
    id: "minghe-trail-stars",
    type: "symbol",
    source: "minghe-trail",
    filter: ["==", ["geometry-type"], "Point"] as never,
    layout: {
      "icon-image": "minghe-star",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 8, 0.85, 14, 1] as never,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": fade as never },
  });
}

export function setMaplibreTrail(map: MaplibreMap, trail: LngLat[]) {
  (map.getSource("minghe-trail") as GeoJSONSource | undefined)?.setData(trailGeoJSON(trail));
}

/** Amap: the trail as dashed lines and small round dots (Amap has no stars), under the roaches; returns them to remove later */
export function amapTrail(AMap: AMapNS, trail: LngLat[]): AMapNS[] {
  const last = trail.length - 1;
  const path = trail.map((p) => toGcj(p));
  const overlays: AMapNS[] = [];
  for (let i = 1; i < path.length; i++) {
    const opacity = trailOpacity(last - i);
    // short dashes, the same on both so the dark one edges the silver (Amap draws no round dots)
    for (const [color, weight] of [
      [EDGE, 5.5],
      [SILVER, 3.5],
    ] as const) {
      overlays.push(
        new AMap.Polyline({
          path: [path[i - 1], path[i]],
          strokeColor: color,
          strokeWeight: weight,
          strokeOpacity: opacity,
          strokeStyle: "dashed",
          strokeDasharray: [8, 6],
          zIndex: 100,
          bubble: true,
          cursor: "default",
        }),
      );
    }
  }
  path.forEach((p, i) =>
    overlays.push(
      new AMap.CircleMarker({
        center: p,
        radius: 4.5,
        strokeColor: EDGE,
        strokeWeight: 1.5,
        strokeOpacity: trailOpacity(last - i),
        fillColor: SILVER,
        fillOpacity: trailOpacity(last - i),
        zIndex: 101,
        bubble: true,
        cursor: "default",
      }),
    ),
  );
  return overlays;
}
