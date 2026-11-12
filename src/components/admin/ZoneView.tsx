"use client";

import { useEffect, useRef, useState } from "react";
import type { ZoneSpot } from "@/lib/adminConsole";
import type { LngLat } from "@/lib/types";
import type { MapLine } from "../map/types";
import { adminCall, AdminError, errorWords } from "./api";
import { circlePath, zoomFor } from "./zoneAim";

/**
 * 去地图上看 from 禁放区 in the 管理台 (/?zone=<id>): the owner's map goes to the place and draws its circle there, on the
 * owner's map only, with a bar at the top saying which it is. Seeing one goes into the 操作记录 (zone).
 */
export default function ZoneView({
  id,
  onFocus,
  onLines,
  onClose,
}: {
  id: string;
  /** Fly to a spot, lift pixels above the middle of the map, at that zoom */
  onFocus: (at: LngLat, lift: number, zoom: number) => void;
  onLines: (lines: MapLine[]) => void;
  onClose: () => void;
}) {
  const [zone, setZone] = useState<ZoneSpot | null>(null);
  const [note, setNote] = useState<{ text: string; shut: boolean } | null>(null);
  const barEl = useRef<HTMLElement>(null);

  useEffect(() => {
    let live = true;
    adminCall<ZoneSpot>("zone", [{ id }])
      .then((z) => {
        if (!live) return;
        setZone(z);
        // the circle in the middle of what the bar leaves of the map, about two thirds as wide as that
        const top = barEl.current?.getBoundingClientRect().bottom ?? 0;
        const room = Math.min(window.innerWidth, window.innerHeight - top) / 2 - 16;
        onFocus({ lng: z.lng, lat: z.lat }, -top / 2, Math.min(18, Math.max(3, zoomFor(z.radiusM, z.lat, room * 0.7))));
        onLines([{ id: `zone-${z.id}`, path: circlePath(z, z.radiusM), color: z.lifted ? "gray" : "blue", solid: !z.lifted }]);
      })
      .catch((e) => {
        if (!live) return;
        const shut = e instanceof AdminError && Boolean(e.gate);
        setNote({ text: shut ? "先去管理台输验证码，再回来看。" : errorWords(e), shut });
      });
    return () => {
      live = false;
    };
  }, [id, onFocus, onLines]);
  useEffect(() => () => onLines([]), [onLines]);

  return (
    <section ref={barEl} className="zone-top" aria-label="禁放区">
      <div className="zone-top-head">
        <strong>{zone ? `${zone.lifted ? "这一处已经解除了" : "这是你圈的禁放区"}：${zone.label}` : note ? "看不了这一处" : "正在读取…"}</strong>
        <button type="button" className="rep-btn small" onClick={onClose}>
          收起
        </button>
      </div>
      {note && (
        <p className="rep-note" role="alert">
          {note.text}
          {note.shut && (
            <>
              {" "}
              <a href="/admin">去管理台</a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
