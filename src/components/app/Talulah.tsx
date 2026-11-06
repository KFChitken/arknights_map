"use client";

import { distanceKm } from "@/lib/geo";
import { MOVES_PER_DAY } from "@/lib/rules";
import { FIRE_AT, TALULAH, TALULAH_NAME } from "@/lib/talulah";
import type { OwnRoach } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/** 塔露拉干员 (src/lib/talulah.ts) on the page: her picture, her introduction, and picking a clone for the fire. */

export const TalulahPicture = ({ size, friend = false }: { size: number; friend?: boolean }) => (
  <RoachIcon color={TALULAH.color} size={size} avatar={TALULAH.avatar} friend={friend} />
);

/** Once, for players with a roach who never sat by her fire. */
export function TalulahIntroSheet({ onGo, onLater }: { onGo: () => void; onLater: () => void }) {
  return (
    <Sheet title={TALULAH_NAME} onClose={onLater}>
      <div className="amiya-greet">
        <TalulahPicture size={96} />
      </div>
      <p className="consent-place">塔露拉上岛了。她在哈尔滨太阳岛点了一堆篝火，派一只克隆体过去坐坐吧。</p>
      <div className="consent-actions">
        <button className="primary wide" onClick={onGo}>
          去火边看看
        </button>
        <button className="pill" onClick={onLater}>
          以后再说
        </button>
      </div>
    </Sheet>
  );
}

const km = (r: OwnRoach) => {
  const d = distanceKm(r, FIRE_AT);
  return d < 1 ? `离火 ${Math.round(d * 1000)} 米` : `离火 ${Math.round(d).toLocaleString()} 公里`;
};

/** All clones are out: which one goes to sit by the fire, as a move. */
export function FireMoveSheet({
  clones,
  movesLeft,
  onPick,
  onClose,
}: {
  clones: OwnRoach[];
  movesLeft: number;
  onPick: (roach: OwnRoach) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="挪哪只克隆体过去？" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        算一次挪窝，今天还能挪 {movesLeft} 次（每天 {MOVES_PER_DAY} 次）。
      </p>
      {clones.map((r, i) => (
        <div className="list-row" key={r.id}>
          <div>
            <strong>克隆体 {i + 1}</strong>
            <p className="muted">{km(r)}</p>
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

// ---- what this browser remembers about her, per player ----

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // without storage, rather say it happened than repeat it on every visit
    return true;
  }
};
const remember = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {}
};
const introKey = (userId: string) => `zhoup.talulahIntro.${userId}`;
const hoodKey = (userId: string) => `zhoup.talulahHood.${userId}`;

export const talulahIntroShown = (userId: string) => remembered(introKey(userId));
export const markTalulahIntroShown = (userId: string) => remember(introKey(userId));
/** Her line to players in the 初始 hood, said once */
export const hoodSaid = (userId: string) => remembered(hoodKey(userId));
export const markHoodSaid = (userId: string) => remember(hoodKey(userId));

/** 清掉我和塔露拉的记录 (local testing only) */
export function forgetTalulahHere(userId: string) {
  try {
    localStorage.removeItem(introKey(userId));
    localStorage.removeItem(hoodKey(userId));
  } catch {}
}
