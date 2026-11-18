"use client";

import { useLayoutEffect, useState } from "react";

/** Looked at again this often */
const LOOK_MS = 250;

/** Where it stands: its bottom (px up from the window's), and the part of the screen across it is in the middle of */
export type Spot = { bottom: number; left: number; width: number };

/**
 * Where 一起听's disco stands over the map in a room: across, the map's own part of the screen (beside 抽屉's drawer on
 * a computer), right of the player where it is open at the left; up from the bottom, the highest of what stands there:
 * what each layout marks along its bottom (data-chrome-bottom: its bar, 听歌's little bar and its handle, 抽屉's tabs,
 * 游戏风's round buttons; in the lower half, as 抽屉's drawer down the side of a computer is marked too), and what stands
 * on that (the row of 短评, ListenOverlay.tsx; 卫戍中, SquadBar.tsx). The stage stands on it (ListenStage.tsx), and
 * 拉远 keeps its roaches and its line over it (ListenFar.tsx).
 */
export function readSpot(): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const seen = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
  const wrap = document.querySelector(".map-wrap")?.getBoundingClientRect();
  let left = wrap ? Math.max(0, wrap.left) : 0;
  const right = wrap && wrap.width > 0 ? Math.min(vw, wrap.right) : vw;
  const player = document.querySelector(".listen-float")?.getBoundingClientRect();
  if (player && seen(player) && player.left < (left + right) / 2) left = Math.max(left, player.right + 12);
  const tops = [...document.querySelectorAll<HTMLElement>("[data-chrome-bottom], .lm-strip, .sq-bar")]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => seen(r) && r.top > vh / 2 && r.right > left && r.left < right)
    .map((r) => r.top);
  const floor = tops.length ? Math.min(...tops) : vh - 16;
  return { bottom: Math.round(vh - floor), left: Math.round(left), width: Math.round(Math.max(0, right - left)) };
}

/** readSpot, looked at again every LOOK_MS (what it stands on moves: the little bar pulled out, the row of 短评 popping up) and as the window changes */
export function useSpot(): Spot | null {
  const [spot, setSpot] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    let last = "";
    const look = () => {
      const s = readSpot();
      const k = `${s.bottom}|${s.left}|${s.width}`;
      if (k === last) return;
      last = k;
      setSpot(s);
    };
    look();
    const t = window.setInterval(look, LOOK_MS);
    window.addEventListener("resize", look);
    window.visualViewport?.addEventListener("resize", look);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("resize", look);
      window.visualViewport?.removeEventListener("resize", look);
    };
  }, []);
  return spot;
}
