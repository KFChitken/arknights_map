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
  busy,
  onNew,
  onPick,
  onClose,
}: {
  /** Their name */
  name: string;
  /** How many clones you have out */
  clones: number;
  busy: boolean;
  onNew: () => void;
  onPick: () => void;
  onClose: () => void;
}) {
  const full = clones >= MAX_CLONES;
  return (
    <Sheet title={fmt(T.visit.ask, { name })} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{T.visit.friendsKnow}</p>
      <p className="hint">
        {full
          ? fmt(T.visit.allOut, { max: MAX_CLONES })
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
