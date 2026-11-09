"use client";

import { useEffect, useRef } from "react";
import type { GuideId } from "@/lib/guides";
import { loadAMap, type AMapNS } from "@/lib/amap";
import { fromGcj, toGcj } from "@/lib/coords";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl, type RoachOpts } from "@/lib/roachSvg";
import {
  crawl,
  HEADINGS,
  iconPx,
  LEG_FRAMES,
  MASS_GROUPS,
  prefersReducedMotion,
  SWARM_FADE_ZOOM,
  SWARM_GRADIENT,
} from "@/lib/swarm";
import { ROACH_AVATARS, ROACH_COLORS, type LngLat, type RoachAvatar, type RoachColor, type RoachStyle } from "@/lib/types";
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
import { listenToAmapConsole, reportMapTrouble } from "./report";
import { amapSandwich } from "./sandwich";
import { SHOUT_LIFT, shoutElement } from "./shoutMarker";
import { amapTrail } from "./trail";
import { roachTraits, type MapViewProps } from "./types";

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
const massZ = (look: RoachStyle) => (look === "real" ? 130 : 120);
const MINE_ICON = 48;
/** The guides: above your own roaches (300) */
const GUIDE_Z = 320;
/** A shout's bubble: over the guides too, as it is the latest thing you did */
const SHOUT_Z = 330;

// MassMarks draws thousands of points on one canvas, unlike DOM markers.
// Roaches are split into batches, each with its own MassMarks redrawn in turn;
// every roach moves on its own rhythm. Style indexes: cartoon = one per look
// and color, then one shared clone look, then the same again for 触须之交;
// real = pre-rendered heading, then see-through clone headings, then both
// again for 触须之交, and that whole block once per walk-cycle pose.
type MassPoint = {
  lng: number;
  lat: number;
  cos: number;
  id: string;
  /** index into the cartoon looks: avatar * colors + color */
  color: number;
  heading: number;
  clone: boolean;
  friend: boolean;
  asleep: boolean;
  seed: number;
};

const LOOKS = ROACH_AVATARS.length * ROACH_COLORS.length;
const CARTOON_STYLES = LOOKS + 1;
const REAL_STYLES = HEADINGS.length * 2;
const REAL_POSE = REAL_STYLES * 2;
/** Where the sleeping icons start in each look's style list, after the awake ones */
const asleepFrom = (look: RoachStyle) => (look === "real" ? REAL_POSE * LEG_FRAMES : CARTOON_STYLES * 2);
/** The batch the crawl never moves: sleeping roaches lie still */
const STILL = MASS_GROUPS;

function massGroups(roaches: PublicRoach[]): MassPoint[][] {
  const groups: MassPoint[][] = Array.from({ length: MASS_GROUPS + 1 }, () => []);
  for (const r of roaches) {
    const [lng, lat] = toGcj(r);
    const t = roachTraits(r.id, MASS_GROUPS, HEADINGS.length);
    groups[r.asleep ? STILL : t.group].push({
      lng,
      lat,
      cos: Math.cos((lat * Math.PI) / 180),
      id: r.id,
      // the shared list only ever holds the looks players pick
      color: ROACH_AVATARS.indexOf(r.avatar as RoachAvatar) * ROACH_COLORS.length + ROACH_COLORS.indexOf(r.color),
      heading: t.headingIndex,
      clone: r.clone,
      friend: r.friend,
      asleep: Boolean(r.asleep),
      seed: t.seed,
    });
  }
  // MassMarks paints in order, so 触须之交 go last to sit on top
  for (const g of groups) g.sort((a, b) => Number(a.friend) - Number(b.friend));
  return groups;
}

function styleIndex(p: MassPoint, look: RoachStyle, pose: number) {
  if (p.asleep) return asleepFrom(look) + (look === "real" ? (p.friend ? HEADINGS.length : 0) + p.heading : (p.friend ? LOOKS : 0) + p.color);
  if (look === "real") return pose * REAL_POSE + (p.friend ? REAL_STYLES : 0) + (p.clone ? HEADINGS.length : 0) + p.heading;
  return (p.friend ? CARTOON_STYLES : 0) + (p.clone ? LOOKS : p.color);
}

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
    const block = (step?: number) =>
      [false, true].flatMap((friend): [RoachColor, RoachOpts][] =>
        look === "real"
          ? [
              ...HEADINGS.map((rotate): [RoachColor, RoachOpts] => ["cyan", { look, rotate, friend, step }]),
              ...HEADINGS.map((rotate): [RoachColor, RoachOpts] => ["cyan", { look, rotate, friend, clone: true, step }]),
            ]
          : [
              ...ROACH_AVATARS.flatMap((avatar) =>
                ROACH_COLORS.map((color): [RoachColor, RoachOpts] => [color, { avatar, friend }]),
              ),
              ["white", { friend, clone: true }],
            ],
      );
    const awake = look === "real" ? Array.from({ length: LEG_FRAMES }, (_, f) => block(f / LEG_FRAMES)).flat() : block();
    // then the sleeping main roaches (asleepFrom), still and with no clones
    const asleep = [false, true].flatMap((friend): [RoachColor, RoachOpts][] =>
      look === "real"
        ? HEADINGS.map((rotate): [RoachColor, RoachOpts] => ["cyan", { look, rotate, friend, asleep: true }])
        : ROACH_AVATARS.flatMap((avatar) =>
            ROACH_COLORS.map((color): [RoachColor, RoachOpts] => [color, { avatar, friend, asleep: true }]),
          ),
    );
    p = Promise.all([...awake, ...asleep].map(([color, opts]) => iconUrl(color, opts)));
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

function heatData(roaches: PublicRoach[]) {
  return {
    data: roaches.map((r) => {
      const [lng, lat] = toGcj(r);
      return { lng, lat, count: 1 };
    }),
    max: 12,
  };
}

async function mineIcon(r: OwnRoach, avatar: RoachAvatar, color: RoachColor, look: RoachStyle, ghost: boolean, asleep: boolean) {
  const url = await iconUrl(color, { avatar, mine: true, clone: r.slot > 0, look, asleep: asleep && r.slot === 0 && !ghost });
  const label = ghost ? "放在这里" : r.slot > 0 ? "我的克隆体" : "我的蟑螂";
  return `<img src="${url}" width="${MINE_ICON}" height="${MINE_ICON}" alt="${label}" style="cursor:pointer${ghost ? ";opacity:.55" : ""}"/>`;
}

export default function AmapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapNS>(null);
  const massRef = useRef<AMapNS[]>([]);
  const groupsRef = useRef<MassPoint[][]>([]);
  const heatRef = useRef<AMapNS>(null);
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
  // the roaches' crawl, which a hidden map stops
  const crawlRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  /** The icon size the roach layers were last styled for */
  const styledPxRef = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;

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
          window.setTimeout(() => propsRef.current.onRoachClick(mark.id), 0);
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

  // Elements the page places on the map (⚡舟友的酒⚡'s dance floor), moved with it
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
      o.el.style.pointerEvents = "none";
      const marker = new AMap.Marker({ position: toGcj(o.at), content: o.el, anchor: "center", zIndex: SHOUT_Z - 5, bubble: true });
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

  const placeMine = async () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const seq = ++mineSeq.current;
    const { mine, mineAsleep, ghost, myAvatar, myColor, look } = propsRef.current;
    // a visitor's preview spot is drawn like a main roach of yours, faded
    const spots = ghost ? [...mine, { id: "ghost", slot: 0, publicId: "", ...ghost }] : mine;
    const icons = await Promise.all(spots.map((r) => mineIcon(r, myAvatar, myColor, look, r.id === "ghost", mineAsleep)));
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
      else propsRef.current.onError?.("高德底图加载失败，请检查 Key 和安全密钥，或切换到 OSM 底图。");
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
          lang: "zh_cn",
        });
        madeAt = Date.now();
        mapRef.current = map;
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar({ position: "RB" }));

        // Dark swarm under the icons so crowded cities read as covered in roaches
        const heat = new AMap.HeatMap(map, {
          radius: 22,
          zIndex: HEAT_Z,
          opacity: [0, 0.85],
          gradient: SWARM_GRADIENT,
          zooms: [2, SWARM_FADE_ZOOM + ZOOM_OFFSET],
        });
        heat.setDataSet(heatData(propsRef.current.roaches));
        heatRef.current = heat;

        groupsRef.current = massGroups(propsRef.current.roaches);
        const onMassClick = (e: AMapNS) => {
          if (propsRef.current.placing) return;
          lastHitRef.current = Date.now();
          const id = e.data?.id;
          // defer so a map click fired for the same tap cannot clear the selection
          if (id) window.setTimeout(() => propsRef.current.onRoachClick(id), 0);
        };
        styledPxRef.current = massPx(map.getZoom());
        massRef.current = groupsRef.current.map((points) => {
          const mass = new AMap.MassMarks(massData(points, map.getZoom(), look, null), {
            zIndex: massZ(look),
            zooms: [2, 20],
            cursor: "pointer",
            style: massStyles(AMap, map.getZoom(), styledRef.current.urls),
          });
          mass.setMap(map);
          mass.on("click", onMassClick);
          return mass;
        });
        // a new style for the 7 layers only when the icons' size changes (it stops changing past city level)
        map.on("zoomchange", () => {
          const px = massPx(map.getZoom());
          if (px === styledPxRef.current) return;
          styledPxRef.current = px;
          const style = massStyles(AMap, map.getZoom(), styledRef.current.urls);
          massRef.current.forEach((m) => m.setStyle(style));
        });

        // Redraw one batch per tick, round robin, to keep each frame light. Not while the map moves: each
        // batch has 高德 draw the whole map again, on top of what a drag or a zoom asks of it, and on a
        // phone that is what makes dragging stutter. They crawl on as soon as the map stands still.
        let tick = 0;
        let moving = false;
        let dragging = false;
        const resumeIn = (ms: number) => {
          window.clearTimeout(resumeTimer);
          resumeTimer = window.setTimeout(() => {
            moving = false;
            dragging = false;
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
        map.on("mapmove", still);
        map.on("zoomchange", still);
        map.on("moveend", ended);
        map.on("zoomend", ended);
        crawlRef.current = {
          start: () => {
            if (crawlTimer || moving || propsRef.current.active === false || prefersReducedMotion()) return;
            crawlTimer = window.setInterval(() => {
              const g = tick++ % MASS_GROUPS;
              const { look } = styledRef.current;
              massRef.current[g]?.setData(massData(groupsRef.current[g], map.getZoom(), look, performance.now()));
            }, 25);
          },
          stop: () => {
            window.clearInterval(crawlTimer);
            crawlTimer = 0;
          },
        };
        crawlRef.current.start();

        placeMine();
        drawTrail();
        // 两面包夹芝士 around Japan, under the roaches
        amapSandwich(AMap, map, ZOOM_OFFSET);

        syncGuides();
        map.on("zoomchange", syncGuides);
        syncShouts();
        syncOverlays();

        map.on("click", (e: AMapNS) => {
          if (Date.now() - lastHitRef.current < 300) return;
          propsRef.current.onMapClick(fromGcj(e.lnglat.getLng(), e.lnglat.getLat()));
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
        else propsRef.current.onError?.("高德底图加载失败，请检查 Key 和安全密钥，或切换到 OSM 底图。");
      });

    return () => {
      cancelled = true;
      stopListening();
      window.clearTimeout(slowTimer);
      window.clearInterval(crawlTimer);
      window.clearTimeout(resumeTimer);
      crawlRef.current = null;
      massRef.current.forEach((m) => m.setMap(null));
      massRef.current = [];
      heatRef.current = null;
      mineRef.current = [];
      trailRef.current = [];
      guideMarkers.clear();
      shoutMarkers.clear();
      overlayMarkers.clear();
      map?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    groupsRef.current = massGroups(props.roaches);
    const z = mapRef.current.getZoom();
    massRef.current.forEach((m, g) => m.setData(massData(groupsRef.current[g], z, styledRef.current.look, null)));
    heatRef.current?.setDataSet(heatData(props.roaches));
  }, [props.roaches]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap) return;
    let stale = false;
    const look = props.look;
    styleUrls(look).then((urls) => {
      if (stale || mapRef.current !== map) return;
      styledRef.current = { look, urls };
      styledPxRef.current = massPx(map.getZoom());
      const style = massStyles(AMap, map.getZoom(), urls);
      massRef.current.forEach((m, g) => {
        m.setzIndex(massZ(look));
        m.setStyle(style);
        m.setData(massData(groupsRef.current[g], map.getZoom(), look, null));
      });
    });
    return () => {
      stale = true;
    };
  }, [props.look]);

  // your own roaches are put down again only when they really change: the page hands over a new list
  // each time it draws, and 高德 redraws the map for each marker taken off and put back
  const mineKey = JSON.stringify([props.mine, props.mineAsleep, props.ghost, props.myAvatar, props.myColor, props.look]);
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

  useEffect(() => {
    mapRef.current?.setDefaultCursor(props.placing ? "crosshair" : "default");
  }, [props.placing]);

  useEffect(() => {
    const f = props.focus;
    // a hidden map leaves the flying to the one on show
    if (f && mapRef.current && propsRef.current.active !== false) mapRef.current.setZoomAndCenter(f.zoom + ZOOM_OFFSET, toGcj(f));
  }, [props.focus]);

  useEffect(() => {
    const j = props.jump;
    if (j && mapRef.current) mapRef.current.setZoomAndCenter(j.zoom + ZOOM_OFFSET, toGcj(j), true);
  }, [props.jump]);

  useEffect(() => {
    if (props.active === false) crawlRef.current?.stop();
    else crawlRef.current?.start();
  }, [props.active]);

  return <div ref={el} className="map" data-basemap="amap" />;
}
