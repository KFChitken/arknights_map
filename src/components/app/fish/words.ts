import { T } from "@/i18n";
import { itemOf } from "@/lib/fish/items";

/** 钓鳞's items in words: by key (zh.ts fish.items), a name with its variant, a size, a picture */

type Words = { name: string; use: string; flavor: string; hint?: string };

/** An item's words (zh.ts fish.items), by its key */
export const wordsOf = (key: string): Words | null => (T.fish.items as Record<string, Words | undefined>)[key] ?? null;

/** An item's name with its variant before it, or ??? for one with no words yet */
export function nameOf(no: number, variant = 0): string {
  const w = wordsOf(itemOf(no)?.key ?? "");
  return w?.name ? `${T.fish.variants[variant] ?? ""}${w.name}` : T.fish.dexPage.unknown;
}

/** Its picture, by key (public/fish) */
export const picOf = (key: string) => `/fish/${key}.webp`;

/** A size in hundredths of a cm, as 38.07 */
export const cmText = (cm: number) => (cm / 100).toFixed(2);
