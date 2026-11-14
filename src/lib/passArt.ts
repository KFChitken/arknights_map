import type { PassChar } from "./passCatalog";

/**
 * The characters' pictures (立绘) on passes, as the page gets them (/api/pass-art, src/lib/server/passArt.ts):
 * catalogue id → [the files' name, the pass's colour picked from the picture (null: the catalogue's)]. A character
 * missing has no picture here, or it is switched off: their pass shows the small picture instead, else a figure.
 * Each character's files: <file>.avif and <file>.webp 480 wide (the whole pass), <file>.s.webp 240 wide (small
 * passes), <file>.b.webp 20 wide (the blur shown while the picture comes, and all that shows to save data).
 */
export type PassArtList = Record<string, readonly [file: string, color: string | null]>;

export type PassArtSize = "big" | "small" | "blur";
const SUFFIX: Record<PassArtSize, string> = { big: "", small: ".s", blur: ".b" };
export const passArtUrl = (file: string, size: PassArtSize, format: "avif" | "webp" = "webp") =>
  `/operator-art/pass/${file}${SUFFIX[size]}.${size === "big" ? format : "webp"}`;

/** A character's picture, if any */
export const passArtFile = (list: PassArtList | null, charId: number): string | null => list?.[charId]?.[0] ?? null;
/** The colour of a character's pass: picked from their picture where there is one, else the catalogue's */
export const passColor = (list: PassArtList | null, c: Pick<PassChar, "id" | "color">): string => list?.[c.id]?.[1] ?? c.color;
