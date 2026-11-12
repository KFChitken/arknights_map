"use client";

import { fmtParts, T } from "@/i18n";
import { MAX_CLONES, MOVES_PER_DAY } from "@/lib/rules";
import type { RoachAvatar, RoachColor, RoachStyle } from "@/lib/types";
import type { OwnRoach } from "@/lib/world/types";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

export default function MineSheet({
  roaches,
  movesLeft,
  avatar,
  color,
  look,
  onFind,
  onMove,
  onRemove,
  onPlaceMain,
  onAddClone,
  ink = false,
  onClose,
}: {
  roaches: OwnRoach[];
  movesLeft: number;
  avatar: RoachAvatar;
  color: RoachColor;
  look: RoachStyle;
  onFind: (r: OwnRoach) => void;
  onMove: (r: OwnRoach) => void;
  onRemove: (r: OwnRoach) => void;
  onPlaceMain: () => void;
  onAddClone: () => void;
  /** 墨小强 is on the map (src/lib/si.ts), one of the MAX_CLONES */
  ink?: boolean;
  onClose: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);
  const out = clones.length + (ink ? 1 : 0);

  return (
    <Sheet title={T.common.myRoach} onClose={onClose}>
      {main ? (
        <div className="list-row">
          <RoachIcon color={color} size={40} avatar={avatar} mine look={look} />
          <div>
            <strong>{T.mine.main}</strong>
            <p className="muted">{T.mine.mainNote}</p>
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onFind(main)}>
              {T.common.find}
            </button>
            <button className="pill" onClick={() => onMove(main)}>
              {T.mine.move}
            </button>
          </div>
        </div>
      ) : (
        <button className="primary wide" onClick={onPlaceMain}>
          {T.mine.placeMain}
        </button>
      )}

      <h3>
        {fmtParts(ink ? T.mine.clonesInk : T.mine.clones, { n: out, max: MAX_CLONES })}
      </h3>
      {clones.map((c, i) => (
        <div className="list-row" key={c.id}>
          <RoachIcon color={color} size={40} avatar={avatar} mine clone look={look} />
          <div>
            <strong>{fmtParts(T.common.cloneN, { n: i + 1 })}</strong>
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onFind(c)}>
              {T.common.find}
            </button>
            <button className="pill" onClick={() => onMove(c)}>
              {T.mine.move}
            </button>
            <button className="pill" onClick={() => onRemove(c)}>
              {T.common.takeBack}
            </button>
          </div>
        </div>
      ))}
      {main && out < MAX_CLONES && (
        <button className="pill dark" style={{ marginTop: 10 }} onClick={onAddClone}>
          {T.mine.addClone}
        </button>
      )}
      {main && (
        <p className="hint">
          {fmtParts(T.mine.movesLeft, { perDay: MOVES_PER_DAY, left: movesLeft })}
        </p>
      )}
      <p className="hint">
        {T.mine.cloneNote}
        {!main && T.mine.mainFirst}
      </p>

      {main && (
        <button className="danger wide" style={{ marginTop: 18 }} onClick={() => onRemove(main)}>
          {T.mine.removeMain}
        </button>
      )}
    </Sheet>
  );
}
