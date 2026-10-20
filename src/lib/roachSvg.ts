import type { RoachColor } from "./types";

// Front-facing chibi roach: round black hood with antennae, dark visor,
// glowing side lights, white front with X straps, dark grey sleeves.
// The color option only changes the side lights.
export const GLOW: Record<RoachColor, string> = {
  cyan: "#3fd0d4",
  pink: "#ff7eb6",
  gold: "#ffd23f",
  green: "#5be37d",
  purple: "#b48cff",
  orange: "#ff9f43",
  red: "#ff5d5d",
  white: "#e8f1ff",
};

const LINE = "#0d0e10";

export function roachSvg(color: RoachColor, opts: { mine?: boolean; size?: number } = {}) {
  const size = opts.size ?? 64;
  const glow = GLOW[color];
  const ground = opts.mine
    ? `<ellipse cx="32" cy="59" rx="25" ry="4.5" fill="#ffd23f" stroke="${LINE}" stroke-width="1.5"/>`
    : `<ellipse cx="32" cy="59.5" rx="20" ry="3" fill="#000" opacity="0.18"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
${ground}
<g fill="none" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round">
  <path d="M27 14 C24 7 17 3 8 4"/><path d="M36 13 C38 6 43 2 51 2"/>
</g>
<rect x="9" y="33" width="15" height="25" rx="5" fill="#33363d" stroke="${LINE}" stroke-width="2"/>
<rect x="40" y="33" width="15" height="25" rx="5" fill="#33363d" stroke="${LINE}" stroke-width="2"/>
<path d="M22 40 L42 40 L43.5 57.5 L20.5 57.5 Z" fill="#fff" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>
<path d="M23.5 42.5 L40.5 50 M40.5 42.5 L23.5 50" stroke="${LINE}" stroke-width="1.8" stroke-linecap="round"/>
<path d="M10 40 C10 22 20 12 32 12 C44 12 54 22 54 40 C54 43 51 44 48 42 L16 42 C13 44 10 43 10 40 Z" fill="#1d1f24" stroke="${LINE}" stroke-width="2"/>
<path d="M14.5 37 C14.5 25 22 17.5 32 17.5 C42 17.5 49.5 25 49.5 37" fill="none" stroke="#3a3e46" stroke-width="1.6"/>
<rect x="17" y="21" width="30" height="15" rx="6" fill="#08080a"/>
<rect x="19.5" y="22.8" width="25" height="3.6" rx="1.8" fill="#50555e"/>
<ellipse cx="22.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85"/>
<ellipse cx="41.5" cy="33.5" rx="2.2" ry="1.1" fill="#ff8fa3" opacity="0.85"/>
<rect x="11" y="35" width="6" height="4" rx="2" fill="${glow}"/>
<rect x="47" y="35" width="6" height="4" rx="2" fill="${glow}"/>
</svg>`;
}

export function roachDataUrl(color: RoachColor, opts: { mine?: boolean; size?: number } = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(roachSvg(color, opts))}`;
}
