import type { LngLat } from "./types";

/**
 * 两面包夹芝士 on the map: a slice of bread on either side of Japan, one in the Sea of Japan
 * and one in the Pacific, with a wedge of cheese between them in the middle of Honshu.
 * Drawn on both maps under the roaches, never in the way of a tap. Switch it off here.
 */
export const SANDWICH_ON = true;

export type SandwichKind = "bread" | "cheese";
export type SandwichPart = { kind: SandwichKind; at: LngLat };

/** Bread first, so the cheese is drawn over them where they meet (zoomed far out) */
export const SANDWICH: SandwichPart[] = [
  // the Sea of Japan, between the Noto peninsula and Sado, 70 km and more from either
  { kind: "bread", at: { lng: 137.4, lat: 38.3 } },
  // the Pacific, off Cape Omaezaki, 70 km and more from it and the Izu islands
  { kind: "bread", at: { lng: 138.1, lat: 33.95 } },
  // 诹访湖 in Nagano, the middle of Honshu
  { kind: "cheese", at: { lng: 138.08, lat: 36.05 } },
];

/** [MapLibre zoom, bread edge in px]: they grow with the map up close to Japan, then stay put */
export const SANDWICH_STOPS: [number, number][] = [
  [2, 18],
  [3, 26],
  [4, 38],
  [5, 54],
  [6, 64],
  [7, 72],
];

/** The cheese, against a slice of bread */
export const CHEESE_SCALE = 0.85;

/** Edge in px of a part at a MapLibre zoom, between the stops in a straight line */
export function sandwichPx(zoom: number, kind: SandwichKind) {
  const s = SANDWICH_STOPS;
  const k = kind === "cheese" ? CHEESE_SCALE : 1;
  if (zoom <= s[0][0]) return s[0][1] * k;
  for (let i = 1; i < s.length; i++) {
    const [z1, p1] = s[i];
    if (zoom <= z1) {
      const [z0, p0] = s[i - 1];
      return (p0 + ((p1 - p0) * (zoom - z0)) / (z1 - z0)) * k;
    }
  }
  return s[s.length - 1][1] * k;
}

const LINE = "#0d0e10";
/** One shape of a drawing on a 64 × 64 grid: filled, outlined, or both */
type Shape = { d: string; fill?: string; stroke?: string; width?: number };

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;

const TOAST = "M13 56 L13 30.5 C5.5 29.5 3.5 18 11 12.5 C19 6.5 45 6.5 53 12.5 C60.5 18 58.5 29.5 51 30.5 L51 56 Q51 59.5 47.5 59.5 L16.5 59.5 Q13 59.5 13 56 Z";
const CRUMB =
  "M17.5 54.5 L17.5 27 C11 26.5 8.5 19.5 13.5 15.8 C20.5 10.6 43.5 10.6 50.5 15.8 C55.5 19.5 53 26.5 46.5 27 L46.5 54.5 Q46.5 55.5 45.5 55.5 L18.5 55.5 Q17.5 55.5 17.5 54.5 Z";

const WEDGE = "M5 31 L43 14 Q53.5 16.5 59 27 L59 47 L5 51 Z";

const DRAWINGS: Record<SandwichKind, Shape[]> = {
  bread: [
    { d: TOAST, fill: "#d9913f" },
    { d: CRUMB, fill: "#fde7b4" },
    // a few crumbs and the shine on the crust
    ...[
      [25, 23, 1.7, 1.1],
      [38, 19.5, 1.5, 1],
      [31.5, 32, 1.8, 1.1],
      [23.5, 43, 1.5, 1],
      [40, 39, 1.7, 1.1],
      [33.5, 49, 1.4, 0.9],
    ].map(([cx, cy, rx, ry]) => ({ d: ellipse(cx, cy, rx, ry), fill: "#efcb85" })),
    { d: "M14 15.5 C17.5 11.5 23 10 28 9.8", stroke: "#f6c27a", width: 1.8 },
    { d: TOAST, stroke: LINE, width: 2.6 },
  ],
  cheese: [
    // the top, the front, then the holes in each
    { d: "M5 31 L43 14 Q53.5 16.5 59 27 Z", fill: "#ffe27a" },
    { d: "M5 31 L59 27 L59 47 L5 51 Z", fill: "#ffc532" },
    ...[
      [33, 21, 3.2, 1.5],
      [45, 23.3, 2.4, 1.1],
      [21.5, 27, 2.2, 1],
    ].map(([cx, cy, rx, ry]) => ({ d: ellipse(cx, cy, rx, ry), fill: "#f2c443" })),
    ...[
      [16.5, 41.5, 4, 3.2],
      [32.5, 36.5, 3, 2.4],
      [46.5, 40.5, 4.4, 3.5],
      [26, 45.8, 2.2, 1.6],
    ].map(([cx, cy, rx, ry]) => ({ d: ellipse(cx, cy, rx, ry), fill: "#e39b16", stroke: "#b87405", width: 1 })),
    { d: "M5 31 L59 27", stroke: LINE, width: 2 },
    { d: WEDGE, stroke: LINE, width: 2.6 },
  ],
};

/** A part drawn on a canvas, px × px */
export function drawSandwichPart(kind: SandwichKind, px: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(px / 64, px / 64);
  ctx.lineJoin = ctx.lineCap = "round";
  for (const s of DRAWINGS[kind]) {
    const path = new Path2D(s.d);
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill(path);
    }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.width ?? 2;
      ctx.stroke(path);
    }
  }
  return canvas;
}

/** The same drawing as an SVG document */
export function sandwichSvg(kind: SandwichKind) {
  const body = DRAWINGS[kind]
    .map(
      (s) =>
        `<path d="${s.d}" fill="${s.fill ?? "none"}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.width ?? 2}" stroke-linejoin="round" stroke-linecap="round"` : ""}/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${body}</svg>`;
}
