"use client";

import { T } from "@/i18n";
import type { PaintingTier } from "@/lib/si";
import { scrollSvg } from "@/lib/siArt";

/** 祀掌柜's scroll with today's painting on it (src/lib/siArt.ts), as a picture on the page */
export function SiScrollArt({ tier, size }: { tier: PaintingTier; size: number }) {
  return (
    <span
      className="si-scroll-art"
      style={{ width: size * 0.6, height: size }}
      role="img"
      aria-label={T.guides.si.todaysPainting}
      dangerouslySetInnerHTML={{ __html: scrollSvg(tier) }}
    />
  );
}
