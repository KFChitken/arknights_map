import { GUIDES, type GuideId } from "@/lib/guides";
import { hoodOnHorse } from "@/lib/horseArt";
import { AVATAR_PICTURES, roachIconUrl } from "@/lib/roachImages";
import { HEART } from "@/lib/roachSvg";
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

/** 塔露拉干员's fire, drawn in code: logs, three flames, and sparks that only bigger fires throw */
const FIRE_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true">
<ellipse cx="32" cy="58" rx="19" ry="3.5" fill="#00000033"/>
<rect x="12" y="50" width="40" height="7" rx="3.5" fill="#7a4a2a" transform="rotate(-14 32 53.5)"/>
<rect x="12" y="50" width="40" height="7" rx="3.5" fill="#94592f" transform="rotate(14 32 53.5)"/>
<g class="flames">
<path class="flame f-outer" d="M32 6c5 9 15 17 14 31-1 9-7 15-14 15s-13-6-14-15c-1-9 5-14 7-21 1 5 3 8 6 9-1-7 0-13 1-19z" fill="#ff6a1a"/>
<path class="flame f-mid" d="M32 20c3 6 9 11 8 19-1 6-4 10-8 10s-7-4-8-10c0-6 3-9 5-13 1 3 2 5 4 6-1-4-1-8-1-12z" fill="#ffa21f"/>
<path class="flame f-core" d="M32 32c2 4 5 7 4 11-1 3-2 5-4 5s-3-2-4-5c0-3 2-5 3-7 0 1 1 2 2 2 0-2-1-4-1-6z" fill="#ffe066"/>
</g>
<circle class="spark sp1" cx="21" cy="20" r="1.6" fill="#ffb347"/>
<circle class="spark sp2" cx="43" cy="16" r="1.4" fill="#ffd166"/>
<circle class="spark sp3" cx="27" cy="9" r="1.2" fill="#ffb347"/>
<circle class="spark sp4" cx="38" cy="6" r="1.5" fill="#ff9f43"/>
<circle class="spark sp5" cx="16" cy="12" r="1.1" fill="#ffd166"/>
<circle class="spark sp6" cx="48" cy="9" r="1.2" fill="#ffb347"/>
</svg>`;

/** The heart a 触须之交 sees beside him (roachSvg's, on its own) */
const HEART_SVG = `<svg class="minghe-heart" viewBox="46 4 16 16" aria-hidden="true">${HEART}</svg>`;

/** Sparks round his picture now and then (he is electromagnetic); still when motion is turned down */
const SPARKS_SVG = `<svg class="minghe-sparks" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="#8fe8ff" stroke-linejoin="round" stroke-linecap="round">
<polyline class="mh-bolt" points="56,38 60,43 56.5,45 61,51" stroke-width="2"/>
<polyline class="mh-bolt b2" points="5,24 9,29 5,31 9,37" stroke-width="1.8"/>
<polyline class="mh-bolt b3" points="44,52 48,56 45,58 49,62" stroke-width="1.6"/>
</svg>`;

/** The ground under 明河都尉's horse: a shadow, pink for a 触须之交 */
const GROUND_SVG = `<svg class="minghe-ground" viewBox="0 0 64 8" aria-hidden="true"><ellipse class="mh-ground" cx="32" cy="4" rx="27" ry="3"/></svg>`;

export function guideElement(id: GuideId) {
  const el = document.createElement("div");
  el.className = "guide-marker";
  el.dataset.guide = id;
  const name = GUIDES[id].name;
  if (id !== "minghe") {
    el.innerHTML = `<p class="guide-bubble" hidden></p><img alt="${name}" draggable="false"/><span class="guide-name">${name}</span>`;
    return el;
  }
  // his picture with sparks of electricity flickering round it; a white-lit hood on a horse drawn in code when it will not load
  el.innerHTML = `<p class="guide-bubble" hidden></p>${GROUND_SVG}<span class="minghe-flip"><img class="minghe-pic" alt="${name}" draggable="false"/>${SPARKS_SVG}<span class="minghe-plain">${hoodOnHorse()}</span></span>${HEART_SVG}<span class="guide-name">${name}</span>`;
  const img = el.querySelector<HTMLImageElement>(".minghe-pic")!;
  img.addEventListener("error", () => el.classList.add("plain"));
  img.src = AVATAR_PICTURES.minghe!;
  return el;
}

/** How big her element is: 明河都尉 on his horse takes more room */
export const guideBox = (mark: GuideMark, zoom: number) => (mark.ride ? Math.round(guideSize(zoom) * 1.5) : guideSize(zoom));

/**
 * Where her element goes relative to the spot it marks, in screen pixels: 塔露拉干员 stands
 * just west of her fire, so the spot is the fire's own (where the seats ring round it);
 * 明河都尉 rides a little ahead of the station, where his riders queue behind him;
 * the others stand on theirs. box: guideBox.
 */
export function guideShift(mark: GuideMark, box: number): [number, number] {
  if (mark.fire) return [-Math.round(box * 0.73), -Math.round(box * 0.4)];
  if (mark.ride) {
    const a = (mark.ride.ahead * Math.PI) / 180;
    return [Math.round(Math.sin(a) * box * 0.42), Math.round(-Math.cos(a) * box * 0.42)];
  }
  return [0, 0];
}

const drawn = new WeakMap<HTMLElement, number>();
let seq = 0;

/** Bring her element up to date for this zoom (MapLibre levels) and what the page says about her. */
export function updateGuide(el: HTMLElement, zoom: number, mark: GuideMark) {
  const guide = GUIDES[mark.id];
  el.style.setProperty("--guide-size", `${guideBox(mark, zoom)}px`);
  el.classList.toggle("named", zoom >= NAMED_FROM);
  const bubble = el.querySelector<HTMLElement>(".guide-bubble")!;
  bubble.textContent = mark.bubble ?? "";
  bubble.hidden = !mark.bubble;
  if (mark.fire) {
    let fire = el.querySelector<HTMLElement>(".guide-fire");
    if (!fire) {
      fire = document.createElement("span");
      fire.innerHTML = FIRE_SVG;
      el.append(fire);
    }
    fire.className = `guide-fire fire-${mark.fire}`;
  }
  if (mark.ride) {
    // he faces the way he goes, with a pink ground and a heart for a 触须之交
    el.classList.add("minghe-marker");
    el.classList.toggle("left", Math.sin((mark.ride.ahead * Math.PI) / 180) < 0);
    el.classList.toggle("friend", mark.friend);
    return;
  }
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
