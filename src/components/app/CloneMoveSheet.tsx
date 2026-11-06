"use client";

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
    return d < 1 ? `${from} ${Math.round(d * 1000)} 米` : `${from} ${Math.round(d).toLocaleString()} 公里`;
  };
  return (
    <Sheet title="挪哪只克隆体过去？" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        算一次挪窝，今天还能挪 {movesLeft} 次（每天 {MOVES_PER_DAY} 次）。
      </p>
      {clones.map((r, i) => (
        <div className="list-row" key={r.id}>
          <div>
            <strong>克隆体 {i + 1}</strong>
            <p className="muted">{far(r)}</p>
          </div>
          <div className="row-actions">
            <button className="pill dark" disabled={movesLeft <= 0} onClick={() => onPick(r)}>
              挪过去
            </button>
          </div>
        </div>
      ))}
    </Sheet>
  );
}
