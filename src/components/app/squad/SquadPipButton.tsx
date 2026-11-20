"use client";

import { useEffect, useState } from "react";
import { T } from "@/i18n";
import { closeSquadPip, openSquadPip, pipSupported, useSquadPip } from "./miniState";

/**
 * 弹出小窗, on the bar beside 卫戍 on a computer: the room small in a window over everything (SquadMini.tsx SquadPip),
 * opened, or (open) closed again. Nothing where the browser has no such window (Safari, phones).
 */
export default function SquadPipButton({ onError }: { onError: (e: unknown) => void }) {
  const pip = useSquadPip();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(pipSupported()), []);
  if (!ok) return null;
  const t = T.squad.mini;
  return (
    <button
      type="button"
      className={`sq-pipbtn${pip ? " on" : ""}`}
      aria-label={pip ? t.pipOnLabel : t.pipLabel}
      aria-pressed={Boolean(pip)}
      onClick={() => (pip ? closeSquadPip() : void openSquadPip().catch(onError))}
    >
      {pip ? t.pipOn : t.pip}
    </button>
  );
}
