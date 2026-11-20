"use client";

import type { CSSProperties } from "react";
import { itemOf, VARIANT_KEYS } from "@/lib/fish/items";
import { cmText, picOf } from "./words";

/**
 * 钓鳞's items on the game's warehouse discs: round, cement grey inside (dark with its colour rising from below for
 * purple, gold and red), a thin black line and the rarity's colour round the edge (fish.css, where every colour is kept
 * in one place); the picture a little bigger, up to the left, over the edge; the size where the game writes how many.
 * A variant is the same picture through its filter or scale; one not caught yet, its dark shape on a paler disc. A
 * 方舟原物's picture is the game's own disc already (its grey and its ring in it): shown as it is, darkened whole while
 * not caught, and only the bare rarity mark is ours.
 */

export { cmText, nameOf, picOf, wordsOf } from "./words";

export default function FishCard({
  no,
  variant = 0,
  size,
  locked = false,
  cm = null,
  count,
  bare = false,
  className = "",
}: {
  no: number;
  variant?: number;
  size: number;
  locked?: boolean;
  /** Written where the game writes how many, in hundredths of a cm */
  cm?: number | null;
  /** How many, written there instead (自动钓's 收网) */
  count?: number;
  /** The disc alone, no picture (the rarity's mark) */
  bare?: boolean;
  className?: string;
}) {
  const item = itemOf(no);
  if (!item) return null;
  return (
    <span
      className={`fish-disc r${item.tier}${item.cat === "game" && !bare ? " game" : ""}${locked ? " locked" : ""} ${className}`}
      style={{ "--d": `${size}px`, width: size, height: size } as CSSProperties}
    >
      {!bare && (
        // eslint-disable-next-line @next/next/no-img-element -- small pictures of our own, already sized
        <img src={picOf(item.key)} alt="" className={variant ? `v-${VARIANT_KEYS[variant]}` : undefined} loading="lazy" />
      )}
      {count !== undefined ? (
        <span className="cnt" style={{ fontSize: Math.round(size * 0.22) }}>
          {count}
        </span>
      ) : (
        cm !== null && (
          <span className="cnt" style={{ fontSize: Math.round(size * 0.16) }}>
            {cmText(cm)}
            <small>cm</small>
          </span>
        )
      )}
    </span>
  );
}
