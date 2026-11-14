import { groundOnly } from "./flipArt";
import { hoodBody } from "./roachSvg";

/**
 * Each look's own moves: what they draw, on the 64 × 64 grid of roachSvg.ts with its lines and colours, to lay
 * over the roach. Timing lives in globals.css; the scenes are components/app/LookMoves.tsx.
 */

const svg64 = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" overflow="visible" aria-hidden="true">${inner}</svg>`;

/** 初始 waving its right sleeve, over your yellow ground: the sleeve turns in CSS (.hd-sleeve) */
export const wavingHood = (glow: string) => svg64(`${groundOnly("mine")}${hoodBody(glow, { sleeveClass: "hd-sleeve" })}`);

/** 初始's two lamps alone, to light up over it */
export const hoodLamps = (glow: string) =>
  svg64(`<rect x="11" y="35" width="6" height="4" rx="2" fill="${glow}"/><rect x="47" y="35" width="6" height="4" rx="2" fill="${glow}"/>`);

/** Two round eyes popping up on 初始's visor */
export const hoodEyes = () =>
  svg64(`<ellipse cx="25.6" cy="28.4" rx="3.8" ry="4.3" fill="#fff" stroke="#0d0e10" stroke-width="0.8"/><ellipse cx="38.4" cy="28.4" rx="3.8" ry="4.3" fill="#fff" stroke="#0d0e10" stroke-width="0.8"/>
<ellipse cx="26.2" cy="29" rx="1.8" ry="2.2" fill="#1b1d22"/><ellipse cx="39" cy="29" rx="1.8" ry="2.2" fill="#1b1d22"/>
<ellipse cx="26.9" cy="28.1" rx="0.6" ry="0.7" fill="#fff"/><ellipse cx="39.7" cy="28.1" rx="0.6" ry="0.7" fill="#fff"/>`);
