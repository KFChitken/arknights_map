import { groundOnly } from "./flipArt";
import { LINE } from "./roachLine";
import { hoodBody } from "./roachSvg";
import type { RoachAvatar } from "./types";

/**
 * Each look's own moves: what they draw, on the 64 × 64 grid of roachSvg.ts with its lines and colours, to lay
 * over the roach. Timing lives in globals.css; the scenes are components/app/LookMoves.tsx.
 * Only system fonts: web fonts do not load in mainland China.
 */

const INK = "#1b1d22";
const FONT = "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif";

const svg64 = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" overflow="visible" aria-hidden="true">${inner}</svg>`;
/** A drawing in a box of its own, w × h px */
const svgBox = (viewBox: string, w: number, h: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" overflow="visible" aria-hidden="true">${inner}</svg>`;

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

/** 博士 部署: the deployment tile that lights up under them, seen from the side */
export const deployTile = () =>
  svgBox(
    "0 0 80 28",
    80,
    28,
    `<path d="M3 14 L40 2.4 L77 14 L40 25.6 Z" fill="rgba(79,182,255,0.28)" stroke="#2f8fe0" stroke-width="2" stroke-linejoin="round"/>
<path d="M14.5 14 L40 6.2 L65.5 14 L40 21.8 Z" fill="none" stroke="#8fd0ff" stroke-width="1.3" stroke-dasharray="3 2.4"/>
<path d="M3 14 L40 2.4 L77 14" fill="none" stroke="#e6f5ff" stroke-width="0.9" opacity="0.8"/>`,
  );

/** One of the crystals that drop onto the tile */
export const deployCrystal = () =>
  svgBox(
    "0 0 10 12",
    10,
    12,
    `<path d="M5 0.8 L9 6 L5 11.2 L1 6 Z" fill="#8fd0ff" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/><path d="M5 2.6 L3.2 6" stroke="#fff" stroke-width="0.9" stroke-linecap="round"/>`,
  );

/**
 * 博士 dozing on its feet: a snot bubble at its nose (.dc-snot) and z Z over its head (.dc-zz); touched, the bubble
 * pops (.dc-pop). On the 64 grid, so the one drawing fits the stage and your dock avatar alike.
 */
export const doctorDozing = () =>
  svg64(`<defs><radialGradient id="dc-snot-fill" cx="0.35" cy="0.35" r="0.92" fx="0.35" fy="0.35"><stop offset="0.18" stop-color="#fff"/><stop offset="0.3" stop-color="#cfeeff"/><stop offset="1" stop-color="#9fd6f5"/></radialGradient></defs>
<g class="dc-snot"><circle cx="37.1" cy="29.1" r="4.66" fill="url(#dc-snot-fill)" stroke="#5aa8d6" stroke-width="0.87"/></g>
<g class="dc-pop"><g transform="translate(30.55 22.55) scale(0.7273)" fill="none" stroke="#5aa8d6" stroke-width="1.6" stroke-linecap="round"><path d="M9 1.5 V4.5 M9 13.5 V16.5 M1.5 9 H4.5 M13.5 9 H16.5 M3.7 3.7 L5.8 5.8 M12.2 12.2 L14.3 14.3 M14.3 3.7 L12.2 5.8 M5.8 12.2 L3.7 14.3"/></g></g>
<g class="dc-zz"><text x="46.5" y="11.4" font-size="9.45" font-weight="900" letter-spacing="0.73" font-family="${FONT}" fill="#2b3a67" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" paint-order="stroke">z Z</text></g>`);

/** 博士 shouting: the terminal it holds up first, its screen flickering (.scr) */
export const terminal = () =>
  svgBox(
    "0 0 34 26",
    34,
    26,
    `<rect x="1" y="1" width="32" height="24" rx="3.5" fill="#2a2d34" stroke="${LINE}" stroke-width="1.6"/>
<g class="scr"><rect x="4" y="4" width="26" height="18" rx="1.5" fill="#1fb0c4"/>
<path d="M4.6 15.4 C9 13 12 17.4 17 14.6 C21 12.4 24 15.6 29.4 12.6" fill="none" stroke="#bff3fb" stroke-width="1" opacity="0.7"/>
<path d="M17 6.4 C14.6 6.4 13.2 8.2 13.2 10 C13.2 12.6 17 16.4 17 16.4 C17 16.4 20.8 12.6 20.8 10 C20.8 8.2 19.4 6.4 17 6.4 Z" fill="#ffd23f" stroke="${LINE}" stroke-width="1.1"/>
<circle cx="17" cy="10" r="1.4" fill="${LINE}"/></g>
<circle cx="31.4" cy="13" r="0.8" fill="#50555e"/>`,
  );

/**
 * What each picture look drinks from (摄入酒精), drawn on the 64 grid by its mouth, with the point it tips about
 * (the cup's base, in % of the box). fall: which way it tips over drunk, when not to its right.
 */
type Cup = { origin: string; draw: () => string; fall?: string };
const CUPS: Partial<Record<RoachAvatar, Cup>> = {
  // a mug of coffee
  doctor: {
    origin: "64% 55%",
    draw: () => `<g stroke="${LINE}" stroke-linejoin="round">
  <path d="M43.6 29.4 C47 29 47.6 33.4 44.2 34.2" fill="none" stroke-width="1.5"/>
  <path d="M37 27.2 H44.2 L43.6 34.6 Q43.5 35.6 42.4 35.6 H38.8 Q37.7 35.6 37.6 34.6 Z" fill="#f3f5f8" stroke-width="1.4"/>
  <path d="M37.1 28.4 H44.1" stroke="#c98a2e" stroke-width="1.6"/>
  <path d="M38.6 31 L42.6 31" stroke="#5aa8d6" stroke-width="1.2"/>
  <ellipse cx="40.6" cy="27.2" rx="3.6" ry="0.9" fill="#fff4cf" stroke-width="1"/>
</g>`,
  },
};

/** The cup a look drinks from, drawn a third bigger about its base, or none: it then only wobbles and tips over */
export function drinkCup(look: RoachAvatar) {
  const cup = CUPS[look];
  if (!cup) return null;
  const [ox, oy] = cup.origin.split(" ").map((v) => Math.round(parseFloat(v) * 64) / 100);
  return { origin: cup.origin, fall: cup.fall, svg: `<g transform="translate(${ox} ${oy}) scale(1.35) translate(${-ox} ${-oy})">${cup.draw()}</g>` };
}
