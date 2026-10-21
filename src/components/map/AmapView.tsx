"use client";

import { useEffect, useRef } from "react";
import { loadAMap, type AMapNS } from "@/lib/amap";
import { fromGcj, toGcj } from "@/lib/coords";
import { roachDataUrl } from "@/lib/roachSvg";
import {
  AGITATION,
  CRAWL_GROUPS,
  crawlOffset,
  HEADINGS,
  iconPx,
  prefersReducedMotion,
  SWARM_FADE_ZOOM,
  SWARM_GRADIENT,
} from "@/lib/swarm";
import { ROACH_COLORS, type RoachColor, type RoachStyle } from "@/lib/types";
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
// Roaches are split into crawl groups; each group gets its own MassMarks.
// Style indexes: cartoon = color index, then one shared clone look, then the
// same again for 触须之交; real = pre-rendered heading, then see-through clone
// headings, then both again for 触须之交.
type MassPoint = {
  lng: number;
  lat: number;
  cos: number;
  id: string;
  color: number;
  heading: number;
  clone: boolean;
  friend: boolean;
};

const CARTOON_STYLES = ROACH_COLORS.length + 1;
const REAL_STYLES = HEADINGS.length * 2;

function massGroups(roaches: PublicRoach[]): MassPoint[][] {
  const groups: MassPoint[][] = Array.from({ length: CRAWL_GROUPS }, () => []);
  for (const r of roaches) {
    const [lng, lat] = toGcj(r);
    const t = roachTraits(r.id, CRAWL_GROUPS, HEADINGS.length);
    groups[t.group].push({
      lng,
      lat,
      cos: Math.cos((lat * Math.PI) / 180),
      id: r.id,
      color: ROACH_COLORS.indexOf(r.color),
      heading: t.headingIndex,
      clone: r.clone,
      friend: r.friend,
    });
  }
  // MassMarks paints in order, so 触须之交 go last to sit on top
  for (const g of groups) g.sort((a, b) => Number(a.friend) - Number(b.friend));
  return groups;
}

function styleIndex(p: MassPoint, look: RoachStyle) {
  if (look === "real") return (p.friend ? REAL_STYLES : 0) + (p.clone ? HEADINGS.length : 0) + p.heading;
  return (p.friend ? CARTOON_STYLES : 0) + (p.clone ? ROACH_COLORS.length : p.color);
}

/** Shift a group by a screen offset in px at the given Amap zoom. */
function massData(points: MassPoint[], [dx, dy]: [number, number], amapZoom: number, look: RoachStyle) {
  const degPerPx = 360 / (256 * 2 ** amapZoom);
  return points.map((p) => ({
    lnglat: [p.lng + dx * degPerPx, p.lat - dy * degPerPx * p.cos],
    id: p.id,
    style: styleIndex(p, look),
  }));
}

function massStyles(AMap: AMapNS, amapZoom: number, look: RoachStyle) {
  const px = Math.round(iconPx(amapZoom - ZOOM_OFFSET));
  const urls = [false, true].flatMap((friend) =>
    look === "real"
      ? [
          ...HEADINGS.map((rotate) => roachDataUrl("cyan", { look, rotate, friend })),
          ...HEADINGS.map((rotate) => roachDataUrl("cyan", { look, rotate, friend, clone: true })),
        ]
      : [...ROACH_COLORS.map((color) => roachDataUrl(color, { friend })), roachDataUrl("white", { friend, clone: true })],
  );
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

function mineIcon(r: OwnRoach, color: RoachColor, look: RoachStyle) {
  const url = roachDataUrl(color, { mine: true, clone: r.slot > 0, look });
  const label = r.slot > 0 ? "我的克隆体" : "我的蟑螂";
  return `<img src="${url}" width="${MINE_ICON}" height="${MINE_ICON}" alt="${label}" style="cursor:pointer"/>`;
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
  const propsRef = useRef(props);
  propsRef.current = props;

  const placeMine = () => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    if (mineRef.current.length) map.remove(mineRef.current);
    const { mine, myColor, look } = propsRef.current;
    mineRef.current = mine.map((r) => {
      const marker = new AMap.Marker({
        position: toGcj(r),
        content: mineIcon(r, myColor, look),
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
      .then((AMap) => {
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
          const { look } = propsRef.current;
          const mass = new AMap.MassMarks(massData(points, [0, 0], map.getZoom(), look), {
            zIndex: massZ(look),
            zooms: [2, 20],
            cursor: "pointer",
            style: massStyles(AMap, map.getZoom(), look),
          });
          mass.setMap(map);
          mass.on("click", onMassClick);
          return mass;
        });
        map.on("zoomchange", () => {
          const style = massStyles(AMap, map.getZoom(), propsRef.current.look);
          massRef.current.forEach((m) => m.setStyle(style));
        });

        // Redraw one group per tick, round robin, to keep each frame light
        let tick = 0;
        if (!prefersReducedMotion()) {
          crawlTimer = window.setInterval(() => {
            const g = tick++ % CRAWL_GROUPS;
            const z = map.getZoom();
            const { look } = propsRef.current;
            const off = crawlOffset(g, performance.now(), iconPx(z - ZOOM_OFFSET) / 24, AGITATION[look]);
            massRef.current[g]?.setData(massData(groupsRef.current[g], off, z, look));
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
    massRef.current.forEach((m, g) => m.setData(massData(groupsRef.current[g], [0, 0], z, props.look)));
    heatRef.current?.setDataSet(heatData(props.roaches));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.roaches]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !amapRef.current) return;
    const style = massStyles(amapRef.current, map.getZoom(), props.look);
    massRef.current.forEach((m, g) => {
      m.setzIndex(massZ(props.look));
      m.setStyle(style);
      m.setData(massData(groupsRef.current[g], [0, 0], map.getZoom(), props.look));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.look]);

  useEffect(() => {
    placeMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mine, props.myColor, props.look]);

  useEffect(() => {
    mapRef.current?.setDefaultCursor(props.placing ? "crosshair" : "default");
  }, [props.placing]);

  useEffect(() => {
    const f = props.focus;
    if (f && mapRef.current) mapRef.current.setZoomAndCenter(f.zoom + ZOOM_OFFSET, toGcj(f));
  }, [props.focus]);

  return <div ref={el} className="map" data-basemap="amap" />;
}
