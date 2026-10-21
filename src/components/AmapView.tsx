"use client";

import AMapLoader from "@amap/amap-jsapi-loader";
import { useEffect, useRef } from "react";
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
import { ROACH_COLORS, type MapViewProps, type MyRoach, type Roach, type RoachStyle } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Amap JS API ships no official types */
type AMapNS = any;

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

// Amap zoom levels assume 256px tiles, one level above MapLibre
const ZOOM_OFFSET = 1;
// The shadow sits on top of cartoon roaches so crowds go solid black, but under
// real ones so their brown bodies stay visible
const HEAT_Z = 125;
const massZ = (look: RoachStyle) => (look === "real" ? 130 : 120);
const MINE_ICON = 48;

let loading: Promise<AMapNS> | null = null;
function loadAMap(): Promise<AMapNS> {
  if (!loading) {
    window._AMapSecurityConfig = {
      securityJsCode: process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE,
    };
    loading = AMapLoader.load({
      key: process.env.NEXT_PUBLIC_AMAP_KEY!,
      version: "2.0",
      plugins: ["AMap.HeatMap", "AMap.Scale", "AMap.ToolBar"],
    }).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

// MassMarks draws thousands of points on one canvas, unlike DOM markers.
// Roaches are split into crawl groups; each group gets its own MassMarks.
// Cartoon styles are indexed by color; real ones by pre-rendered heading.
type MassPoint = { lng: number; lat: number; cos: number; id: string; color: number; heading: number };

function massGroups(roaches: Roach[]): MassPoint[][] {
  const groups: MassPoint[][] = Array.from({ length: CRAWL_GROUPS }, () => []);
  roaches.forEach((r, i) => {
    const [lng, lat] = toGcj(r);
    groups[i % CRAWL_GROUPS].push({
      lng,
      lat,
      cos: Math.cos((lat * Math.PI) / 180),
      id: r.id,
      color: ROACH_COLORS.indexOf(r.color),
      heading: (i * 5) % HEADINGS.length,
    });
  });
  return groups;
}

/** Shift a group by a screen offset in px at the given Amap zoom. */
function massData(points: MassPoint[], [dx, dy]: [number, number], amapZoom: number, look: RoachStyle) {
  const degPerPx = 360 / (256 * 2 ** amapZoom);
  return points.map((p) => ({
    lnglat: [p.lng + dx * degPerPx, p.lat - dy * degPerPx * p.cos],
    id: p.id,
    style: look === "real" ? p.heading : p.color,
  }));
}

function massStyles(AMap: AMapNS, amapZoom: number, look: RoachStyle) {
  const px = Math.round(iconPx(amapZoom - ZOOM_OFFSET));
  const urls =
    look === "real"
      ? HEADINGS.map((rotate) => roachDataUrl("cyan", { look, rotate }))
      : ROACH_COLORS.map((color) => roachDataUrl(color));
  return urls.map((url) => ({
    url,
    size: new AMap.Size(px, px),
    anchor: new AMap.Pixel(px / 2, px / 2),
  }));
}

function heatData(roaches: Roach[]) {
  return {
    data: roaches.map((r) => {
      const [lng, lat] = toGcj(r);
      return { lng, lat, count: 1 };
    }),
    max: 12,
  };
}

export default function AmapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapNS>(null);
  const massRef = useRef<AMapNS[]>([]);
  const groupsRef = useRef<MassPoint[][]>([]);
  const heatRef = useRef<AMapNS>(null);
  const mineRef = useRef<AMapNS>(null);
  const amapRef = useRef<AMapNS>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const placeMine = (my: MyRoach | null) => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) return;
    if (mineRef.current) {
      map.remove(mineRef.current);
      mineRef.current = null;
    }
    if (!my) return;
    mineRef.current = new AMap.Marker({
      position: toGcj(my),
      content: `<img src="${roachDataUrl(my.color, { mine: true, look: propsRef.current.look })}" width="${MINE_ICON}" height="${MINE_ICON}" alt="我的蟑螂"/>`,
      offset: new AMap.Pixel(-MINE_ICON / 2, -MINE_ICON / 2),
      zIndex: 300,
      bubble: true,
    });
    map.add(mineRef.current);
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
        let lastHit = 0;
        const onMassClick = (e: AMapNS) => {
          lastHit = Date.now();
          const r = propsRef.current.roaches.find((x) => x.id === e.data?.id);
          // defer so a map click fired for the same tap cannot clear the selection
          if (r) window.setTimeout(() => propsRef.current.onRoachClick(r), 0);
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

        placeMine(propsRef.current.myRoach);

        map.on("click", (e: AMapNS) => {
          if (Date.now() - lastHit < 300) return;
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
      mineRef.current = null;
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
    placeMine(propsRef.current.myRoach);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.look]);

  useEffect(() => {
    placeMine(props.myRoach);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.myRoach]);

  useEffect(() => {
    mapRef.current?.setDefaultCursor(props.placing ? "crosshair" : "default");
  }, [props.placing]);

  useEffect(() => {
    const f = props.focus;
    if (f && mapRef.current) mapRef.current.setZoomAndCenter(f.zoom + ZOOM_OFFSET, toGcj(f));
  }, [props.focus]);

  return <div ref={el} className="map" data-basemap="amap" />;
}
