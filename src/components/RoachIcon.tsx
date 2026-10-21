"use client";

import { useEffect, useState } from "react";
import { roachIconUrl, usesPicture } from "@/lib/roachImages";
import { roachDataUrl, type RoachOpts } from "@/lib/roachSvg";
import type { RoachColor } from "@/lib/types";

/** A roach icon for the UI; looks that are pictures are composed on a canvas first. */
export default function RoachIcon({ color, size, ...opts }: RoachOpts & { color: RoachColor; size: number }) {
  const picture = usesPicture(opts);
  const key = JSON.stringify([color, opts, size]);
  const [src, setSrc] = useState<string | null>(picture ? null : roachDataUrl(color, opts));

  useEffect(() => {
    if (!picture) {
      setSrc(roachDataUrl(color, opts));
      return;
    }
    let live = true;
    roachIconUrl(color, opts, size * 2).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return src ? (
    <img src={src} width={size} height={size} alt="" />
  ) : (
    <span style={{ display: "inline-block", width: size, height: size, flexShrink: 0 }} />
  );
}
