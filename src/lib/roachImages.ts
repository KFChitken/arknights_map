import { DUCK_ASLEEP, duckZzz, pictureSleeping, pictureZzz, zzz, type PictureFit } from "./flipArt";
import { hoodOnHorseUrl } from "./horseArt";
import { bodyOpacityFor, roachDataUrl, shownAvatar, type RoachOpts } from "./roachSvg";
import { GUIDE_AVATARS, type DrawnAvatar, type RoachColor } from "./types";

/**
 * Cartoon looks that are pictures rather than code-drawn SVG. Each is a
 * square transparent PNG with the character's feet at the bottom edge,
 * made from the artist's original with scripts/cutout.mjs.
 */
export const AVATAR_PICTURES: Partial<Record<DrawnAvatar, string>> = {
  // WebP, a quarter of the PNGs' size (2026-11-11: these and the guides' were a third of what the site sent)
  doctor: "/avatars/doctor.webp",
  endmin: "/avatars/endmin.webp",
  imp: "/avatars/imp.webp",
  gugu: "/avatars/gugu.webp",
  // 鸭爵, the thanks for sponsoring: the whole picture; its three layers (duck-bcase, duck-body, duck-hat) move apart
  duck: "/avatars/duck.webp",
  // the guides' (src/lib/guides.ts): not ours to publish, so served from the server's own folder
  // (src/app/guide-art) and kept out of the repository; browsers keep them a month, so a new
  // picture gets a new ?v
  amiya: "/guide-art/amiya.webp?v=1",
  perlica: "/guide-art/perlica.webp?v=1",
  talulah: "/guide-art/talulah.webp?v=1",
  minghe: "/guide-art/minghe.webp?v=1",
  si: "/guide-art/si.webp?v=1",
  // her Q figure whole, where it is drawn still; on the map and her card it moves, in five layers (src/components/app/Haimao.tsx)
  haimao: "/guide-art/haimao.webp?v=1",
};

/** What a picture that will not load gives way to, instead of the plain hood: 明河都尉 keeps his horse */
const PICTURE_FALLBACKS: Partial<Record<DrawnAvatar, () => string>> = { minghe: hoodOnHorseUrl };

/** Where each figure sits in its picture, measured from the PNGs, to lay it down asleep */
const PICTURE_FIT: Partial<Record<DrawnAvatar, PictureFit>> = {
  doctor: { left: 45, right: 211 },
  endmin: { left: 31, right: 225 },
  // drawn with her eyes open, so she sleeps in a mask
  imp: { left: 13, right: 243, mask: true },
  // eyes open too
  gugu: { left: 39, right: 216, mask: true },
};

/** 鸭爵's picture in its three layers, back to front, each in the whole picture's frame: they move apart in his scenes */
const DUCK_LAYERS = { bcase: "/avatars/duck-bcase.webp", body: "/avatars/duck-body.webp", hat: "/avatars/duck-hat.webp" } as const;
export type DuckLayer = keyof typeof DUCK_LAYERS;

/**
 * 鸭爵 on the 64 grid in his three layers (d-bcase, d-body, d-hat), or those asked for, facing left as in his picture;
 * flip: facing right, as he does on the left of a stage. hatTransform: for his hat, which turns about its brim's corner
 * (26.4 9.7).
 */
export function duckLayers({ flip = false, bcase = true, body = true, hat = true, hatTransform = "" } = {}) {
  const layer = (k: DuckLayer, transform = "") =>
    `<g class="d-${k}"${transform ? ` transform="${transform}"` : ""}><image href="${DUCK_LAYERS[k]}" x="4" y="4" width="56" height="56"/></g>`;
  const inner = (bcase ? layer("bcase") : "") + (body ? layer("body") : "") + (hat ? layer("hat", hatTransform) : "");
  return flip ? `<g transform="translate(64 0) scale(-1 1)">${inner}</g>` : inner;
}

/** Load 鸭爵's three layers ahead, so a scene that moves them apart has them at once */
export function warmDuckLayers() {
  for (const src of Object.values(DUCK_LAYERS)) void loadImage(src).catch(() => {});
}

/** 鸭爵 dozing on his feet (DUCK_ASLEEP in flipArt.ts), without his ground */
const duckDozing = () => {
  const { deg, x, y } = DUCK_ASLEEP.lean;
  return `<g transform="rotate(${deg} ${x} ${y})">${duckLayers({ hatTransform: DUCK_ASLEEP.hat })}</g>`;
};

const svgUrl = (inner: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${inner}</svg>`)}`;

const isGuide = (avatar: DrawnAvatar) => (GUIDE_AVATARS as readonly DrawnAvatar[]).includes(avatar);

/** A guide keeps her picture in 写实 too, and never sleeps */
const asDrawn = (opts: RoachOpts): RoachOpts =>
  isGuide(shownAvatar(opts)) ? { ...opts, look: "cartoon", asleep: false } : opts;

/** Whether this roach is drawn from a picture (and so needs drawRoach instead of roachDataUrl). */
export function usesPicture(opts: RoachOpts) {
  const o = asDrawn(opts);
  return o.look !== "real" && Boolean(AVATAR_PICTURES[shownAvatar(o)]);
}

/** The Zzz of a sleeping roach on its own, for a scene that moves it apart; the realistic roach has none. */
export function sleepingZzz(opts: RoachOpts) {
  if (opts.look === "real") return "";
  if (usesPicture(opts) && shownAvatar(opts) === "duck") return duckZzz({ anim: true });
  const fit = usesPicture(opts) ? PICTURE_FIT[shownAvatar(opts)] : undefined;
  return fit ? pictureZzz(fit, { anim: true }) : zzz({ anim: true });
}

/**
 * A picture look on the 64 grid as SVG, without its ground, for a scene that keeps the ground still under it:
 * standing, or asleep (laid down on its pillow under the quilt, with its Zzz; 鸭爵 dozing on his feet). Empty for a
 * look that is no picture.
 */
export function pictureSvg(avatar: DrawnAvatar, { asleep = false } = {}) {
  const href = AVATAR_PICTURES[avatar];
  if (!href) return "";
  if (asleep && avatar === "duck") return duckDozing() + duckZzz();
  const body = `<image href="${href}" x="4" y="4" width="56" height="56"/>`;
  const fit = PICTURE_FIT[avatar];
  if (!asleep || !fit) return body;
  const { under, over, mask, layDown } = pictureSleeping(fit, { ground: "none", zzz: true });
  return `${under}<g transform="translate(${layDown.x} ${layDown.y}) rotate(${layDown.deg}) translate(-32 -32)">${body}${mask}</g>${over}`;
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
export async function drawRoach(color: RoachColor, given: RoachOpts, px: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d")!;
  const opts = asDrawn(given);
  const picture = usesPicture(opts) ? AVATAR_PICTURES[shownAvatar(opts)] : undefined;
  if (picture && shownAvatar(opts) === "duck") warmDuckLayers();
  // a picture that will not load (the guide's can be switched off) leaves the hood in the roach's colour, or its own fallback
  const fallback = PICTURE_FALLBACKS[shownAvatar(opts)];
  const body = picture ? await loadImage(picture).catch(() => (fallback ? loadImage(fallback()) : null)) : null;
  if (!body) {
    ctx.drawImage(await loadImage(roachDataUrl(color, { ...opts, avatar: picture ? "hood" : opts.avatar })), 0, 0, px, px);
    return canvas;
  }
  if (opts.asleep && !opts.clone && shownAvatar(opts) === "duck") return drawDuckDozing(canvas, color, opts);
  const fit = PICTURE_FIT[shownAvatar(opts)];
  if (opts.asleep && !opts.clone && fit) {
    // laid down on a pillow under a quilt, until drawn lying versions exist
    const kind = opts.mine ? "mine" : opts.friend ? "friend" : "other";
    const parts = pictureSleeping(fit, { ground: kind, zzz: opts.zzz });
    const [under, over, mask] = await Promise.all([
      loadImage(svgUrl(parts.under)),
      loadImage(svgUrl(parts.over)),
      parts.mask ? loadImage(svgUrl(parts.mask)) : null,
    ]);
    ctx.drawImage(under, 0, 0, px, px);
    ctx.save();
    ctx.scale(px / 64, px / 64);
    ctx.translate(parts.layDown.x, parts.layDown.y);
    ctx.rotate((parts.layDown.deg * Math.PI) / 180);
    ctx.translate(-32, -32);
    ctx.drawImage(body, 4, 4, 56, 56);
    if (mask) ctx.drawImage(mask, 0, 0, 64, 64);
    ctx.restore();
    ctx.drawImage(over, 0, 0, px, px);
    return canvas;
  }
  const [ground, overlay] = await Promise.all([
    loadImage(roachDataUrl(color, { ...opts, part: "ground" })),
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

/** 鸭爵 asleep on a canvas: his ground as when awake, his three layers dozing on his feet, his Zzz on a card */
async function drawDuckDozing(canvas: HTMLCanvasElement, color: RoachColor, opts: RoachOpts) {
  const px = canvas.width;
  const ctx = canvas.getContext("2d")!;
  const awake = { ...opts, asleep: false };
  const [ground, overlay, bcase, body, hat, z] = await Promise.all([
    loadImage(roachDataUrl(color, { ...awake, part: "ground" })),
    loadImage(roachDataUrl(color, { ...awake, part: "overlay" })),
    loadImage(DUCK_LAYERS.bcase),
    loadImage(DUCK_LAYERS.body),
    loadImage(DUCK_LAYERS.hat),
    opts.zzz ? loadImage(svgUrl(duckZzz())) : null,
  ]);
  ctx.drawImage(ground, 0, 0, px, px);
  ctx.save();
  ctx.scale(px / 64, px / 64);
  const { deg, x, y } = DUCK_ASLEEP.lean;
  ctx.translate(x, y);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-x, -y);
  ctx.drawImage(bcase, 4, 4, 56, 56);
  ctx.drawImage(body, 4, 4, 56, 56);
  // DUCK_ASLEEP.hat: rotate(-11 26.4 9.7) translate(-0.8 1.6)
  ctx.translate(26.4, 9.7);
  ctx.rotate((-11 * Math.PI) / 180);
  ctx.translate(-26.4 - 0.8, -9.7 + 1.6);
  ctx.drawImage(hat, 4, 4, 56, 56);
  ctx.restore();
  if (z) ctx.drawImage(z, 0, 0, px, px);
  ctx.drawImage(overlay, 0, 0, px, px);
  return canvas;
}

const urls = new Map<string, Promise<string>>();

/** What a roach icon is kept by (roachIconUrl): colors do not change pictures, so a picture look's share one */
export const roachIconKey = (color: RoachColor, opts: RoachOpts, px: number) =>
  JSON.stringify([usesPicture(opts) ? "-" : color, { ...asDrawn(opts), size: undefined }, px]);

/** PNG data URL of a roach icon, cached. Colors do not change pictures, so they share one entry. */
export function roachIconUrl(color: RoachColor, opts: RoachOpts, px: number): Promise<string> {
  const key = roachIconKey(color, opts, px);
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
