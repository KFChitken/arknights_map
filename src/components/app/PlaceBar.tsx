"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { searchPlaces, suggestPlaces, type Place, type PlaceResults } from "@/lib/geocode";
import type { Basemap, MapView } from "@/lib/types";

const SUGGEST_DELAY_MS = 350;

// One CJK character is already a useful query; Latin needs two
const longEnough = (q: string) => q.length >= (/^[\x00-\x7f]*$/.test(q) ? 2 : 1);

/** Shown while placing a roach: tap the map, or search for a place by name. */
export default function PlaceBar({
  label,
  basemap,
  view,
  onPick,
  onCancel,
}: {
  label: string;
  basemap: Basemap;
  /** Map view when placing started; suggestions near its center come first once zoomed in */
  view: MapView;
  onPick: (p: Place) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<(PlaceResults & { full: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may show its results
  const seq = useRef(0);
  const timer = useRef(0);

  const run = async (full: boolean) => {
    const query = q.trim();
    window.clearTimeout(timer.current);
    const mine = ++seq.current;
    if (full) setBusy(true);
    setError(null);
    try {
      const near = view.zoom >= 5 ? view : undefined;
      const res = await (full ? searchPlaces(query, basemap) : suggestPlaces(query, basemap, near));
      if (mine === seq.current) setResults({ ...res, full });
    } catch (err) {
      console.error(err);
      if (mine === seq.current) {
        setResults(null);
        setError("搜索没有连上，检查一下网络，或者直接点地图。");
      }
    } finally {
      if (full) setBusy(false);
    }
  };

  // Suggest places as the player types
  useEffect(() => {
    const query = q.trim();
    if (!longEnough(query)) {
      seq.current++;
      setResults(null);
      return;
    }
    timer.current = window.setTimeout(() => run(false), SUGGEST_DELAY_MS);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, basemap]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim() && !busy) run(true);
  };

  return (
    <div className="placebar" role="dialog" aria-label={label}>
      <div className="placebar-top">
        <span>{label}</span>
        <button onClick={onCancel}>取消</button>
      </div>
      <form onSubmit={search}>
        <input
          type="search"
          enterKeyHint="search"
          placeholder="或者输入地点，比如：静安寺、秋叶原"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? "…" : "搜索"}
        </button>
      </form>
      {results && (
        <ul className="results">
          {results.places.map((p, i) => (
            <li key={`${p.lng},${p.lat},${i}`}>
              <button onClick={() => onPick(p)}>
                <strong>{p.name}</strong>
                {p.detail && <small>{p.detail}</small>}
              </button>
            </li>
          ))}
          {results.places.length === 0 && results.full && <li className="empty">没找到这个地点，换个说法试试。</li>}
          {!results.full && <li className="empty">没有想要的？按「搜索」用更全的方式再找一次。</li>}
        </ul>
      )}
      {error && <p className="hint">{error}</p>}
      <p className="hint">
        别人看到的是约 1 公里的大概位置，请不要放在家门口。
        {results?.osm && " 部分地点数据 © OpenStreetMap。"}
      </p>
    </div>
  );
}
