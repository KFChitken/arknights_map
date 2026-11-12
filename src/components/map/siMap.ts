import type { GeoJSONSource, LayerSpecification, Map as MaplibreMap, SourceSpecification } from "maplibre-gl";
import { SI_AT } from "@/lib/si";
import { homeDots } from "@/lib/siHomes";
import { INN_CENTER, innDrawing, queueLine } from "@/lib/siInn";
import { prefersReducedMotion } from "@/lib/swarm";
import type { InkPoint } from "@/lib/siTiles";
import {
  brushReveal,
  butterflyCanvas,
  INK_LOOKS,
  INK_VARIANTS,
  inkCanvas,
  inkImageName,
  rolledCanvas,
  scrollCanvas,
  signCanvas,
  treeCanvas,
  variantOf,
} from "./inkArt";
import {
  BLOT_OPACITY,
  BLOT_RADIUS,
  BRUSH_MS,
  BUTTERFLIES,
  BUTTERFLY_PX,
  butterflyAt,
  DOT_OPACITY,
  DOT_RADIUS,
  FAR_BELOW,
  INK,
  INK_OPACITY,
  INK_PX,
  INK_SIZE,
  INN_FROM,
  INN_OPACITY,
  MARK_SIZE,
  MARKS_FROM,
  NEAR_FROM,
  QUEUE_OPACITY,
  QUEUE_WIDTH,
  RAILING_WIDTH,
  RING_PAD,
  ROLLED_SHIFT,
  SCROLL_FROM,
  SCROLL_OPEN,
  SCROLL_OPEN_FROM,
  SCROLL_ROLLED,
  scrollAt,
  WALL_WIDTH,
  zoomExpr,
} from "./siLook";
import type { SiMapData, SiMine } from "./types";

/**
 * 祀掌柜's corner of the OSM map (MapLibre), under the roaches and never in the way of a tap: her scroll beside
 * her (rolled from afar, open close up with today's painting) and her ink butterflies round it; 缘缘庄 from far
 * away as a blot of ink on 宏村 as big as she has drawn, in the middle distance the queue as one ink line from
 * the door to its end and faint dots over the fields where those who stayed lie; close up the inn's walls,
 * courtyards and the yard's railings in ink, its sign, the old trees by the village gate, and every ink roach one
 * by one (src/lib/siTiles.ts), your own on top, ringed in your colour (siLook.ts has the sizes, as on 高德).
 */

const emptyFc = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });
const point = (lng: number, lat: number, properties: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties,
});
const DOTS = 1600;

/** The inn's lines and marks, which never change */
function innGeoJSON(): GeoJSON.FeatureCollection {
  const d = innDrawing();
  return {
    type: "FeatureCollection",
    features: [
      ...d.walls.map((pts) => ({ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: pts }, properties: { kind: "wall" } })),
      ...d.railings.map((pts) => ({ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: pts }, properties: { kind: "railing" } })),
      ...d.trees.map((t) => point(t.lng, t.lat, { kind: "tree" })),
      point(d.sign.lng, d.sign.lat, { kind: "sign" }),
    ],
  };
}

const lineOf = (queue: number): GeoJSON.FeatureCollection =>
  queue > 0
    ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: queueLine(queue) }, properties: {} }] }
    : emptyFc();

const dotsOf = (reach: number): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: homeDots(reach, DOTS).map(([lng, lat]) => point(lng, lat)),
});

const blotOf = (drawn: number): GeoJSON.FeatureCollection =>
  drawn > 0 ? { type: "FeatureCollection", features: [point(INN_CENTER.lng, INN_CENTER.lat, { drawn })] } : emptyFc();

const inksOf = (inks: InkPoint[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: inks.map((p) =>
    point(p.lng, p.lat, { icon: inkImageName(p.look, variantOf(p.state, p.left)), size: p.size, tilt: p.tilt, ink: p.ink, lying: p.state === 2 ? 1 : 0 }),
  ),
});

const mineOf = (mine: SiMine | null): GeoJSON.FeatureCollection =>
  mine ? { type: "FeatureCollection", features: [point(mine.at.lng, mine.at.lat, { size: mine.size, tilt: mine.tilt, ink: mine.ink })] } : emptyFc();

const signIcon = (full: boolean) => ["match", ["get", "kind"], "tree", "si-tree", full ? "si-sign-full" : "si-sign"];

/** Her butterflies' layers: two for each, its wings open and half shut, one shown at a time */
const flyLayer = (i: number, f: 0 | 1) => `si-fly-${i}-${f}`;

/** 缘缘庄's sources as the page has it now */
export function siSources(si: SiMapData | undefined): Record<string, SourceSpecification> {
  const geo = (data: GeoJSON.FeatureCollection): SourceSpecification => ({ type: "geojson", data });
  return {
    "si-her": geo({ type: "FeatureCollection", features: [point(SI_AT.lng, SI_AT.lat)] }),
    "si-blot": geo(blotOf(si?.inn?.drawn ?? 0)),
    "si-queue": geo(lineOf(si?.inn?.queue ?? 0)),
    "si-dots": geo(dotsOf(si?.inn?.homesReach ?? 0)),
    "si-inn": geo(innGeoJSON()),
    "si-inks": geo(inksOf(si?.inks ?? [])),
    "si-mine": geo(mineOf(si?.mine ?? null)),
  };
}

/** 缘缘庄's layers, bottom first (full: its sign says 客满) */
export function siLayers(full: boolean): LayerSpecification[] {
  const open = scrollAt(SCROLL_OPEN_FROM)!;
  const still = (i: number) => butterflyAt(i, null, SCROLL_OPEN_FROM);
  const lineKind = ["==", ["geometry-type"], "LineString"];
  return [
    // far: a soft blot, bigger the more she has drawn
    {
      id: "si-blot",
      type: "circle",
      source: "si-blot",
      maxzoom: FAR_BELOW,
      paint: {
        "circle-color": INK,
        "circle-opacity": BLOT_OPACITY,
        "circle-blur": 0.85,
        "circle-radius": zoomExpr(BLOT_RADIUS, 1, ["+", 1, ["/", ["ln", ["+", 1, ["get", "drawn"]]], 4]]) as never,
      },
    },
    // the middle distance: the fields' dots, then the queue's line over them
    {
      id: "si-dots",
      type: "circle",
      source: "si-dots",
      minzoom: FAR_BELOW - 0.5,
      maxzoom: NEAR_FROM + 0.5,
      paint: {
        "circle-color": INK,
        "circle-radius": zoomExpr(DOT_RADIUS) as never,
        "circle-opacity": zoomExpr(DOT_OPACITY) as never,
        "circle-blur": 0.4,
      },
    },
    {
      id: "si-queue",
      type: "line",
      source: "si-queue",
      minzoom: FAR_BELOW - 0.5,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": INK,
        "line-width": zoomExpr(QUEUE_WIDTH, 2) as never,
        "line-opacity": zoomExpr(QUEUE_OPACITY) as never,
        "line-blur": 0.6,
      },
    },
    // close up: the inn in ink lines
    {
      id: "si-inn-lines",
      type: "line",
      source: "si-inn",
      minzoom: INN_FROM,
      filter: lineKind as never,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": INK,
        "line-width": [
          "interpolate",
          ["exponential", 2],
          ["zoom"],
          ...WALL_WIDTH.flatMap(([z, wall], i) => [z, ["match", ["get", "kind"], "wall", wall, RAILING_WIDTH[i][1]]]),
        ] as never,
        "line-opacity": zoomExpr(INN_OPACITY) as never,
        "line-dasharray": ["match", ["get", "kind"], "railing", ["literal", [2, 1.5]], ["literal", [1, 0]]] as never,
      },
    },
    {
      id: "si-inn-marks",
      type: "symbol",
      source: "si-inn",
      minzoom: MARKS_FROM,
      filter: ["==", ["geometry-type"], "Point"] as never,
      layout: {
        "icon-image": signIcon(full) as never,
        "icon-size": zoomExpr(MARK_SIZE, 2) as never,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    // close up: every ink roach, under the real ones
    {
      id: "si-inks",
      type: "symbol",
      source: "si-inks",
      minzoom: NEAR_FROM,
      layout: {
        "icon-image": ["get", "icon"] as never,
        "icon-size": zoomExpr(INK_SIZE, 2, ["get", "size"]) as never,
        "icon-rotate": ["get", "tilt"] as never,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        // the lying ones under those standing
        "symbol-sort-key": ["-", 0, ["get", "lying"]] as never,
      },
      paint: { "icon-opacity": ["*", INK_OPACITY, ["get", "ink"]] as never },
    },
    // your own over them, ringed: its picture has room round the figure, so it is drawn that much bigger and lower
    {
      id: "si-mine",
      type: "symbol",
      source: "si-mine",
      minzoom: NEAR_FROM,
      layout: {
        "icon-image": "si-mine",
        "icon-size": zoomExpr(INK_SIZE, 2, ["/", ["get", "size"], 1 - 2 * RING_PAD]) as never,
        "icon-offset": [0, INK_PX * RING_PAD],
        "icon-rotate": ["get", "tilt"] as never,
        "icon-anchor": "bottom",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: { "icon-opacity": ["min", 1, ["*", 1.05, ["get", "ink"]]] as never },
    },
    // her scroll beside her: rolled from afar, open close up
    {
      id: "si-scroll-rolled",
      type: "symbol",
      source: "si-her",
      minzoom: SCROLL_FROM,
      maxzoom: SCROLL_OPEN_FROM,
      layout: { "icon-image": "si-scroll-rolled", "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-translate": ["interpolate", ["linear"], ["zoom"], ...ROLLED_SHIFT.flatMap(([z, dx]) => [z, ["literal", [dx, 0]]])] as never },
    },
    {
      id: "si-scroll",
      type: "symbol",
      source: "si-her",
      minzoom: SCROLL_OPEN_FROM,
      layout: { "icon-image": "si-scroll", "icon-allow-overlap": true, "icon-ignore-placement": true },
      paint: { "icon-translate": [open.dx, open.dy] },
    },
    // her butterflies round it, moved on every few frames (startSiFlight)
    ...Array.from({ length: BUTTERFLIES }, (_, i) =>
      ([0, 1] as const).map(
        (f): LayerSpecification => ({
          id: flyLayer(i, f),
          type: "symbol",
          source: "si-her",
          minzoom: SCROLL_OPEN_FROM,
          layout: { "icon-image": `si-fly-${f}`, "icon-allow-overlap": true, "icon-ignore-placement": true },
          paint: { "icon-translate": [still(i).dx, still(i).dy], "icon-opacity": f === 0 ? 0.85 : 0 },
        }),
      ),
    ).flat(),
  ];
}

const ratio = { pixelRatio: 2 };

/** A picture under a name: added, or put in place of the one there (same size) */
function putImage(map: MaplibreMap, name: string, c: HTMLCanvasElement) {
  const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  if (map.hasImage(name)) map.updateImage(name, data);
  else map.addImage(name, data, ratio);
}

const INK_NAMES = new Set(INK_LOOKS.flatMap((look) => INK_VARIANTS.map((v) => inkImageName(look, v))));
/** The ink roaches' pictures being made for a map */
const inksComing = new WeakMap<MaplibreMap, Promise<void>>();

/** The ink roaches' pictures, every look each way (five downloads, held after) */
function addInkImages(map: MaplibreMap) {
  let p = inksComing.get(map);
  if (!p) {
    p = Promise.all(
      INK_LOOKS.flatMap((look) =>
        INK_VARIANTS.map(async (v) => {
          const c = await inkCanvas(look, v, INK_PX * 2).catch(() => null);
          try {
            if (c) putImage(map, inkImageName(look, v), c);
          } catch {
            // the map is gone
          }
        }),
      ),
    ).then(() => {
      inksComing.delete(map);
    });
    inksComing.set(map, p);
  }
  return p;
}

/** Your own ink roach as the page last had it, drawn when the map asks for its picture */
const mineNow = new WeakMap<MaplibreMap, SiMine | null>();
const onDemand = new WeakSet<MaplibreMap>();

/**
 * The ink roaches' pictures, and your own, only when the map first lays one out (close up at 宏村), so nobody else
 * downloads them: a clear one of the same size at once, so the ink roach is not left out, then the picture in its
 * place. Again after a new style has dropped them, from the pictures held.
 */
function picturesOnDemand(map: MaplibreMap) {
  if (onDemand.has(map)) return;
  onDemand.add(map);
  map.on("styleimagemissing", ({ id }: { id: string }) => {
    if (id !== "si-mine" && !INK_NAMES.has(id)) return;
    const px = INK_PX * 2;
    if (!map.hasImage(id)) map.addImage(id, { width: px, height: px, data: new Uint8Array(px * px * 4) }, ratio);
    if (id !== "si-mine") void addInkImages(map);
    else {
      const mine = mineNow.get(map);
      if (mine) void drawMine(map, mine);
    }
  });
}

/** The scroll with today's painting, and rolled up; drawn from SVG, so a moment later */
async function addScrollImages(map: MaplibreMap, tier: SiMapData["tier"]) {
  const [open, rolled] = await Promise.all([scrollCanvas(tier, SCROLL_OPEN.h * 2), rolledCanvas(SCROLL_ROLLED.w * 2)].map((p) => p.catch(() => null)));
  if (open) putImage(map, "si-scroll", open);
  if (rolled && !map.hasImage("si-scroll-rolled")) putImage(map, "si-scroll-rolled", rolled);
}

/** MapLibre: 缘缘庄's sources and layers, under whatever is added after them (the roaches) */
export function addMaplibreSi(map: MaplibreMap, si: SiMapData | undefined) {
  if (!map.hasImage("si-tree")) putImage(map, "si-tree", treeCanvas(INK_PX * 2));
  if (!map.hasImage("si-sign-full")) putImage(map, "si-sign-full", signCanvas("客满", INK_PX * 1.5, true));
  if (!map.hasImage("si-sign")) putImage(map, "si-sign", signCanvas("缘缘庄", INK_PX * 1.5));
  for (const f of [0, 1] as const) if (!map.hasImage(`si-fly-${f}`)) putImage(map, `si-fly-${f}`, butterflyCanvas(f, BUTTERFLY_PX * 2));
  for (const [id, source] of Object.entries(siSources(si))) map.addSource(id, source);
  for (const layer of siLayers(Boolean(si?.inn?.full))) map.addLayer(layer);
  picturesOnDemand(map);
  void addScrollImages(map, si?.tier ?? 0);
  mineNow.set(map, si?.mine ?? null);
  // kept through a new style: drawn again now (held, no download); otherwise when the map asks for it
  if (si?.mine && map.hasImage("si-mine")) void drawMine(map, si.mine);
}

/** Which of your own was drawn last, so a slow picture never lands after a newer one */
const mineSeq = new WeakMap<MaplibreMap, number>();

/** Your own ink roach's picture, ringed; drawn in by her brush when she has only just drawn it */
async function drawMine(map: MaplibreMap, mine: SiMine) {
  const seq = (mineSeq.get(map) ?? 0) + 1;
  mineSeq.set(map, seq);
  const c = await inkCanvas(mine.look, mine.variant, INK_PX * 2, mine.color).catch(() => null);
  if (!c || mineSeq.get(map) !== seq) return;
  const left = mine.brushFrom === null ? 0 : BRUSH_MS - (Date.now() - mine.brushFrom);
  if (left <= 0 || prefersReducedMotion()) {
    putImage(map, "si-mine", c);
    return;
  }
  const frame = brushReveal(c);
  const start = performance.now() - (BRUSH_MS - left);
  const step = () => {
    if (mineSeq.get(map) !== seq || !map.getStyle()) return;
    const p = (performance.now() - start) / BRUSH_MS;
    const data = frame(p);
    if (map.hasImage("si-mine")) map.updateImage("si-mine", data);
    else map.addImage("si-mine", data, ratio);
    if (p < 1) requestAnimationFrame(step);
  };
  step();
}

/** MapLibre: 缘缘庄 as the page now has it */
export function setMaplibreSi(map: MaplibreMap, si: SiMapData | undefined, changed: { inn?: boolean; inks?: boolean; mine?: boolean; tier?: boolean }) {
  if (changed.inn) {
    (map.getSource("si-blot") as GeoJSONSource | undefined)?.setData(blotOf(si?.inn?.drawn ?? 0));
    (map.getSource("si-queue") as GeoJSONSource | undefined)?.setData(lineOf(si?.inn?.queue ?? 0));
    (map.getSource("si-dots") as GeoJSONSource | undefined)?.setData(dotsOf(si?.inn?.homesReach ?? 0));
    if (map.getLayer("si-inn-marks")) map.setLayoutProperty("si-inn-marks", "icon-image", signIcon(Boolean(si?.inn?.full)));
  }
  if (changed.inks) (map.getSource("si-inks") as GeoJSONSource | undefined)?.setData(inksOf(si?.inks ?? []));
  if (changed.mine) {
    mineNow.set(map, si?.mine ?? null);
    (map.getSource("si-mine") as GeoJSONSource | undefined)?.setData(mineOf(si?.mine ?? null));
    if (si?.mine && map.hasImage("si-mine")) void drawMine(map, si.mine);
  }
  if (changed.tier) void addScrollImages(map, si?.tier ?? 0);
}

/**
 * Her butterflies flying round the scroll, a few frames a second while she is on screen close up and the map is
 * shown (active); with motion turned down they stay where they rest. Returns the way to stop them.
 */
export function startSiFlight(map: MaplibreMap, active: () => boolean) {
  const place = (t: number | null) => {
    const z = map.getZoom();
    for (let i = 0; i < BUTTERFLIES; i++) {
      const b = butterflyAt(i, t, z);
      for (const f of [0, 1] as const) {
        const id = flyLayer(i, f);
        if (!map.getLayer(id)) continue;
        map.setPaintProperty(id, "icon-translate", [b.dx, b.dy]);
        map.setPaintProperty(id, "icon-opacity", b.frame === f ? 0.85 : 0);
      }
    }
  };
  if (prefersReducedMotion()) return () => {};
  let frame = 0;
  let last = 0;
  const fly = () => {
    frame = requestAnimationFrame(fly);
    const t = performance.now();
    if (t - last < 60) return;
    last = t;
    if (document.hidden || !active() || map.getZoom() < SCROLL_OPEN_FROM) return;
    const p = map.project([SI_AT.lng, SI_AT.lat]);
    const el = map.getContainer();
    if (p.x < -120 || p.y < -120 || p.x > el.clientWidth + 120 || p.y > el.clientHeight + 120) return;
    place(t);
  };
  frame = requestAnimationFrame(fly);
  return () => cancelAnimationFrame(frame);
}
