"use client";

import { useEffect, useRef } from "react";
import { fmtParts, T } from "@/i18n";
import { GUIDES, type GuideId } from "@/lib/guides";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/**
 * The five guides (src/lib/guides.ts) in a column under 方舟雷达: tap one for what
 * they do, with a button that takes the map to them.
 */

const ORDER: GuideId[] = ["amiya", "perlica", "talulah", "minghe", "si"];

/** What each of them does, in a few lines; read when shown */
const about = (): Record<GuideId, string[]> => ({
  amiya: [
    T.guides.amiya.about.home,
    T.guides.amiya.about.touch,
    T.guides.amiya.about.dance,
  ],
  perlica: [
    T.guides.perlica.about.home,
    T.guides.perlica.about.timer,
    T.guides.perlica.about.friends,
  ],
  talulah: [
    T.guides.talulah.about.home,
    T.guides.talulah.about.fire,
    T.guides.talulah.about.friends,
  ],
  minghe: [
    T.guides.minghe.about.home,
    T.guides.minghe.about.ride,
  ],
  si: [
    T.guides.si.about.home,
    T.guides.si.about.stamps,
    T.guides.si.about.friends,
  ],
});

export function GuideDock({ onOpen }: { onOpen: (id: GuideId) => void }) {
  const ref = useRef<HTMLElement>(null);
  // On a short phone globals.css lifts the column by just enough for its last guide to clear the bottom buttons, but
  // never into the counts at the top. So it needs to know how tall the column is, however many guides it holds and
  // however small a short screen makes them (--guides-h), and how tall the counts are, with whatever rows are put
  // under them (--hud-h). The counts come and go with the column (both are hidden while placing a roach).
  useEffect(() => {
    const nav = ref.current;
    const app = nav?.closest<HTMLElement>(".app");
    if (!nav || !app || typeof ResizeObserver === "undefined") return;
    const hud = app.querySelector<HTMLElement>(".hud");
    const sizes = new ResizeObserver(() => {
      app.style.setProperty("--guides-h", `${nav.getBoundingClientRect().height}px`);
      if (hud) app.style.setProperty("--hud-h", `${hud.getBoundingClientRect().height}px`);
    });
    sizes.observe(nav);
    if (hud) sizes.observe(hud);
    return () => {
      sizes.disconnect();
      app.style.removeProperty("--guides-h");
      app.style.removeProperty("--hud-h");
    };
  }, []);
  return (
    <nav ref={ref} className="guide-dock" aria-label={T.common.guides}>
      {ORDER.map((id) => (
        <button key={id} onClick={() => onOpen(id)} aria-label={GUIDES[id].name}>
          <RoachIcon color={GUIDES[id].color} size={34} avatar={GUIDES[id].avatar} />
          <small>{GUIDES[id].short}</small>
        </button>
      ))}
    </nav>
  );
}

/** One of them: who they are and what they do, and where they are. away: why the map cannot show them now, if so */
export function GuideSheet({
  id,
  away,
  onFind,
  onClose,
}: {
  id: GuideId;
  away: string | null;
  onFind: () => void;
  onClose: () => void;
}) {
  const g = GUIDES[id];
  return (
    <Sheet title={g.name} onClose={onClose}>
      <div className="amiya-greet">
        <RoachIcon color={g.color} size={96} avatar={g.avatar} />
      </div>
      <p className="hint guide-note">{g.note}</p>
      {about()[id].map((line) => (
        <p key={line} className="guide-about">
          {line}
        </p>
      ))}
      <div className="consent-actions">
        {away ? (
          <p className="hint">{away}</p>
        ) : (
          <button className="primary wide" onClick={onFind}>
            {fmtParts(T.guides.dock.find, { them: g.pronoun })}
          </button>
        )}
      </div>
    </Sheet>
  );
}
