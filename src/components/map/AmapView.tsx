"use client";

import { useEffect, useRef } from "react";
import { lang, T } from "@/i18n";
import type { GuideId } from "@/lib/guides";
import { loadAMap, type AMapNS } from "@/lib/amap";
import { fromGcj, toGcj } from "@/lib/coords";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl, type RoachOpts } from "@/lib/roachSvg";
import { crawl, iconPx, MASS_GROUPS, prefersReducedMotion, SWARM_FADE_ZOOM, SWARM_GRADIENT } from "@/lib/swarm";
import type { LngLat, RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach } from "@/lib/world/types";
import { byDistance, STACK_FROM_ZOOM, type Near } from "@/lib/stackPick";
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
import { listenToAmapConsole, reportMapTrouble } from "./report";
import { roachGl, type HeartMode, type RoachGl } from "./roachGl";
import { swarmGl } from "./swarmGl";
import { amapSandwich } from "./sandwich";
import { amapSi, type SiAmap } from "./siAmap";
import { SHOUT_LIFT, shoutElement } from "./shoutMarker";
import { amapLines } from "./lines";
import { amapTrail } from "./trail";
import { MassCache, STILL, styleIndex, styleSpecs, type MassPoint } from "./massPoints";
import { PILE_MAX_ZOOM } from "./pileWork";
import { inkHit, tapNear } from "./stackTap";
import { BADGE_AT, countBadgeText, PILE_MAX_PX, pileMul, Piles, type Box, type PileItem } from "./piles";
import type { MapViewProps, StackHit, StackUnder } from "./types";

// Amap zoom levels assume 256px tiles, one level above MapLibre
const ZOOM_OFFSET = 1;
/** The crawl waits this long after the last sign of a move, if the end of it is never told */
const MOVE_QUIET_MS = 1500;
/** And this long after the map says it stopped, in case another move follows at once */
const MOVE_SETTLE_MS = 150;
/** A refusal of the key this soon after the map is made means its tiles never come (see the start-up below) */
const REFUSED_WITHIN_MS = 30_000;
// The shadow sits on top of cartoon roaches so crowds go solid black, but under
// real ones so their brown bodies stay visible
const HEAT_Z = 125;
/** The dark swarm: each roach a dark spot this many px across, this many on one another full dark */
const SWARM = {
  radius: 22,
  max: 12,
  opacity: [0, 0.85] as [number, number],
  gradient: SWARM_GRADIENT,
  zooms: [2, SWARM_FADE_ZOOM + ZOOM_OFFSET] as [number, number],
};
const massZ = (look: RoachStyle) => (look === "real" ? 130 : 120);
const MINE_ICON = 48;
/** The guides: above your own roaches (300) */
const GUIDE_Z = 320;
/** A shout's bubble: over the guides too, as it is the latest thing you did */
const SHOUT_Z = 330;

/**
 * Only the roaches near the screen go to 高德: those within the view's box grown by its own width and
 * height on every side (3×3 screens). 高德 works through every point of its layers on each frame of a
 * drag, so with 14,000 roaches a city view dragged at 5 frames a second, and at about 60 with these
 * few hundred (measured 2026-11-10). Zoomed out far enough that the box would cross ±180° or span half
 * the world, every roach goes, as before. The roach count and the dark swarm still use them all.
 */
function nearBox(map: AMapNS): [number, number, number, number] | null {
  try {
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    const w = ne.getLng() - sw.getLng();
    const h = ne.getLat() - sw.getLat();
    if (!(w > 0) || !(h > 0) || w * 3 > 180) return null;
    return [sw.getLng() - w, sw.getLat() - h, ne.getLng() + w, ne.getLat() + h];
  } catch {
    return null;
  }
}

/** Each batch's roaches within the box (all of them without one), but the one off stage (props.hiddenId) */
const nearOnly = (box: [number, number, number, number] | null, groups: MassPoint[][], hidden: string | null) =>
  box || hidden
    ? groups.map((g) =>
        g.filter((p) => p.id !== hidden && (!box || (p.lng >= box[0] && p.lng <= box[2] && p.lat >= box[1] && p.lat <= box[3]))),
      )
    : groups;

/** 高德 zoom at and below which roaches piled on one another are drawn once (Breeze, 2026-11-10: 做) */
const THIN_ZOOM = 7;

/**
 * Zoomed out that far, one roach for each square of the screen half an icon wide, a 触须之交 first:
 * the rest would only be drawn under it. A whole country dragged at 3 frames a second with them all,
 * at 10 like this, and looked the same (measured 2026-11-10). The dark swarm still shows how many.
 */
function thinned(groups: MassPoint[][], amapZoom: number): MassPoint[][] {
  if (amapZoom > THIN_ZOOM) return groups;
  const cell = Math.max(4, iconPx(amapZoom - ZOOM_OFFSET) / 2);
  const world = 256 * 2 ** amapZoom;
  const taken = new Set<string>();
  const kept = new Set<MassPoint>();
  const all = groups.flat().sort((a, b) => Number(b.friend) - Number(a.friend));
  for (const p of all) {
    const sin = Math.sin((p.lat * Math.PI) / 180);
    const x = Math.floor((((p.lng + 180) / 360) * world) / cell);
    const y = Math.floor(((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world) / cell);
    const key = `${x},${y}`;
    if (taken.has(key)) continue;
    taken.add(key);
    kept.add(p);
  }
  return groups.map((g) => g.filter((p) => kept.has(p)));
}

/** What 高德 gets of each batch: the roaches near the screen, and far out only one of each pile; never the one off stage */
const shownOf = (map: AMapNS, groups: MassPoint[][], hidden: string | null) => thinned(nearOnly(nearBox(map), groups, hidden), map.getZoom());

/**
 * The GPU layer stays off on this page with ?gl=0 in its address: for a phone it draws wrongly on, and to
 * compare with the MassMarks it replaced.
 */
const glOff = () => {
  try {
    return new URLSearchParams(window.location.search).get("gl") === "0";
  } catch {
    return false;
  }
};

/** Every roach of a batch where its own crawl puts it at time t (ms), or at rest when t is null. */
function massData(points: MassPoint[], amapZoom: number, look: RoachStyle, t: number | null) {
  const degPerPx = 360 / (256 * 2 ** amapZoom);
  const scale = iconPx(amapZoom - ZOOM_OFFSET) / 24;
  return points.map((p) => {
    const c = t === null ? { dx: 0, dy: 0, frame: 0 } : crawl(p.seed, t, look, scale);
    return {
      lnglat: [p.lng + c.dx * degPerPx, p.lat - c.dy * degPerPx * p.cos],
      id: p.id,
      style: styleIndex(p, look, c.frame),
    };
  });
}

const ICON_URL_PX = 96;

/**
 * Icon URL for a roach. Pictures and the walking realistic roach are composed
 * once into PNGs: the canvas redraws thousands of them many times a second,
 * and bitmaps draw far faster than SVG.
 */
function iconUrl(color: RoachColor, opts: RoachOpts) {
  return usesPicture(opts) || opts.look === "real"
    ? roachIconUrl(color, opts, ICON_URL_PX)
    : Promise.resolve(roachDataUrl(color, opts));
}

const styleUrlCache = new Map<RoachStyle, Promise<string[]>>();

/** One icon per style index (see styleIndex), built once per look. */
function styleUrls(look: RoachStyle) {
  let p = styleUrlCache.get(look);
  if (!p) {
    p = Promise.all(styleSpecs(look).map(([color, opts]) => iconUrl(color, opts)));
    styleUrlCache.set(look, p);
  }
  return p;
}

/** The roaches' icon size at this 高德 zoom, in whole pixels */
const massPx = (amapZoom: number) => Math.round(iconPx(amapZoom - ZOOM_OFFSET));

function massStyles(AMap: AMapNS, amapZoom: number, urls: string[]) {
  const px = massPx(amapZoom);
  return urls.map((url) => ({
    url,
    size: new AMap.Size(px, px),
    anchor: new AMap.Pixel(px / 2, px / 2),
  }));
}

/** 轻量's piles for the view as it is now (as 高德 has it), at MapLibre's zoom */
function askPiles(map: AMapNS | null, piles: Piles | null) {
  if (!map || !piles) return;
  try {
    const b = map.getBounds();
    const sw = b.getSouthWest();
    const ne = b.getNorthEast();
    // across the 180° meridian: the whole width
    const view: Box = ne.getLng() > sw.getLng() ? [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()] : [-180, sw.getLat(), 180, ne.getLat()];
    piles.view(view, Math.min(PILE_MAX_ZOOM + 1, Math.max(0, Math.floor(map.getZoom() - ZOOM_OFFSET))));
  } catch {}
}

/** No batches at all: 全员隐匿 draws nobody's roaches */
const noGroups = (): MassPoint[][] => Array.from({ length: MASS_GROUPS + 1 }, () => []);

/**
 * The dark swarm's points: every roach where 高德 has it (worked out once, MassCache); one of the overview
 * (world/area.ts) as many times as the roaches it stands for, so the swarm is as dark as with them all
 */
const swarmPoints = (groups: MassPoint[][]) => {
  const out: [number, number][] = [];
  for (const g of groups) for (const p of g) for (let i = 0; i < p.n; i++) out.push(p.at);
  return out;
};

function heatData(points: [number, number][]) {
  return { data: points.map(([lng, lat]) => ({ lng, lat, count: 1 })), max: SWARM.max };
}

/** 舟u本色's hearts: rising, or still with motion turned down; none in the other styles */
const heartModeOf = (style: MapViewProps["mapStyle"]): HeartMode => (style === "hearts" ? (prefersReducedMotion() ? "still" : "float") : "off");

/** The dark swarm, drawn by the GPU (swarmGl.ts) or by 高德's HeatMap */
type Swarm = { set: (points: [number, number][]) => void; destroy: () => void };

async function mineIcon(
  r: OwnRoach,
  avatar: RoachAvatar,
  color: RoachColor,
  look: RoachStyle,
  ghost: boolean,
  asleep: boolean,
  hearts: HeartMode,
) {
  const lying = asleep && r.slot === 0 && !ghost;
  const url = await iconUrl(color, { avatar, mine: true, clone: r.slot > 0, look, asleep: lying });
  const label = ghost ? T.map.view.placeHere : r.slot > 0 ? T.map.view.myClone : T.map.view.myRoach;
  const img = `<img src="${url}" width="${MINE_ICON}" height="${MINE_ICON}" alt="${label}" style="cursor:pointer;display:block${ghost ? ";opacity:.55" : ""}"/>`;
  // 舟u本色: your own roaches have hearts too (globals.css .mine-hearts), but not one lying drunk, nor the preview
  if (hearts === "off" || ghost || lying) return img;
  return `<span class="mine-hearts${hearts === "still" ? " still" : ""}">${img}<i></i><i></i></span>`;
}

export default function AmapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapNS>(null);
  const massRef = useRef<AMapNS[]>([]);
  // the GPU layer, which draws the roaches instead of the MassMarks in the cartoon look
  const glRef = useRef<RoachGl | null>(null);
  // the roaches' layers made again for the look in use (set up with the map)
  const layRef = useRef<() => void>(() => {});
  // the pointer is over a roach of the GPU layer (it has no cursor of its own)
  const overRef = useRef(false);
  const groupsRef = useRef<MassPoint[][]>([]);
  // each roach worked out once (massPoints.ts), kept across updates of the list
  const cacheRef = useRef(new MassCache());
  // 全员隐匿 draws none of the crowd and works none of it out; the cache keeps what it has for the way back
  /** The batches drawn now: everyone's roaches, or none of them */
  const regroup = () => {
    const p = propsRef.current;
    groupsRef.current = p.mapStyle === "hidden" ? noGroups() : cacheRef.current.groups(p.roaches);
  };
  /** The GPU layer's roaches, for the batches regroup() made */
  const glList = () => (propsRef.current.mapStyle === "hidden" ? [] : cacheRef.current.gl());
  // how the crowd was last drawn: every roach, in piles (轻量), or none (全员隐匿)
  const crowdWasRef = useRef<"all" | "lite" | "off">("all");
  // 轻量: the piles, worked out in the background (piles.ts), while it is on the GPU layer
  const pilesRef = useRef<Piles | null>(null);
  // 轻量's piles as they came, and where they go: the GPU layer, or 高德's own LabelMarkers where it cannot run
  // (set up with the map)
  const pileItemsRef = useRef<PileItem[]>([]);
  const showPilesRef = useRef<(items: PileItem[] | null) => void>(() => {});
  /** 轻量: the list as it is put into the piles; what is drawn now stays, still, until the first piles come */
  const startPiles = () => {
    pilesRef.current ??= new Piles((items) => {
      pileItemsRef.current = items;
      showPilesRef.current(items);
    });
    pilesRef.current.load(groupsRef.current);
    askPiles(mapRef.current, pilesRef.current);
  };
  const stopPiles = () => {
    pilesRef.current?.stop();
    pilesRef.current = null;
    pileItemsRef.current = [];
    showPilesRef.current(null);
  };
  // the batches as 高德 gets them: only the roaches near the screen (nearBox)
  const shownRef = useRef<MassPoint[][]>([]);
  // pick them again for where the map is now, and hand them over
  const reshowRef = useRef<() => void>(() => {});
  const heatRef = useRef<Swarm | null>(null);
  // the dark swarm is made only for 国度版 (props.mapStyle): how to make it and drop it as the style changes
  const swarmRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const mineRef = useRef<AMapNS[]>([]);
  const amapRef = useRef<AMapNS>(null);
  const lastHitRef = useRef(0);
  // The look whose icons the MassMarks currently use, so style indexes always match them
  const styledRef = useRef<{ look: RoachStyle; urls: string[] }>({ look: props.look, urls: [] });
  const mineSeq = useRef(0);
  const guidesRef = useRef(new Map<GuideId, { el: HTMLElement; marker: AMapNS }>());
  const shoutsRef = useRef(new Map<string, AMapNS>());
  const overlaysRef = useRef(new Map<string, AMapNS>());
  // 明河都尉's trail of stars
  const trailRef = useRef<AMapNS[]>([]);
  // 祀掌柜's 缘缘庄, its queue and its ink roaches
  const siRef = useRef<SiAmap | null>(null);
  // the 站长's dashed lines
  const linesRef = useRef<AMapNS[]>([]);
  // the roaches' crawl, which a hidden map stops
  const crawlRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  /** The icon size the roach layers were last styled for */
  const styledPxRef = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;

  /**
   * Everything drawn within reach of a point of the map's box (px), for a tap close up (src/lib/stackPick.ts): the
   * others' roaches (轻量's piles left out: a tap opens one up instead), your own, and 缘缘庄's ink roaches, each with
   * how far from the point its middle is, wherever the crawl has it now. reach: left out, as far as a tap on each
   * counts (half its icon, at least 14 px; your own, half theirs; an ink roach's figure); a guide's figure gives its
   * own. near: the point on the map (高德's), to look at only the MassMarks' roaches around it
   */
  const underAt = (x: number, y: number, reach?: number, near?: [number, number]): Near<StackHit>[] => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map) return [];
    const onScreen = (lng: number, lat: number) => {
      const px = map.lngLatToContainer([lng, lat]);
      return { x: px.getX(), y: px.getY() };
    };
    const out: Near<StackHit>[] = [];
    const gl = glRef.current;
    if (gl) {
      for (const h of gl.hits(x, y, reach)) out.push({ ref: { kind: "roach", id: h.id }, d: h.d });
    } else if (massRef.current.length) {
      // 高德's MassMarks: the batches as they were handed over, each roach where its crawl has it now
      const zoom = map.getZoom();
      const size = iconPx(zoom - ZOOM_OFFSET);
      const r = reach ?? Math.max(size / 2, 14);
      const degPerPx = 360 / (256 * 2 ** zoom);
      // the crawl takes a realistic roach up to 7.5 px of its icon at 24 px from its spot
      const box = (r + 8 + (7.5 * size) / 24) * degPerPx;
      const crawling = p.active !== false && !prefersReducedMotion();
      const now = performance.now();
      const { look } = styledRef.current;
      shownRef.current.forEach((points, g) => {
        for (const q of points) {
          if (near && (Math.abs(q.lng - near[0]) > box || Math.abs(q.lat - near[1]) > box * q.cos)) continue;
          const s = onScreen(q.lng, q.lat);
          const c = crawling && g !== STILL ? crawl(q.seed, now, look, size / 24) : { dx: 0, dy: 0 };
          const d = Math.hypot(s.x + c.dx - x, s.y + c.dy - y);
          if (d <= r) out.push({ ref: { kind: "roach", id: q.id }, d });
        }
      });
    }
    for (const m of p.mine) {
      const s = onScreen(...toGcj(m));
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= (reach ?? MINE_ICON / 2)) out.push({ ref: { kind: "mine", id: m.id }, d });
    }
    if (p.onInkClick) for (const n of siRef.current?.near(x, y, reach) ?? []) out.push({ ref: inkHit(n.ink), d: n.d });
    return out;
  };
  /**
   * A tap close up (src/lib/stackPick.ts) at a point of the map's box (px), at this place: the one nearest the finger
   * opened, or those lying on top of each other offered to pick from, once the map's own click for the tap is over.
   * tapped: what 高德 says the tap was on, counted even if it lies further from the point than a tap on it counts.
   * False where it is not for that tap (further out, while placing, or nothing there), for the tap to go on as before
   */
  const stackTap = (x: number, y: number, at: LngLat, gcj: [number, number], tapped?: Near<StackHit>): boolean => {
    const map = mapRef.current;
    const p = propsRef.current;
    if (!map || p.placing || !p.onStackClick || map.getZoom() - ZOOM_OFFSET < STACK_FROM_ZOOM) return false;
    const near = underAt(x, y, undefined, gcj);
    const same = (h: StackHit) => tapped && h.kind === tapped.ref.kind && "id" in h && "id" in tapped.ref && h.id === tapped.ref.id;
    if (tapped && !near.some((n) => same(n.ref))) near.push(tapped);
    if (!near.length) return false;
    lastHitRef.current = Date.now();
    // after the map's own click for the same tap, which would close what this opens
    window.setTimeout(() => tapNear(propsRef.current, near, at), 0);
    return true;
  };
  /**
   * What lies under a guide's figure close up, nearest her middle first, and where her middle is (src/lib/stackPick.ts):
   * the roaches whose middles are within half her figure's width of hers; none: undefined. at: where she stands, for
   * where 高德 cannot say where her middle is
   */
  const underGuide = (figure: HTMLElement, at: LngLat): StackUnder | undefined => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    const box = el.current;
    const p = propsRef.current;
    if (!map || !AMap || !box || !p.onStackClick || map.getZoom() - ZOOM_OFFSET < STACK_FROM_ZOOM) return undefined;
    // her picture, not her name or what she says
    const fig = (figure.querySelector("img") ?? figure).getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const x = fig.left + fig.width / 2 - b.left;
    const y = fig.top + fig.height / 2 - b.top;
    let middle = at;
    try {
      const ll = map.containerToLngLat(new AMap.Pixel(x, y));
      middle = fromGcj(ll.getLng(), ll.getLat());
    } catch {}
    const near = underAt(x, y, Math.min(fig.width, fig.height) / 2, toGcj(middle));
    if (!near.length) return undefined;
    return { hits: byDistance(near).map((n) => n.ref), at: middle };
  };
  // both for 高德's own handlers, set up once with the map, as they are now
  const stackRef = useRef({ tap: stackTap, underGuide });
  stackRef.current = { tap: stackTap, underGuide };

  // The guides: page element markers on top of everything, in their pictures whatever the look.
  // Added, moved and taken away as the page says; each kept beside your main roach, never on it.
  const syncGuides = () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const p = propsRef.current;
    const shown = guidesRef.current;
    const want = new Set(p.guides.map((g) => g.id));
    for (const [id, g] of shown) {
      if (want.has(id)) continue;
      map.remove(g.marker);
      shown.delete(id);
    }
    const zoom = map.getZoom() - ZOOM_OFFSET;
    const onScreen = (at: LngLat) => {
      const px = map.lngLatToContainer(toGcj(at));
      return { x: px.getX(), y: px.getY() };
    };
    const main = p.mine.find((r) => r.slot === 0);
    const mainAt = main ? onScreen(main) : null;
    for (const mark of p.guides) {
      let g = shown.get(mark.id);
      if (!g) {
        const el = guideElement(mark.id);
        const marker = new AMap.Marker({ position: toGcj(mark.at), content: el, zIndex: GUIDE_Z, bubble: true });
        marker.on("click", () => {
          if (propsRef.current.placing) return;
          lastHitRef.current = Date.now();
          const under = stackRef.current.underGuide(el, propsRef.current.guides.find((x) => x.id === mark.id)?.at ?? mark.at);
          window.setTimeout(() => propsRef.current.onRoachClick(mark.id, under), 0);
        });
        map.add(marker);
        g = { el, marker };
        shown.set(mark.id, g);
      } else g.marker.setPosition(toGcj(mark.at));
      updateGuide(g.el, zoom, mark);
      const box = guideBox(mark, zoom);
      const [sx, sy] = guideShift(mark, box);
      // she stays by her fire, 佩丽卡监督 sits right beside your drunk main roach; the others step aside from it
      const at = onScreen(mark.at);
      const [dx, dy] = mark.fire
        ? [0, 0]
        : mark.beside
          ? besideRight(box)
          : besideMain({ x: at.x + sx, y: at.y + sy }, mainAt, box, belowGuide(zoom));
      g.marker.setOffset(new AMap.Pixel(-box / 2 + sx + dx, -box / 2 + sy + dy));
      if (freshRide(mark, g.el)) {
        const from = mark.arrive!.from ? onScreen(mark.arrive!.from) : null;
        const c = el.current!;
        rideIn(g.el, rideStart({ x: at.x + sx + dx, y: at.y + sy + dy }, from, c.clientWidth, c.clientHeight), BIKE_MS);
      }
    }
  };

  // Your shouts: a bubble over each roach a declaration just went out from, taken away as the page says
  const syncShouts = () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const shown = shoutsRef.current;
    const want = new Set(propsRef.current.shouts.map((s) => s.id));
    for (const [id, marker] of shown) {
      if (want.has(id)) continue;
      map.remove(marker);
      shown.delete(id);
    }
    for (const s of propsRef.current.shouts) {
      if (shown.has(s.id)) continue;
      const marker = new AMap.Marker({
        position: toGcj(s.at),
        content: shoutElement(s.text, s.limited),
        anchor: "bottom-center",
        offset: new AMap.Pixel(0, -SHOUT_LIFT),
        zIndex: SHOUT_Z,
        bubble: true,
      });
      map.add(marker);
      shown.set(s.id, marker);
    }
  };

  // Elements the page places on the map (⚡舟友的酒⚡'s dance floor, the 站长's marks), moved with it
  const syncOverlays = () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const shown = overlaysRef.current;
    const want = new Set((propsRef.current.overlays ?? []).map((o) => o.id));
    for (const [id, marker] of shown) {
      if (want.has(id)) continue;
      map.remove(marker);
      shown.delete(id);
    }
    for (const o of propsRef.current.overlays ?? []) {
      if (shown.has(o.id)) continue;
      const tap = o.onClick;
      if (!tap) o.el.style.pointerEvents = "none";
      const marker = new AMap.Marker({ position: toGcj(o.at), content: o.el, anchor: "center", zIndex: SHOUT_Z - 5, bubble: true });
      if (tap) {
        // as a guide's: the map's own click that follows is not a tap on the map
        marker.on("click", () => {
          if (propsRef.current.placing) return;
          lastHitRef.current = Date.now();
          window.setTimeout(tap, 0);
        });
      }
      map.add(marker);
      shown.set(o.id, marker);
    }
  };

  const drawTrail = () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    if (trailRef.current.length) map.remove(trailRef.current);
    trailRef.current = amapTrail(AMap, propsRef.current.trail);
    if (trailRef.current.length) map.add(trailRef.current);
  };

  const drawLines = () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    if (linesRef.current.length) map.remove(linesRef.current);
    linesRef.current = amapLines(AMap, propsRef.current.lines ?? []);
    if (linesRef.current.length) map.add(linesRef.current);
  };

  const placeMine = async () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const seq = ++mineSeq.current;
    const { mine, mineAsleep, ghost, myAvatar, myColor, look } = propsRef.current;
    // a visitor's preview spot is drawn like a main roach of yours, faded
    const spots = ghost ? [...mine, { id: "ghost", slot: 0, publicId: "", ...ghost }] : mine;
    const hearts = heartModeOf(propsRef.current.mapStyle);
    const icons = await Promise.all(spots.map((r) => mineIcon(r, myAvatar, myColor, look, r.id === "ghost", mineAsleep, hearts)));
    if (seq !== mineSeq.current || mapRef.current !== map) return;
    if (mineRef.current.length) map.remove(mineRef.current);
    mineRef.current = spots.map((r, i) => {
      const marker = new AMap.Marker({
        position: toGcj(r),
        content: icons[i],
        offset: new AMap.Pixel(-MINE_ICON / 2, -MINE_ICON / 2),
        zIndex: 300,
        bubble: true,
      });
      marker.on("click", () => {
        // while placing, let the tap fall through to the map
        if (propsRef.current.placing) return;
        lastHitRef.current = Date.now();
        // close up, what lies on top of each other with it, by its middle (高德 tells no more of where the tap was);
        // a visitor's preview spot opens as before
        if (r.id !== "ghost") {
          const gcj = toGcj(r);
          const px = map.lngLatToContainer(gcj);
          if (stackRef.current.tap(px.getX(), px.getY(), { lng: r.lng, lat: r.lat }, gcj, { ref: { kind: "mine", id: r.id }, d: 0 })) return;
        }
        window.setTimeout(() => propsRef.current.onMineClick(r.id), 0);
      });
      return marker;
    });
    if (mineRef.current.length) map.add(mineRef.current);
  };

  useEffect(() => {
    let cancelled = false;
    let map: AMapNS = null;
    let crawlTimer = 0;
    let resumeTimer = 0;
    // 高德 tells of a bad or used-up key only in the console; a map that never finishes drawing is told too.
    // It refuses the key as the new map asks for its first tiles, after the map's complete event, so a
    // refusal within REFUSED_WITHIN_MS of making the map means it stays blank: the page's other map
    // instead, once. A later one leaves the map as it is (高德 counts a load when a map is made, and a
    // map drawn goes on working), so nobody in the middle of something is moved to another map.
    let madeAt = 0;
    let gaveUp = false;
    const stopListening = listenToAmapConsole(() => {
      if (gaveUp || cancelled || (madeAt && Date.now() - madeAt > REFUSED_WITHIN_MS)) return;
      gaveUp = true;
      if (propsRef.current.onFailed) propsRef.current.onFailed();
      else propsRef.current.onError?.(T.map.view.amapFailed);
    });
    let slowTimer = 0;
    const overlayMarkers = overlaysRef.current;
    const shoutMarkers = shoutsRef.current;
    const guideMarkers = guidesRef.current;

    loadAMap()
      .then(async (AMap) => {
        if (cancelled) return;
        const look = propsRef.current.look;
        styledRef.current = { look, urls: await styleUrls(look) };
        if (cancelled) return;
        amapRef.current = AMap;
        const { initialView } = propsRef.current;
        map = new AMap.Map(el.current, {
          center: toGcj(initialView),
          zoom: Math.max(2, Math.min(20, initialView.zoom + ZOOM_OFFSET)),
          zooms: [2, 20],
          viewMode: "2D",
          // 高德's own English labels on an English page
          lang: lang() === "zh" ? "zh_cn" : "en",
        });
        madeAt = Date.now();
        mapRef.current = map;
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: "RB" }));

        // Dark swarm over the cartoon icons so crowded cities read as covered in roaches, in 国度版 only: drawn
        // by the GPU, or by 高德's HeatMap where it cannot be (that one costs the phone dearly when zoomed far
        // out). The other styles build none of it, which is what makes 默认 the lightest to open.
        let swarmOn = false;
        // a new one for every start and stop, so a heat map plugin arriving late is not drawn after a stop
        let swarmSeq = 0;
        const amapHeat = (seq: number) =>
          // the plugin only comes when it is needed: 国度版 on a phone whose GPU layer cannot run
          AMap.plugin("AMap.HeatMap", () => {
            if (cancelled || seq !== swarmSeq) return;
            const heat = new AMap.HeatMap(map, { ...SWARM, zIndex: HEAT_Z });
            heat.setDataSet(heatData(swarmPoints(groupsRef.current)));
            heatRef.current = { set: (points) => heat.setDataSet(heatData(points)), destroy: () => heat.setMap(null) };
          });
        const startSwarm = () => {
          if (swarmOn) return;
          swarmOn = true;
          const seq = ++swarmSeq;
          const swarm = glOff()
            ? null
            : swarmGl(AMap, map, {
                ...SWARM,
                zIndex: HEAT_Z,
                onFail: (why) =>
                  window.setTimeout(() => {
                    if (cancelled || seq !== swarmSeq || heatRef.current !== gpuSwarm) return;
                    console.warn("swarm layer:", why);
                    gpuSwarm?.destroy();
                    heatRef.current = null;
                    amapHeat(seq);
                  }, 0),
              });
          const gpuSwarm: Swarm | null = swarm && { set: (points) => swarm.setPoints(points), destroy: swarm.destroy };
          if (gpuSwarm) {
            heatRef.current = gpuSwarm;
            gpuSwarm.set(swarmPoints(groupsRef.current));
          } else amapHeat(seq);
        };
        const stopSwarm = () => {
          if (!swarmOn) return;
          swarmOn = false;
          swarmSeq++;
          heatRef.current?.destroy();
          heatRef.current = null;
        };
        swarmRef.current = { start: startSwarm, stop: stopSwarm };
        regroup();
        if (propsRef.current.mapStyle === "nation") startSwarm();

        const onMassClick = (e: AMapNS) => {
          if (propsRef.current.placing) return;
          lastHitRef.current = Date.now();
          const id = e.data?.id;
          if (!id) return;
          // close up, what lies on top of each other with it, by its middle as drawn (高德 tells no more of where
          // the tap was)
          const ll = e.data.lnglat;
          const gcj: [number, number] | null = Array.isArray(ll) ? [ll[0], ll[1]] : ll?.getLng ? [ll.getLng(), ll.getLat()] : null;
          if (gcj) {
            const px = map.lngLatToContainer(gcj);
            const tapped = { ref: { kind: "roach", id } as const, d: 0 };
            if (stackRef.current.tap(px.getX(), px.getY(), fromGcj(gcj[0], gcj[1]), gcj, tapped)) return;
          }
          // defer so a map click fired for the same tap cannot clear the selection
          window.setTimeout(() => propsRef.current.onRoachClick(id), 0);
        };
        // The roaches on 高德's MassMarks: the realistic look, and wherever the GPU layer cannot run
        const startMass = () => {
          const { look, urls } = styledRef.current;
          // in 轻量 the piles stand in for them
          shownRef.current = propsRef.current.mapStyle === "lite" ? noGroups() : shownOf(map, groupsRef.current, propsRef.current.hiddenId ?? null);
          styledPxRef.current = massPx(map.getZoom());
          massRef.current = shownRef.current.map((points) => {
            const mass = new AMap.MassMarks(massData(points, map.getZoom(), look, null), {
              zIndex: massZ(look),
              zooms: [2, 20],
              cursor: "pointer",
              style: massStyles(AMap, map.getZoom(), urls),
            });
            mass.setMap(map);
            mass.on("click", onMassClick);
            return mass;
          });
        };
        const stopMass = () => {
          massRef.current.forEach((m) => m.setMap(null));
          massRef.current = [];
        };
        // The cartoon look's roaches all drawn by the GPU, every one of them at no cost per roach
        // (roachGl.ts); MassMarks once more if this phone or 高德 cannot
        let glBroke = glOff();
        // 舟u本色's hearts are drawn by the GPU layer, so without it this map cannot draw them
        if (glBroke) {
          propsRef.current.onHeartsUnavailable?.();
          propsRef.current.onNoGpuLayer?.();
        }
        const startGl = () => {
          const gl = roachGl(AMap, map, {
            zIndex: massZ("cartoon"),
            thinZoom: THIN_ZOOM,
            // the roaches drawn, but not their hearts: 舟u本色 is drawn as 默认 on this phone
            onHeartsFail: (why) => {
              console.warn("hearts:", why);
              propsRef.current.onHeartsUnavailable?.();
            },
            // not in the middle of 高德's own drawing
            onFail: (why) =>
              window.setTimeout(() => {
                if (glRef.current !== gl || cancelled) return;
                glBroke = true;
                propsRef.current.onHeartsUnavailable?.();
                propsRef.current.onNoGpuLayer?.();
                console.warn("roach layer:", why);
                layRef.current();
                // 轻量's piles, as 高德's own markers from now on
                if (pilesRef.current) showPilesRef.current(pileItemsRef.current);
              }, 0),
          });
          if (!gl) {
            glBroke = true;
            propsRef.current.onHeartsUnavailable?.();
            propsRef.current.onNoGpuLayer?.();
            return false;
          }
          glRef.current = gl;
          gl.setCrawl(!prefersReducedMotion());
          gl.setHearts(heartModeOf(propsRef.current.mapStyle));
          gl.setRoaches(glList());
          gl.setHidden(propsRef.current.hiddenId ?? null);
          return true;
        };
        layRef.current = () => {
          const { look, urls } = styledRef.current;
          crawlRef.current?.stop();
          if (look === "cartoon" && !glBroke && (glRef.current || startGl())) {
            stopMass();
            void glRef.current!.setIcons(urls);
          } else {
            glRef.current?.destroy();
            glRef.current = null;
            overRef.current = false;
            if (!massRef.current.length) startMass();
            else {
              styledPxRef.current = massPx(map.getZoom());
              const style = massStyles(AMap, map.getZoom(), urls);
              massRef.current.forEach((m, g) => {
                m.setzIndex(massZ(look));
                m.setStyle(style);
                m.setData(massData(shownRef.current[g], map.getZoom(), look, null));
              });
            }
          }
          crawlRef.current?.start();
        };
        // a new style for the 7 layers only when the icons' size changes (it stops changing past city level)
        map.on("zoomchange", () => {
          if (!massRef.current.length) return;
          const px = massPx(map.getZoom());
          if (px === styledPxRef.current) return;
          styledPxRef.current = px;
          const style = massStyles(AMap, map.getZoom(), styledRef.current.urls);
          massRef.current.forEach((m) => m.setStyle(style));
        });

        // Redraw one batch per tick, round robin, to keep each frame light. Not while the map moves: each
        // batch has 高德 draw the whole map again, on top of what a drag or a zoom asks of it, and on a
        // phone that is what makes dragging stutter. They crawl on as soon as the map stands still.
        // The GPU layer crawls by itself on every frame 高德 draws; standing still, it asks for frames.
        let tick = 0;
        let moving = false;
        let dragging = false;
        // the roaches near where the map stands now, each where its crawl has it (sleeping ones lie still);
        // the GPU layer has all of them already
        reshowRef.current = () => {
          if (glRef.current || !massRef.current.length) return;
          // in 轻量 the piles stand in for them
          shownRef.current = propsRef.current.mapStyle === "lite" ? noGroups() : shownOf(map, groupsRef.current, propsRef.current.hiddenId ?? null);
          const crawling = propsRef.current.active !== false && !prefersReducedMotion();
          const now = performance.now();
          const { look } = styledRef.current;
          massRef.current.forEach((m, g) => m.setData(massData(shownRef.current[g], map.getZoom(), look, crawling && g !== STILL ? now : null)));
        };
        const resumeIn = (ms: number) => {
          window.clearTimeout(resumeTimer);
          resumeTimer = window.setTimeout(() => {
            moving = false;
            dragging = false;
            // only once the map stands still: a busy phone hears moveend in the middle of a drag too
            reshowRef.current();
            crawlRef.current?.start();
          }, ms);
        };
        const halt = () => {
          moving = true;
          crawlRef.current?.stop();
          resumeIn(MOVE_QUIET_MS);
        };
        // still moving: put off the crawl again (in case the end of the move is never told)
        const still = () => moving && resumeIn(MOVE_QUIET_MS);
        // A busy phone hears of a drag mostly as dragging: 高德 then says the map stopped (moveend)
        // between two steps of the finger, so only the end of the drag counts. Let go, the map may
        // slide on (movestart … moveend) before they crawl again.
        const ended = () => moving && !dragging && resumeIn(MOVE_SETTLE_MS);
        map.on("dragstart", () => {
          dragging = true;
          halt();
        });
        map.on("dragging", still);
        map.on("dragend", () => {
          dragging = false;
          ended();
        });
        map.on("movestart", halt);
        map.on("zoomstart", halt);
        // whether the map feels slow is told by its frames while it moves (src/lib/lag.ts)
        for (const [event, on] of [["movestart", true], ["zoomstart", true], ["moveend", false], ["zoomend", false]] as const) {
          map.on(event, () => propsRef.current.onMoving?.(on));
        }
        map.on("mapmove", still);
        map.on("zoomchange", still);
        map.on("moveend", ended);
        map.on("zoomend", ended);
        crawlRef.current = {
          start: () => {
            // nothing crawls in 全员隐匿 or 轻量
            const style = propsRef.current.mapStyle;
            if (moving || propsRef.current.active === false || prefersReducedMotion() || style === "hidden" || style === "lite") return;
            if (glRef.current) return glRef.current.tick(true);
            if (crawlTimer) return;
            crawlTimer = window.setInterval(() => {
              const g = tick++ % MASS_GROUPS;
              const { look } = styledRef.current;
              massRef.current[g]?.setData(massData(shownRef.current[g], map.getZoom(), look, performance.now()));
            }, 25);
          },
          stop: () => {
            glRef.current?.tick(false);
            window.clearInterval(crawlTimer);
            crawlTimer = 0;
          },
        };
        layRef.current();
        // 轻量 from the start: piles once the GPU layer has the roaches
        // 轻量's piles where the GPU layer cannot run: 高德's own LabelMarkers, a few hundred at most, each a
        // pile's icon at its size with its count beside it
        let pileLayer: AMapNS | null = null;
        const tapPile = (it: PileItem) => {
          lastHitRef.current = Date.now();
          if (typeof it.ref === "string") {
            const id = it.ref;
            window.setTimeout(() => propsRef.current.onRoachClick(id), 0);
            return;
          }
          void pilesRef.current?.expand(it.ref).then((z) => {
            if (mapRef.current !== map) return;
            map.setZoomAndCenter(Math.min(20, Math.max(map.getZoom() + 0.5, z + 0.05 + ZOOM_OFFSET)), [it.lng, it.lat], false, 650);
          });
        };
        const pileMarkers = (items: PileItem[]) => {
          if (!pileLayer) {
            pileLayer = new AMap.LabelsLayer({ zooms: [2, 20], zIndex: massZ("cartoon"), collision: false, allowCollision: true });
            map.add(pileLayer);
          }
          pileLayer.clear();
          const { urls } = styledRef.current;
          const size = iconPx(map.getZoom() - ZOOM_OFFSET);
          const hidden = propsRef.current.hiddenId ?? null;
          const markers: AMapNS[] = [];
          items.forEach((it, i) => {
            if (it.ref === hidden || !urls[it.style]) return;
            const w = Math.round(Math.min(size * pileMul(it.n), Math.max(size, PILE_MAX_PX)));
            const marker = new AMap.LabelMarker({
              position: [it.lng, it.lat],
              // drawn in the order they came: the southern ones, then 触须之交, on top
              zIndex: i,
              icon: { type: "image", image: urls[it.style], size: [w, w], anchor: "center" },
              ...(it.n > 1
                ? {
                    text: {
                      content: countBadgeText(it.n),
                      direction: "center",
                      offset: [Math.round(BADGE_AT[0] * w), Math.round(BADGE_AT[1] * w)],
                      style: { fontSize: 11, fontWeight: "bold", fillColor: "#ffffff", backgroundColor: "#1b1d22", borderColor: "#ffffff", borderWidth: 1, padding: [1, 5] },
                    },
                  }
                : {}),
            });
            marker.on("click", () => !propsRef.current.placing && tapPile(it));
            markers.push(marker);
          });
          pileLayer.add(markers);
        };
        showPilesRef.current = (items) => {
          if (glRef.current) {
            glRef.current.setPiles(items);
            return;
          }
          if (items) pileMarkers(items);
          else pileLayer?.clear();
        };
        // a pile's size follows the zoom
        map.on("zoomend", () => {
          if (pilesRef.current && !glRef.current) pileMarkers(pileItemsRef.current);
        });
        const mode = propsRef.current.mapStyle === "hidden" ? "off" : propsRef.current.mapStyle === "lite" ? "lite" : "all";
        crowdWasRef.current = mode;
        if (mode === "lite") {
          if (!glRef.current) {
            shownRef.current = noGroups();
            massRef.current.forEach((m) => m.setData([]));
          }
          startPiles();
        }
        // 轻量's piles asked for again as the view moves: as it ends, and every 150 ms meanwhile
        let pilesAskedAt = 0;
        const pilesMeanwhile = () => {
          if (!pilesRef.current || performance.now() - pilesAskedAt < 150) return;
          pilesAskedAt = performance.now();
          askPiles(map, pilesRef.current);
        };
        const pilesNow = () => askPiles(map, pilesRef.current);
        map.on("mapmove", pilesMeanwhile);
        map.on("zoomchange", pilesMeanwhile);
        map.on("moveend", pilesNow);
        map.on("zoomend", pilesNow);

        placeMine();
        drawTrail();
        drawLines();
        // 两面包夹芝士 around Japan, under the roaches
        amapSandwich(AMap, map, ZOOM_OFFSET);
        // 祀掌柜's 缘缘庄: the inn, its queue and its ink roaches, under the roaches too
        siRef.current = amapSi(AMap, map, ZOOM_OFFSET, propsRef.current.si, (why) => console.warn("ink layer:", why));
        siRef.current.setActive(propsRef.current.active !== false);

        syncGuides();
        map.on("zoomchange", syncGuides);
        syncShouts();
        syncOverlays();

        map.on("click", (e: AMapNS) => {
          if (Date.now() - lastHitRef.current < 300) return;
          // the GPU layer's roaches are found here, being no markers of 高德's
          const gl = glRef.current;
          const hit = gl && !propsRef.current.placing ? gl.hit(e.pixel.getX(), e.pixel.getY()) : null;
          // close up: the one nearest the finger, or those lying on top of each other to pick from (src/lib/stackPick.ts);
          // a tap on the MassMarks' roaches is theirs to tell (onMassClick)
          if ((hit === null || typeof hit === "string") && (gl || !massRef.current.length)) {
            const gcj: [number, number] = [e.lnglat.getLng(), e.lnglat.getLat()];
            if (stackRef.current.tap(e.pixel.getX(), e.pixel.getY(), fromGcj(...gcj), gcj)) return;
          }
          if (typeof hit === "string") {
            lastHitRef.current = Date.now();
            window.setTimeout(() => propsRef.current.onRoachClick(hit), 0);
            return;
          }
          // 缘缘庄's ink roaches, under the real ones
          const onInk = propsRef.current.onInkClick;
          const ink = !hit && onInk && !propsRef.current.placing ? (siRef.current?.hit(e.pixel.getX(), e.pixel.getY()) ?? null) : null;
          if (ink && onInk) {
            lastHitRef.current = Date.now();
            window.setTimeout(() => onInk(ink), 0);
            return;
          }
          // 轻量: a pile opens up, the map zooming in on it to where it comes apart
          if (hit && pilesRef.current) {
            lastHitRef.current = Date.now();
            void pilesRef.current.expand(hit.pile).then((z) => {
              const m = mapRef.current;
              if (!m) return;
              m.setZoomAndCenter(Math.min(20, Math.max(m.getZoom() + 0.5, z + 0.05 + ZOOM_OFFSET)), [hit.lng, hit.lat], false, 650);
            });
            return;
          }
          propsRef.current.onMapClick(fromGcj(e.lnglat.getLng(), e.lnglat.getLat()));
        });
        // with a mouse, the hand over a roach as MassMarks showed it
        let hoverAt = 0;
        map.on("mousemove", (e: AMapNS) => {
          const gl = glRef.current;
          if (!gl || propsRef.current.placing || Date.now() - hoverAt < 80) return;
          hoverAt = Date.now();
          const over = gl.hit(e.pixel.getX(), e.pixel.getY()) !== null;
          if (over === overRef.current) return;
          overRef.current = over;
          map.setDefaultCursor(over ? "pointer" : "default");
        });

        const reportView = () => {
          const c = map.getCenter();
          const b = map.getBounds();
          const sw = b.getSouthWest();
          const ne = b.getNorthEast();
          propsRef.current.onViewChange(
            { ...fromGcj(c.getLng(), c.getLat()), zoom: map.getZoom() - ZOOM_OFFSET },
            [fromGcj(sw.getLng(), sw.getLat()), fromGcj(ne.getLng(), ne.getLat())],
          );
        };
        map.on("moveend", reportView);
        map.on("zoomend", reportView);
        map.on("complete", reportView);
        // drawn for the first time, and turned or resized (a phone on its side): the roaches near the view now
        map.on("complete", () => reshowRef.current());
        map.on("resize", () => reshowRef.current());
        map.on("complete", () => propsRef.current.onReady?.());
        slowTimer = window.setTimeout(() => reportMapTrouble("amap", "slow"), 20000);
        map.on("complete", () => window.clearTimeout(slowTimer));
      })
      .catch((e: unknown) => {
        if (cancelled || gaveUp) return;
        gaveUp = true;
        console.error(e);
        reportMapTrouble("amap", "load", e instanceof Error ? e.name : typeof e === "string" ? e : "");
        if (propsRef.current.onFailed) propsRef.current.onFailed();
        else propsRef.current.onError?.(T.map.view.amapFailed);
      });

    return () => {
      cancelled = true;
      stopListening();
      window.clearTimeout(slowTimer);
      window.clearInterval(crawlTimer);
      window.clearTimeout(resumeTimer);
      crawlRef.current = null;
      layRef.current = () => {};
      glRef.current?.destroy();
      glRef.current = null;
      siRef.current?.destroy();
      siRef.current = null;
      massRef.current.forEach((m) => m.setMap(null));
      massRef.current = [];
      heatRef.current?.destroy();
      heatRef.current = null;
      swarmRef.current = null;
      mineRef.current = [];
      trailRef.current = [];
      linesRef.current = [];
      guideMarkers.clear();
      shoutMarkers.clear();
      overlayMarkers.clear();
      map?.destroy();
      mapRef.current = null;
    };
  }, []);

  // An update of the list: only the roaches that changed are worked out again (MassCache). The way the crowd is
  // drawn: every roach; 轻量's piles (on the GPU layer), put together again in the background as the list
  // changes, the full list for the GPU then not made at all; or 全员隐匿, none, the updates waiting for the way back.
  const crowdMode = props.mapStyle === "hidden" ? "off" : props.mapStyle === "lite" ? "lite" : "all";
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const was = crowdWasRef.current;
    if (crowdMode === "off" && was === "off") return;
    regroup();
    const gl = glRef.current;
    const mode = crowdMode;
    crowdWasRef.current = mode;
    if (mode === "lite") {
      // where the GPU layer cannot run, the piles stand in for MassMarks
      if (!gl && was !== "lite") {
        shownRef.current = noGroups();
        massRef.current.forEach((m) => m.setData([]));
      }
      startPiles();
    } else {
      if (was === "lite") stopPiles();
      if (gl) gl.setRoaches(glList());
      else {
        shownRef.current = shownOf(map, groupsRef.current, propsRef.current.hiddenId ?? null);
        const z = map.getZoom();
        massRef.current.forEach((m, g) => m.setData(massData(shownRef.current[g], z, styledRef.current.look, null)));
      }
    }
    heatRef.current?.set(swarmPoints(groupsRef.current));
    if (mode !== was) {
      if (mode === "all") crawlRef.current?.start();
      else crawlRef.current?.stop();
    }
  }, [props.roaches, crowdMode]);

  // One roach off stage while a touch scene plays over the map: left out where it is drawn, nothing worked out again
  const hiddenId = props.hiddenId ?? null;
  const hiddenWasRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    const was = hiddenWasRef.current;
    hiddenWasRef.current = hiddenId;
    if (!map) return;
    if (glRef.current) return glRef.current.setHidden(hiddenId);
    // 轻量 as 高德's own markers: drawn again without it
    if (pilesRef.current) return showPilesRef.current(pileItemsRef.current);
    if (!massRef.current.length) return;
    // MassMarks: only the batches it and the one before are in are handed over again
    const touched = new Set(
      [was, hiddenId].flatMap((id) => (id ? [groupsRef.current.findIndex((g) => g.some((p) => p.id === id))] : [])).filter((g) => g >= 0),
    );
    if (!touched.size) return;
    shownRef.current = shownOf(map, groupsRef.current, hiddenId);
    const z = map.getZoom();
    for (const g of touched) massRef.current[g]?.setData(massData(shownRef.current[g], z, styledRef.current.look, null));
  }, [hiddenId]);

  // 地图画风: the dark swarm made or dropped, and the hearts, as the style changes, without a reload
  useEffect(() => {
    if (props.mapStyle === "nation") swarmRef.current?.start();
    else swarmRef.current?.stop();
    glRef.current?.setHearts(heartModeOf(props.mapStyle));
  }, [props.mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let stale = false;
    const look = props.look;
    styleUrls(look).then((urls) => {
      if (stale || mapRef.current !== map) return;
      styledRef.current = { look, urls };
      layRef.current();
    });
    return () => {
      stale = true;
    };
  }, [props.look]);

  // your own roaches are put down again only when they really change: the page hands over a new list
  // each time it draws, and 高德 redraws the map for each marker taken off and put back
  const mineKey = JSON.stringify([props.mine, props.mineAsleep, props.ghost, props.myAvatar, props.myColor, props.look, props.mapStyle === "hearts"]);
  useEffect(() => {
    placeMine();
  }, [mineKey]);

  const main = props.mine.find((r) => r.slot === 0);
  const guidesKey = `${JSON.stringify(props.guides)}|${main ? `${main.lng},${main.lat}` : ""}`;
  useEffect(syncGuides, [guidesKey]);
  const shoutsKey = props.shouts.map((s) => s.id).join("|");
  useEffect(syncShouts, [shoutsKey]);
  const overlaysKey = (props.overlays ?? []).map((o) => o.id).join("|");
  useEffect(syncOverlays, [overlaysKey]);

  const trailKey = JSON.stringify(props.trail);
  useEffect(drawTrail, [trailKey]);
  const linesKey = JSON.stringify(props.lines ?? []);
  useEffect(drawLines, [linesKey]);

  // 缘缘庄: only what changed (its numbers, the ink roaches in view, your own, today's painting)
  const siInnKey = props.si?.innKey ?? "";
  useEffect(() => siRef.current?.set(propsRef.current.si, { inn: true }), [siInnKey]);
  const siInksKey = props.si?.inksKey ?? 0;
  useEffect(() => siRef.current?.set(propsRef.current.si, { inks: true }), [siInksKey]);
  const siMineKey = props.si?.mineKey ?? "";
  useEffect(() => siRef.current?.set(propsRef.current.si, { mine: true }), [siMineKey]);
  const siTier = props.si?.tier ?? 0;
  useEffect(() => siRef.current?.set(propsRef.current.si, { tier: true }), [siTier]);

  useEffect(() => {
    overRef.current = false;
    mapRef.current?.setDefaultCursor(props.placing ? "crosshair" : "default");
  }, [props.placing]);

  useEffect(() => {
    const f = props.focus;
    // a hidden map leaves the flying to the one on show
    if (f && mapRef.current && propsRef.current.active !== false) mapRef.current.setZoomAndCenter(f.zoom + ZOOM_OFFSET, toGcj(f));
  }, [props.focus]);

  useEffect(() => {
    const j = props.jump;
    if (!j || !mapRef.current) return;
    mapRef.current.setZoomAndCenter(j.zoom + ZOOM_OFFSET, toGcj(j), true);
    // a jump need not say that the map moved: the roaches of the new place, all the same
    reshowRef.current();
  }, [props.jump]);

  useEffect(() => {
    siRef.current?.setActive(props.active !== false);
    if (props.active === false) crawlRef.current?.stop();
    else {
      reshowRef.current();
      crawlRef.current?.start();
    }
  }, [props.active]);

  return <div ref={el} className="map" data-basemap="amap" />;
}
