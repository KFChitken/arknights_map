"use client";

import { useEffect, useRef, useState } from "react";
import { fromTencent, toTencent } from "@/lib/coords";
import { loadTMap, type TMapNS } from "@/lib/tencentMap";
import type { MapView } from "@/lib/types";
import MaplibreView from "./MaplibreView";
import { reportMapTrouble } from "./report";
import type { BaseMap, MapViewProps } from "./types";

/** Tencent's zoom is MapLibre's plus one, as 高德's (AmapView) */
const ZOOM_OFFSET = 1;
const MIN_ZOOM = 3;
const MAX_ZOOM = 20;
/**
 * Trouble this soon after the map is made (its key turned away, its script not loading) means it stays blank: the
 * page's next map instead, once. Later trouble leaves it as it is, as with 高德 (AmapView REFUSED_WITHIN_MS).
 */
const REFUSED_WITHIN_MS = 30_000;
/** Not drawn by then: told to the server as slow, and left to go on loading (slow is not broken) */
const SLOW_MS = 20_000;
/** A glide to a place (MapViewProps.focus); further than this many screens away it first rises, as MapLibre's flyTo */
const GLIDE_MS = 900;
const FAR_SCREENS = 2;

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/**
 * Calls f as the map starts drawing each frame: at its first WebGL call in a task, which is when it has
 * settled where the frame looks. Tencent says a view changed before it draws it, so following those events
 * would put the roaches a frame ahead of the land; at its draws, both show the same frame. Returns the undo.
 */
function onDraws(contexts: GL[], f: () => void) {
  let busy = false;
  const undo: (() => void)[] = [];
  for (const gl of contexts) {
    const own = gl as unknown as Record<string, unknown>;
    for (const name of ["clear", "drawElements", "drawArrays"]) {
      const original = own[name] as (...args: unknown[]) => unknown;
      own[name] = function (this: unknown, ...args: unknown[]) {
        if (!busy) {
          busy = true;
          queueMicrotask(() => {
            busy = false;
          });
          try {
            f();
          } catch (e) {
            console.error(e);
          }
        }
        return original.apply(this, args);
      };
      undo.push(() => delete own[name]);
    }
  }
  return () => undo.forEach((u) => u());
}

/**
 * 腾讯's map (JavaScript API GL), for visitors from mainland China when 高德 cannot be used: Tencent draws the land
 * and takes the gestures, and MaplibreView draws everything of ours over it, see-through, following its view
 * (BaseMap). Tencent shifts mainland China, Hong Kong and Macau as 高德 does, Taiwan not (src/lib/coords.ts):
 * MapLibre's view is Tencent's own, unshifted at its middle, which leaves at most a few pixels at the edges.
 */
export default function TencentView(props: MapViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState<BaseMap | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // a focus or jump the page had before this map was made is no news to it: it starts at initialView
  const firstRef = useRef({ focus: props.focus, jump: props.jump });
  // shown when both Tencent's land and our layer have drawn themselves
  const readyRef = useRef({ land: false, ours: false, told: false });
  const tellReady = () => {
    const r = readyRef.current;
    if (!r.land || !r.ours || r.told) return;
    r.told = true;
    propsRef.current.onReady?.();
  };

  useEffect(() => {
    let cancelled = false;
    let gaveUp = false;
    let madeAt = 0;
    let slowTimer = 0;
    let glideTimer = 0;
    let tm: TMapNS = null;
    const container = el.current!;
    const undo: (() => void)[] = [];
    const fail = (what: "load" | "key", detail: string) => {
      if (cancelled || gaveUp || (madeAt && Date.now() - madeAt > REFUSED_WITHIN_MS)) return;
      gaveUp = true;
      reportMapTrouble("tencent", what, detail);
      propsRef.current.onFailed?.();
    };

    loadTMap()
      .then((TMap) => {
        if (cancelled) return;
        const { initialView } = propsRef.current;
        const latLng = (v: { lng: number; lat: number }) => {
          const [lng, lat] = toTencent(v);
          return new TMap.LatLng(lat, lng);
        };
        // the WebGL context Tencent makes for its map, as it makes it (onDraws)
        const made: GL[] = [];
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
          const ctx = (getContext as (...a: unknown[]) => RenderingContext | null).apply(this, args);
          if (ctx && /webgl/i.test(String(args[0]))) made.push(ctx as GL);
          return ctx;
        } as typeof getContext;
        try {
          tm = new TMap.Map(container, {
            center: latLng(initialView),
            zoom: clampZoom(initialView.zoom + ZOOM_OFFSET),
            minZoom: MIN_ZOOM,
            maxZoom: MAX_ZOOM,
            viewMode: "2D",
            rotatable: false,
            pitchable: false,
          });
        } finally {
          HTMLCanvasElement.prototype.getContext = getContext;
        }
        madeAt = Date.now();
        const ids = TMap.constants?.DEFAULT_CONTROL_ID ?? {};
        const positions = TMap.constants?.CONTROL_POSITION ?? {};
        // no compass (the map never turns), and the zoom buttons bottom right, where the other maps have theirs
        tm.removeControl(ids.ROTATION ?? "rotation");
        tm.getControl(ids.ZOOM ?? "zoom")?.setPosition(positions.BOTTOM_RIGHT ?? 8);
        // its corners, for globals.css to keep them clear of the phone's home bar and our buttons: each the nearest
        // box placed on its own around the logo, the scale and the zoom buttons (the logo comes a little later)
        const corners = [
          [".logo-text", "tmap-corner-left"],
          [".tmap-scale-control", "tmap-corner-left"],
          [".tmap-zoom-control", "tmap-corner-right"],
        ];
        const markCorners = () => {
          for (let i = corners.length - 1; i >= 0; i--) {
            const [what, name] = corners[i];
            let box = container.querySelector(what)?.parentElement ?? null;
            while (box && box !== container && getComputedStyle(box).position !== "absolute") box = box.parentElement;
            if (!box || box === container) continue;
            box.classList.add(name);
            corners.splice(i, 1);
          }
        };
        markCorners();

        tm.on("auth_checked", (e: { state?: string; error?: number }) => {
          markCorners();
          // a key it turns away (-301), or no answer at all (-1): the map stays blank
          if (e?.state && e.state !== "success") fail("key", String(e.error ?? e.state));
        });
        slowTimer = window.setTimeout(() => reportMapTrouble("tencent", "slow"), SLOW_MS);
        tm.on("tilesloaded", () => {
          window.clearTimeout(slowTimer);
          markCorners();
          readyRef.current.land = true;
          tellReady();
        });

        // ---- the base map our layer follows ----
        const frames = new Set<() => void>();
        const taps = new Set<(x: number, y: number) => void>();
        const pointers = new Set<(x: number, y: number) => void>();
        const movings = new Set<(moving: boolean) => void>();
        const listen = <T,>(set: Set<T>, f: T) => {
          set.add(f);
          return () => void set.delete(f);
        };
        const frame = () => frames.forEach((f) => f());
        const glContexts = made.filter((gl) => gl.canvas instanceof HTMLCanvasElement && container.contains(gl.canvas));
        if (glContexts.length) undo.push(onDraws(glContexts, frame));
        else {
          // no WebGL context of its own to watch: its view as it changes, which may show a frame early
          tm.on("center_changed", frame);
          tm.on("zoom_changed", frame);
        }
        tm.on("resize", frame);
        tm.on("click", (e: { point?: { x: number; y: number } }) => {
          if (e?.point) taps.forEach((f) => f(e.point!.x, e.point!.y));
        });
        // the mouse, at most once a frame
        let pointerAt: { x: number; y: number } | null = null;
        let pointerFrame = 0;
        tm.on("mousemove", (e: { point?: { x: number; y: number } }) => {
          if (!e?.point) return;
          pointerAt = { x: e.point.x, y: e.point.y };
          if (pointerFrame) return;
          pointerFrame = requestAnimationFrame(() => {
            pointerFrame = 0;
            const at = pointerAt;
            if (at) pointers.forEach((f) => f(at.x, at.y));
          });
        });
        undo.push(() => cancelAnimationFrame(pointerFrame));
        tm.on("movestart", () => movings.forEach((f) => f(true)));
        tm.on("moveend", () => movings.forEach((f) => f(false)));
        // a person's own drag, pinch or wheel ends a glide's second half before it starts
        const interrupted = () => window.clearTimeout(glideTimer);
        for (const type of ["pointerdown", "touchstart", "wheel"]) container.addEventListener(type, interrupted, { passive: true });

        let seen = "";
        let shown: MapView = initialView;
        const view = (): MapView => {
          const c = tm.getCenter();
          const z = tm.getZoom();
          const key = `${c.getLng()},${c.getLat()},${z}`;
          if (key !== seen) {
            seen = key;
            shown = { ...fromTencent(c.getLng(), c.getLat()), zoom: z - ZOOM_OFFSET };
          }
          return shown;
        };
        const easeTo = (v: MapView, ms = GLIDE_MS) => {
          window.clearTimeout(glideTimer);
          const to = { center: latLng(v), zoom: clampZoom(v.zoom + ZOOM_OFFSET) };
          // far away: up first to where both places show, then down, so the way between is not a blur
          const from = tm.getCenter();
          const a = tm.projectToContainer(from);
          const b = tm.projectToContainer(to.center);
          const screen = Math.hypot(container.clientWidth, container.clientHeight) || 1;
          const screens = a && b ? Math.hypot(b.x - a.x, b.y - a.y) / screen : 0;
          if (screens <= FAR_SCREENS) return tm.easeTo(to, { duration: ms });
          const up = clampZoom(Math.min(tm.getZoom(), to.zoom) - Math.log2(screens) - 0.5);
          const mid = new TMap.LatLng((from.getLat() + to.center.getLat()) / 2, (from.getLng() + to.center.getLng()) / 2);
          tm.easeTo({ center: mid, zoom: up }, { duration: ms });
          glideTimer = window.setTimeout(() => tm.easeTo(to, { duration: ms }), ms + 20);
        };
        const cursor = (c: string) => {
          if (typeof tm.setCursorStyle === "function") tm.setCursorStyle(c || "default");
          else container.style.cursor = c;
        };
        setBase({
          view,
          onFrame: (f) => listen(frames, f),
          onTap: (f) => listen(taps, f),
          onPointer: (f) => listen(pointers, f),
          onMoving: (f) => listen(movings, f),
          easeTo,
          jumpTo: (v) => {
            window.clearTimeout(glideTimer);
            tm.jumpTo({ center: latLng(v), zoom: clampZoom(v.zoom + ZOOM_OFFSET) });
          },
          setCursor: cursor,
        });
        undo.push(() => {
          for (const type of ["pointerdown", "touchstart", "wheel"]) container.removeEventListener(type, interrupted);
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error(e);
        fail("load", e instanceof Error ? e.message : typeof e === "string" ? e : "");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      window.clearTimeout(glideTimer);
      undo.forEach((u) => u());
      setBase(null);
      try {
        tm?.destroy();
      } catch (e) {
        console.error(e);
      }
    };
  }, []);

  const first = firstRef.current;
  return (
    <div className="map tmap" data-basemap="tencent">
      <div ref={el} className="tmap-base" />
      {base && (
        <MaplibreView
          {...props}
          focus={props.focus === first.focus ? null : props.focus}
          jump={props.jump === first.jump ? null : props.jump}
          base={base}
          onReady={() => {
            readyRef.current.ours = true;
            tellReady();
          }}
        />
      )}
    </div>
  );
}
