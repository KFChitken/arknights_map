import { T } from "@/i18n";
import { FISH_ITEMS, itemOf } from "@/lib/fish/items";

/** 钓鳞's items in words: by key (zh.ts fish.items), a name with its variant, a size, a picture */

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

/** A size in hundredths of a cm, as 38.07 */
export const cmText = (cm: number) => (cm / 100).toFixed(2);
