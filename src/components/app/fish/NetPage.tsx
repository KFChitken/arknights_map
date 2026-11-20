"use client";

import { fmt, T } from "@/i18n";
import type { FishHaul } from "@/lib/fish/rules";
import FishCard, { nameOf } from "./FishCard";

/**
 * 收网 (自动钓), as the game's 获得物资 brings a task's rewards, over the small window's scene: dark under its dot grid,
 * 收网：n 竿都记进图鉴了, each item once on its disc with how many came where the game writes how many, NEW at the corner
 * of one new to the dex, its name under it; a round ✓ in the corner, and a tap anywhere closes it.
 */
export default function NetPage({ haul, onClose }: { haul: FishHaul; onClose: () => void }) {
  const title = fmt(T.fish.win.hauled, { n: haul.casts });
  return (
    <button type="button" className="fish-got fish-netgot" onClick={onClose} aria-label={title}>
      <span className="halo" aria-hidden="true" />
      <span className="ttl">{title}</span>
      <span className="haul">
        {haul.items.map((i) => (
          <span key={`${i.no}:${i.variant}`} className="one">
            <span className="dk">
              <FishCard no={i.no} variant={i.variant} size={52} count={i.n} />
              {i.first && <em className="fish-new">{T.fish.banner.fresh}</em>}
            </span>
            <span className="nm">{nameOf(i.no, i.variant)}</span>
          </span>
        ))}
      </span>
      <span className="ok" aria-hidden="true">
        <svg width="16" height="12" viewBox="0 0 26 20">
          <path d="M2 10 L10 17 L24 3" fill="none" stroke="#d6d6d6" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
