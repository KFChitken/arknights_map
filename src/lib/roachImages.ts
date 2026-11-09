import { pictureSleeping, pictureZzz, zzz, type PictureFit } from "./flipArt";
import { hoodOnHorseUrl } from "./horseArt";
import { bodyOpacityFor, roachDataUrl, shownAvatar, type RoachOpts } from "./roachSvg";
import { GUIDE_AVATARS, type DrawnAvatar, type RoachColor } from "./types";

/**
 * Cartoon looks that are pictures rather than code-drawn SVG. Each is a
 * square transparent PNG with the character's feet at the bottom edge,
 * made from the artist's original with scripts/cutout.mjs.
 */
export const AVATAR_PICTURES: Partial<Record<DrawnAvatar, string>> = {
  doctor: "/avatars/doctor.png",
  endmin: "/avatars/endmin.png",
  imp: "/avatars/imp.png",
  gugu: "/avatars/gugu.png",
  // the guides' (src/lib/guides.ts): not ours to publish, so served from the server's own folder
  // (src/app/guide-art) and kept out of the repository
  // ?v: another picture of her was briefly served at this address while trying out her dance; browsers keep pictures a day
  amiya: "/guide-art/amiya.png?v=3",
  perlica: "/guide-art/perlica.png",
  talulah: "/guide-art/talulah.png",
  minghe: "/guide-art/minghe.png",
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
  const fit = usesPicture(opts) ? PICTURE_FIT[shownAvatar(opts)] : undefined;
  return fit ? pictureZzz(fit, { anim: true }) : zzz({ anim: true });
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
  // a picture that will not load (the guide's can be switched off) leaves the hood in the roach's colour, or its own fallback
  const fallback = PICTURE_FALLBACKS[shownAvatar(opts)];
  const body = picture ? await loadImage(picture).catch(() => (fallback ? loadImage(fallback()) : null)) : null;
  if (!body) {
    ctx.drawImage(await loadImage(roachDataUrl(color, { ...opts, avatar: picture ? "hood" : opts.avatar })), 0, 0, px, px);
    return canvas;
  }
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

const urls = new Map<string, Promise<string>>();

/** PNG data URL of a roach icon, cached. Colors do not change pictures, so they share one entry. */
export function roachIconUrl(color: RoachColor, opts: RoachOpts, px: number): Promise<string> {
  const key = JSON.stringify([usesPicture(opts) ? "-" : color, { ...asDrawn(opts), size: undefined }, px]);
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
