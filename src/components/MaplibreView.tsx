"use client";

import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { roachDataUrl } from "@/lib/roachSvg";
import { ROACH_COLORS, type MapViewProps, type MyRoach, type Roach } from "@/lib/types";

const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

// For offline debugging: append ?style=blank to draw a plain background only
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#dde5ea" } }],
};

const ICON_PX = 96; // bitmap edge; pixelRatio 2 → shown at 48px

async function svgToImageData(url: string, size: number) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

function roachesGeoJSON(roaches: Roach[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: roaches.map((r, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      // a fixed slight tilt per roach so the crowd looks alive
      properties: { id: r.id, color: r.color, rot: ((i * 47) % 17) - 8 },
    })),
  };
}

function mineGeoJSON(my: MyRoach | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: my
      ? [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [my.lng, my.lat] },
            properties: { color: my.color },
          },
        ]
      : [],
  };
}

export default function MaplibreView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

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

    map.on("load", async () => {
      await Promise.all(
        ROACH_COLORS.flatMap((color) => [
          svgToImageData(roachDataUrl(color), ICON_PX).then((d) =>
            map.addImage(`roach-${color}`, d, { pixelRatio: 2 }),
          ),
          svgToImageData(roachDataUrl(color, { mine: true }), ICON_PX).then((d) =>
            map.addImage(`mine-${color}`, d, { pixelRatio: 2 }),
          ),
        ]),
      );

      map.addSource("roaches", {
        type: "geojson",
        data: roachesGeoJSON(propsRef.current.roaches),
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 12,
      });
      map.addSource("mine", { type: "geojson", data: mineGeoJSON(propsRef.current.myRoach) });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "roaches",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#f2c14e", 20, "#f08a4b", 100, "#d1495b"],
          "circle-radius": ["step", ["get", "point_count"], 16, 20, 22, 100, 30],
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "roaches",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 13,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#2b1d10" },
      });
      map.addLayer({
        id: "roach",
        type: "symbol",
        source: "roaches",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "icon-image": ["concat", "roach-", ["get", "color"]],
          "icon-size": 0.75,
          "icon-rotate": ["get", "rot"],
          "icon-allow-overlap": true,
        },
      });
      map.addLayer({
        id: "mine",
        type: "symbol",
        source: "mine",
        layout: {
          "icon-image": ["concat", "mine-", ["get", "color"]],
          "icon-size": 1,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      readyRef.current = true;
      window.clearTimeout(loadTimer);
      reportView();
    });

    map.on("click", "clusters", async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const src = map.getSource("roaches") as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id);
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      map.easeTo({ center: [lng, lat], zoom });
    });

    map.on("click", "roach", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const r = propsRef.current.roaches.find((x) => x.id === f.properties.id);
      if (r) propsRef.current.onRoachClick(r);
    });

    map.on("click", (e) => {
      if (!readyRef.current) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["clusters", "roach"] });
      if (hit.length) return;
      propsRef.current.onMapClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    for (const layer of ["clusters", "roach"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
    map.on("moveend", reportView);

    return () => {
      window.clearTimeout(loadTimer);
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("roaches") as GeoJSONSource).setData(roachesGeoJSON(props.roaches));
  }, [props.roaches]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource("mine") as GeoJSONSource).setData(mineGeoJSON(props.myRoach));
  }, [props.myRoach]);

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
