import { GLOW, hoodBody } from "./roachSvg";

/**
 * 怒骊, 明河都尉's black horse, drawn in code (src/lib/minghe.ts): what he rides
 * without his picture, with a white-lit hood on its back. Facing right; now and then it
 * swishes its tail and a spark of electricity flickers round it (he is electromagnetic),
 * which the page's CSS plays (.mh-tail, .mh-bolt) and a still drawing leaves out.
 */
const HORSE = `<g fill="#16171b" stroke="#050506" stroke-width="2" stroke-linejoin="round">
<path class="mh-tail" d="M24 31 C13 30 6 38 7 51 C11 45 15 42 19 42 C17 47 18 52 21 55 C22 47 25 41 29 37 Z"/>
<rect x="25" y="40" width="7.5" height="18" rx="3"/>
<rect x="34" y="41" width="7.5" height="17" rx="3"/>
<rect x="56" y="41" width="7.5" height="17" rx="3"/>
<rect x="65" y="40" width="7.5" height="18" rx="3"/>
<rect x="21" y="26" width="54" height="22" rx="11"/>
<path d="M60 33 L65 13 Q69 7 76 9 L76 34 Z"/>
<path d="M67 9 Q71 3 79 5 L90.5 15.5 Q94 20 89.5 23 L81 23 Q74.5 22.5 71 18 Z"/>
<path d="M70.5 7 L72 -0.5 L76 5 Z"/>
</g>
<g fill="#3a3d45"><rect x="25" y="55" width="7.5" height="3.5" rx="1.5"/><rect x="34" y="55" width="7.5" height="3.5" rx="1.5"/><rect x="56" y="55" width="7.5" height="3.5" rx="1.5"/><rect x="65" y="55" width="7.5" height="3.5" rx="1.5"/></g>
<path d="M66 9.5 Q60 19 58.5 31 L62.5 31 Q64 20 69.5 10.5 Z" fill="#4aa8ff"/>
<path d="M29 29 Q48 25.5 68 29" fill="none" stroke="#3a3f4a" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="79.5" cy="12.5" r="1.7" fill="#8fe8ff"/>
<polyline class="mh-bolt" points="77,40 82,45 77.5,47 84,53" fill="none" stroke="#8fe8ff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
<polyline class="mh-bolt b2" points="14,24 18,29 13.5,31 18,36" fill="none" stroke="#8fe8ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

/** The white-lit 初始 hood riding 怒骊, as one square SVG with the hooves at the bottom edge, like the guides' pictures */
export function hoodOnHorse() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
<g transform="translate(0 37)">${HORSE}</g>
<g transform="translate(28.8 29.5) scale(0.6)">${hoodBody(GLOW.white)}</g>
</svg>`;
}

let url: string | null = null;
/** hoodOnHorse as an image address, for drawing on a canvas */
export function hoodOnHorseUrl() {
  url ??= `data:image/svg+xml;charset=utf-8,${encodeURIComponent(hoodOnHorse())}`;
  return url;
}
