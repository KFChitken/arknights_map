import { MINE_PX } from "./guideMarker";

/**
 * The bubble a shout leaves over the roach it went out from (ShoutMark), drawn the same
 * on both maps: the line in a dark bubble pointing down at the roach, which fades away
 * by itself (globals.css .shout-mark). It never takes a tap.
 */
export function shoutElement(text: string, limited: boolean) {
  const el = document.createElement("div");
  el.className = "shout-mark";
  const bubble = document.createElement("div");
  bubble.className = "shout-bubble";
  if (limited) {
    const tag = document.createElement("span");
    tag.className = "ta-tag";
    tag.textContent = "限定";
    bubble.append(tag);
  }
  bubble.append(document.createTextNode(text));
  el.append(bubble);
  return el;
}

/** How far above the spot the bubble's point sits: just over your roach, which both maps draw MINE_PX across */
export const SHOUT_LIFT = MINE_PX / 2 + 2;
