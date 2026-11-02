import { AMIYA_NAME } from "@/lib/amiya";
import { roachIconUrl } from "@/lib/roachImages";
import { iconPx } from "@/lib/swarm";
import { GUIDE_AVATAR } from "@/lib/types";
import type { MapViewProps } from "./types";

/**
 * 阿米娅向导 on either map: one page element rather than a roach in the crowd, so
 * she keeps her picture in 写实 and stays on top. A little bigger than a roach,
 * her name under her once a city can be made out, and what she says over her head.
 */

/** How much bigger than a roach she is drawn */
const SCALE = 1.3;
/** Her name shows from this zoom (MapLibre levels) */
const NAMED_FROM = 6;

// never so small that a finger cannot find her
export const amiyaSize = (zoom: number) => Math.max(18, Math.round(iconPx(zoom) * SCALE));

export function amiyaElement() {
  const el = document.createElement("div");
  el.className = "amiya-marker";
  el.innerHTML = `<p class="amiya-bubble" hidden></p><img alt="${AMIYA_NAME}" draggable="false"/><span class="amiya-name">${AMIYA_NAME}</span>`;
  return el;
}

let drawn = 0;

/** Bring her element up to date for this zoom (MapLibre levels) and what the page says about her. */
export function updateAmiya(el: HTMLElement, zoom: number, amiya: MapViewProps["amiya"]) {
  const size = amiyaSize(zoom);
  el.style.setProperty("--amiya-size", `${size}px`);
  el.classList.toggle("named", zoom >= NAMED_FROM);
  const bubble = el.querySelector<HTMLElement>(".amiya-bubble")!;
  bubble.textContent = amiya.bubble ?? "";
  bubble.hidden = !amiya.bubble;
  const img = el.querySelector<HTMLImageElement>("img")!;
  const want = amiya.friend ? "friend" : "plain";
  if (img.dataset.look === want) return;
  img.dataset.look = want;
  const seq = ++drawn;
  // her picture with a pink ground and a heart once she is a 触须之交; drawn large once, shown at any size
  roachIconUrl("pink", { avatar: GUIDE_AVATAR, friend: amiya.friend }, 128)
    .then((url) => {
      if (seq === drawn) img.src = url;
    })
    .catch(() => {});
}
