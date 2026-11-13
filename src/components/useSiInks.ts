"use client";

import { useEffect, useRef, useState } from "react";
import { decodeTile, INK_TILE_V, INK_TILE_ZOOM, tilesOver, type InkPoint } from "@/lib/siTiles";
import type { LngLat } from "@/lib/types";
import { inkDrawn } from "@/lib/world/onlyMains";
import { NEAR_FROM } from "./map/siLook";

/**
 * 缘缘庄's ink roaches close up (src/lib/siTiles.ts): the tiles over the view, asked for while the map shows
 * them close enough (NEAR_FROM), each kept half a minute and asked again while still in view; together, the
 * ink roaches of the view and a margin round it. view: the map's bounds and zoom, null away from 宏村. hide: the
 * tap number of your own, which the page draws apart (and not at all while it is held), left out of them. keep:
 * with 只看本体 on, the tap numbers of your 触须之交's, the only others drawn; null draws every one.
 */

export type SiView = { sw: LngLat; ne: LngLat; zoom: number };

const KEEP_MS = 30_000;
/** At most this many tiles at once (a phone close up needs about a dozen with the margin, a big screen more) */
const MAX_TILES = 64;

export function useSiInks(view: SiView | null, hide: number | null = null, keep: readonly number[] | null = null) {
  const tiles = useRef(new Map<string, { at: number; points: InkPoint[] }>());
  const [state, setState] = useState<{ inks: InkPoint[]; key: number }>({ inks: [], key: 0 });
  const [tick, setTick] = useState(0);
  const close = Boolean(view && view.zoom >= NEAR_FROM);
  // the numbers, not the list, decide
  const keepKey = keep ? [...keep].sort((a, b) => a - b).join(",") : null;
  const pickRef = useRef<{ hide: number | null; keep: ReadonlySet<number> | null }>({ hide, keep: keep ? new Set(keep) : null });
  const shown = () => {
    const { hide: h, keep: k } = pickRef.current;
    return [...tiles.current.values()].flatMap((t) => t.points).filter((p) => inkDrawn(p.tap, h, k));
  };

  // yours known, or no longer; 只看本体 switched, or your 触须之交's changed: the tiles held, picked again
  useEffect(() => {
    pickRef.current = { hide, keep: keepKey === null ? null : new Set(keepKey ? keepKey.split(",").map(Number) : []) };
    setState((s) => (tiles.current.size ? { inks: shown(), key: s.key + 1 } : s));
  }, [hide, keepKey]);

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
      setState((s) => ({ inks: shown(), key: s.key + 1 }));
    };
    if (!missing.length) {
      merge();
      return;
    }
    Promise.all(
      missing.map(async (t) => {
        const r = await fetch(`/api/si/ink?z=${INK_TILE_ZOOM}&x=${t.x}&y=${t.y}&v=${INK_TILE_V}`);
        // a server from before the tap number, while the site is being updated: what was held is kept till the next ask
        if (!r.ok || r.headers.get("x-ink-v") !== INK_TILE_V) return;
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
