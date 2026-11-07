import type { Map as MaplibreMap } from "maplibre-gl";
import type { AMapNS } from "@/lib/amap";
import { toGcj } from "@/lib/coords";
import { drawSandwichPart, SANDWICH, SANDWICH_ON, SANDWICH_STOPS, sandwichPx, type SandwichKind } from "@/lib/sandwich";

/**
 * 两面包夹芝士 (src/lib/sandwich.ts) on either map: under the roaches and their dark swarm,
 * and never in the way of a tap.
 */

const KINDS: SandwichKind[] = ["bread", "cheese"];
/** Drawn at twice the biggest they are shown, for sharp screens */
const IMAGE_PX = 2 * SANDWICH_STOPS[SANDWICH_STOPS.length - 1][1];

/** MapLibre: the parts as icons that grow with the map, under whatever is added after them */
export function addMaplibreSandwich(map: MaplibreMap) {
  if (!SANDWICH_ON) return;
  for (const kind of KINDS) {
    if (map.hasImage(`sandwich-${kind}`)) continue;
    const ctx = drawSandwichPart(kind, IMAGE_PX).getContext("2d")!;
    map.addImage(`sandwich-${kind}`, ctx.getImageData(0, 0, IMAGE_PX, IMAGE_PX), { pixelRatio: 2 });
  }
  map.addSource("sandwich", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: SANDWICH.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.at.lng, p.at.lat] },
        properties: { kind: p.kind },
      })),
    },
  });
  // the cheese over the bread, where they meet zoomed far out
  for (const kind of KINDS) {
    map.addLayer({
      id: `sandwich-${kind}`,
      type: "symbol",
      source: "sandwich",
      filter: ["==", ["get", "kind"], kind] as never,
      layout: {
        "icon-image": `sandwich-${kind}`,
        // icon-size 1 is the image's own size, IMAGE_PX / 2
        "icon-size": ["interpolate", ["linear"], ["zoom"], ...SANDWICH_STOPS.flatMap(([z]) => [z, sandwichPx(z, kind) / (IMAGE_PX / 2)])] as never,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
  }
}

/**
 * Amap: the parts in one MassMarks under the roaches' (which sit at 120 and up), resized as
 * the map zooms; zoomOffset turns an Amap zoom into a MapLibre one. Returns it to take away later.
 */
export function amapSandwich(AMap: AMapNS, map: AMapNS, zoomOffset: number): AMapNS | null {
  if (!SANDWICH_ON) return null;
  const urls = KINDS.map((kind) => drawSandwichPart(kind, IMAGE_PX).toDataURL("image/png"));
  const styles = () =>
    KINDS.map((kind, i) => {
      const px = Math.round(sandwichPx(map.getZoom() - zoomOffset, kind));
      return { url: urls[i], size: new AMap.Size(px, px), anchor: new AMap.Pixel(px / 2, px / 2) };
    });
  const mass = new AMap.MassMarks(
    SANDWICH.map((p) => ({ lnglat: toGcj(p.at), style: KINDS.indexOf(p.kind) })),
    { zIndex: 110, zooms: [2, 20], cursor: "default", style: styles() },
  );
  mass.setMap(map);
  map.on("zoomchange", () => mass.setStyle(styles()));
  return mass;
}
