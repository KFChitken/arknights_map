"use client";

import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { roachDataUrl } from "@/lib/roachSvg";
import {
  AGITATION,
  CRAWL_GROUPS,
  crawlOffset,
  HEADINGS,
  ICON_STOPS,
  iconPx,
  prefersReducedMotion,
  SWARM_FADE_ZOOM,
  SWARM_GRADIENT,
} from "@/lib/swarm";
import { ROACH_COLORS, type RoachColor, type RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import { roachTraits, type MapViewProps } from "./types";

const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

// For offline debugging: append ?style=blank to draw a plain background only
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#dde5ea" } }],
};

const ICON_PX = 96; // bitmap edge; pixelRatio 2 → shown at 48px at icon-size 1
const ICON_BASE = ICON_PX / 2;
const ROACH_LAYERS = Array.from({ length: CRAWL_GROUPS }, (_, g) => `roach-${g}`);
const CLICKABLE = [...ROACH_LAYERS, "mine"];

// The cartoon roach faces the viewer and only tilts; the real one is top-down and can face any way.
// Clones share one see-through look whatever their owner's color; 触须之交 get a pink ground and a heart.
function roachImage(look: RoachStyle) {
  if (look === "real") {
    return [
      "case",
      ["get", "friend"],
      ["case", ["get", "clone"], "friendclone-real", "friend-real"],
      ["case", ["get", "clone"], "clone-real", "real"],
    ];
  }
  return [
    "case",
    ["get", "friend"],
    ["case", ["get", "clone"], "friendclone", ["concat", "friend-", ["get", "color"]]],
    ["case", ["get", "clone"], "clone", ["concat", "roach-", ["get", "color"]]],
  ];
}
function roachRotate(look: RoachStyle) {
  return look === "real" ? ["get", "heading"] : ["get", "rot"];
}
function mineImage(look: RoachStyle) {
  return look === "real"
    ? ["case", [">", ["get", "slot"], 0], "mineclone-real", "mine-real"]
    : ["concat", ["case", [">", ["get", "slot"], 0], "mineclone-", "mine-"], ["get", "color"]];
}

const IMAGES: [string, string][] = [
  ["real", roachDataUrl("cyan", { look: "real" })],
  ["clone-real", roachDataUrl("cyan", { look: "real", clone: true })],
  ["mine-real", roachDataUrl("cyan", { look: "real", mine: true })],
  ["mineclone-real", roachDataUrl("cyan", { look: "real", mine: true, clone: true })],
  ["friend-real", roachDataUrl("cyan", { look: "real", friend: true })],
  ["friendclone-real", roachDataUrl("cyan", { look: "real", friend: true, clone: true })],
  ["clone", roachDataUrl("white", { clone: true })],
  ["friendclone", roachDataUrl("white", { clone: true, friend: true })],
  ...ROACH_COLORS.flatMap((c): [string, string][] => [
    [`roach-${c}`, roachDataUrl(c)],
    [`friend-${c}`, roachDataUrl(c, { friend: true })],
    [`mine-${c}`, roachDataUrl(c, { mine: true })],
    [`mineclone-${c}`, roachDataUrl(c, { mine: true, clone: true })],
  ]),
];

async function svgToImageData(url: string, size: number) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

function roachesGeoJSON(roaches: PublicRoach[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: roaches.map((r) => {
      const t = roachTraits(r.id, CRAWL_GROUPS, HEADINGS.length);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        // a fixed slight tilt per roach so the crowd looks alive
        properties: {
          id: r.id,
          color: r.color,
          clone: r.clone,
          friend: r.friend,
          rot: t.rot,
          heading: t.heading,
          g: t.group,
        },
      };
    }),
  };
}

function mineGeoJSON(mine: OwnRoach[], color: RoachColor): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: mine.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: { id: r.id, slot: r.slot, color },
    })),
  };
}

export default function MaplibreView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const { initialView } = propsRef.current;
    const blank = new URLSearchParams(location.search).get("style") === "blank";
    const map = new maplibregl.Map({
      container: el.current!,
      style: blank ? BLANK_STYLE : process.env.NEXT_PUBLIC_OSM_STYLE || DEFAULT_STYLE,
      center: [initialView.lng, initialView.lat],
      zoom: initialView.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    const loadTimer = window.setTimeout(() => {
      if (!readyRef.current) propsRef.current.onError?.("海外底图加载很慢，可以试试切换到高德底图。");
    }, 12000);

    const reportView = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      propsRef.current.onViewChange(
        { lng: c.lng, lat: c.lat, zoom: map.getZoom() },
        [
          { lng: b.getWest(), lat: b.getSouth() },
          { lng: b.getEast(), lat: b.getNorth() },
        ],
      );
    };

    let frame = 0;
    let last = 0;
    const crawl = () => {
      frame = requestAnimationFrame(crawl);
      const t = performance.now();
      if (t - last < 66) return; // ~15fps is plenty for a twitchy crowd
      last = t;
      const scale = iconPx(map.getZoom()) / 24;
      const a = AGITATION[propsRef.current.look];
      ROACH_LAYERS.forEach((id, g) => map.setPaintProperty(id, "icon-translate", crawlOffset(g, t, scale, a)));
    };

    map.on("load", async () => {
      await Promise.all(
        IMAGES.map(([name, url]) =>
          svgToImageData(url, ICON_PX).then((d) => map.addImage(name, d, { pixelRatio: 2 })),
        ),
      );

      const { roaches, mine, myColor, look } = propsRef.current;
      map.addSource("roaches", { type: "geojson", data: roachesGeoJSON(roaches) });
      map.addSource("mine", { type: "geojson", data: mineGeoJSON(mine, myColor) });

      // Dark swarm under the icons so crowded cities read as covered in roaches
      const ramp = Object.entries(SWARM_GRADIENT)
        .map(([k, v]) => [Number(k), v] as const)
        .sort((a, b) => a[0] - b[0])
        .flat();
      map.addLayer({
        id: "swarm",
        type: "heatmap",
        source: "roaches",
        maxzoom: SWARM_FADE_ZOOM + 1,
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.2, SWARM_FADE_ZOOM, 2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 10, 4, 18, 8, 30, SWARM_FADE_ZOOM, 40],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], ...ramp] as never,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 1, SWARM_FADE_ZOOM, 0],
        },
      });
      // One layer per crawl group so each group can be nudged with a cheap paint update
      ROACH_LAYERS.forEach((id, g) =>
        map.addLayer({
          id,
          type: "symbol",
          source: "roaches",
          filter: ["==", ["get", "g"], g],
          layout: {
            "icon-image": roachImage(look) as never,
            "icon-size": [
              "interpolate",
              ["linear"],
              ["zoom"],
              ...ICON_STOPS.flatMap(([z, px]) => [z, px / ICON_BASE]),
            ] as never,
            "icon-rotate": roachRotate(look) as never,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // 触须之交 drawn on top of the crowd
            "symbol-sort-key": ["case", ["get", "friend"], 1, 0],
          },
        }),
      );
      map.addLayer({
        id: "mine",
        type: "symbol",
        source: "mine",
        layout: {
          "icon-image": mineImage(look) as never,
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      readyRef.current = true;
      window.clearTimeout(loadTimer);
      if (!prefersReducedMotion()) crawl();
      reportView();
    });

    map.on("click", (e) => {
      if (!readyRef.current) return;
      const p = propsRef.current;
      if (!p.placing) {
        const hit = map.queryRenderedFeatures(e.point, { layers: CLICKABLE })[0];
        if (hit?.layer.id === "mine") return p.onMineClick(hit.properties.id);
        if (hit) return p.onRoachClick(hit.properties.id);
      }
      p.onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    map.on("mouseenter", CLICKABLE, () => {
      if (!propsRef.current.placing) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", CLICKABLE, () => {
      map.getCanvas().style.cursor = propsRef.current.placing ? "crosshair" : "";
    });
    map.on("moveend", reportView);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(loadTimer);
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("roaches") as GeoJSONSource).setData(roachesGeoJSON(props.roaches));
  }, [props.roaches]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("mine") as GeoJSONSource).setData(mineGeoJSON(props.mine, props.myColor));
  }, [props.mine, props.myColor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    for (const id of ROACH_LAYERS) {
      map.setLayoutProperty(id, "icon-image", roachImage(props.look) as never);
      map.setLayoutProperty(id, "icon-rotate", roachRotate(props.look) as never);
    }
    map.setLayoutProperty("mine", "icon-image", mineImage(props.look) as never);
  }, [props.look]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.placing ? "crosshair" : "";
  }, [props.placing]);

  useEffect(() => {
    const f = props.focus;
    if (f && mapRef.current) mapRef.current.flyTo({ center: [f.lng, f.lat], zoom: f.zoom });
  }, [props.focus]);

  return <div ref={el} className="map" data-basemap="osm" />;
}
