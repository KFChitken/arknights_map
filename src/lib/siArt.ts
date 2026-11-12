import type { PaintingTier } from "./si";

/**
 * 祀掌柜's hanging scroll (src/lib/si.ts), drawn in code: today's painting grows on it tier by tier
 * (an ink blot and far hills; hills and pines; 缘缘庄 with smoke from its roof; the moon, ink butterflies
 * and her seal). Also rolled up, for the map from far away, and the 「祀」 seal on its own.
 */

const INK = "#24221f";
const PAPER = "#f7f1e3";
const ROD = "#5b3a24";
export const SEAL_RED = "#c0392b";

/** Her seal: a red square, the character in white (朱文 would be red on white; this small, white reads better) */
export function sealSvg(x: number, y: number, size: number, text = "祀") {
  const fs = size * 0.72;
  return `<g><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.12}" fill="${SEAL_RED}"/><text x="${x + size / 2}" y="${y + size * 0.76}" text-anchor="middle" font-size="${fs}" font-family="'Source Han Serif SC','Noto Serif SC','Songti SC',STSong,serif" font-weight="700" fill="#fff8f0">${text}</text></g>`;
}

/** What is painted on the scroll at a tier, inside a 48 × 84 sheet whose top left is (6, 8) */
function painting(tier: PaintingTier) {
  if (tier === 0) return "";
  const parts: string[] = [];
  // 1: a blot of ink and a few far hills in a pale wash
  parts.push(
    `<path d="M10 70 Q18 60 24 66 Q30 56 38 64 Q44 58 50 66 L50 72 L10 72 Z" fill="${INK}" opacity="0.18"/>`,
    `<ellipse cx="17" cy="78" rx="5" ry="3" fill="${INK}" opacity="0.75"/><ellipse cx="21" cy="80" rx="2.4" ry="1.6" fill="${INK}" opacity="0.6"/><circle cx="13" cy="81" r="1" fill="${INK}" opacity="0.5"/>`,
  );
  if (tier >= 2) {
    // hills in firmer strokes, and two pines on the left
    parts.push(
      `<path d="M8 74 Q16 52 23 62 Q28 46 36 58 Q42 50 52 70" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>`,
      `<path d="M14 84 L14 64" stroke="${INK}" stroke-width="1.4"/><path d="M9 70 L14 64 L19 70 M10 75 L14 69 L18 75 M11 79 L14 74 L17 79" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`,
      `<path d="M21 85 L21 72" stroke="${INK}" stroke-width="1.1"/><path d="M17.5 76 L21 72 L24.5 76 M18 80 L21 76.5 L24 80" fill="none" stroke="${INK}" stroke-width="1.1"/>`,
    );
  }
  if (tier >= 3) {
    // 缘缘庄: white walls, a dark tiled roof with stepped gables, smoke curling up
    parts.push(
      `<rect x="30" y="74" width="18" height="10" fill="#fffdf8" stroke="${INK}" stroke-width="0.9"/>`,
      `<path d="M28.5 74.5 L31 70.5 L47 70.5 L49.5 74.5 Z" fill="${INK}" opacity="0.9"/>`,
      `<path d="M29.5 70.5 L29.5 67.5 L31.5 67.5 L31.5 70.5 M46.5 70.5 L46.5 67.5 L48.5 67.5 L48.5 70.5" fill="${INK}"/>`,
      `<rect x="37.5" y="78" width="3.5" height="6" fill="${INK}" opacity="0.85"/>`,
      `<path d="M44 70 Q42 66 45 63 Q48 60 45.5 56 Q43.5 53 46 50" fill="none" stroke="${INK}" stroke-width="0.8" opacity="0.45" stroke-linecap="round"/>`,
    );
  }
  if (tier >= 4) {
    // the moon, two ink butterflies, and her seal in the corner: done
    parts.push(
      `<circle cx="42" cy="20" r="6" fill="none" stroke="${INK}" stroke-width="1" opacity="0.7"/>`,
      `<path d="M18 26 q-4 -4 -1 -6 q3 1 1 6 q4 -4 6 -1 q-1 3 -6 1" fill="${INK}" opacity="0.8"/>`,
      `<path d="M28 36 q-3 -3 -0.8 -4.5 q2.2 0.8 0.8 4.5 q3 -3 4.5 -0.8 q-0.8 2.2 -4.5 0.8" fill="${INK}" opacity="0.65"/>`,
      sealSvg(42, 84, 7),
    );
  }
  return parts.join("");
}

/** The scroll hanging open: 60 × 100 */
export function scrollSvg(tier: PaintingTier) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 100" aria-hidden="true">
<path d="M22 4 L30 0 L38 4" fill="none" stroke="${ROD}" stroke-width="1"/>
<rect x="3" y="3" width="54" height="5" rx="2.5" fill="${ROD}"/>
<rect x="6" y="8" width="48" height="84" fill="${PAPER}" stroke="#dccfb2" stroke-width="0.8"/>
<rect x="9" y="11" width="42" height="78" fill="none" stroke="#e8dcc0" stroke-width="0.6"/>
${painting(tier)}
<rect x="2" y="92" width="56" height="5" rx="2.5" fill="${ROD}"/>
</svg>`;
}

/** The scroll rolled up, for the map from far away: 60 × 20 */
export function rolledSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20" aria-hidden="true">
<rect x="4" y="6" width="52" height="9" rx="4.5" fill="${PAPER}" stroke="#cdbf9f" stroke-width="0.8"/>
<rect x="1" y="7" width="5" height="7" rx="2" fill="${ROD}"/><rect x="54" y="7" width="5" height="7" rx="2" fill="${ROD}"/>
<path d="M30 6 Q30 1 34 1" fill="none" stroke="${ROD}" stroke-width="1"/>
<rect x="27" y="6" width="6" height="9" fill="${SEAL_RED}" opacity="0.85"/>
</svg>`;
}
