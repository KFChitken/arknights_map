"use client";

import { fmt, T } from "@/i18n";
import { MAX_CLONES, PLACEMENTS_PER_DAY } from "@/lib/rules";
import Sheet from "./Sheet";

/**
 * 做客, asked first: a new clone goes over (one of the day's placements) while there is
 * room for one, else one already out is moved over (one of the day's moves).
 */
export default function VisitSheet({
  name,
  clones,
  ink = false,
  busy,
  onNew,
  onPick,
  onClose,
}: {
  /** Their name */
  name: string;
  /** How many clones you have out */
  clones: number;
  /** 墨小强 is on the map, one of the MAX_CLONES (src/lib/si.ts) */
  ink?: boolean;
  busy: boolean;
  onNew: () => void;
  onPick: () => void;
  onClose: () => void;
}) {
  const full = clones + (ink ? 1 : 0) >= MAX_CLONES;
  return (
    <Sheet title={fmt(T.visit.ask, { name })} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{T.visit.friendsKnow}</p>
      <p className="hint">
        {full
          ? fmt(ink ? T.visit.allOutInk : T.visit.allOut, { max: MAX_CLONES })
          : fmt(T.visit.newOne, { n: PLACEMENTS_PER_DAY })}
        {T.visit.goHomeNote}
      </p>
      <div className="consent-actions">
        <button className="primary wide" disabled={busy} onClick={full ? onPick : onNew}>
          {full ? T.visit.pickOne : T.visit.sendNew}
        </button>
        <button className="pill" onClick={onClose}>
          {T.common.neverMind}
        </button>
      </div>
    </Sheet>
  );
}
