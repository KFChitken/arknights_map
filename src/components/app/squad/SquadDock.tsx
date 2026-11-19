"use client";

import { T } from "@/i18n";
import type { SquadMove, SquadRoom } from "@/lib/squad";
import { dockTabs, type DockTab } from "./dockState";
import { ActTab, RoundTab, SayTab } from "./SquadTalk";
import "./squadFight.css";

/**
 * The panel of the bar beside 卫戍 on a computer (loaded with it): the tabs 说话 · 动作, and 这局 while a round plays
 * (its dot while the player has not looked at a round they marked no strategy for), and the arrow folding it down to
 * them, and under them the tab's page, which stays as one taps: lines said one after another, a pose or a move done,
 * 这局's picks. A move to a teammate (击掌, 贴贴) is picked on the bar's tiles (picking). Folded, a tab tapped opens
 * it on that tab.
 */
export default function SquadDock({
  room,
  tab,
  folded,
  unseen,
  picking,
  onTab,
  onFold,
  onPick,
  onError,
}: {
  room: SquadRoom;
  tab: DockTab;
  folded: boolean;
  unseen: boolean;
  picking: SquadMove | null;
  onTab: (tab: DockTab) => void;
  onFold: (folded: boolean) => void;
  onPick: (move: SquadMove | null) => void;
  onError: (e: unknown) => void;
}) {
  const tabs = dockTabs(room.state === "go");
  return (
    <div className={`sq-dock${folded ? " folded" : ""}`}>
      <div className="tabs">
        <div className="sq-tabs3" role="tablist">
          {tabs.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={!folded && tab === k} className={!folded && tab === k ? "on" : ""} onClick={() => onTab(k)}>
              {T.squad.talk.tabs[k]}
              {k === "round" && unseen && <span className="dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="fold"
          aria-label={folded ? T.squad.fight.unfold : T.squad.fight.fold}
          aria-expanded={!folded}
          onClick={() => onFold(!folded)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={folded ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {!folded && (
        <div className="body" role="tabpanel">
          {tab === "say" ? (
            <SayTab room={room} onDone={() => {}} docked />
          ) : tab === "act" ? (
            <ActTab room={room} onDone={() => {}} onError={onError} docked picking={picking} onPick={onPick} />
          ) : (
            <RoundTab room={room} onError={onError} />
          )}
        </div>
      )}
    </div>
  );
}
