"use client";

import maplibregl, { type GeoJSONSource, type StyleImageInterface, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { GuideId } from "@/lib/guides";
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
import type { LngLat, RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import {
  belowGuide,
  besideMain,
  besideRight,
  BIKE_MS,
  freshRide,
  guideBox,
  guideElement,
  guideShift,
  rideIn,
  rideStart,
  updateGuide,
} from "./guideMarker";
import { reportMapTrouble } from "./report";
import { addMaplibreSandwich } from "./sandwich";
import { SHOUT_LIFT, shoutElement } from "./shoutMarker";
import { heartsLayer, type HeartDot, type HeartsLayer } from "./heartsGl";
import type { HeartMode } from "./roachGl";
import { addMaplibreTrail, setMaplibreTrail } from "./trail";
import { roachTraits, type MapViewProps } from "./types";
import { FeatureCache } from "./features";

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
/** Sleeping roaches lie still, so they get a layer the crawl never moves */
const ASLEEP_LAYER = "roach-asleep";
const CLICKABLE = [...ROACH_LAYERS, ASLEEP_LAYER, "mine"];

// The cartoon roach faces the viewer and only tilts; the real one is top-down and can face any way.
// Clones share one see-through look whatever their owner's color; 触须之交 get a pink ground and a heart.
/**
 * The overseas basemap shows no national borders or country names, since a map shown in
 * China must not draw them differently from the official ones. Layers are found by what
 * they draw, not by name, so a renamed layer in the style is still caught.
 */
function hideBorders(map: maplibregl.Map) {
  for (const layer of map.getStyle().layers ?? []) {
    const from = "source-layer" in layer ? layer["source-layer"] : undefined;
    const filter = JSON.stringify("filter" in layer ? layer.filter : null);
    const countryName = from === "place" && /"==",(\["get","class"\]|"class"),"country"/.test(filter);
    if (from === "boundary" || countryName) map.setLayoutProperty(layer.id, "visibility", "none");
  }
}

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
/** A sleeping main roach (never a clone): sleep-<roach|friend>-<avatar>-<color>, or sleep-real / sleep-friend-real */
function sleepImage(look: RoachStyle) {
  return look === "real"
    ? ["case", ["get", "friend"], "sleep-friend-real", "sleep-real"]
    : ["concat", ["case", ["get", "friend"], "sleep-friend-", "sleep-roach-"], ["get", "avatar"], "-", ["get", "color"]];
}
/** The cartoon one lies already tilted; the realistic one keeps facing its own way. */
function sleepRotate(look: RoachStyle) {
  return look === "real" ? ["get", "heading"] : 0;
}
function mineImage(look: RoachStyle) {
  const awake =
    look === "real"
      ? ["case", [">", ["get", "slot"], 0], "mineclone-real", "mine-real"]
      : ["concat", ["case", [">", ["get", "slot"], 0], "mineclone-", "mine-"], ["get", "avatar"], "-", ["get", "color"]];
  const asleep = look === "real" ? "sleep-mine-real" : ["concat", "sleep-mine-", ["get", "avatar"], "-", ["get", "color"]];
  return ["case", ["get", "asleep"], asleep, awake];
}

/**
 * Icon ids: real-p<n> / clone-real-p<n> / ... for the walking realistic roach,
 * mine-real and mineclone-real for your own (which keep still), clone and
 * friendclone for other players' clones, and
 * <roach|friend|mine|mineclone>-<avatar>-<color> for everything else.
 */
const WALKING = /^(.*real)-p(\d+)$/;

function imageSpec(id: string): [RoachColor, RoachOpts] {
  if (id.startsWith("sleep-")) {
    const [color, opts] = imageSpec(id.slice("sleep-".length));
    return [color, { ...opts, asleep: true }];
  }
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

/**
 * The icons the current data needs, so only those get drawn: those of your own roaches, and of the crowd
 * given (all of it, or only its roaches new since the map last had it, whose icons may be new).
 */
function neededImages(p: Pick<MapViewProps, "mine" | "mineAsleep" | "ghost" | "myAvatar" | "myColor" | "look">, crowd: readonly PublicRoach[]) {
  const ids = new Set<string>();
  if (p.look === "real") {
    for (const id of ["real", "clone-real", "friend-real", "friendclone-real"]) {
      for (let n = 0; n < LEG_PHASES; n++) ids.add(`${id}-p${n}`);
    }
    ids.add("mine-real");
    ids.add("mineclone-real");
    for (const id of ["sleep-real", "sleep-friend-real", "sleep-mine-real"]) ids.add(id);
    return ids;
  }
  for (const r of crowd) {
    if (r.clone) ids.add(r.friend ? "friendclone" : "clone");
    else ids.add(`${r.asleep ? "sleep-" : ""}${r.friend ? "friend" : "roach"}-${r.avatar}-${r.color}`);
  }
  for (const r of p.mine) {
    const sleeps = r.slot === 0 && p.mineAsleep;
    ids.add(`${sleeps ? "sleep-" : ""}${r.slot > 0 ? "mineclone" : "mine"}-${p.myAvatar}-${p.myColor}`);
  }
  if (p.ghost) ids.add(`mine-${p.myAvatar}-${p.myColor}`);
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

/** 舟u本色's hearts: rising, or still with motion turned down; none in the other styles */
const heartModeOf = (style: MapViewProps["mapStyle"]): HeartMode => (style === "hearts" ? (prefersReducedMotion() ? "still" : "float") : "off");

/** The roaches with hearts: everyone's awake ones, in their crawl group, and yours, awake, that keep still */
function heartDots(p: Pick<MapViewProps, "roaches" | "mine" | "mineAsleep" | "hiddenId">, features: FeatureCache): HeartDot[] {
  const dots: HeartDot[] = [];
  for (const r of p.roaches) {
    if (r.asleep || r.id === p.hiddenId) continue;
    const t = features.traits(r.id) ?? roachTraits(r.id, LAYER_GROUPS, HEADINGS.length);
    dots.push({ lng: r.lng, lat: r.lat, seed: t.seed, group: t.group, kind: r.friend ? 2 : r.clone ? 1 : 0 });
  }
  for (const r of p.mine) {
    if (p.mineAsleep && r.slot === 0) continue;
    dots.push({ lng: r.lng, lat: r.lat, seed: roachTraits(r.id, LAYER_GROUPS, HEADINGS.length).seed, group: -1, kind: 3 });
  }
  return dots;
}

/**
 * The roach off stage during a touch scene (props.hiddenId) is marked by its feature state and drawn see-through:
 * neither the data nor a filter changes, which would have the map cut all of its roaches into tiles again
 */
const OFF_STAGE = { "icon-opacity": ["case", ["boolean", ["feature-state", "off"], false], 0, 1] };

function mineGeoJSON(
  mine: OwnRoach[],
  asleep: boolean,
  ghost: LngLat | null | undefined,
  avatar: RoachAvatar,
  color: RoachColor,
): GeoJSON.FeatureCollection {
  const spots = [
    ...mine.map((r) => ({ id: r.id, slot: r.slot, at: r as LngLat, ghost: false })),
    ...(ghost ? [{ id: "ghost", slot: 0, at: ghost, ghost: true }] : []),
  ];
  return {
    type: "FeatureCollection",
    features: spots.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.at.lng, s.at.lat] },
      properties: { id: s.id, slot: s.slot, avatar, color, ghost: s.ghost, asleep: asleep && s.slot === 0 && !s.ghost },
    })),
  };
}

export default function MaplibreView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // each roach's feature, kept across updates of the list
  const featuresRef = useRef(new FeatureCache());
  // the look the whole crowd's icons are drawn in, so an update draws only the new roaches' icons
  const iconsLookRef = useRef<RoachStyle | null>(null);
  // the roach marked off stage on the map, by its feature state
  const offStageRef = useRef<string | null>(null);
  /** Mark the roach off stage (none: null), and the one before back on stage */
  const markOffStage = (map: maplibregl.Map, id: string | null) => {
    const was = offStageRef.current;
    if (was === id) return;
    if (was) map.setFeatureState({ source: "roaches", id: was }, { off: false });
    if (id) map.setFeatureState({ source: "roaches", id }, { off: true });
    offStageRef.current = id;
  };
  const syncRef = useRef<Promise<void>>(Promise.resolve());
  const guidesRef = useRef(new Map<GuideId, { el: HTMLElement; marker: maplibregl.Marker }>());
  const shoutsRef = useRef(new Map<string, maplibregl.Marker>());
  const overlaysRef = useRef(new Map<string, maplibregl.Marker>());
  // the roaches' crawl, which a hidden map stops
  const crawlRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  // 舟u本色: the hearts' layer, made the first time they are wanted, and the crawl groups' last offsets it follows
  const heartsRef = useRef<HeartsLayer | null>(null);
  const offsetsRef = useRef<[number, number][] | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // The guides: page elements over the map, so taps on them never reach the roaches below.
  // Added, moved and taken away as the page says; each kept beside your main roach, never on it.
  const syncGuides = () => {
    const map = mapRef.current;
    if (!map) return;
    const p = propsRef.current;
    const shown = guidesRef.current;
    const want = new Set(p.guides.map((g) => g.id));
    for (const [id, g] of shown) {
      if (want.has(id)) continue;
      g.marker.remove();
      shown.delete(id);
    }
    const zoom = map.getZoom();
    const main = p.mine.find((r) => r.slot === 0);
    const mainAt = main ? map.project([main.lng, main.lat]) : null;
    for (const mark of p.guides) {
      let g = shown.get(mark.id);
      if (!g) {
        const el = guideElement(mark.id);
        el.addEventListener("click", (e) => {
          // while placing, the tap is a spot on the map like any other
          if (propsRef.current.placing) return;
          e.stopPropagation();
          propsRef.current.onRoachClick(mark.id);
        });
        g = { el, marker: new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([mark.at.lng, mark.at.lat]).addTo(map) };
        shown.set(mark.id, g);
      } else g.marker.setLngLat([mark.at.lng, mark.at.lat]);
      updateGuide(g.el, zoom, mark);
      const box = guideBox(mark, zoom);
      const [sx, sy] = guideShift(mark, box);
      // she stays by her fire, 佩丽卡监督 sits right beside your drunk main roach; the others step aside from it
      const at = map.project([mark.at.lng, mark.at.lat]);
      const [dx, dy] = mark.fire
        ? [0, 0]
        : mark.beside
          ? besideRight(box)
          : besideMain({ x: at.x + sx, y: at.y + sy }, mainAt, box, belowGuide(zoom));
      g.marker.setOffset([sx + dx, sy + dy]);
      if (freshRide(mark, g.el)) {
        const from = mark.arrive!.from ? map.project([mark.arrive!.from.lng, mark.arrive!.from.lat]) : null;
        const c = map.getContainer();
        rideIn(g.el, rideStart({ x: at.x + sx + dx, y: at.y + sy + dy }, from, c.clientWidth, c.clientHeight), BIKE_MS);
      }
    }
  };

  // Your shouts: a bubble over each roach a declaration just went out from, taken away as the page says
  const syncShouts = () => {
    const map = mapRef.current;
    if (!map) return;
    const shown = shoutsRef.current;
    const want = new Set(propsRef.current.shouts.map((s) => s.id));
    for (const [id, marker] of shown) {
      if (want.has(id)) continue;
      marker.remove();
      shown.delete(id);
    }
    for (const s of propsRef.current.shouts) {
      if (shown.has(s.id)) continue;
      const marker = new maplibregl.Marker({ element: shoutElement(s.text, s.limited), anchor: "bottom", offset: [0, -SHOUT_LIFT] });
      shown.set(s.id, marker.setLngLat([s.at.lng, s.at.lat]).addTo(map));
    }
  };

  // Elements the page places on the map (⚡舟友的酒⚡'s dance floor), moved with it
  const syncOverlays = () => {
    const map = mapRef.current;
    if (!map) return;
    const shown = overlaysRef.current;
    const want = new Set((propsRef.current.overlays ?? []).map((o) => o.id));
    for (const [id, marker] of shown) {
      if (want.has(id)) continue;
      marker.remove();
      shown.delete(id);
    }
    for (const o of propsRef.current.overlays ?? []) {
      if (shown.has(o.id)) continue;
      o.el.style.pointerEvents = "none";
      shown.set(o.id, new maplibregl.Marker({ element: o.el, anchor: "center" }).setLngLat([o.at.lng, o.at.lat]).addTo(map));
    }
  };

  // Draw any icons the latest data needs, then hand the data to the map; queued so updates land in order
  /** The whole crowd and the look ("all"), or only your own roaches ("mine"), drawn from the latest props */
  const sync = (what: "all" | "mine") => {
    syncRef.current = syncRef.current
      .then(async () => {
        const map = mapRef.current;
        if (!map || !readyRef.current) return;
        const p = propsRef.current;
        // what changed in the crowd since the map last had it, and whether every roach's icons are needed
        // again (a new look), or only those of roaches new or changed
        const update = what === "all" ? featuresRef.current.update(p.roaches) : null;
        const allIcons = what === "all" && p.look !== iconsLookRef.current;
        try {
          await ensureImages(map, neededImages(p, allIcons ? p.roaches : (update?.fresh ?? [])));
          if (allIcons) iconsLookRef.current = p.look;
          if (mapRef.current !== map) return;
          (map.getSource("mine") as GeoJSONSource).setData(mineGeoJSON(p.mine, p.mineAsleep, p.ghost, p.myAvatar, p.myColor));
          if (heartModeOf(p.mapStyle) !== "off") heartsRef.current?.setDots(heartDots(p, featuresRef.current));
          if (!update) return;
          const roaches = map.getSource("roaches") as GeoJSONSource;
          if (update.all) roaches.setData(update.all);
          else if (update.diff.add.length || update.diff.remove.length) roaches.updateData(update.diff);
        } catch (e) {
          // the map did not get these changes: the next update hands it everything
          if (update) featuresRef.current.reset();
          throw e;
        }
        for (const id of ROACH_LAYERS) {
          map.setLayoutProperty(id, "icon-image", roachImage(p.look) as never);
          map.setLayoutProperty(id, "icon-rotate", roachRotate(p.look) as never);
        }
        map.setLayoutProperty(ASLEEP_LAYER, "icon-image", sleepImage(p.look) as never);
        map.setLayoutProperty(ASLEEP_LAYER, "icon-rotate", sleepRotate(p.look) as never);
        map.setLayoutProperty("mine", "icon-image", mineImage(p.look) as never);
      })
      .catch((e) => console.error(e));
  };
  const syncAll = () => sync("all");
  const syncMine = () => sync("mine");

  /** 舟u本色: the hearts' layer made (on top of everything) the first time they are wanted, then on or off */
  const showHearts = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const p = propsRef.current;
    const mode = heartModeOf(p.mapStyle);
    if (mode !== "off" && !heartsRef.current) {
      heartsRef.current = heartsLayer({
        offsets: () => offsetsRef.current,
        onFail: (why) => {
          console.warn("hearts:", why);
          propsRef.current.onHeartsUnavailable?.();
        },
      });
      map.addLayer(heartsRef.current);
    }
    if (mode !== "off") heartsRef.current?.setDots(heartDots(p, featuresRef.current));
    heartsRef.current?.setMode(mode);
  };

  useEffect(() => {
    const { initialView } = propsRef.current;
    const shoutMarkers = shoutsRef.current;
    const overlayMarkers = overlaysRef.current;
    const guideMarkers = guidesRef.current;
    const blank = new URLSearchParams(location.search).get("style") === "blank";
    const map = new maplibregl.Map({
      container: el.current!,
      style: blank ? BLANK_STYLE : (propsRef.current.style ?? (process.env.NEXT_PUBLIC_OSM_STYLE || DEFAULT_STYLE)),
      center: [initialView.lng, initialView.lat],
      zoom: initialView.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("style.load", () => hideBorders(map));
    mapRef.current = map;

    syncGuides();
    map.on("zoom", syncGuides);
    syncShouts();
    syncOverlays();

    // our own overseas map (a style of its own) or OpenStreetMap's, for reports of trouble
    const kind = propsRef.current.style ? "overseas" : "osm";
    const loadTimer = window.setTimeout(() => {
      if (readyRef.current) return;
      reportMapTrouble(kind, "slow");
      propsRef.current.onError?.(propsRef.current.slowNote ?? "海外底图加载很慢，可以试试切换到高德底图。");
    }, 12000);
    // a style that never loads, or tiles failing again and again, is told to the server once
    let tileErrors = 0;
    map.on("error", (e: { error?: { status?: number; message?: string }; sourceId?: string }) => {
      console.error(e.error ?? e);
      // the roaches' data may not have taken the last changes: the next update hands it all of them
      if (e.sourceId === "roaches") featuresRef.current.reset();
      const status = e.error?.status ? String(e.error.status) : "";
      if (!e.sourceId) {
        if (!readyRef.current) reportMapTrouble(kind, "style", status);
      } else if (++tileErrors === 5) reportMapTrouble(kind, "tiles", [e.sourceId, status].filter(Boolean).join("-"));
    });

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
      const offsets: [number, number][] = [];
      ROACH_LAYERS.forEach((id, g) => {
        const c = crawl(g + 1, t, look, scale);
        map.setPaintProperty(id, "icon-translate", [c.dx, c.dy]);
        offsets.push([c.dx, c.dy]);
      });
      offsetsRef.current = offsets;
    };

    map.on("load", async () => {
      // a cover over the land and names, under the roaches added next
      const { cover } = propsRef.current;
      if (cover) {
        map.addSource("cover", { type: "geojson", data: cover });
        map.addLayer({ id: "cover", type: "fill", source: "cover", paint: { "fill-color": "#ede9e1" } });
      }
      // 两面包夹芝士 around Japan, and 明河都尉's trail of stars, under all the roaches
      addMaplibreSandwich(map);
      addMaplibreTrail(map, propsRef.current.trail);
      await ensureImages(map, neededImages(propsRef.current, propsRef.current.roaches));
      const { roaches, mine, mineAsleep, ghost, myAvatar, myColor, look } = propsRef.current;
      iconsLookRef.current = look;
      // each roach's id is its feature's, so updates can name what changed and touches can mark one
      map.addSource("roaches", { type: "geojson", data: featuresRef.current.collection(roaches), promoteId: "id" });
      map.addSource("mine", { type: "geojson", data: mineGeoJSON(mine, mineAsleep, ghost, myAvatar, myColor) });

      // Dark swarm under the icons so crowded cities read as covered in roaches, in 国度版 only (地图画风):
      // hidden otherwise, which costs next to nothing, as MapLibre leaves a hidden layer alone
      const ramp = Object.entries(SWARM_GRADIENT)
        .map(([k, v]) => [Number(k), v] as const)
        .sort((a, b) => a[0] - b[0])
        .flat();
      map.addLayer({
        id: "swarm",
        type: "heatmap",
        source: "roaches",
        maxzoom: SWARM_FADE_ZOOM + 1,
        layout: { visibility: propsRef.current.mapStyle === "nation" ? "visible" : "none" },
        paint: {
          "heatmap-weight": 1,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.2, SWARM_FADE_ZOOM, 2],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 10, 4, 18, 8, 30, SWARM_FADE_ZOOM, 40],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], ...ramp] as never,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 1, SWARM_FADE_ZOOM, 0],
        },
      });
      const iconSize = ["interpolate", ["linear"], ["zoom"], ...ICON_STOPS.flatMap(([z, px]) => [z, px / ICON_BASE])];
      // Sleeping roaches lie still under the crawling crowd
      map.addLayer({
        id: ASLEEP_LAYER,
        type: "symbol",
        source: "roaches",
        filter: ["get", "asleep"],
        layout: {
          "icon-image": sleepImage(look) as never,
          "icon-size": iconSize as never,
          "icon-rotate": sleepRotate(look) as never,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "symbol-sort-key": ["case", ["get", "friend"], 1, 0],
        },
        paint: OFF_STAGE as never,
      });
      // One layer per crawl group so each group can be nudged with a cheap paint update
      ROACH_LAYERS.forEach((id, g) =>
        map.addLayer({
          id,
          type: "symbol",
          source: "roaches",
          filter: ["all", ["==", ["get", "g"], g], ["!", ["get", "asleep"]]],
          layout: {
            "icon-image": roachImage(look) as never,
            "icon-size": iconSize as never,
            "icon-rotate": roachRotate(look) as never,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // 触须之交 drawn on top of the crowd
            "symbol-sort-key": ["case", ["get", "friend"], 1, 0],
          },
          paint: OFF_STAGE as never,
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
        paint: { "icon-opacity": ["case", ["get", "ghost"], 0.55, 1] },
      });

      readyRef.current = true;
      offStageRef.current = null;
      markOffStage(map, propsRef.current.hiddenId ?? null);
      showHearts();
      window.clearTimeout(loadTimer);
      crawlRef.current?.start();
      reportView();
      map.once("idle", () => propsRef.current.onReady?.());
    });
    crawlRef.current = {
      start: () => {
        if (!frame && readyRef.current && propsRef.current.active !== false && !prefersReducedMotion()) animate();
      },
      stop: () => {
        cancelAnimationFrame(frame);
        frame = 0;
      },
    };

    map.on("click", (e) => {
      if (!readyRef.current) return;
      const p = propsRef.current;
      if (!p.placing) {
        // the one off stage is still there, see-through: a tap goes to whatever is under it
        const hit = map.queryRenderedFeatures(e.point, { layers: CLICKABLE }).find((f) => f.layer.id === "mine" || f.properties.id !== p.hiddenId);
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
      crawlRef.current = null;
      window.clearTimeout(loadTimer);
      window.clearTimeout(foldTimer);
      readyRef.current = false;
      mapRef.current = null;
      guideMarkers.clear();
      shoutMarkers.clear();
      overlayMarkers.clear();
      map.remove();
    };
  }, []);

  // the whole crowd again only when it (kept as one list by the page) or the look changes; your own
  // roaches only when they really change, since the page hands over a new list of them each time it draws
  useEffect(syncAll, [props.roaches, props.look]);

  // the roach off stage during a touch scene: only its feature state changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    markOffStage(map, props.hiddenId ?? null);
    const p = propsRef.current;
    if (heartModeOf(p.mapStyle) !== "off") heartsRef.current?.setDots(heartDots(p, featuresRef.current));
  }, [props.hiddenId]);
  const mineKey = JSON.stringify([props.mine, props.mineAsleep, props.ghost, props.myAvatar, props.myColor]);
  useEffect(syncMine, [mineKey]);

  const trailKey = JSON.stringify(props.trail);
  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current) setMaplibreTrail(map, propsRef.current.trail);
  }, [trailKey]);

  const main = props.mine.find((r) => r.slot === 0);
  const guidesKey = `${JSON.stringify(props.guides)}|${main ? `${main.lng},${main.lat}` : ""}`;
  useEffect(syncGuides, [guidesKey]);
  const shoutsKey = props.shouts.map((s) => s.id).join("|");
  useEffect(syncShouts, [shoutsKey]);
  const overlaysKey = (props.overlays ?? []).map((o) => o.id).join("|");
  useEffect(syncOverlays, [overlaysKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.placing ? "crosshair" : "";
  }, [props.placing]);

  // 地图画风: the dark swarm shown in 国度版 only, and 舟u本色's hearts
  useEffect(() => {
    const map = mapRef.current;
    if (map && readyRef.current && map.getLayer("swarm")) map.setLayoutProperty("swarm", "visibility", props.mapStyle === "nation" ? "visible" : "none");
    showHearts();
  }, [props.mapStyle]);

  // a hidden map leaves the flying to the one on show
  useEffect(() => {
    const f = props.focus;
    if (f && mapRef.current && propsRef.current.active !== false) mapRef.current.flyTo({ center: [f.lng, f.lat], zoom: f.zoom });
  }, [props.focus]);

  useEffect(() => {
    const j = props.jump;
    if (j && mapRef.current) mapRef.current.jumpTo({ center: [j.lng, j.lat], zoom: j.zoom });
  }, [props.jump]);

  useEffect(() => {
    if (props.active === false) crawlRef.current?.stop();
    else crawlRef.current?.start();
  }, [props.active]);

  return <div ref={el} className="map" data-basemap="osm" />;
}
