import type { RoachAvatar } from "./types";

/**
 * The looks with an ink picture (public/avatars/ink-<look>.webp), for 祀掌柜's 墨小强, in ROACH_AVATARS' order (the
 * server numbers ink looks by it, server/siInk.ts). 鸭爵 has none yet: in ink he is drawn as the hood, on the map and
 * on cards, and an ink roach is never drawn as him. His own will need cells of his own in the map's atlas
 * (components/map/inkGl.ts), whose first 20 are these five looks' four ways, then the trees and the sign.
 */
export const INK_LOOKS = ["hood", "doctor", "endmin", "imp", "gugu"] as const satisfies readonly RoachAvatar[];
export type InkLook = (typeof INK_LOOKS)[number];

/** A look as ink draws it, by name or by its number in ROACH_AVATARS: its own ink picture, or the hood's */
export const inkLook = (look: string | number): InkLook =>
  typeof look === "number" ? (INK_LOOKS[look] ?? "hood") : (INK_LOOKS.find((l) => l === look) ?? "hood");

/** Where a look's ink picture is */
export const inkPicture = (look: string | number) => `/avatars/ink-${inkLook(look)}.webp`;
