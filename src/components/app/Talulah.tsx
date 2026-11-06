"use client";

import { TALULAH, TALULAH_NAME } from "@/lib/talulah";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/** 塔露拉干员 (src/lib/talulah.ts) on the page: her picture and her introduction (CloneMoveSheet picks a clone for the fire). */

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
