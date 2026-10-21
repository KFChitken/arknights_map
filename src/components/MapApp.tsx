"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { amapConfigured, guessBasemap, saveBasemap } from "@/lib/basemap";
import { inBounds } from "@/lib/coords";
import { generateFakeRoaches } from "@/lib/fakeRoaches";
import { loadLook, saveLook } from "@/lib/look";
import { loadMyRoach, saveMyRoach } from "@/lib/myRoach";
import { roachDataUrl } from "@/lib/roachSvg";
import {
  ROACH_COLORS,
  type Basemap,
  type LngLat,
  type MapFocus,
  type MapView,
  type MyRoach,
  type Roach,
  type RoachStyle,
} from "@/lib/types";

const MaplibreView = dynamic(() => import("./MaplibreView"), { ssr: false });
const AmapView = dynamic(() => import("./AmapView"), { ssr: false });

const CHINA_VIEW: MapView = { lng: 108, lat: 34, zoom: 2.6 };
const WORLD_VIEW: MapView = { lng: 100, lat: 25, zoom: 1.2 };

export default function MapApp() {
  const roaches = useMemo(() => generateFakeRoaches(), []);
  const [basemap, setBasemap] = useState<Basemap | null>(null);
  const [look, setLook] = useState<RoachStyle>("cartoon");
  const [myRoach, setMyRoach] = useState<MyRoach | null>(null);
  const [placing, setPlacing] = useState(false);
  const [visible, setVisible] = useState<number | null>(null);
  const [selected, setSelected] = useState<Roach | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const viewRef = useRef<MapView>(WORLD_VIEW);

  // Pick the basemap and read local data in the browser only, to keep SSR output stable
  useEffect(() => {
    const b = guessBasemap();
    const mine = loadMyRoach();
    viewRef.current = mine ? { lng: mine.lng, lat: mine.lat, zoom: 11 } : b === "amap" ? CHINA_VIEW : WORLD_VIEW;
    setMyRoach(mine);
    setLook(loadLook());
    setBasemap(b);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const switchBasemap = (b: Basemap) => {
    if (b === basemap) return;
    saveBasemap(b);
    setBasemap(b);
  };

  const switchLook = (l: RoachStyle) => {
    saveLook(l);
    setLook(l);
  };

  const onViewChange = useCallback(
    (v: MapView, bounds: [LngLat, LngLat]) => {
      viewRef.current = v;
      let n = roaches.reduce((s, r) => s + (inBounds(r, bounds) ? 1 : 0), 0);
      if (myRoach && inBounds(myRoach, bounds)) n += 1;
      setVisible(n);
    },
    [roaches, myRoach],
  );

  const onMapClick = useCallback(
    (p: LngLat) => {
      setSelected(null);
      if (!placing) return;
      const color = myRoach?.color ?? ROACH_COLORS[Math.floor(Math.random() * ROACH_COLORS.length)];
      const next: MyRoach = { ...p, color, placedAt: Date.now() };
      setMyRoach(next);
      saveMyRoach(next);
      setPlacing(false);
      setToast("放好啦！别人看到的是大概位置（约 1 公里外）。");
    },
    [placing, myRoach],
  );

  const removeMine = () => {
    setMyRoach(null);
    saveMyRoach(null);
    setToast("已收回你的蟑螂。");
  };

  const recolor = () => {
    if (!myRoach) return;
    const i = ROACH_COLORS.indexOf(myRoach.color);
    const next = { ...myRoach, color: ROACH_COLORS[(i + 1) % ROACH_COLORS.length] };
    setMyRoach(next);
    saveMyRoach(next);
  };

  const flyToMine = () => {
    if (myRoach) setFocus({ lng: myRoach.lng, lat: myRoach.lat, zoom: 12, nonce: Date.now() });
  };

  const mapProps = {
    roaches,
    myRoach,
    look,
    initialView: viewRef.current,
    placing,
    focus,
    onMapClick,
    onRoachClick: setSelected,
    onViewChange,
    onError: setToast,
  };

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <img src={roachDataUrl(myRoach?.color ?? "cyan", { look })} width={28} height={28} alt="" />
          <span>舟p蟑螂地图</span>
          <span className="tag">原型 · 演示数据</span>
        </div>
        <div className="switches">
          <div className="basemap-switch" role="group" aria-label="蟑螂外观">
            <button className={look === "cartoon" ? "on" : ""} onClick={() => switchLook("cartoon")}>
              卡通
            </button>
            <button className={look === "real" ? "on" : ""} onClick={() => switchLook("real")}>
              写实
            </button>
          </div>
          <div className="basemap-switch" role="group" aria-label="底图">
            <button
              className={basemap === "amap" ? "on" : ""}
              onClick={() => switchBasemap("amap")}
              disabled={!amapConfigured}
              title={amapConfigured ? "国内底图" : "没有配置高德 Key"}
            >
              高德
            </button>
            <button className={basemap === "osm" ? "on" : ""} onClick={() => switchBasemap("osm")}>
              OSM
            </button>
          </div>
        </div>
      </header>

      <div className="stats">
        {visible === null ? "地图加载中…" : `这片地图里有 ${visible.toLocaleString()} 只舟p`}
        <span className="muted"> · 全球 {(roaches.length + (myRoach ? 1 : 0)).toLocaleString()} 只</span>
      </div>

      <div className="map-wrap">
        {basemap === "amap" && <AmapView key="amap" {...mapProps} />}
        {basemap === "osm" && <MaplibreView key="osm" {...mapProps} />}
      </div>

      {placing && (
        <div className="banner">
          点地图放下你的蟑螂。别人看到的是大概位置（约 1 公里），请不要放在家门口。
          <button onClick={() => setPlacing(false)}>取消</button>
        </div>
      )}

      {selected && (
        <div className="card" role="dialog">
          <img src={roachDataUrl(selected.color, { look })} width={56} height={56} alt="" />
          <div>
            <strong>一只匿名舟p</strong>
            <p className="muted">互相关注后才能看到 TA 的游戏 ID。资料卡功能马上就来。</p>
          </div>
          <button className="close" onClick={() => setSelected(null)} aria-label="关闭">
            ×
          </button>
        </div>
      )}

      <footer className="actions">
        {!myRoach ? (
          <button className="primary" onClick={() => setPlacing(true)} disabled={placing}>
            放下我的蟑螂
          </button>
        ) : (
          <>
            <button className="primary" onClick={flyToMine}>
              找到我的蟑螂
            </button>
            <button onClick={() => setPlacing(true)} disabled={placing}>
              挪个窝
            </button>
            <button onClick={recolor}>换颜色</button>
            <button onClick={removeMine}>收回</button>
          </>
        )}
      </footer>

      {toast && <div className="toast">{toast}</div>}
      <p className="disclaimer">非官方同人项目 · 与鹰角网络无关</p>
    </main>
  );
}
