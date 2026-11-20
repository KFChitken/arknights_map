"use client";

import type { CSSProperties } from "react";
import { T } from "@/i18n";
import { itemOf, VARIANT_KEYS } from "@/lib/fish/items";

/**
 * 钓鳞's items on the game's warehouse discs: round, cement grey inside (dark with its colour rising from below for
 * purple, gold and red), a thin black line and the rarity's colour round the edge (fish.css, where every colour is kept
 * in one place); the picture a little bigger, up to the left, over the edge; the size where the game writes how many.
 * A variant is the same picture through its filter or scale; one not caught yet, its dark shape on a paler disc.
 */

type Words = { name: string; use: string; flavor: string; hint?: string };

/** An item's words (zh.ts fish.items), by its key */
export const wordsOf = (key: string): Words | null => (T.fish.items as Record<string, Words | undefined>)[key] ?? null;

/** An item's name with its variant before it, or ？？？ for one with no words yet */
export function nameOf(no: number, variant = 0): string {
  const w = wordsOf(itemOf(no)?.key ?? "");
  return w?.name ? `${T.fish.variants[variant] ?? ""}${w.name}` : T.fish.dexPage.unknown;
}

/** Its picture, by key (public/fish) */
export const picOf = (key: string) => `/fish/${key}.webp`;

/** A size in hundredths of a cm, as 38.07 */
export const cmText = (cm: number) => (cm / 100).toFixed(2);

export default function FishCard({
  no,
  variant = 0,
  size,
  locked = false,
  cm = null,
  bare = false,
  className = "",
}: {
  no: number;
  variant?: number;
  size: number;
  locked?: boolean;
  /** Written where the game writes how many, in hundredths of a cm */
  cm?: number | null;
  /** The disc alone, no picture (the rarity's mark) */
  bare?: boolean;
  className?: string;
}) {
  const item = itemOf(no);
  if (!item) return null;
  return (
    <span className={`fish-disc r${item.tier}${locked ? " locked" : ""} ${className}`} style={{ "--d": `${size}px`, width: size, height: size } as CSSProperties}>
      {!bare && (
        // eslint-disable-next-line @next/next/no-img-element -- small pictures of our own, already sized
        <img src={picOf(item.key)} alt="" className={variant ? `v-${VARIANT_KEYS[variant]}` : undefined} loading="lazy" />
      )}
      {cm !== null && (
        <span className="cnt" style={{ fontSize: Math.round(size * 0.16) }}>
          {cmText(cm)}
          <small>cm</small>
        </span>
      )}
    </span>
  );
}
