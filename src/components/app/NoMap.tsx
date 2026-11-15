"use client";

import { T } from "@/i18n";

/**
 * In the map's place when the browser will not let the page draw with the graphics card (src/lib/webgl.ts), or
 * when what the maps drew was lost meanwhile (lost): what happened and how to get the map back. The rest of the
 * page works as ever.
 */
export default function NoMap({ lost, onRetry }: { lost: boolean; onRetry: () => void }) {
  return (
    <div className="no-map" role="alert">
      <div className="trouble-box">
        <strong>{lost ? T.map.noGl.lostTitle : T.map.noGl.title}</strong>
        <p>{T.map.noGl.text}</p>
        <button className="pill dark" onClick={onRetry}>
          {T.map.noGl.retry}
        </button>
      </div>
    </div>
  );
}
