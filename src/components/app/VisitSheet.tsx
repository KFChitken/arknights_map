"use client";

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
    <Sheet title={`派一只克隆体去 ${name} 家做客？`} onClose={onClose}>
      <p style={{ marginTop: 0 }}>你们共同的触须之交认得出这只克隆体是你的。</p>
      <p className="hint">
        {full
          ? `你的 ${MAX_CLONES} 只克隆体都放出去了，挑一只挪过去，算今天的一次挪窝。`
          : `放一只新的过去，算今天放下的 ${PLACEMENTS_PER_DAY} 只里的一只。`}
        随时可以点它回家，回家不算挪窝。
      </p>
      <div className="consent-actions">
        <button className="primary wide" disabled={busy} onClick={full ? onPick : onNew}>
          {full ? "挑一只挪过去" : "派一只新的过去"}
        </button>
        <button className="pill" onClick={onClose}>
          算了
        </button>
      </div>
    </Sheet>
  );
}
