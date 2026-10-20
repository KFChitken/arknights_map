"use client";

import AMapLoader from "@amap/amap-jsapi-loader";
import { useEffect, useRef } from "react";
import { fromGcj, toGcj } from "@/lib/coords";
import { roachDataUrl } from "@/lib/roachSvg";
import type { MapViewProps, MyRoach, Roach } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the Amap JS API ships no official types */
type AMapNS = any;

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode?: string; serviceHost?: string };
  }
}

// Amap zoom levels assume 256px tiles, one level above MapLibre
const ZOOM_OFFSET = 1;
const ICON = 36;
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
      plugins: ["AMap.MarkerCluster", "AMap.Scale", "AMap.ToolBar"],
    }).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

function clusterPoints(roaches: Roach[]) {
  return roaches.map((r, i) => ({
    lnglat: toGcj(r),
    id: r.id,
    color: r.color,
    rot: ((i * 47) % 17) - 8,
  }));
}

function clusterHtml(count: number) {
  const [size, bg] = count < 20 ? [32, "#f2c14e"] : count < 100 ? [44, "#f08a4b"] : [60, "#d1495b"];
  const label = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
  return {
    size,
    html: `<div class="amap-cluster" style="width:${size}px;height:${size}px;background:${bg}">${label}</div>`,
  };
}

export default function AmapView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapNS>(null);
  const clusterRef = useRef<AMapNS>(null);
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
      content: `<img src="${roachDataUrl(my.color, { mine: true })}" width="${MINE_ICON}" height="${MINE_ICON}" alt="我的蟑螂"/>`,
      offset: new AMap.Pixel(-MINE_ICON / 2, -MINE_ICON / 2),
      zIndex: 300,
      bubble: true,
    });
    map.add(mineRef.current);
  };

  useEffect(() => {
    let cancelled = false;
    let map: AMapNS = null;

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

        const cluster = new AMap.MarkerCluster(map, clusterPoints(propsRef.current.roaches), {
          gridSize: 60,
          maxZoom: 13,
          renderClusterMarker(ctx: AMapNS) {
            const { size, html } = clusterHtml(ctx.count);
            ctx.marker.setContent(html);
            ctx.marker.setOffset(new AMap.Pixel(-size / 2, -size / 2));
          },
          renderMarker(ctx: AMapNS) {
            const d = ctx.data[0];
            ctx.marker.setContent(
              `<img src="${roachDataUrl(d.color)}" width="${ICON}" height="${ICON}" style="transform:rotate(${d.rot}deg)" alt=""/>`,
            );
            ctx.marker.setOffset(new AMap.Pixel(-ICON / 2, -ICON / 2));
          },
        });
        cluster.on("click", (e: AMapNS) => {
          const data = e.clusterData ?? [];
          if (data.length > 1) {
            map.setZoomAndCenter(Math.min(map.getZoom() + 2, 18), e.lnglat);
          } else if (data.length === 1) {
            const r = propsRef.current.roaches.find((x) => x.id === data[0].id);
            if (r) propsRef.current.onRoachClick(r);
          }
        });
        clusterRef.current = cluster;

        placeMine(propsRef.current.myRoach);

        map.on("click", (e: AMapNS) => {
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
      clusterRef.current?.setMap(null);
      clusterRef.current = null;
      mineRef.current = null;
      map?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    clusterRef.current?.setData(clusterPoints(props.roaches));
  }, [props.roaches]);

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
