import { bodyOpacityFor, roachDataUrl, shownAvatar, type RoachOpts } from "./roachSvg";
import type { RoachAvatar, RoachColor } from "./types";

/**
 * Cartoon looks that are pictures rather than code-drawn SVG. Each is a
 * square transparent PNG with the character's feet at the bottom edge,
 * made from the artist's original with scripts/cutout.mjs.
 */
export const AVATAR_PICTURES: Partial<Record<RoachAvatar, string>> = {
  doctor: "/avatars/doctor.png",
  endmin: "/avatars/endmin.png",
  imp: "/avatars/imp.png",
};

/** Whether this roach is drawn from a picture (and so needs drawRoach instead of roachDataUrl). */
export function usesPicture(opts: RoachOpts) {
  return opts.look !== "real" && Boolean(AVATAR_PICTURES[shownAvatar(opts)]);
}

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = images.get(src);
  if (!p) {
    const img = new Image();
    img.src = src;
    p = img.decode().then(() => img);
    p.catch(() => images.delete(src));
    images.set(src, p);
  }
  return p;
}

/** Any roach icon on a square canvas: the code-drawn ground, the look, then the overlay (heart). */
export async function drawRoach(color: RoachColor, opts: RoachOpts, px: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const picture = usesPicture(opts) ? AVATAR_PICTURES[shownAvatar(opts)] : undefined;
  if (!picture) {
    ctx.drawImage(await loadImage(roachDataUrl(color, opts)), 0, 0, px, px);
    return canvas;
  }
  const [ground, body, overlay] = await Promise.all([
    loadImage(roachDataUrl(color, { ...opts, part: "ground" })),
    loadImage(picture),
    loadImage(roachDataUrl(color, { ...opts, part: "overlay" })),
  ]);
  ctx.drawImage(ground, 0, 0, px, px);
  // same footprint as the drawn hood: feet on the ground line at y≈60 of 64
  const box = (px * 56) / 64;
  ctx.globalAlpha = bodyOpacityFor(opts);
  ctx.drawImage(body, (px - box) / 2, (px * 60) / 64 - box, box, box);
  ctx.globalAlpha = 1;
  ctx.drawImage(overlay, 0, 0, px, px);
  return canvas;
}

const urls = new Map<string, Promise<string>>();

/** PNG data URL of a roach icon, cached. Colors do not change pictures, so they share one entry. */
export function roachIconUrl(color: RoachColor, opts: RoachOpts, px: number): Promise<string> {
  const key = JSON.stringify([usesPicture(opts) ? "-" : color, { ...opts, size: undefined }, px]);
  let p = urls.get(key);
  if (!p) {
    p = drawRoach(color, opts, px).then((c) => c.toDataURL("image/png"));
    p.catch(() => urls.delete(key));
    urls.set(key, p);
  }
  return p;
}

export async function roachImageData(color: RoachColor, opts: RoachOpts, px: number) {
  const canvas = await drawRoach(color, opts, px);
  return canvas.getContext("2d")!.getImageData(0, 0, px, px);
}
