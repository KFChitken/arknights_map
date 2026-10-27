"use client";

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
  onClose: () => void;
}) {
  const main = roaches.find((r) => r.slot === 0);
  const clones = roaches.filter((r) => r.slot > 0);

  return (
    <Sheet title="我的蟑螂" onClose={onClose}>
      {main ? (
        <div className="list-row">
          <RoachIcon color={color} size={40} avatar={avatar} mine look={look} />
          <div>
            <strong>蟑螂本体</strong>
            <p className="muted">别人能看到它在哪，但看不出是你</p>
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onFind(main)}>
              找到
            </button>
            <button className="pill" onClick={() => onMove(main)}>
              挪窝
            </button>
          </div>
        </div>
      ) : (
        <button className="primary wide" onClick={onPlaceMain}>
          放下蟑螂本体
        </button>
      )}

      <h3>
        克隆体 {clones.length}/{MAX_CLONES}
      </h3>
      {clones.map((c, i) => (
        <div className="list-row" key={c.id}>
          <RoachIcon color={color} size={40} avatar={avatar} mine clone look={look} />
          <div>
            <strong>克隆体 {i + 1}</strong>
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onFind(c)}>
              找到
            </button>
            <button className="pill" onClick={() => onMove(c)}>
              挪窝
            </button>
            <button className="pill" onClick={() => onRemove(c)}>
              收回
            </button>
          </div>
        </div>
      ))}
      {main && clones.length < MAX_CLONES && (
        <button className="pill dark" style={{ marginTop: 10 }} onClick={onAddClone}>
          ＋ 放一只克隆体
        </button>
      )}
      {main && (
        <p className="hint">
          每天能挪 {MOVES_PER_DAY} 次窝，今天还能挪 {movesLeft} 次。
        </p>
      )}
      <p className="hint">
        克隆体可以放在你常去的别的城市。别人看到的是“某舟P的克隆体”，碰它的触须会传到你这里，但谁也看不出它和你的本体是同一只。
        {!main && " 放下本体之后才能放克隆体。"}
      </p>

      {main && (
        <button className="danger wide" style={{ marginTop: 18 }} onClick={() => onRemove(main)}>
          收回本体（克隆体也会一起收回）
        </button>
      )}
    </Sheet>
  );
}
