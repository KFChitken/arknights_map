"use client";

import { T } from "@/i18n";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import RoachIcon from "../RoachIcon";
import Sheet from "./Sheet";

/**
 * 地图上看哪些蟑螂 (只看本体): every roach, or each player's main roach only. Opened from the counts at the top and
 * from 资料; a choice takes at once, with nothing to save (the page shows it first, and goes back if the server
 * says no). Drawn with the player's own look: a main roach with its clone for 全部, the main roach alone otherwise.
 */
export default function OnlyMainsSheet({
  onlyMains,
  look,
  onPick,
  onBack,
  onClose,
}: {
  onlyMains: boolean;
  look: { color: RoachColor; avatar: RoachAvatar };
  onPick: (on: boolean) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const choices: { on: boolean; name: string; note: string }[] = [
    { on: false, name: T.onlyMains.all, note: T.onlyMains.allNote },
    { on: true, name: T.onlyMains.mains, note: T.onlyMains.mainsNote },
  ];
  return (
    <Sheet title={T.onlyMains.title} onClose={onClose} onBack={onBack}>
      <div className="only-mains" role="radiogroup" aria-label={T.onlyMains.title}>
        {choices.map((c) => (
          <button key={String(c.on)} className="style-opt" role="radio" aria-checked={onlyMains === c.on} onClick={() => onPick(c.on)}>
            <span className="only-mains-icons" aria-hidden="true">
              <RoachIcon color={look.color} avatar={look.avatar} size={40} />
              {!c.on && <RoachIcon color={look.color} avatar={look.avatar} size={30} clone />}
            </span>
            <span>
              <b>{c.name}</b>
              <small>{c.note}</small>
            </span>
            <svg className="tick" viewBox="0 0 18 18" aria-hidden="true">
              <circle cx="9" cy="9" r="9" fill="#ffd23f" />
              <path d="M5 9.2 L7.8 12 L13 6.5" fill="none" stroke="#1b1d22" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
      <p className="hint">{T.onlyMains.noteHidden}</p>
      <p className="hint">{T.onlyMains.noteAccount}</p>
    </Sheet>
  );
}

/** 「地图上看哪些蟑螂 · 全部 ›」 in 我的资料, after 串门: opens the same sheet as the counts at the top of the map. */
export function OnlyMainsRow({ onlyMains, onOpen }: { onlyMains: boolean; onOpen: () => void }) {
  return (
    <button className="link-row only-mains-row" onClick={onOpen}>
      <span>{T.onlyMains.title}</span>
      <span className="link-row-end">
        <span className="muted">{onlyMains ? T.onlyMains.mains : T.onlyMains.all}</span>
        <span className="chev" aria-hidden="true">
          ›
        </span>
      </span>
    </button>
  );
}
