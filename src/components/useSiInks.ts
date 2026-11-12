"use client";

import { useEffect, useRef, useState } from "react";
import { decodeTile, INK_TILE_ZOOM, tilesOver, type InkPoint } from "@/lib/siTiles";
import type { LngLat } from "@/lib/types";
import { NEAR_FROM } from "./map/siLook";

/**
 * 缘缘庄's ink roaches close up (src/lib/siTiles.ts): the tiles over the view, asked for while the map shows
 * them close enough (NEAR_FROM), each kept half a minute and asked again while still in view; together, the
 * ink roaches of the view and a margin round it. view: the map's bounds and zoom, null away from 宏村.
 */

export type SiView = { sw: LngLat; ne: LngLat; zoom: number };

const KEEP_MS = 30_000;
/** At most this many tiles at once (a phone close up needs about a dozen with the margin, a big screen more) */
const MAX_TILES = 64;

export function useSiInks(view: SiView | null) {
  const tiles = useRef(new Map<string, { at: number; points: InkPoint[] }>());
  const [state, setState] = useState<{ inks: InkPoint[]; key: number }>({ inks: [], key: 0 });
  const [tick, setTick] = useState(0);
  const close = Boolean(view && view.zoom >= NEAR_FROM);

  // asked again every half minute while close
  useEffect(() => {
    if (!close) return;
    const t = window.setInterval(() => setTick((n) => n + 1), KEEP_MS);
    return () => window.clearInterval(t);
  }, [close]);

  useEffect(() => {
    if (!view || view.zoom < NEAR_FROM) {
      setState((s) => (s.inks.length ? { inks: [], key: s.key + 1 } : s));
      return;
    }
    // a margin of half a screen round the view; on a big screen just the view, should that be too many
    const dLng = (view.ne.lng - view.sw.lng) / 2;
    const dLat = (view.ne.lat - view.sw.lat) / 2;
    const withMargin = tilesOver({ lng: view.sw.lng - dLng, lat: view.sw.lat - dLat }, { lng: view.ne.lng + dLng, lat: view.ne.lat + dLat }, INK_TILE_ZOOM, MAX_TILES);
    const want = withMargin.length ? withMargin : tilesOver(view.sw, view.ne, INK_TILE_ZOOM, MAX_TILES);
    let gone = false;
    const now = Date.now();
    const missing = want.filter((t) => {
      const held = tiles.current.get(`${t.x}/${t.y}`);
      return !held || now - held.at >= KEEP_MS;
    });
    const merge = () => {
      if (gone) return;
      const keys = new Set(want.map((t) => `${t.x}/${t.y}`));
      for (const k of tiles.current.keys()) if (!keys.has(k)) tiles.current.delete(k);
      setState((s) => ({ inks: [...tiles.current.values()].flatMap((t) => t.points), key: s.key + 1 }));
    };
    if (!missing.length) {
      merge();
      return;
    }
    Promise.all(
      missing.map(async (t) => {
        const r = await fetch(`/api/si/ink?z=${INK_TILE_ZOOM}&x=${t.x}&y=${t.y}`);
        if (!r.ok) return;
        const bytes = new Uint8Array(await r.arrayBuffer());
        tiles.current.set(`${t.x}/${t.y}`, { at: Date.now(), points: decodeTile(t.x, t.y, INK_TILE_ZOOM, bytes) });
      }),
    )
      .catch(() => {})
      .then(merge);
    return () => {
      gone = true;
    };
    // the view's numbers, not the object, decide
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.sw.lng, view?.sw.lat, view?.ne.lng, view?.ne.lat, view?.zoom, tick]);

  return state;
}
