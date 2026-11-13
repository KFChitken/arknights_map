import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "@/lib/types";
import { GLOW } from "@/lib/roachSvg";
import type { PaintingTier } from "@/lib/si";
import { rolledSvg, scrollSvg, SEAL_RED } from "@/lib/siArt";
import { INK, RING_PAD } from "./siLook";

/**
 * The pictures of 祀掌柜's corner of the map, drawn once on a canvas each, for both maps: 墨小强, the ink
 * roaches she draws (src/lib/siInn.ts), each of the five ink pictures (public/avatars/ink-<look>.webp, 256 px,
 * feet at the bottom) standing facing either way, or lying on its side head left or right, with her red seal on
 * its back or without, and your own ringed in your colour; the inn's trees and sign; her scroll, rolled or open
 * with today's painting; her butterflies.
 */

export const INK_LOOKS = ROACH_AVATARS;
export type InkVariant = "standR" | "standL" | "lieL" | "lieR";
export const INK_VARIANTS: InkVariant[] = ["standR", "standL", "lieL", "lieR"];

/** Where each figure sits across its picture (px of 256), to lay it down on its side (the cut-out's own measures) */
const SPAN: Record<RoachAvatar, [number, number]> = {
  hood: [22, 234],
  doctor: [65, 191],
  endmin: [60, 196],
  imp: [48, 207],
  gugu: [57, 199],
};

/**
 * Her seal on one whose owner's 集章本 was full (as the design's ink-seal.svg, 24 × 24): red, a cream frame inside,
 * 「祀」 cut out of it, outlined (Noto Sans SC Black), so no font is needed
 */
const SEAL_COLORS = { red: "#c8321e", paper: "#fbf1e3", edge: "#1b1d22" };
const SEAL_GLYPH = "M6.24 9.22H10.03V10.86H6.24ZM7.87 13.82 9.64 11.71V19.07H7.87ZM9.53 12.1Q9.68 12.2 9.95 12.44Q10.22 12.67 10.51 12.94Q10.81 13.21 11.06 13.45Q11.31 13.69 11.42 13.79L10.33 15.27Q10.17 15.02 9.94 14.71Q9.7 14.39 9.45 14.07Q9.2 13.75 8.96 13.46Q8.73 13.18 8.54 12.98ZM9.48 9.22H9.84L10.14 9.16L11.08 9.84Q10.63 11.04 9.9 12.15Q9.17 13.26 8.27 14.15Q7.37 15.05 6.43 15.62Q6.38 15.36 6.27 14.99Q6.15 14.62 6.03 14.27Q5.9 13.92 5.79 13.74Q6.59 13.33 7.33 12.66Q8.06 12 8.63 11.18Q9.19 10.37 9.48 9.53ZM7.37 7.78 8.8 7Q9.15 7.39 9.48 7.89Q9.82 8.38 9.99 8.76L8.49 9.65Q8.35 9.26 8.02 8.74Q7.7 8.21 7.37 7.78ZM12.43 11.97H16.44V13.62H12.43ZM11.51 7.89H13.34V16.21Q13.34 16.59 13.38 16.76Q13.42 16.94 13.56 17Q13.71 17.05 13.99 17.05Q14.08 17.05 14.24 17.05Q14.4 17.05 14.6 17.05Q14.8 17.05 15 17.05Q15.2 17.05 15.36 17.05Q15.51 17.05 15.59 17.05Q15.86 17.05 16.01 16.91Q16.15 16.78 16.22 16.42Q16.29 16.06 16.34 15.38Q16.65 15.6 17.14 15.81Q17.62 16.02 18.01 16.1Q17.91 17.08 17.67 17.66Q17.43 18.24 16.98 18.51Q16.53 18.77 15.78 18.77Q15.65 18.77 15.45 18.77Q15.25 18.77 15 18.77Q14.75 18.77 14.5 18.77Q14.26 18.77 14.06 18.77Q13.86 18.77 13.74 18.77Q12.9 18.77 12.41 18.55Q11.92 18.33 11.72 17.77Q11.51 17.22 11.51 16.2ZM12.51 7.89H17.28V14.18H15.49V9.54H12.51Z";
/**
 * Where its middle sits on each figure (px of 256, the picture as it faces), low on its back as the design shows,
 * and how wide it is (of the picture): smaller on the slight figures than on the round hood
 */
const SEAL_AT: Record<RoachAvatar, [number, number, number]> = {
  hood: [190, 210, 0.2],
  doctor: [142, 178, 0.17],
  endmin: [148, 182, 0.17],
  imp: [136, 178, 0.17],
  gugu: [150, 196, 0.17],
};
/** How it is turned (degrees; the other way round on a figure facing the other way) */
const SEAL_TILT = -12;

let sealPath: Path2D | null = null;
/** The seal, its middle at x, y, size px wide, turned tilt degrees */
function drawSeal(g: CanvasRenderingContext2D, x: number, y: number, size: number, tilt: number) {
  g.save();
  g.translate(x, y);
  g.rotate((tilt * Math.PI) / 180);
  g.scale(size / 24, size / 24);
  g.translate(-12, -12);
  g.fillStyle = SEAL_COLORS.red;
  g.strokeStyle = SEAL_COLORS.edge;
  g.lineWidth = 1.4;
  g.beginPath();
  g.roundRect(2.2, 2.2, 19.6, 19.6, 2.35);
  g.fill();
  g.stroke();
  g.strokeStyle = SEAL_COLORS.paper;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(4.2, 4.2, 15.6, 15.6, 1.57);
  g.stroke();
  g.fillStyle = SEAL_COLORS.paper;
  g.fill((sealPath ??= new Path2D(SEAL_GLYPH)));
  g.restore();
}

/**
 * Where the seal goes on a figure drawn one way (inkCanvas), on a canvas px wide with the picture box px wide at
 * pad: on its back as it stands, the same spot the other way round as it faces left; lying, as the figure is turned,
 * on whichever side faces up. Its middle, its size, and how it is turned.
 */
function sealSpot(look: RoachAvatar, variant: InkVariant, px: number, pad: number, box: number) {
  const [sx, sy, w] = SEAL_AT[look];
  const k = box / 256;
  const size = w * box;
  if (variant === "standR") return { x: pad + sx * k, y: pad + sy * k, size, tilt: SEAL_TILT };
  if (variant === "standL") return { x: px - pad - sx * k, y: pad + sy * k, size, tilt: -SEAL_TILT };
  const [l, r] = SPAN[look];
  const lying = ((r - l) / 256) * box;
  const cx = px / 2;
  const cy = px - pad - lying / 2;
  // from the figure's middle: across it, and down the picture
  const across = (sx - (l + r) / 2) * k;
  const down = (sy - 128) * k;
  // a quarter turn left takes its right side up; a quarter turn right takes its left side up, so the seal goes there
  return variant === "lieL" ? { x: cx + down, y: cy - across, size, tilt: SEAL_TILT } : { x: cx - down, y: cy - across, size, tilt: -SEAL_TILT };
}

const url = (look: RoachAvatar) => `/avatars/ink-${look}.webp`;
const pictures = new Map<RoachAvatar, Promise<HTMLImageElement>>();
function picture(look: RoachAvatar) {
  let p = pictures.get(look);
  if (!p) {
    const img = new Image();
    img.src = url(look);
    p = img.decode().then(() => img);
    p.catch(() => pictures.delete(look));
    pictures.set(look, p);
  }
  return p;
}

/**
 * One look in one way, on a square canvas px wide; ring: your colour round it, for your own (RING_PAD of room);
 * sealed: her seal on its back
 */
export async function inkCanvas(look: RoachAvatar, variant: InkVariant, px: number, ring?: RoachColor, sealed = false) {
  const img = await picture(look);
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  const pad = ring ? px * RING_PAD : 0;
  const box = px - pad * 2;
  const draw = (g: CanvasRenderingContext2D) => {
    g.save();
    if (variant === "standR" || variant === "standL") {
      if (variant === "standL") {
        g.translate(px, 0);
        g.scale(-1, 1);
      }
      g.drawImage(img, pad, pad, box, box);
    } else {
      // on its side: the figure's width becomes its height, resting on the bottom edge
      const [l, r] = SPAN[look];
      const lying = ((r - l) / 256) * box;
      g.translate(px / 2, px - pad - lying / 2);
      g.rotate(((variant === "lieL" ? -1 : 1) * Math.PI) / 2);
      // the figure's horizontal middle onto the turning point
      g.drawImage(img, -box / 2 + (box / 2 - ((l + r) / 2 / 256) * box), -box / 2, box, box);
    }
    g.restore();
    if (sealed) {
      const at = sealSpot(look, variant, px, pad, box);
      drawSeal(g, at.x, at.y, at.size, at.tilt);
    }
  };
  if (ring) {
    // the outline: the picture's shape in the colour, a little bigger all round, under it
    const shape = document.createElement("canvas");
    shape.width = shape.height = px;
    const s = shape.getContext("2d")!;
    draw(s);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = GLOW[ring] ?? "#ffd23f";
    s.fillRect(0, 0, px, px);
    const w = Math.max(2, px * 0.05);
    for (let a = 0; a < 16; a++) {
      const t = (a / 16) * Math.PI * 2;
      ctx.drawImage(shape, Math.cos(t) * w, Math.sin(t) * w);
    }
  }
  draw(ctx);
  return c;
}

/** The name each look and way, sealed or not, is registered under on a map */
export const inkImageName = (look: number | RoachAvatar, variant: InkVariant, sealed = false) =>
  `si-ink-${typeof look === "number" ? (INK_LOOKS[look] ?? "hood") : look}-${variant}${sealed ? "-sealed" : ""}`;

/** Which way an ink roach is drawn: standing (queuing or in a room) facing its way, or lying on its side */
export const variantOf = (state: number, left: boolean): InkVariant => (state === 2 ? (left ? "lieL" : "lieR") : left ? "standL" : "standR");

export const isRoachColor = (c: string): c is RoachColor => (ROACH_COLORS as readonly string[]).includes(c);

/**
 * Her brush drawing a picture in, from the feet up, its front ragged the way bristles drag: the picture as far as
 * she has got at each moment (0 to 1)
 */
export function brushReveal(src: HTMLCanvasElement) {
  const { width: w, height: h } = src;
  const full = src.getContext("2d")!.getImageData(0, 0, w, h);
  const lag = new Float32Array(w);
  let seed = 20261111;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const p1 = rand() * 6.28;
  const p2 = rand() * 6.28;
  for (let x = 0; x < w; x++) lag[x] = 0.06 * Math.sin((x / w) * 9 + p1) + 0.04 * Math.sin((x / w) * 23 + p2) + 0.03 * rand();
  const out = new ImageData(w, h);
  return (p: number) => {
    const front = Math.max(0, Math.min(1, p)) * 1.45 - 0.2;
    const d = out.data;
    const f = full.data;
    for (let y = 0; y < h; y++) {
      // 0 at the feet, 1 at the top
      const up = 1 - y / h;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const k = Math.max(0, Math.min(1, (front - up - lag[x]) / 0.1));
        d[i] = f[i];
        d[i + 1] = f[i + 1];
        d[i + 2] = f[i + 2];
        d[i + 3] = f[i + 3] * k;
      }
    }
    return out;
  };
}

/** An ink tree, square, px wide, standing on the bottom edge */
export function treeCanvas(px: number) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  g.scale(px / 64, px / 64);
  g.fillStyle = INK;
  g.globalAlpha = 0.85;
  g.fillRect(30, 34, 4, 30);
  for (const [x, y, r] of [
    [32, 24, 16],
    [20, 30, 11],
    [44, 30, 11],
    [32, 14, 10],
  ]) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.globalAlpha = 0.55;
    g.fill();
  }
  return c;
}

/** The inn's sign, twice as wide as high (h px): 缘缘庄, or 客满 in red (red) when it is full */
export function signCanvas(text: string, h: number, red = false) {
  const w = h * 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf6ea";
  g.strokeStyle = INK;
  g.lineWidth = h * 0.06;
  g.beginPath();
  g.roundRect(h * 0.06, h * 0.18, w - h * 0.12, h * 0.7, h * 0.08);
  g.fill();
  g.stroke();
  g.fillStyle = red ? SEAL_RED : INK;
  g.font = `700 ${Math.round(h * 0.46)}px 'Source Han Serif SC','Noto Serif SC','Songti SC',STSong,serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h * 0.55);
  return c;
}

/** One of her ink butterflies seen from above, wings open (0) or half shut (1), on a square px wide */
export function butterflyCanvas(frame: 0 | 1, px: number) {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const g = c.getContext("2d")!;
  g.translate(px / 2, px / 2);
  g.scale(px / 24, px / 24);
  g.fillStyle = INK;
  const spread = frame === 0 ? 1 : 0.45;
  for (const side of [-1, 1]) {
    g.save();
    g.scale(side * spread, 1);
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(0.6, -1);
    g.bezierCurveTo(4, -9.5, 11.5, -9.5, 10.5, -3);
    g.bezierCurveTo(10, 0, 5, 1, 0.6, 0.5);
    g.fill();
    g.globalAlpha = 0.6;
    g.beginPath();
    g.moveTo(0.6, 0.5);
    g.bezierCurveTo(5, 1.5, 8.5, 5, 6.5, 8);
    g.bezierCurveTo(4.5, 9.8, 1.5, 6, 0.6, 2);
    g.fill();
    g.restore();
  }
  g.globalAlpha = 1;
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -3);
  g.lineTo(0, 6.5);
  g.stroke();
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(0, -3);
  g.quadraticCurveTo(-1.5, -7, -3.8, -8.8);
  g.moveTo(0, -3);
  g.quadraticCurveTo(1.5, -7, 3.8, -8.8);
  g.stroke();
  return c;
}

/** An SVG drawn on a canvas w × h px */
async function svgCanvas(svg: string, w: number, h: number) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return c;
}

/** Her scroll open with a tier of today's painting (60 × 100), h px high */
export const scrollCanvas = (tier: PaintingTier, h: number) => svgCanvas(scrollSvg(tier), Math.round(h * 0.6), h);
/** Her scroll rolled up (60 × 20), w px wide */
export const rolledCanvas = (w: number) => svgCanvas(rolledSvg(), w, Math.round(w / 3));
