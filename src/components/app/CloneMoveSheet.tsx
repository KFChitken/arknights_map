"use client";

import { fmt, fmtParts, T } from "@/i18n";
import { distanceKm } from "@/lib/geo";
import { MOVES_PER_DAY } from "@/lib/rules";
import type { LngLat } from "@/lib/types";
import type { OwnRoach } from "@/lib/world/types";
import Sheet from "./Sheet";

/**
 * Every clone is out: which one to move over, to 塔露拉干员's fire or into 明河都尉's
 * queue, each with how far it is from there (from: 「离火」, 「离他」).
 */
export default function CloneMoveSheet({
  clones,
  movesLeft,
  to,
  from,
  onPick,
  onClose,
}: {
  clones: OwnRoach[];
  movesLeft: number;
  to: LngLat;
  from: string;
  onPick: (roach: OwnRoach) => void;
  onClose: () => void;
}) {
  const far = (r: OwnRoach) => {
    const d = distanceKm(r, to);
    return d < 1 ? fmt(T.cloneMove.meters, { from, m: Math.round(d * 1000) }) : fmt(T.cloneMove.km, { from, km: Math.round(d).toLocaleString() });
  };
  return (
    <Sheet title={T.cloneMove.which} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        {fmtParts(T.cloneMove.movesLeft, { left: movesLeft, perDay: MOVES_PER_DAY })}
      </p>
      {clones.map((r, i) => (
        <div className="list-row" key={r.id}>
          <div>
            <strong>{fmtParts(T.common.cloneN, { n: i + 1 })}</strong>
            <p className="muted">{far(r)}</p>
          </div>
          <div className="row-actions">
            <button className="pill dark" disabled={movesLeft <= 0} onClick={() => onPick(r)}>
              {T.cloneMove.move}
            </button>
          </div>
        </div>
      ))}
    </Sheet>
  );
}
