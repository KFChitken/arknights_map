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

/** How long 佩丽卡监督 rides her 鬼火 to where the main roach moved */
export const BIKE_MS = 1200;

/** Where she sits while keeping watch beside your drunk main roach: just to its right, in screen pixels */
export const besideRight = (box: number): [number, number] => [Math.round(MINE_PX / 2 + box / 2 - 4), 0];

/** A ride whose nonce is older than this was started for a map that is gone, and is not played again */
const RIDE_FRESH_MS = 3000;
export const freshRide = (mark: GuideMark, el: HTMLElement) => {
  if (!mark.arrive || el.dataset.arrived === String(mark.arrive.nonce)) return false;
  el.dataset.arrived = String(mark.arrive.nonce);
  return Date.now() - mark.arrive.nonce < RIDE_FRESH_MS;
};

/** 佩丽卡监督's 鬼火: a little motorbike drawn in code, a strip of lights along it running through colours */
const BIKE_SVG = `<svg viewBox="0 0 64 30" aria-hidden="true">
<circle cx="13" cy="21" r="7" fill="#1d1f24" stroke="#0d0e10" stroke-width="2"/><circle cx="13" cy="21" r="2.6" fill="#9aa3b2"/>
<circle cx="51" cy="21" r="7" fill="#1d1f24" stroke="#0d0e10" stroke-width="2"/><circle cx="51" cy="21" r="2.6" fill="#9aa3b2"/>
<path d="M10 17 L22 9 L44 9 L54 17 L46 19 L18 19 Z" fill="#2c3140" stroke="#0d0e10" stroke-width="2" stroke-linejoin="round"/>
<path class="bike-lights" d="M18 15 L46 15" stroke="#ff4fd8" stroke-width="3" stroke-linecap="round"/>
<path d="M44 9 L50 3 L55 3" fill="none" stroke="#0d0e10" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;

/**
 * Where 佩丽卡监督's ride starts, as an offset from where she stops (to, on screen):
 * just past the screen's edge in the direction of where she stood before (from), or
 * the left edge when that is unknown. w and h: the map's size on screen.
 */
export function rideStart(to: { x: number; y: number }, from: { x: number; y: number } | null, w: number, h: number, margin = 40) {
  if (!from || Math.hypot(from.x - to.x, from.y - to.y) < 1) return [-margin - to.x, 0] as [number, number];
  const ux = (from.x - to.x) / Math.hypot(from.x - to.x, from.y - to.y);
  const uy = (from.y - to.y) / Math.hypot(from.x - to.x, from.y - to.y);
  // how far along that way to the edge of the screen, widened by the margin
  const along = (p: number, u: number, size: number) => (u > 0 ? (size + margin - p) / u : u < 0 ? (-margin - p) / u : Infinity);
  const t = Math.max(0, Math.min(along(to.x, ux, w), along(to.y, uy, h)));
  return [Math.round(ux * t), Math.round(uy * t)] as [number, number];
}

const riding = new WeakMap<HTMLElement, number>();

/**
 * 佩丽卡监督 rides her 鬼火 in from offset (screen pixels) to her spot, slowing down,
 * and the bike stays a moment after she stops, then fades. Nothing moves, and no
 * bike shows, when motion is turned down.
 */
export function rideIn(el: HTMLElement, offset: [number, number], ms: number) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!el.querySelector(".guide-bike")) {
    const bike = document.createElement("span");
    bike.className = "guide-bike";
    bike.innerHTML = BIKE_SVG;
    el.append(bike);
  }
  el.classList.add("riding");
  el.style.transition = "none";
  el.style.translate = `${offset[0]}px ${offset[1]}px`;
  // the start takes effect before the ride does
  void el.offsetWidth;
  el.style.transition = `translate ${ms}ms cubic-bezier(0.15, 0.65, 0.3, 1)`;
  el.style.translate = "0px 0px";
  window.clearTimeout(riding.get(el));
  riding.set(
    el,
    window.setTimeout(() => el.classList.remove("riding"), ms + 2000),
  );
}

/** 阿米娅向导's dance (an animation by 疚刃 on bilibili), fetched once when she is first tapped; null where it is switched off */
const DANCE_URL = "/guide-art/amiya-dance.webp";
let dance: Promise<Blob | null> | null = null;
const danceBlob = () =>
  (dance ??= fetch(DANCE_URL)
    .then((r) => (r.ok ? r.blob() : null))
    .catch(() => {
      dance = null;
      return null;
    }));
const dancing = new WeakMap<HTMLElement, string>();

/** Fetch her dance ahead of a tap (once she is on screen), so the first tap starts it at once */
export const preloadDance = () => void danceBlob();

/**
 * She dances in place of her picture, bigger, from the first step (a fresh copy of the
 * animation each time, so it starts over), and stands still again when the page says so.
 */
function updateDance(el: HTMLElement, mark: GuideMark) {
  let img = el.querySelector<HTMLImageElement>(".guide-dance");
  const want = mark.dance ? String(mark.dance) : "";
  if (!want) {
    el.classList.remove("dance-wait");
    if (!img) return;
    el.classList.remove("dancing");
    const url = dancing.get(el);
    if (url) URL.revokeObjectURL(url);
    dancing.delete(el);
    img.remove();
    return;
  }
  if (img?.dataset.dance === want) return;
  if (!img) {
    img = document.createElement("img");
    img.className = "guide-dance";
    img.alt = "";
    img.draggable = false;
    el.append(img);
  }
  img.dataset.dance = want;
  const shown = img;
  // a hop on the spot while the dance is still on its way
  el.classList.add("dance-wait");
  danceBlob().then((blob) => {
    if (shown.dataset.dance !== want || !shown.isConnected) return;
    el.classList.remove("dance-wait");
    if (!blob) return;
    const old = dancing.get(el);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(blob);
    dancing.set(el, url);
    shown.src = url;
    el.classList.add("dancing");
  });
}

/** Bring her element up to date for this zoom (MapLibre levels) and what the page says about her. */
export function updateGuide(el: HTMLElement, zoom: number, mark: GuideMark) {
  const guide = GUIDES[mark.id];
  el.style.setProperty("--guide-size", `${guideBox(mark, zoom)}px`);
  el.classList.toggle("named", zoom >= NAMED_FROM);
  const bubble = el.querySelector<HTMLElement>(".guide-bubble")!;
  bubble.textContent = mark.bubble ?? "";
  bubble.hidden = !mark.bubble;
  if (mark.dance || el.classList.contains("dancing") || el.querySelector(".guide-dance")) updateDance(el, mark);
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
