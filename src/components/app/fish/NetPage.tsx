"use client";

import { fmt, T } from "@/i18n";
import type { FishHaul } from "@/lib/fish/rules";
import FishCard, { nameOf } from "./FishCard";

/**
 * 收网 (自动钓 ④), as the game's 获得物资 brings a task's rewards: the bank dark under its dot grid, the crate and 收网了
 * with the casts it took, each item once on its disc with how many came where the game writes how many, NEW at the
 * corner of one new to the dex, its name under it; a round ✓, and a tap anywhere closes it.
 */
export default function NetPage({ haul, onClose }: { haul: FishHaul; onClose: () => void }) {
  const t = T.fish.net;
  return (
    <button type="button" className="fish-got fish-netgot" onClick={onClose} aria-label={fmt(t.pulled, { n: haul.casts })}>
      <span className="in">
        <span className="box">
          <svg width="62" height="58" viewBox="0 0 62 58" aria-hidden="true">
            <path d="M8 18 L29 8 L50 18 L29 28 Z" fill="#d9d9d9" />
            <path d="M8 18 L29 28 L29 54 L8 44 Z" fill="#bdbdbd" />
            <path d="M50 18 L29 28 L29 54 L50 44 Z" fill="#a3a3a3" />
            <path d="M18 13 L39 23 L39 32 L44 29.5 L44 20.5 L23 10.5 Z" fill="#8a8a8a" />
            <path d="M33 39 l3 -1.4 v8 l-3 1.4 Z M38 36.6 l3 -1.4 v8 l-3 1.4 Z M43 34.2 l3 -1.4 v8 l-3 1.4 Z" fill="#7a7a7a" />
            <path d="M52 2 h3 v6 h6 v3 h-6 v6 h-3 v-6 h-6 v-3 h6 Z" fill="#d9d9d9" />
          </svg>
          <span>{t.title}</span>
          <small>{fmt(t.pulled, { n: haul.casts })}</small>
        </span>
        <span className="halo" aria-hidden="true" />
        <span className="haul">
          {haul.items.map((i) => (
            <span key={`${i.no}:${i.variant}`} className="one">
              <span className="dk">
                <FishCard no={i.no} variant={i.variant} size={72} count={i.n} />
                {i.first && <em className="fish-new">{T.fish.banner.fresh}</em>}
              </span>
              <span className="nm">{nameOf(i.no, i.variant)}</span>
            </span>
          ))}
        </span>
        <span className="ok" aria-hidden="true">
          <svg width="26" height="20" viewBox="0 0 26 20">
            <path d="M2 10 L10 17 L24 3" fill="none" stroke="#d6d6d6" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </span>
    </button>
  );
}
