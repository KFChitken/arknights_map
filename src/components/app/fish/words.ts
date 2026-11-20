import { fmt, T } from "@/i18n";
import { FISH_ITEMS, gramsOf, itemOf } from "@/lib/fish/items";

/** 钓鳞's items in words: by key (zh.ts fish.items), a name with its variant, a weight, a picture */

type Words = { name: string; use: string; flavor: string; hint?: string };

/** An item's words (zh.ts fish.items), by its key */
export const wordsOf = (key: string): Words | null => (T.fish.items as Record<string, Words | undefined>)[key] ?? null;

/** An item's name with its variant before it, or ??? for one with no words yet */
export function nameOf(no: number, variant = 0): string {
  const w = wordsOf(itemOf(no)?.key ?? "");
  return w?.name ? `${T.fish.variants[variant] ?? ""}${w.name}` : T.fish.dexPage.unknown;
}

const PIC = new Map(FISH_ITEMS.flatMap((i) => (i.pic ? [[i.key, i.pic] as const] : [])));
/** Its picture, by key: ours in public/fish; a 方舟原物's from our servers' fish-art/, by its file */
export const picOf = (key: string) => {
  const pic = PIC.get(key);
  return pic ? `/fish-art/${pic}` : `/fish/${key}.webp`;
};

/**
 * A catch's weight from its size (in hundredths of a cm, as kept), as its number and unit: under 10 g to a tenth
 * (5.8 g), under 1 kg in whole grams (613 g), under 1000 kg to a hundredth (1.60 kg), and tons from there (2.29 t);
 * each unit taking over where the one before would round up to it. Null for one not weighed.
 */
export function weightOf(no: number, cm: number | null): [string, string] | null {
  const g = gramsOf(no, cm);
  if (g === null) return null;
  if (Number(g.toFixed(1)) < 10) return [g.toFixed(1), "g"];
  if (Math.round(g) < 1000) return [String(Math.round(g)), "g"];
  if (Number((g / 1000).toFixed(2)) < 1000) return [(g / 1000).toFixed(2), "kg"];
  return [(g / 1e6).toFixed(2), "t"];
}

/** The same in one piece, as 1.60 kg */
export function weightText(no: number, cm: number | null): string | null {
  const w = weightOf(no, cm);
  return w && `${w[0]} ${w[1]}`;
}

/** After a name in a line said of a catch (fish.sized, as 「 · 1.60 kg」), or nothing for one not weighed */
export function weightAfterName(no: number, cm: number | null): string {
  const w = weightText(no, cm);
  return w ? fmt(T.fish.sized, { w }) : "";
}
