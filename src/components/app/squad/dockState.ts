/**
 * The panel of the bar beside 卫戍 on a computer (SquadFight.tsx, SquadDock.tsx): 说话 · 动作 · 这局 under the tiles
 * (这局 while a round plays), folded down to its tabs or not, kept on this computer; the tab a round's start turns it
 * to; what a tap on a tile does, while 击掌 or 贴贴 is picking a teammate on the tiles or not; what the line under a
 * name says while the room waits.
 */
import { T } from "@/i18n";
import type { SquadMember } from "@/lib/squad";

/** Folded: "0" in this computer's storage, nothing while open (as squad.scene) */
const DOCK_KEY = "squad.dock";

export type DockTab = "say" | "act" | "round";

/** The panel's tabs: 这局 only while a round plays */
export const dockTabs = (playing: boolean): DockTab[] => (playing ? ["say", "act", "round"] : ["say", "act"]);

/** Whether the panel is folded down to its tabs on this computer; open where nothing (or no storage) says */
export function dockFolded(): boolean {
  try {
    return window.localStorage.getItem(DOCK_KEY) === "0";
  } catch {
    return false;
  }
}

/** The panel folded or opened: kept on this computer for the next round and page (where storage is there) */
export function keepDockFolded(folded: boolean) {
  try {
    if (folded) window.localStorage.setItem(DOCK_KEY, "0");
    else window.localStorage.removeItem(DOCK_KEY);
  } catch {
    // this page alone, then
  }
}

/**
 * A round started in sight: the panel turns to 这局 once when it is open and the player marked no strategy for the
 * round (as the phone's 说话 / 动作 / 这局 opens there first); folded, 这局's dot alone says so (null: stays as it is)
 */
export const tabAtRound = (folded: boolean, unseen: boolean): DockTab | null => (!folded && unseen ? "round" : null);

/**
 * A tile tapped: your own turns the panel to 这局 (opening it), or while the room waits opens the room's sheet (where
 * the strategy, 准备 and 开始游戏 are), or, while a teammate is being picked, stops picking; a teammate's is the one
 * picked, or else opens TA's card
 */
export const tileTap = (you: boolean, picking: boolean, waiting = false): "round" | "sheet" | "cancel" | "pick" | "card" =>
  you ? (picking ? "cancel" : waiting ? "sheet" : "round") : picking ? "pick" : "card";

/** While the room waits, the line under a name: the host needs no 准备 (你是房主 to TA), the others ready or not */
export function readyOf(m: Pick<SquadMember, "you" | "host" | "inGame">): { text: string; ok: boolean } {
  if (m.host) return { text: m.you ? T.squad.fight.youHost : T.squad.mate.hostNone, ok: false };
  return m.inGame ? { text: T.squad.room.inGameTag, ok: true } : { text: T.squad.room.notReadyTag, ok: false };
}
