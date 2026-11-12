import { ROACH_AVATARS, ROACH_COLORS, type RoachAvatar, type RoachColor } from "@/lib/types";
import { GLOW } from "@/lib/roachSvg";
import type { PaintingTier } from "@/lib/si";
import { rolledSvg, scrollSvg, SEAL_RED } from "@/lib/siArt";
import { INK, RING_PAD } from "./siLook";

/**
 * The pictures of 祀掌柜's corner of the map, drawn once on a canvas each, for both maps: 墨小强, the ink
 * roaches she draws (src/lib/siInn.ts), each of the five ink pictures (public/avatars/ink-<look>.webp, 256 px,
 * feet at the bottom) standing facing either way, or lying on its side head left or right, and your own ringed
 * in your colour; the inn's trees and sign; her scroll, rolled or open with today's painting; her butterflies.
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

/** One look in one way, on a square canvas px wide; ring: your colour round it, for your own (RING_PAD of room) */
export async function inkCanvas(look: RoachAvatar, variant: InkVariant, px: number, ring?: RoachColor) {
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

/** The name each look and way is registered under on a map */
export const inkImageName = (look: number | RoachAvatar, variant: InkVariant) =>
  `si-ink-${typeof look === "number" ? (INK_LOOKS[look] ?? "hood") : look}-${variant}`;

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
