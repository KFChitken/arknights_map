"use client";

import { fmtParts, T } from "@/i18n";
import { GUIDES, type GuideId } from "@/lib/guides";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/**
 * One of the five guides (src/lib/guides.ts), opened from wherever the layout puts them (src/components/app/chrome):
 * what they do, with a button that takes the map to them.
 */

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
