import { GUIDES, type GuideId } from "@/lib/guides";
import { roachIconUrl } from "@/lib/roachImages";
import { iconPx } from "@/lib/swarm";
import type { GuideMark } from "./types";

/**
 * A guide (src/lib/guides.ts) on either map: one page element rather than a roach
 * in the crowd, so she keeps her picture in 写实 and stays on top. A little bigger
 * than a roach, her name under her once a city can be made out, and what she says
 * over her head.
 */

/** How much bigger than a roach she is drawn */
const SCALE = 1.3;
/** Her name shows from this zoom (MapLibre levels) */
const NAMED_FROM = 6;
/** Your own roaches are drawn this big at any zoom, on both maps */
export const MINE_PX = 48;
/** How far her name hangs below her */
const NAME_PX = 18;

// never so small that a finger cannot find her
export const guideSize = (zoom: number) => Math.max(18, Math.round(iconPx(zoom) * SCALE));
/** What hangs below her at this zoom: her name, or nothing */
export const belowGuide = (zoom: number) => (zoom >= NAMED_FROM ? NAME_PX : 0);

export function guideElement(id: GuideId) {
  const el = document.createElement("div");
  el.className = "guide-marker";
  el.dataset.guide = id;
  el.innerHTML = `<p class="guide-bubble" hidden></p><img alt="${GUIDES[id].name}" draggable="false"/><span class="guide-name">${GUIDES[id].name}</span>`;
  return el;
}

const drawn = new WeakMap<HTMLElement, number>();
let seq = 0;

/** Bring her element up to date for this zoom (MapLibre levels) and what the page says about her. */
export function updateGuide(el: HTMLElement, zoom: number, mark: GuideMark) {
  const guide = GUIDES[mark.id];
  el.style.setProperty("--guide-size", `${guideSize(zoom)}px`);
  el.classList.toggle("named", zoom >= NAMED_FROM);
  const bubble = el.querySelector<HTMLElement>(".guide-bubble")!;
  bubble.textContent = mark.bubble ?? "";
  bubble.hidden = !mark.bubble;
  const img = el.querySelector<HTMLImageElement>("img")!;
  const want = mark.friend ? "friend" : "plain";
  if (img.dataset.look === want) return;
  img.dataset.look = want;
  const mine = ++seq;
  drawn.set(el, mine);
  // her picture with a pink ground and a heart once she is a 触须之交; drawn large once, shown at any size
  roachIconUrl(guide.color, { avatar: guide.avatar, friend: mark.friend }, 128)
    .then((url) => {
      if (drawn.get(el) === mine) img.src = url;
    })
    .catch(() => {});
}

/**
 * How far to push her off her spot, in screen pixels, so she never covers your
 * main roach (which the maps draw under her): when the two are closer than
 * their icons are wide, she moves away from it along the line between them,
 * just far enough to sit beside it, her name (below: how far it hangs under
 * her) kept off it too. [0, 0] otherwise. her and main are where the map shows
 * them on screen.
 */
export function besideMain(
  her: { x: number; y: number },
  main: { x: number; y: number } | null,
  size: number,
  below = 0,
): [number, number] {
  if (!main) return [0, 0];
  const dx = her.x - main.x;
  const dy = her.y - main.y;
  const d = Math.hypot(dx, dy);
  // right on top of it: step aside upwards
  const [ux, uy] = d > 0.5 ? [dx / d, dy / d] : [0, -1];
  const need = (MINE_PX + size) / 2 + (uy < 0 ? -uy * below : 0);
  if (d >= need) return [0, 0];
  return [Math.round(ux * (need - d)), Math.round(uy * (need - d))];
}
