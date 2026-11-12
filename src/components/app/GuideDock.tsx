"use client";

import { useEffect, useRef } from "react";
import { GUIDES, type GuideId } from "@/lib/guides";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/**
 * The four guides (src/lib/guides.ts) in a column under 方舟雷达: tap one for what
 * they do, with a button that takes the map to them.
 */

const ORDER: GuideId[] = ["amiya", "perlica", "talulah", "minghe"];

/** What each of them does, in a few lines */
const ABOUT: Record<GuideId, string[]> = {
  amiya: [
    "住在罗德岛，所有舟P共用一只。",
    "碰她，她每天会用一样的方式碰回你一次；大胆碰她就成为触须之交，以后她每天跟你打招呼。",
    "点她，她还会跳舞。",
  ],
  perlica: [
    "住在你的蟑螂本体附近，只有你看得到她站在哪。",
    "答应让她记时间以后，你离开满 10 分钟再回来，她会告诉你离开了多久。",
    "成为触须之交以后，她会吃醋、每周发监督周报，你醉倒时还会守在旁边。",
  ],
  talulah: [
    "在哈尔滨太阳岛守着一堆篝火。",
    "派一只克隆体去烤火，火边的蟑螂越多，火烧得越旺。",
    "大胆碰她会跟你握手，成为触须之交。",
  ],
  minghe: [
    "骑着怒骊每天换一座城市，30 站走一圈，身后连着一串星点。",
    "派一只克隆体跟他走 7 站，每天到一座新城市，让各地的舟P碰到你。",
  ],
};

export function GuideDock({ onOpen }: { onOpen: (id: GuideId) => void }) {
  const ref = useRef<HTMLElement>(null);
  // On a short phone globals.css lifts the column by just enough for its last guide to clear the bottom buttons, but
  // never into the counts at the top. So it needs to know how tall the column is, however many guides it holds and
  // however small a short screen makes them (--guides-h), and how tall the counts are, with whatever rows are put
  // under them (--hud-h). The counts come and go with the column (both are hidden while placing a roach).
  useEffect(() => {
    const nav = ref.current;
    const app = nav?.closest<HTMLElement>(".app");
    if (!nav || !app || typeof ResizeObserver === "undefined") return;
    const hud = app.querySelector<HTMLElement>(".hud");
    const sizes = new ResizeObserver(() => {
      app.style.setProperty("--guides-h", `${nav.getBoundingClientRect().height}px`);
      if (hud) app.style.setProperty("--hud-h", `${hud.getBoundingClientRect().height}px`);
    });
    sizes.observe(nav);
    if (hud) sizes.observe(hud);
    return () => {
      sizes.disconnect();
      app.style.removeProperty("--guides-h");
      app.style.removeProperty("--hud-h");
    };
  }, []);
  return (
    <nav ref={ref} className="guide-dock" aria-label="向导">
      {ORDER.map((id) => (
        <button key={id} onClick={() => onOpen(id)} aria-label={GUIDES[id].name}>
          <RoachIcon color={GUIDES[id].color} size={34} avatar={GUIDES[id].avatar} />
          <small>{GUIDES[id].short}</small>
        </button>
      ))}
    </nav>
  );
}

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
      {ABOUT[id].map((line) => (
        <p key={line} className="guide-about">
          {line}
        </p>
      ))}
      <div className="consent-actions">
        {away ? (
          <p className="hint">{away}</p>
        ) : (
          <button className="primary wide" onClick={onFind}>
            在地图上找到{g.pronoun}
          </button>
        )}
      </div>
    </Sheet>
  );
}
