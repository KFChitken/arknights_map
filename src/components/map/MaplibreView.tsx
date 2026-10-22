"use client";

import maplibregl, { type GeoJSONSource, type StyleImageInterface, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { roachImageData } from "@/lib/roachImages";
import type { RoachOpts } from "@/lib/roachSvg";
import {
  crawl,
  HEADINGS,
  ICON_STOPS,
  iconPx,
  LAYER_GROUPS,
  LEG_FRAMES,
  LEG_PHASES,
  legFrame,
  prefersReducedMotion,
  SWARM_FADE_ZOOM,
  SWARM_GRADIENT,
} from "@/lib/swarm";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
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
const ROACH_LAYERS = Array.from({ length: LAYER_GROUPS }, (_, g) => `roach-${g}`);
const CLICKABLE = [...ROACH_LAYERS, "mine"];

// The cartoon roach faces the viewer and only tilts; the real one is top-down and can face any way.
// Clones share one see-through look whatever their owner's color; 触须之交 get a pink ground and a heart.
function roachImage(look: RoachStyle) {
  if (look === "real") {
    // the walking icons come in LEG_PHASES out-of-step copies, picked per roach
    return [
      "concat",
      [
        "case",
        ["get", "friend"],
        ["case", ["get", "clone"], "friendclone-real", "friend-real"],
        ["case", ["get", "clone"], "clone-real", "real"],
      ],
      "-p",
      ["to-string", ["get", "lp"]],
    ];
  }
  const icon = (kind: string) => ["concat", kind, "-", ["get", "avatar"], "-", ["get", "color"]];
  return [
    "case",
    ["get", "friend"],
    ["case", ["get", "clone"], "friendclone", icon("friend")],
    ["case", ["get", "clone"], "clone", icon("roach")],
  ];
}
function roachRotate(look: RoachStyle) {
  return look === "real" ? ["get", "heading"] : ["get", "rot"];
}
function mineImage(look: RoachStyle) {
  return look === "real"
    ? ["case", [">", ["get", "slot"], 0], "mineclone-real", "mine-real"]
    : [
        "concat",
        ["case", [">", ["get", "slot"], 0], "mineclone-", "mine-"],
        ["get", "avatar"],
        "-",
        ["get", "color"],
      ];
}

/**
 * Icon ids: real-p<n> / clone-real-p<n> / ... for the walking realistic roach,
 * mine-real and mineclone-real for your own (which keep still), clone and
 * friendclone for other players' clones, and
 * <roach|friend|mine|mineclone>-<avatar>-<color> for everything else.
 */
const WALKING = /^(.*real)-p(\d+)$/;

function imageSpec(id: string): [RoachColor, RoachOpts] {
  const walking = WALKING.exec(id);
  if (walking) return imageSpec(walking[1]);
  if (id.endsWith("real")) {
    const kind = id.slice(0, -"real".length);
    const flags = { mine: kind.startsWith("mine"), friend: kind.startsWith("friend"), clone: kind.includes("clone") };
    return ["cyan", { look: "real", ...flags }];
  }
  if (id === "clone" || id === "friendclone") return ["white", { clone: true, friend: id === "friendclone" }];
  const [kind, avatar, color] = id.split("-") as [string, RoachAvatar, RoachColor];
  return [color, { avatar, mine: kind.startsWith("mine"), clone: kind === "mineclone", friend: kind === "friend" }];
}

/** The icons the current data needs, so only those get drawn. */
function neededImages(p: Pick<MapViewProps, "roaches" | "mine" | "myAvatar" | "myColor" | "look">) {
  const ids = new Set<string>();
  if (p.look === "real") {
    for (const id of ["real", "clone-real", "friend-real", "friendclone-real"]) {
      for (let n = 0; n < LEG_PHASES; n++) ids.add(`${id}-p${n}`);
    }
    ids.add("mine-real");
    ids.add("mineclone-real");
    return ids;
  }
  for (const r of p.roaches) {
    if (r.clone) ids.add(r.friend ? "friendclone" : "clone");
    else ids.add(`${r.friend ? "friend" : "roach"}-${r.avatar}-${r.color}`);
  }
  for (const r of p.mine) ids.add(`${r.slot > 0 ? "mineclone" : "mine"}-${p.myAvatar}-${p.myColor}`);
  return ids;
}

// Walk-cycle poses per realistic look, drawn once and shared by its out-of-step copies
const poses = new Map<string, Promise<ImageData[]>>();
function walkPoses(id: string) {
  let p = poses.get(id);
  if (!p) {
    const [color, opts] = imageSpec(id);
    p = Promise.all(
      Array.from({ length: LEG_FRAMES }, (_, i) => roachImageData(color, { ...opts, step: i / LEG_FRAMES }, ICON_PX)),
    );
    poses.set(id, p);
  }
  return p;
}

/** Legs pose changes at most this often; every change re-uploads the icon. */
const LEG_TICK_MS = 70;

/**
 * An icon whose legs move. MapLibre calls render() before each frame it draws
 * the icon in, and only re-uploads it when the pose has changed.
 */
function walkingIcon(frames: ImageData[], phase: number): StyleImageInterface {
  let shown = -1;
  let checked = 0;
  const icon = {
    width: frames[0].width,
    height: frames[0].height,
    data: new Uint8Array(frames[0].data.length),
    render() {
      const t = performance.now();
      if (t - checked < LEG_TICK_MS) return false;
      checked = t;
      const f = prefersReducedMotion() ? 0 : legFrame(phase, t);
      if (f === shown) return false;
      shown = f;
      icon.data.set(frames[f].data);
      return true;
    },
  };
  return icon;
}

async function ensureImages(map: maplibregl.Map, ids: Set<string>) {
  await Promise.all(
    [...ids]
      .filter((id) => !map.hasImage(id))
      .map(async (id) => {
        const walking = WALKING.exec(id);
        if (walking) {
          const frames = await walkPoses(walking[1]);
          if (!map.hasImage(id)) map.addImage(id, walkingIcon(frames, Number(walking[2])), { pixelRatio: 2 });
          return;
        }
        const d = await roachImageData(...imageSpec(id), ICON_PX);
        if (!map.hasImage(id)) map.addImage(id, d, { pixelRatio: 2 });
      }),
  );
}

function roachesGeoJSON(roaches: PublicRoach[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: roaches.map((r) => {
      const t = roachTraits(r.id, LAYER_GROUPS, HEADINGS.length);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        // a fixed slight tilt per roach so the crowd looks alive
        properties: {
          id: r.id,
          avatar: r.avatar,
          color: r.color,
          clone: r.clone,
          friend: r.friend,
          rot: t.rot,
          heading: t.heading,
          g: t.group,
          lp: t.seed % LEG_PHASES,
        },
      };
    }),
  };
}

function mineGeoJSON(mine: OwnRoach[], avatar: RoachAvatar, color: RoachColor): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: mine.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: { id: r.id, slot: r.slot, avatar, color },
    })),
  };
}

export default function MaplibreView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const syncRef = useRef<Promise<void>>(Promise.resolve());
  const propsRef = useRef(props);
  propsRef.current = props;

  // Draw any icons the latest data needs, then hand the data to the map; queued so updates land in order
  const sync = () => {
    syncRef.current = syncRef.current
      .then(async () => {
        const map = mapRef.current;
        if (!map || !readyRef.current) return;
        const p = propsRef.current;
        await ensureImages(map, neededImages(p));
        if (mapRef.current !== map) return;
        (map.getSource("roaches") as GeoJSONSource).setData(roachesGeoJSON(p.roaches));
        (map.getSource("mine") as GeoJSONSource).setData(mineGeoJSON(p.mine, p.myAvatar, p.myColor));
        for (const id of ROACH_LAYERS) {
          map.setLayoutProperty(id, "icon-image", roachImage(p.look) as never);
          map.setLayoutProperty(id, "icon-rotate", roachRotate(p.look) as never);
        }
        map.setLayoutProperty("mine", "icon-image", mineImage(p.look) as never);
      })
      .catch((e) => console.error(e));
  };

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

    // The map credits show at first, then fold into the (i) button after five seconds or as soon
    // as the map moves, which OpenStreetMap's attribution guidelines allow
    let foldTimer = 0;
    const foldCredits = () =>
      map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    const watchCredits = () => {
      if (!map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact")) return;
      map.off("sourcedata", watchCredits);
      foldTimer = window.setTimeout(foldCredits, 5000);
      map.once("movestart", foldCredits);
    };
    map.on("sourcedata", watchCredits);

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
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const t = performance.now();
      if (t - last < 66) return; // ~15fps is plenty for a twitchy crowd
      last = t;
      const scale = iconPx(map.getZoom()) / 24;
      const { look } = propsRef.current;
      ROACH_LAYERS.forEach((id, g) => {
        const c = crawl(g + 1, t, look, scale);
        map.setPaintProperty(id, "icon-translate", [c.dx, c.dy]);
      });
    };

    map.on("load", async () => {
      await ensureImages(map, neededImages(propsRef.current));
      const { roaches, mine, myAvatar, myColor, look } = propsRef.current;
      map.addSource("roaches", { type: "geojson", data: roachesGeoJSON(roaches) });
      map.addSource("mine", { type: "geojson", data: mineGeoJSON(mine, myAvatar, myColor) });

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
      if (!prefersReducedMotion()) animate();
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
      window.clearTimeout(foldTimer);
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(sync, [props.roaches, props.mine, props.myAvatar, props.myColor, props.look]);

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
