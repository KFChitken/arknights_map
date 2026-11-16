"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { SQUAD_MAX } from "@/lib/squad";
import { ShieldIcon } from "../chrome/parts";
import { useSquadRoom } from "./squading";
import "./squadBar.css";

/**
 * Over the map while the player is in a room of 一起卫戍 and its sheet is shut: 卫戍中 n/4, back to the room at a tap.
 * Just above the layout's bottom bar (data-chrome-bottom), else under the top.
 */
export default function SquadBar({ hidden, onOpen }: { hidden: boolean; onOpen: () => void }) {
  const room = useSquadRoom();
  const [at, setAt] = useState<CSSProperties | null>(null);
  const shown = Boolean(room) && !hidden;
  useEffect(() => {
    if (!shown) return;
    let last = "";
    const look = () => {
      const r = document.querySelector("[data-chrome-bottom]")?.getBoundingClientRect();
      const next: CSSProperties = r && r.height ? { bottom: Math.round(window.innerHeight - r.top + 10) } : { top: 76 };
      const k = JSON.stringify(next);
      if (k === last) return;
      last = k;
      setAt(next);
    };
    look();
    const t = window.setInterval(look, 1_000);
    window.addEventListener("resize", look);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", look);
    };
  }, [shown]);
  if (!room || !shown || !at) return null;
  const n = room.members.length;
  return (
    <button className="sq-bar glass" style={at} aria-haspopup="dialog" aria-label={fmt(T.squad.inRoomLabel, { n, max: SQUAD_MAX })} onClick={onOpen}>
      <ShieldIcon size={18} />
      <span>{fmt(T.squad.inRoom, { n, max: SQUAD_MAX })}</span>
    </button>
  );
}
