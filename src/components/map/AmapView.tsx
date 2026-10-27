"use client";

import { useEffect, useRef } from "react";
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
import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor, type RoachStyle } from "@/lib/types";
import type { OwnRoach, PublicRoach } from "@/lib/world/types";
import { roachTraits, type MapViewProps } from "./types";

// Amap zoom levels assume 256px tiles, one level above MapLibre
const ZOOM_OFFSET = 1;
// The shadow sits on top of cartoon roaches so crowds go solid black, but under
// real ones so their brown bodies stay visible
const HEAT_Z = 125;
const massZ = (look: RoachStyle) => (look === "real" ? 130 : 120);
const MINE_ICON = 48;

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
  seed: number;
};

const LOOKS = ROACH_AVATARS.length * ROACH_COLORS.length;
const CARTOON_STYLES = LOOKS + 1;
const REAL_STYLES = HEADINGS.length * 2;
const REAL_POSE = REAL_STYLES * 2;

function massGroups(roaches: PublicRoach[]): MassPoint[][] {
  const groups: MassPoint[][] = Array.from({ length: MASS_GROUPS }, () => []);
  for (const r of roaches) {
    const [lng, lat] = toGcj(r);
    const t = roachTraits(r.id, MASS_GROUPS, HEADINGS.length);
    groups[t.group].push({
      lng,
      lat,
      cos: Math.cos((lat * Math.PI) / 180),
      id: r.id,
      color: ROACH_AVATARS.indexOf(r.avatar) * ROACH_COLORS.length + ROACH_COLORS.indexOf(r.color),
      heading: t.headingIndex,
      clone: r.clone,
      friend: r.friend,
      seed: t.seed,
    });
  }
  // MassMarks paints in order, so 触须之交 go last to sit on top
  for (const g of groups) g.sort((a, b) => Number(a.friend) - Number(b.friend));
  return groups;
}

function styleIndex(p: MassPoint, look: RoachStyle, pose: number) {
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
    const specs = look === "real" ? Array.from({ length: LEG_FRAMES }, (_, f) => block(f / LEG_FRAMES)).flat() : block();
    p = Promise.all(specs.map(([color, opts]) => iconUrl(color, opts)));
    styleUrlCache.set(look, p);
  }
  return p;
}

function massStyles(AMap: AMapNS, amapZoom: number, urls: string[]) {
  const px = Math.round(iconPx(amapZoom - ZOOM_OFFSET));
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

async function mineIcon(r: OwnRoach, avatar: RoachAvatar, color: RoachColor, look: RoachStyle, ghost = false) {
  const url = await iconUrl(color, { avatar, mine: true, clone: r.slot > 0, look });
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
  const propsRef = useRef(props);
  propsRef.current = props;

  const placeMine = async () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    const seq = ++mineSeq.current;
    const { mine, ghost, myAvatar, myColor, look } = propsRef.current;
    // a visitor's preview spot is drawn like a main roach of yours, faded
    const spots = ghost ? [...mine, { id: "ghost", slot: 0, publicId: "", ...ghost }] : mine;
    const icons = await Promise.all(spots.map((r) => mineIcon(r, myAvatar, myColor, look, r.id === "ghost")));
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
        map.on("zoomchange", () => {
          const style = massStyles(AMap, map.getZoom(), styledRef.current.urls);
          massRef.current.forEach((m) => m.setStyle(style));
        });

        // Redraw one batch per tick, round robin, to keep each frame light
        let tick = 0;
        if (!prefersReducedMotion()) {
          crawlTimer = window.setInterval(() => {
            const g = tick++ % MASS_GROUPS;
            const { look } = styledRef.current;
            massRef.current[g]?.setData(massData(groupsRef.current[g], map.getZoom(), look, performance.now()));
          }, 25);
        }

        placeMine();

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
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error(e);
        propsRef.current.onError?.("高德底图加载失败，请检查 Key 和安全密钥，或切换到 OSM 底图。");
      });

    return () => {
      cancelled = true;
      window.clearInterval(crawlTimer);
      massRef.current.forEach((m) => m.setMap(null));
      massRef.current = [];
      heatRef.current = null;
      mineRef.current = [];
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

  useEffect(() => {
    placeMine();
  }, [props.mine, props.ghost, props.myAvatar, props.myColor, props.look]);

  useEffect(() => {
    mapRef.current?.setDefaultCursor(props.placing ? "crosshair" : "default");
  }, [props.placing]);

  useEffect(() => {
    const f = props.focus;
    if (f && mapRef.current) mapRef.current.setZoomAndCenter(f.zoom + ZOOM_OFFSET, toGcj(f));
  }, [props.focus]);

  return <div ref={el} className="map" data-basemap="amap" />;
}
