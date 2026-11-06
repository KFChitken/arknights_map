import { layers, namedFlavor } from "@protomaps/basemaps";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";

/**
 * Our own overseas map, for visitors from mainland China looking at somewhere
 * abroad (src/lib/chinaView.ts says when): OpenStreetMap data cut by Protomaps,
 * zoom levels 0–12 of one build, served from our own server (Caddy, /tiles), with
 * Chinese place names. Like the other overseas map it shows no national borders
 * and no country names. A new build goes in under a new file name, so the
 * browser's cached pieces of the old one are never mixed with it.
 */

export const OVERSEAS_TILES = "/tiles/world-20261105.pmtiles";

/** Borders of any kind, and country names */
const HIDDEN_LAYERS = new Set(["boundaries", "boundaries_country", "places_country"]);

export const OVERSEAS_CREDIT =
  '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

let reading = false;

/** The style, for a page at this origin: MapLibre wants whole addresses for fonts and icons */
export function overseasStyle(origin: string): StyleSpecification {
  // MapLibre reads the map file in pieces through this, once per page
  if (!reading) {
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    reading = true;
  }
  return {
    version: 8,
    glyphs: `${origin}/tiles/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/tiles/sprites/v4/light`,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${origin}${OVERSEAS_TILES}`, attribution: OVERSEAS_CREDIT },
    },
    layers: layers("protomaps", namedFlavor("light"), { lang: "zh-Hans" }).filter(
      (l) => !HIDDEN_LAYERS.has(l.id) && !("source-layer" in l && l["source-layer"] === "boundaries"),
    ),
  };
}
