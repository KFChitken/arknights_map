"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { T } from "@/i18n";
import { SearchBusy, searchPlaces, suggestPlaces, type Place, type PlaceResults } from "@/lib/geocode";
import type { MapView } from "@/lib/types";

/** How long typing pauses before suggestions are asked for */
const SUGGEST_DELAY_MS = 500;

// Two CJK characters make a useful query (one, such as 静 or 上, finds nothing in particular); Latin needs three
const longEnough = (q: string) => q.length >= (/^[\x00-\x7f]*$/.test(q) ? 3 : 2);

/** Shown while placing a roach: tap the map, or search for a place by name. */
export default function PlaceBar({
  label,
  view,
  cn,
  onPick,
  onCancel,
}: {
  label: string;
  /** A visitor from mainland China: places are searched through our server, and its errors say to tap the map */
  cn: boolean;
  /** Map view when placing started; suggestions near its center come first once zoomed in */
  view: MapView;
  onPick: (p: Place) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  // pinyin still being typed into the box (an input method composing): nothing is asked until a word is chosen
  const [composing, setComposing] = useState(false);
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
      const res = await (full ? searchPlaces(query, near, cn) : suggestPlaces(query, near, cn));
      if (mine === seq.current) setResults({ ...res, full });
    } catch (err) {
      console.error(err);
      if (mine === seq.current) {
        setResults(null);
        setError(
          err instanceof SearchBusy
            ? T.placeBar.search.busy
            : cn
              ? T.placeBar.search.unavailable
              : T.placeBar.search.offline,
        );
      }
    } finally {
      if (full) setBusy(false);
    }
  };

  // Suggest places as the player types, once a word is chosen and typing pauses
  useEffect(() => {
    const query = q.trim();
    if (!longEnough(query)) {
      seq.current++;
      setResults(null);
      return;
    }
    if (composing) return;
    timer.current = window.setTimeout(() => run(false), SUGGEST_DELAY_MS);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, composing]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    // Enter that picks a word in the input method is not a search for the pinyin
    if (q.trim() && !busy && !composing) run(true);
  };

  return (
    <div className="placebar" role="dialog" aria-label={label}>
      <div className="placebar-top">
        <span>{label}</span>
        <button onClick={onCancel}>{T.common.cancel}</button>
      </div>
      <form onSubmit={search}>
        <input
          type="search"
          enterKeyHint="search"
          placeholder={T.placeBar.search.placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // state, not a ref: browsers differ in whether the last input event comes before or after compositionend,
          // and when the text did not change only composing changing runs the suggestions again
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false);
            setQ(e.currentTarget.value);
          }}
        />
        <button type="submit" disabled={busy}>
          {busy ? "…" : T.placeBar.search.button}
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
          {results.places.length === 0 && results.full && <li className="empty">{T.placeBar.search.none}</li>}
          {!results.full && <li className="empty">{T.placeBar.search.more}</li>}
        </ul>
      )}
      {error && <p className="hint">{error}</p>}
      <p className="hint">
        {T.placeBar.doorstep}
        {results?.osm && T.placeBar.credit.osm}
        {results?.tencent && T.placeBar.credit.tencent}
      </p>
    </div>
  );
}
